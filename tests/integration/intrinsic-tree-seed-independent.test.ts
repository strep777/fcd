import {readFileSync} from 'node:fs';
import {createHash,randomUUID} from 'node:crypto';
import {resolve} from 'node:path';
import {expect,it} from 'vitest';
import type {Binding,Surface,SurfaceReport} from '../../packages/schema/index';
import {request} from '../../apps/desktop/main/worker';
import {intrinsicTreeSeed} from '../../packages/surface/intrinsic-tree-seed';
import {nativeSurfaceResponseSchema} from '../../packages/surface/native-report';
import {mapFromSurface,mapToSurface} from '../../packages/surface/mapping';

const bytes=readFileSync(new URL('../fixtures/intrinsic-tree-three-face.json',import.meta.url));
const fixture=JSON.parse(bytes.toString('utf8')) as Surface;
const worker=resolve('target/release/fpcad-worker.exe');
const xyz=(p:Surface['vertices'][number])=>[p.xMm,p.yMm,p.zMm];
const xy=(p:SurfaceReport['uv'][number])=>[p.xMm,p.yMm];
const sub=(a:number[],b:number[])=>a.map((v,i)=>v-b[i]);
const cross=(a:number[],b:number[])=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
const length=(a:number[],b:number[])=>Math.hypot(...sub(a,b));

async function solve(seed?:SurfaceReport['uv']){
 const raw=await request(worker,{protocolVersion:1,operation:'surface.unwrap',mesh:{vertices:fixture.vertices,faces:fixture.faces,method:'arap-seamed',iterations:100,repair_cuts:false,...(seed?{initial_uv:seed}:{})}},undefined,{timeoutMs:120000,bytes:1024*1024});
 expect(raw).toMatchObject({ok:true,protocolVersion:1});
 return (raw as {patches:SurfaceReport[]}).patches;
}

function assertPhysicalChart(uv:SurfaceReport['uv']){
 const world=new Map(fixture.vertices.map(p=>[p.id,xyz(p)])),flat=new Map(uv.map(p=>[p.vertexId,xy(p)]));
 expect(new Set(flat.keys())).toEqual(new Set(world.keys()));expect(flat.size).toBe(uv.length);
 let totalWorld=0,totalPaper=0,shortest=Infinity,longest=0;
 for(const face of fixture.faces){
  const p=face.vertices.map(id=>world.get(id)!),q=face.vertices.map(id=>flat.get(id)!);
  expect(q.flat().every(Number.isFinite)).toBe(true);
  const area3=Math.hypot(...cross(sub(p[1],p[0]),sub(p[2],p[0])))/2;
  const area2=((q[1][0]-q[0][0])*(q[2][1]-q[0][1])-(q[1][1]-q[0][1])*(q[2][0]-q[0][0]))/2;
  expect(area3).toBeGreaterThan(0);expect(area2,'Every original triangle retains positive winding').toBeGreaterThan(0);
  expect(Math.abs(area2/area3-1),'Each small triangle retains its physical area').toBeLessThanOrEqual(1e-6);
  totalWorld+=area3;totalPaper+=area2;
  for(let i=0;i<3;i++){
   const j=(i+1)%3,worldLength=length(p[i],p[j]),paperLength=length(q[i],q[j]);shortest=Math.min(shortest,worldLength);longest=Math.max(longest,worldLength);
   expect(Math.abs(paperLength-worldLength)).toBeLessThanOrEqual(1e-9);
   expect(Math.abs(paperLength/worldLength-1),'Even the micrometre edges remain at their true millimetre size').toBeLessThanOrEqual(1e-6);
  }
 }
 expect(shortest).toBeLessThan(2e-6);expect(longest).toBeGreaterThan(20);
 expect(Math.abs(totalPaper/totalWorld-1)).toBeLessThanOrEqual(1e-9);
}

it('unrolls the exact captured three-face strip without resizing, dropping a tiny face, or changing the source',()=>{
 expect(createHash('sha256').update(bytes).digest('hex')).toBe('eef15da8083b9e9247381e6624ca60a6d0740241cb76b02c503a65eca913a47a');
 expect(fixture.vertices).toHaveLength(5);expect(fixture.faces).toHaveLength(3);
 const before=structuredClone(fixture),seed=intrinsicTreeSeed(fixture);expect(seed).toBeDefined();assertPhysicalChart(seed!);expect(fixture).toEqual(before);
});

it('the actual native worker preserves all three physical faces in one chart with or without a seed',async()=>{
 const before=structuredClone(fixture),unseeded=await solve();
 const seed=intrinsicTreeSeed(fixture)!;expect(seed).toBeDefined();const saved=structuredClone(seed),seeded=await solve(seed);
 for(const patches of [unseeded,seeded]){
  expect(patches).toHaveLength(1);expect(new Set(patches[0].faceIds)).toEqual(new Set(fixture.faces.map(f=>f.id)));assertPhysicalChart(patches[0].uv);
  expect(patches[0].areaErrorMax).toBeLessThanOrEqual(.15);expect(patches[0].edgeErrorMax).toBeLessThanOrEqual(.1);expect(patches[0].distortionMax).toBeLessThanOrEqual(.15);
  expect(patches[0].seamLengthErrorMm).toBeDefined();expect(patches[0].seamLengthErrorMm!).toBeLessThanOrEqual(.25);
 }
 expect(seed).toEqual(saved);expect(fixture).toEqual(before);
},120000);

it('an independently reflected physical seed is rejected by the real native orientation check',async()=>{
 const original=intrinsicTreeSeed(fixture)!;expect(original).toBeDefined();
 const reflected=original.map(p=>({...p,xMm:-p.xMm}));
 await expect(solve(reflected)).rejects.toThrow('UNWRAP_FLIPPED');
},120000);

function analytic(points:number[][],triangles:number[][]):Surface{
 const vertices=points.map(([xMm,yMm,zMm=0])=>({id:randomUUID(),xMm,yMm,zMm}));
 return {id:randomUUID(),source:'obj',topologyVersion:1,vertices,faces:triangles.map(t=>({id:randomUUID(),vertices:t.map(i=>vertices[i].id) as [string,string,string],region:'cloth'}))};
}

it('declines a valid cyclic triangle fan instead of guessing an unrollable tree',()=>{
 const mesh=analytic([[0,0,1],[-2,-2],[2,-2],[2,2],[-2,2]],[[0,1,2],[0,2,3],[0,3,4],[0,4,1]]),before=structuredClone(mesh);
 expect(intrinsicTreeSeed(mesh)).toBeUndefined();expect(mesh).toEqual(before);
});

it('declines three triangles sharing one nonmanifold edge',()=>{
 const mesh=analytic([[0,0],[10,0],[0,10],[0,-10],[0,0,10]],[[0,1,2],[1,0,3],[0,1,4]]),before=structuredClone(mesh);
 expect(intrinsicTreeSeed(mesh)).toBeUndefined();expect(mesh).toEqual(before);
});

it('declines disconnected triangles rather than placing two unrelated sheets together',()=>{
 const mesh=analytic([[0,0],[10,0],[0,10],[20,0],[30,0],[20,10]],[[0,1,2],[3,4,5]]),before=structuredClone(mesh);
 expect(intrinsicTreeSeed(mesh)).toBeUndefined();expect(mesh).toEqual(before);
});

type GridCase={mesh:Surface;grid:string[][];width:number;height:number;netArea:number;holeArea:number;holes:number;windows:number[][]};
/** The oracle develops rigid cylinder facets by chord length, rather than by
 * the smooth radius*angle arc or any coordinates returned by production. */
function measuredGrid(columns:number,rows:number,kind:'plane'|'cylinder'|'saddle',holes=0):GridCase{
 const radius=160,angle=.09,stepY=20,chord=2*radius*Math.sin(angle/2),stepX=kind==='cylinder'?chord:120/columns;
 const windows=holes===1?[[3,5,3,5]]:holes===2?[[2,4,3,5],[8,10,3,5]]:[];
 const vertices:Surface['vertices']=[],grid:string[][]=[],faces:Surface['faces']=[];
 for(let j=0;j<=rows;j++){grid[j]=[];for(let i=0;i<=columns;i++){
  const id=randomUUID(),u=i*stepX,v=kind==='plane'?j*80/rows:j*stepY;grid[j][i]=id;
  // A tilted plane retains exactly the same 120 x 80 mm physical rectangle
  // at coarse and dense tessellations; the saddle has real Gaussian curvature.
  const p=kind==='plane'?[u*.6,v,u*.8]:kind==='cylinder'?[radius*Math.sin(i*angle),v,radius*Math.cos(i*angle)]:[u,v,.003*u*v];
  vertices.push({id,xMm:p[0],yMm:p[1],zMm:p[2]});
 }}
 for(let j=0;j<rows;j++)for(let i=0;i<columns;i++){
  if(windows.some(([x0,x1,y0,y1])=>i>=x0&&i<x1&&j>=y0&&j<y1))continue;
  const [a,b,c,d]=[grid[j][i],grid[j][i+1],grid[j+1][i+1],grid[j+1][i]];
  for(const ids of [[a,b,c],[a,c,d]])faces.push({id:randomUUID(),region:'cloth',vertices:ids as [string,string,string]});
 }
 const used=new Set(faces.flatMap(f=>f.vertices)),width=columns*stepX,height=kind==='plane'?80:rows*stepY,holeArea=4*stepX*stepY;
 return {mesh:{id:randomUUID(),source:'obj',topologyVersion:1,vertices:vertices.filter(v=>used.has(v.id)),faces},grid,width,height,netArea:width*height-holes*holeArea,holeArea,holes,windows};
}
function exactMeasuredChart(mesh:Surface,uv:SurfaceReport['uv'],expectedArea:number){
 const world=new Map(mesh.vertices.map(v=>[v.id,xyz(v)])),flat=new Map(uv.map(v=>[v.vertexId,xy(v)]));
 expect(flat.size).toBe(uv.length);expect(new Set(flat.keys())).toEqual(new Set(world.keys()));let total=0;
 for(const f of mesh.faces){
  const p=f.vertices.map(id=>world.get(id)!),q=f.vertices.map(id=>flat.get(id)!);
  const a3=Math.hypot(...cross(sub(p[1],p[0]),sub(p[2],p[0])))/2,a2=((q[1][0]-q[0][0])*(q[2][1]-q[0][1])-(q[1][1]-q[0][1])*(q[2][0]-q[0][0]))/2;
  expect(a2).toBeGreaterThan(0);expect(Math.abs(a2/a3-1)).toBeLessThanOrEqual(1e-6);total+=a2;
  for(let i=0;i<3;i++){const j=(i+1)%3;expect(Math.abs(length(p[i],p[j])-length(q[i],q[j]))).toBeLessThanOrEqual(1e-9);}
 }
 expect(Math.abs(total/expectedArea-1)).toBeLessThanOrEqual(1e-9);
}
async function certifiedGrid(f:GridCase){
 const before=structuredClone(f.mesh),seed=intrinsicTreeSeed(f.mesh);expect(seed).toBeDefined();exactMeasuredChart(f.mesh,seed!,f.netArea);
 const raw=await request(worker,{protocolVersion:1,operation:'surface.unwrap',mesh:{vertices:f.mesh.vertices,faces:f.mesh.faces,method:'lscm',repair_cuts:false,initial_uv:seed}},undefined,{timeoutMs:120000,bytes:8*1024*1024});
 const response=nativeSurfaceResponseSchema.parse(raw);expect(response.patches).toHaveLength(1);const report=response.patches[0];
 expect(new Set(report.faceIds)).toEqual(new Set(f.mesh.faces.map(v=>v.id)));exactMeasuredChart(f.mesh,report.uv,f.netArea);expect(report.holes??[]).toHaveLength(f.holes);
 const uv=new Map(report.uv.map(v=>[v.vertexId,v])),signed=(ring:string[])=>{const o=uv.get(ring[0])!;return ring.reduce((sum,id,i)=>{const a=uv.get(id)!,b=uv.get(ring[(i+1)%ring.length])!;return sum+(a.xMm-o.xMm)*(b.yMm-o.yMm)-(b.xMm-o.xMm)*(a.yMm-o.yMm);},0)/2;};
 expect(signed(report.boundary)).toBeCloseTo(f.width*f.height,6);for(const hole of report.holes??[])expect(signed(hole)).toBeCloseTo(-f.holeArea,6);
 const binding:Binding={pieceId:randomUUID(),surfaceId:f.mesh.id,topologyVersion:f.mesh.topologyVersion,geometryHash:'',surfaceHash:'',report};
 for(const face of f.mesh.faces){
  const w:[number,number,number]=[.2,.3,.5],point=mapFromSurface(binding,face.id,w,f.mesh);expect(point).not.toBeNull();const hit=mapToSurface(f.mesh,binding,point!);expect(hit).not.toBeNull();expect(hit!.faceId).toBe(face.id);hit!.barycentric.forEach((v,i)=>expect(v).toBeCloseTo(w[i],10));
 }
 const origin=uv.get(f.grid[0][0])!,right=uv.get(f.grid[0][f.grid[0].length-1])!,c=(right.xMm-origin.xMm)/f.width,s=(right.yMm-origin.yMm)/f.width;
 for(const [x0,x1,y0,y1]of f.windows){const x=(x0+x1)/2*f.width/(f.grid[0].length-1),y=(y0+y1)/2*20;expect(mapToSurface(f.mesh,binding,{xMm:origin.xMm+c*x-s*y,yMm:origin.yMm+s*x+c*y})).toBeNull();}
 await expect(request(worker,{protocolVersion:1,operation:'surface.unwrap',mesh:{vertices:f.mesh.vertices,faces:f.mesh.faces,method:'lscm',repair_cuts:false,initial_uv:seed!.map(p=>({...p,xMm:-p.xMm}))}})).rejects.toThrow('UNWRAP_FLIPPED');
 expect(f.mesh).toEqual(before);return report;
}

it('coarse and over-64-face coplanar tessellations retain the same exact physical rectangle through native certification and inverse mapping',async()=>{
 const coarse=measuredGrid(1,1,'plane'),dense=measuredGrid(12,8,'plane');expect(dense.mesh.faces.length).toBeGreaterThan(64);
 for(const f of [coarse,dense])await certifiedGrid(f);
 expect(coarse.netArea).toBe(9600);expect(dense.netArea).toBe(coarse.netArea);
},120000);

it.each([1,2])('an over-64-face open cylinder with %s holes closes every intrinsic cycle at actual chord width and survives native certification',async holes=>{
 const f=measuredGrid(12,8,'cylinder',holes);expect(f.mesh.faces.length).toBeGreaterThan(64);await certifiedGrid(f);
 expect(f.width).toBeCloseTo(12*2*160*Math.sin(.09/2),12);
},120000);

it('declines a complete cone fan whose angular deficit prevents cyclic intrinsic closure',()=>{
 const n=96,points=[[0,0,60],...Array.from({length:n},(_,i)=>[50*Math.cos(i*2*Math.PI/n),50*Math.sin(i*2*Math.PI/n),0])],faces=Array.from({length:n},(_,i)=>[0,1+i,1+(i+1)%n]),mesh=analytic(points,faces),before=structuredClone(mesh);
 expect(mesh.faces.length).toBeGreaterThan(64);expect(intrinsicTreeSeed(mesh)).toBeUndefined();expect(mesh).toEqual(before);
});

it('declines a double-curvature saddle instead of accumulating a nonclosing cyclic layout',()=>{
 const {mesh}=measuredGrid(12,8,'saddle'),before=structuredClone(mesh);expect(mesh.faces.length).toBeGreaterThan(64);
 expect(intrinsicTreeSeed(mesh)).toBeUndefined();expect(mesh).toEqual(before);
});
