import {expect,it} from 'vitest';
import {randomUUID} from 'node:crypto';
import {resolve} from 'node:path';
import type {Surface} from '../../packages/schema/index';
import {sectionDesignDomain} from '../../packages/surface/design-section';
import {request} from '../../apps/desktop/main/worker';
import {nativeSurfaceResponseSchema} from '../../packages/surface/native-report';
// @ts-expect-error Exact dyadic orientation oracle has no production TS dependency.
import {triangleOrientation} from '../fixtures/independent-triangle-orientation.mjs';

function source(options:{flip?:boolean;divisions?:number;reverse?:boolean;nearVertex?:boolean;lockedBank?:boolean}={}){
 const xs=[-500,-300,-100,0,480,484,500],ys=[-100,0,20,100],vertices:Surface['vertices']=[],faces:Surface['faces']=[],ids=new Map<string,string>(),n=options.divisions??1;
 const at=(x:number,y:number)=>{const key=x+','+y;let id=ids.get(key);if(!id){id=randomUUID();ids.set(key,id);vertices.push({id,xMm:x,yMm:options.nearVertex&&x===-300&&y===0?1e-5:y,zMm:0});}return id;};
 for(let j=0;j<ys.length-1;j++)for(let i=0;i<xs.length-1;i++){
  const cx=(xs[i]+xs[i+1])/2,cy=(ys[j]+ys[j+1])/2;if(!(cy<0||cx< -100||cx>480&&cx<484&&cy<20))continue;
  for(let y=0;y<n;y++)for(let x=0;x<n;x++){const a=xs[i]+(xs[i+1]-xs[i])*x/n,b=xs[i]+(xs[i+1]-xs[i])*(x+1)/n,c=ys[j]+(ys[j+1]-ys[j])*y/n,d=ys[j]+(ys[j+1]-ys[j])*(y+1)/n,quad=[at(a,c),at(b,c),at(b,d),at(a,d)];for(const t of options.flip?[[0,1,3],[1,2,3]]:[[0,1,2],[0,2,3]])faces.push({id:randomUUID(),region:'design:#315579',vertices:t.map(i=>quad[i]) as [string,string,string]});}
 }
 const cutConstraints:NonNullable<Surface['cutConstraints']>=[];
 if(options.lockedBank){const a=ids.get('480,0')!,b=ids.get('484,0')!,copy=new Map<string,string>();for(const id of [a,b]){const v=vertices.find(v=>v.id===id)!,next=randomUUID();vertices.push({...v,id:next});copy.set(id,next);}for(const f of faces)if(f.vertices.map(id=>vertices.find(v=>v.id===id)!).every(v=>v.xMm>=480&&v.xMm<=484&&v.yMm>=0))f.vertices=f.vertices.map(id=>copy.get(id)??id) as [string,string,string];cutConstraints.push({a,b,locked:true},{a:copy.get(a)!,b:copy.get(b)!,locked:true});}
 if(options.reverse){vertices.reverse();faces.reverse();}return{id:randomUUID(),topologyVersion:1,source:'obj',vertices,faces,...(cutConstraints.length?{cutConstraints}:{})} as Surface;
}
function area(surface:Surface,face:Surface['faces'][number]){const v=new Map(surface.vertices.map(v=>[v.id,v])),[a,b,c]=face.vertices.map(id=>v.get(id)!);return Math.abs((b.xMm-a.xMm)*(c.yMm-a.yMm)-(b.yMm-a.yMm)*(c.xMm-a.xMm))/2;}
function checked(input:Surface){
 const before=structuredClone(input),result=sectionDesignDomain(input,input.faces,randomUUID);expect(result).toBeDefined();expect(result!.plane.aligned).toBe(true);expect(result!.plane.normal).toEqual([0,1,0]);expect(result!.plane.position).toBeCloseTo(0,12);
 const parts=result!.parts,all=parts.flat(),original=new Map(input.vertices.map(v=>[v.id,v])),points=new Map(result!.surface.vertices.map(v=>[v.id,v]));expect(parts.length).toBeGreaterThanOrEqual(2);expect(parts.length).toBeLessThanOrEqual(4);expect(new Set(all.map(f=>f.id)).size).toBe(all.length);expect(new Set(all.map(f=>f.id))).toEqual(new Set(result!.surface.faces.map(f=>f.id)));
 for(const parent of input.faces){const children=result!.children.get(parent.id);if(!children){expect(all.filter(f=>f.id===parent.id)).toEqual([parent]);continue;}let covered=0;
  for(const c of children){const [a,b,d]=c.triangle;covered+=((b[0]-a[0])*(d[1]-a[1])-(b[1]-a[1])*(d[0]-a[0]))/1e6;expect(area(result!.surface,c.face)).toBeGreaterThan(0);c.triangle.forEach(([u,v],i)=>{const w=[1-(u+v)/1000,u/1000,v/1000],p=points.get(c.face.vertices[i])!;for(const axis of ['xMm','yMm','zMm'] as const)expect(Math.abs(p[axis]-w.reduce((s,n,k)=>s+n*original.get(parent.vertices[k])![axis],0))).toBeLessThan(1e-8);});
   for(const [u,v] of c.triangle){expect(u).toBeGreaterThanOrEqual(-1e-9);expect(v).toBeGreaterThanOrEqual(-1e-9);expect(u+v).toBeLessThanOrEqual(1000+1e-9);}
  }expect(covered).toBeCloseTo(1,10);expect(children.reduce((s,c)=>s+area(result!.surface,c.face),0)).toBeCloseTo(area(input,parent),7);
 }
 const total=input.faces.reduce((s,f)=>s+area(input,f),0),partAreas=parts.map(part=>part.reduce((s,f)=>s+area(result!.surface,f),0));expect(partAreas.reduce((s,n)=>s+n,0)).toBeCloseTo(total,7);for(const a of partAreas)expect(a/total).toBeGreaterThanOrEqual(.02);
 // The real 4 x 20 mm authored tip stays cloth; it is rejoined rather than deleted.
 const tipFaces=input.faces.filter(f=>f.vertices.map(id=>original.get(id)!).every(v=>v.xMm>=480&&v.xMm<=484&&v.yMm>=0));expect(tipFaces.reduce((s,f)=>s+area(input,f),0)).toBeCloseTo(80,10);expect(input).toEqual(before);return result!;
}

it('long material-edge continuation is invariant to diagonal flips, densification and reverse storage',()=>{
 const runs:number[][]=[];for(const options of [{},{flip:true},{divisions:2},{divisions:2,flip:true,reverse:true}]){const p=source(options),r=checked(p);runs.push(r.parts.map(part=>part.reduce((sum,f)=>sum+area(r.surface,f),0)).sort((a,b)=>a-b));}
 for(const a of runs){expect(a).toHaveLength(2);a.forEach((n,i)=>expect(n).toBeCloseTo(runs[0][i],7));}
});

it('an already-open locked bank is never rejoined to consume the genuine small motif',()=>{
 const p=source({lockedBank:true}),before=structuredClone(p),r=sectionDesignDomain(p,p.faces,randomUUID);expect(r).toBeUndefined();expect(p).toEqual(before);expect(p.cutConstraints).toHaveLength(2);expect(p.cutConstraints!.every(e=>e.locked)).toBe(true);
});

it('an original locked edge on the proposed continuation cannot become the small island rejoining route',()=>{
 const p=source(),at=(x:number,y:number)=>p.vertices.find(v=>v.xMm===x&&v.yMm===y)!.id;
 p.cutConstraints=[{a:at(480,0),b:at(484,0),locked:true}];const before=structuredClone(p),r=sectionDesignDomain(p,p.faces,randomUUID);
 // The y=0 proposal would have to close this protected 4 mm bank to absorb
 // the 80 mm² tip. A different valid section is allowed; closing that bank is not.
 if(r){expect(Math.abs(r.plane.normal[1]-1)<1e-12&&Math.abs(r.plane.position)<1e-12).toBe(false);expect(r.surface.cutConstraints).toEqual(p.cutConstraints);}
 expect(p).toEqual(before);
});

it('equal shared lengths choose the same physical neighbour under new IDs, diagonal flips, subdivision and reverse order',()=>{
 // Deliberately roomy cloth isolates deterministic neighbour selection from
 // the independent 2/4/8/16/32 mm corridor rejection: the authored bridge is
 // 40 mm deep, so this test never asks the guard to accept a narrow new strip.
 for(const options of [{},{flip:true},{divisions:2},{divisions:2,flip:true,reverse:true}]){
  const vertices:Surface['vertices']=[],faces:Surface['faces']=[],ids=new Map<string,string>(),n=options.divisions??1,xs=[-350000,-250000,-150000,-50000,50000,150000],ys=[-5000,0,40,5000];
  const at=(x:number,y:number)=>{const key=x+','+y;let id=ids.get(key);if(!id){id=randomUUID();ids.set(key,id);vertices.push({id,xMm:x,yMm:y,zMm:0});}return id;};
  for(let row=0;row<3;row++)for(let col=0;col<5;col++){if(!(row===0&&col!==3||row>0&&col===0||row===1&&col>=2))continue;for(let y=0;y<n;y++)for(let x=0;x<n;x++){const a=xs[col]+(xs[col+1]-xs[col])*x/n,b=xs[col]+(xs[col+1]-xs[col])*(x+1)/n,c=ys[row]+(ys[row+1]-ys[row])*y/n,d=ys[row]+(ys[row+1]-ys[row])*(y+1)/n,q=[at(a,c),at(b,c),at(b,d),at(a,d)];for(const t of options.flip?[[0,1,3],[1,2,3]]:[[0,1,2],[0,2,3]])faces.push({id:randomUUID(),region:'design:#315579',vertices:t.map(i=>q[i]) as [string,string,string]});}}
  if(options.reverse){vertices.reverse();faces.reverse();}const p:Surface={id:randomUUID(),source:'obj',topologyVersion:1,vertices,faces},before=structuredClone(p),r=sectionDesignDomain(p,p.faces,randomUUID);expect(r).toBeDefined();expect(r!.plane.aligned).toBe(true);expect(r!.plane.normal).toEqual([0,1,0]);expect(r!.plane.position).toBe(0);expect(r!.parts).toHaveLength(3);
  const points=new Map(r!.surface.vertices.map(v=>[v.id,v])),left=r!.parts.find(part=>part.some(f=>f.vertices.every(id=>points.get(id)!.xMm<0)&&f.vertices.some(id=>points.get(id)!.yMm<0)))!;
  expect(left.reduce((sum,f)=>sum+area(r!.surface,f),0)).toBeCloseTo(1512000000,4);for(const other of r!.parts.filter(part=>part!==left))expect(other.reduce((sum,f)=>sum+area(r!.surface,f),0)).toBeCloseTo(500000000,4);
  expect(new Set(r!.parts.flatMap(part=>part.map(f=>f.id)))).toEqual(new Set(r!.surface.faces.map(f=>f.id)));expect(p).toEqual(before);
 }
});

it('aligned near-vertex skinny children keep real quality through an actual native solve of every complete panel',async()=>{
 const p=source({nearVertex:true}),r=checked(p),vertices=new Map(r.surface.vertices.map(v=>[v.id,v]));let skinny=0;
 for(const f of r.surface.faces){const v=f.vertices.map(id=>vertices.get(id)!),longest=Math.max(...v.map((a,i)=>Math.hypot(a.xMm-v[(i+1)%3].xMm,a.yMm-v[(i+1)%3].yMm)));if(2*area(r.surface,f)/longest**2<.015)skinny++;}
 expect(skinny).toBeGreaterThan(0);
 for(const faces of r.parts){const used=new Set(faces.flatMap(f=>f.vertices)),result=nativeSurfaceResponseSchema.parse(await request(resolve('target/release/fpcad-worker.exe'),{protocolVersion:1,operation:'surface.unwrap',mesh:{vertices:r.surface.vertices.filter(v=>used.has(v.id)),faces,method:'lscm',repair_cuts:false}},undefined,{timeoutMs:120000,bytes:16*1024*1024}));expect(result.patches).toHaveLength(1);const panel=result.patches[0],uv=new Map(panel.uv.map(v=>[v.vertexId,[v.xMm,v.yMm]]));expect(new Set(panel.faceIds)).toEqual(new Set(faces.map(f=>f.id)));expect(panel.areaErrorMax).toBeLessThanOrEqual(.15);expect(panel.edgeErrorMax).toBeLessThanOrEqual(.1);expect(panel.distortionMax).toBeLessThanOrEqual(.15);
  // Independently remeasure the actual stored UV, including the very thin
  // children. Passing reported metrics alone cannot certify physical scale.
  for(const f of faces){const flat=f.vertices.map(id=>uv.get(id)!);expect(triangleOrientation(flat)).toBe(1);const [a,b,c]=flat,uvArea=Math.abs((b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]))/2;expect(Math.abs(uvArea/area(r.surface,f)-1)).toBeLessThanOrEqual(.15);
   f.vertices.forEach((id,i)=>{const p=vertices.get(id)!,q=vertices.get(f.vertices[(i+1)%3])!,physical=Math.hypot(p.xMm-q.xMm,p.yMm-q.yMm,p.zMm-q.zMm),length=Math.hypot(flat[i][0]-flat[(i+1)%3][0],flat[i][1]-flat[(i+1)%3][1]);expect(Math.abs(length/physical-1)).toBeLessThanOrEqual(.1);});
  }
 }
},30000);
