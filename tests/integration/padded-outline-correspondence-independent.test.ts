import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {expect,it} from 'vitest';
import type {Binding,Piece,Surface} from '../../packages/schema/index';
import {designManufacturingOutline} from '../../apps/desktop/main/design-outline';

type XY=[number,number];
type Capture={provenance:{tipId:string};source:Pick<Surface,'vertices'|'faces'>;trim:NonNullable<Binding['trim']>;report:Binding['report'];paper:Piece};
const bytes=readFileSync(new URL('../fixtures/padded-manufacturing-spur.json',import.meta.url));
const capture=JSON.parse(bytes.toString('utf8')) as Capture;
const xy=(p:{xMm:number;yMm:number}):XY=>[p.xMm,p.yMm];
const flat=new Map(capture.trim.vertices.map(p=>[p.id,p]));
const boundary=capture.report.boundary.map(id=>xy(flat.get(id)!));
const tip=xy(flat.get(capture.provenance.tipId)!);

// Independent finite-segment measurements. Neither the captured report's
// claimed tolerance nor the production normalization supplies this verdict.
function segmentDistance(p:XY,a:XY,b:XY){
 const dx=b[0]-a[0],dy=b[1]-a[1],length=dx*dx+dy*dy;
 const t=length?Math.max(0,Math.min(1,((p[0]-a[0])*dx+(p[1]-a[1])*dy)/length)):0;
 return Math.hypot(p[0]-a[0]-t*dx,p[1]-a[1]-t*dy);
}
const ringDistance=(p:XY,ring:XY[])=>Math.min(...ring.map((a,i)=>segmentDistance(p,a,ring[(i+1)%ring.length])));
function signedArea(ring:XY[]){
 const origin=ring[0];return ring.reduce((sum,a,i)=>{const b=ring[(i+1)%ring.length];return sum+(a[0]-origin[0])*(b[1]-origin[1])-(a[1]-origin[1])*(b[0]-origin[0]);},0)/2;
}
function rawBoundaryEdges(){
 const groups=new Map<string,{a:XY;b:XY;ids:string[]}[]>();
 for(const t of capture.trim.triangles)for(let i=0;i<3;i++){
  const ids=[t.vertices[i],t.vertices[(i+1)%3]],key=[...ids].sort().join(':');
  groups.set(key,[...(groups.get(key)??[]),{a:xy(flat.get(ids[0])!),b:xy(flat.get(ids[1])!),ids}]);
 }
 return [...groups.values()].filter(g=>g.length===1).map(g=>g[0]);
}

it('the native capture contains a real original-surface corner and two exposed trim edges, not an invented zero-area point',()=>{
 expect(createHash('sha256').update(bytes).digest('hex')).toBe('84e04699e082e29f19e3e384877d429afa82e7c412b8039089de8c937c23b06b');
 expect(capture.trim.triangles).toHaveLength(45);expect(capture.source.faces).toHaveLength(15);
 const world=new Map(capture.source.vertices.map(v=>[v.id,v])),faces=new Map(capture.source.faces.map(f=>[f.id,f]));
 expect(world.has(capture.provenance.tipId)).toBe(true);
 for(const face of capture.source.faces){
  const [a,b,c]=face.vertices.map(id=>world.get(id)!);
  const u=[b.xMm-a.xMm,b.yMm-a.yMm,b.zMm-a.zMm],v=[c.xMm-a.xMm,c.yMm-a.yMm,c.zMm-a.zMm];
  expect(Math.hypot(u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0])).toBeGreaterThan(0);
 }
 const atTip=capture.trim.triangles.filter(t=>t.vertices.includes(capture.provenance.tipId));expect(atTip).toHaveLength(9);
 for(const t of atTip){
  const weights=t.barycentric[t.vertices.indexOf(capture.provenance.tipId)],face=faces.get(t.faceId)!;
  expect(weights.filter(w=>w===1)).toHaveLength(1);expect(weights.filter(w=>w===0)).toHaveLength(2);
  expect(face.vertices[weights.indexOf(1)]).toBe(capture.provenance.tipId);
  const points=t.vertices.map(id=>xy(flat.get(id)!));expect(Math.abs(signedArea(points))).toBeGreaterThan(0);
 }
 const exposed=rawBoundaryEdges().filter(e=>e.ids.includes(capture.provenance.tipId));expect(exposed).toHaveLength(2);
 const bases=exposed.map(e=>e.ids.find(id=>id!==capture.provenance.tipId)!).map(id=>xy(flat.get(id)!));
 expect(Math.hypot(bases[0][0]-bases[1][0],bases[0][1]-bases[1][1])).toBeGreaterThan(0);
 expect(Math.hypot(bases[0][0]-bases[1][0],bases[0][1]-bases[1][1])).toBeLessThan(1e-6);
 expect(segmentDistance(tip,bases[0],bases[1])).toBeGreaterThan(5e-4);
});

it('strict manufacturing normalization retains the captured positive-area tip within its 1e-6 mm stage budget without altering any source or trim triangle',()=>{
 const before=structuredClone(capture),input={outer:structuredClone(boundary),holes:[] as XY[][]};
 const result=designManufacturingOutline(input,1e-6);
 expect(ringDistance(tip,result.outer)).toBeLessThanOrEqual(1e-6);
 for(const p of input.outer)expect(ringDistance(p,result.outer)).toBeLessThanOrEqual(1e-6);
 for(const p of result.outer)expect(ringDistance(p,input.outer)).toBeLessThanOrEqual(1e-6);
 expect(Math.sign(signedArea(result.outer))).toBe(Math.sign(signedArea(boundary)));
 const perimeter=boundary.reduce((sum,p,i)=>{const q=boundary[(i+1)%boundary.length];return sum+Math.hypot(p[0]-q[0],p[1]-q[1]);},0);
 expect(Math.abs(signedArea(result.outer)-signedArea(boundary))).toBeLessThanOrEqual(perimeter*1e-6);
 // Check the actual exposed triangle boundary too. A retained report outline
 // cannot excuse damage to a source feature omitted from that report.
 for(const e of rawBoundaryEdges())for(const p of [e.a,e.b,[(e.a[0]+e.b[0])/2,(e.a[1]+e.b[1])/2] as XY])expect(ringDistance(p,result.outer)).toBeLessThanOrEqual(1e-4);
 expect(capture).toEqual(before);expect(input.outer).toEqual(boundary);
});

it('rejects the captured 13-node paper outline even though its area change is tiny and it declares a 1e-4 mm boundary tolerance',()=>{
 const oldPaper=capture.paper.nodes.map(xy),deviation=ringDistance(tip,oldPaper);
 expect(oldPaper).toHaveLength(13);expect(boundary).toHaveLength(15);
 expect(deviation).toBeCloseTo(.0005722916360108098,12);
 expect(deviation).toBeGreaterThan(1e-4);
 expect(deviation).toBeGreaterThan(capture.report.boundaryToleranceMm!);
 // An area-only test misses this manufacturing correspondence regression.
 expect(Math.abs(signedArea(oldPaper)-signedArea(boundary))).toBeLessThan(1e-6);
});
