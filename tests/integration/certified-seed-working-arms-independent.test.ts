import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
import {expect,it} from 'vitest';
import type {Binding,Surface,SurfaceReport} from '../../packages/schema/index';
import {unwrapSurface} from '../../apps/desktop/main/surface';
import {request} from '../../apps/desktop/main/worker';
import {mergeDesignCharts} from '../../packages/surface/merge-design-charts';
import {measureBoundaryStrain,designQualityFailure} from '../../packages/surface/design-partition';
import {project} from '../fixtures';

type Capture={mesh:Surface;charts:SurfaceReport[]};
const cases=[
 {name:'three-face',file:'working-arm-three-face.json',hash:'944dec3634cef2bce87d7513e41d6c6c20c6db115435097c13b588c61df773c9'},
 {name:'six-face',file:'working-arm-six-face.json',hash:'b8af838c4365faeaa29685a779dd7ff2201a33bf53c1ecf92a5da9d89b1bbadc'},
].map(c=>{const bytes=readFileSync(new URL('../fixtures/'+c.file,import.meta.url));return {...c,bytes,...JSON.parse(bytes.toString('utf8')) as Capture};});
const worker=resolve('target/release/fpcad-worker.exe');
const sub=(a:number[],b:number[])=>a.map((v,i)=>v-b[i]);
const cross=(a:number[],b:number[])=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
const length=(a:number[],b:number[])=>Math.hypot(...sub(a,b));
const xyz=(p:Surface['vertices'][number])=>[p.xMm,p.yMm,p.zMm];
const xy=(p:{xMm:number;yMm:number})=>[p.xMm,p.yMm];

function physicalMeasurements(mesh:Surface,binding:Binding){
 const world=new Map(mesh.vertices.map(v=>[v.id,xyz(v)])),faces=new Map(mesh.faces.map(f=>[f.id,f]));
 const sourceArea=(f:Surface['faces'][number])=>{const [a,b,c]=f.vertices.map(id=>world.get(id)!);return Math.hypot(...cross(sub(b,a),sub(c,a)))/2;};
 const sourceTotal=mesh.faces.reduce((sum,f)=>sum+sourceArea(f),0),flat=new Map(binding.report.uv.map(p=>[p.vertexId,xy(p)]));
 const trim= binding.trim,trimUv=trim?new Map(trim.vertices.map(p=>[p.id,xy(p)])):undefined;
 const triangles=trim?trim.triangles.map(t=>{const source=faces.get(t.faceId)!.vertices.map(id=>world.get(id)!);return {faceId:t.faceId,p:t.barycentric.map(w=>[0,1,2].map(axis=>w.reduce((sum,n,i)=>sum+n*source[i][axis],0))),q:t.vertices.map(id=>trimUv!.get(id)!)};}):binding.report.faceIds.map(id=>{const f=faces.get(id)!;return {faceId:id,p:f.vertices.map(id=>world.get(id)!),q:f.vertices.map(id=>flat.get(id)!)};});
 let physicalArea=0,uvArea=0,maxArea=0,maxEdge=0,worstAreaFace:unknown;
 for(const {faceId,p,q} of triangles){
  expect(p.flat().every(Number.isFinite)).toBe(true);expect(q.flat().every(Number.isFinite)).toBe(true);
  const area3=Math.hypot(...cross(sub(p[1],p[0]),sub(p[2],p[0])))/2,area2=((q[1][0]-q[0][0])*(q[2][1]-q[0][1])-(q[1][1]-q[0][1])*(q[2][0]-q[0][0]))/2;
  expect(area3).toBeGreaterThan(0);expect(area2,'Every real source triangle preserves orientation').toBeGreaterThan(0);
  physicalArea+=area3;uvArea+=area2;const areaError=Math.abs(area2/area3-1);if(areaError>maxArea){maxArea=areaError;worstAreaFace={faceId,area3,area2,p,q};}
  for(let i=0;i<3;i++)maxEdge=Math.max(maxEdge,Math.abs(length(q[i],q[(i+1)%3])/length(p[i],p[(i+1)%3])-1));
 }
 expect(new Set(triangles.map(t=>t.faceId))).toEqual(new Set(mesh.faces.map(f=>f.id)));
 expect(Math.abs(physicalArea/sourceTotal-1)).toBeLessThanOrEqual(1e-8);
 return {sourceTotal,physicalArea,uvArea,maxArea,maxEdge,worstAreaFace};
}

async function completeUnwrap(mesh:Surface){
 const p=project();p.pieces=[];p.defaultAllowanceMm=0;p.surface=structuredClone(mesh);
 return unwrapSurface(worker,mesh,p,{method:'arap',partitionStrategy:'design',automaticCuts:true,colorBoundaryCuts:true,iterations:30,optimizeCuts:true,maxPieces:500});
}

for(const fixture of cases){
 it(`full production unfolding certifies the exact ${fixture.name} arm in its original vertex order without additional panels, with order-independent physical dimensions`,async()=>{
  expect(createHash('sha256').update(fixture.bytes).digest('hex')).toBe(fixture.hash);
  const before=structuredClone(fixture.mesh),original=await completeUnwrap(fixture.mesh);
  const reordered=structuredClone(fixture.mesh);reordered.faces.reverse();
  const points=new Map(reordered.vertices.map(v=>[v.id,v]));reordered.vertices=[...new Set(reordered.faces.flatMap(f=>f.vertices))].map(id=>points.get(id)!);
  const reorderedBefore=structuredClone(reordered),again=await completeUnwrap(reordered);
  const measured=[];
  for(const run of [original,again]){
   expect(run.pieces).toHaveLength(1);expect(run.bindings).toHaveLength(1);expect(run.cutEdges??[]).toHaveLength(0);
   expect(new Set(run.bindings[0].report.faceIds)).toEqual(new Set(before.faces.map(f=>f.id)));
   const r=physicalMeasurements(before,run.bindings[0]);measured.push(r);
   expect(designQualityFailure(run.bindings[0].report)).toBe(false);
  }
  expect(Math.abs(measured[0].uvArea-measured[1].uvArea)/measured[0].sourceTotal).toBeLessThanOrEqual(1e-6);
  expect(fixture.mesh).toEqual(before);expect(reordered).toEqual(reorderedBefore);
  for(const r of measured){expect(r.maxArea,JSON.stringify({orders:measured})).toBeLessThanOrEqual(1e-6);expect(r.maxEdge).toBeLessThanOrEqual(1e-6);}
 },120000);

 it(`the production union accepts the exact ${fixture.name} captured seed in original storage order after real native validity checks`,async()=>{
  const before=structuredClone({mesh:fixture.mesh,charts:fixture.charts}),reports:SurfaceReport[]=[];
  const merged=await mergeDesignCharts(fixture.mesh,fixture.charts,async(faces,seed)=>{
   expect(seed).toBeDefined();
   const raw=await request(worker,{protocolVersion:1,operation:'surface.unwrap',mesh:{vertices:fixture.mesh.vertices,faces,method:'lscm',iterations:30,repair_cuts:false,initial_uv:seed}},undefined,{timeoutMs:120000,bytes:1024*1024});
   const rows=(raw as {patches:SurfaceReport[]}).patches;expect(rows).toHaveLength(1);
   const report=measureBoundaryStrain({...fixture.mesh,faces},rows[0]);expect(designQualityFailure(report)).toBe(false);reports.push(report);return report;
  });
  expect(merged).toHaveLength(1);expect(reports).toHaveLength(1);
  const r=physicalMeasurements(fixture.mesh,{pieceId:'probe',surfaceId:fixture.mesh.id,topologyVersion:fixture.mesh.topologyVersion,geometryHash:'probe',surfaceHash:'probe',report:reports[0]});
  expect(r.maxArea).toBeLessThanOrEqual(1e-6);expect(r.maxEdge).toBeLessThanOrEqual(1e-6);
  expect({mesh:fixture.mesh,charts:fixture.charts}).toEqual(before);
  expect(createHash('sha256').update(fixture.bytes).digest('hex')).toBe(fixture.hash);
 },120000);

 it(`native certification and production union reject reflected ${fixture.name} charts`,async()=>{
  const charts=fixture.charts.map(c=>({...c,uv:c.uv.map(p=>({...p,xMm:-p.xMm}))})),before=structuredClone(charts),errors:string[]=[];
  const merged=await mergeDesignCharts(fixture.mesh,charts,async(faces,seed)=>{
   expect(seed).toBeDefined();try{
    await request(worker,{protocolVersion:1,operation:'surface.unwrap',mesh:{vertices:fixture.mesh.vertices,faces,method:'lscm',iterations:30,repair_cuts:false,initial_uv:seed}},undefined,{timeoutMs:120000,bytes:1024*1024});
   }catch(error){errors.push(String(error));return undefined;}
   throw Error('A mirrored chart unexpectedly passed native certification');
  });
  expect(errors).toHaveLength(1);expect(errors[0]).toContain('UNWRAP_FLIPPED');expect(merged).toHaveLength(2);expect(charts).toEqual(before);
 },120000);

 it.each([1.01,2])(`production union cannot certify a %s-scaled ${fixture.name} seed even when native parsing succeeds`,async scale=>{
  const charts=fixture.charts.map(c=>({...c,uv:c.uv.map(p=>({...p,xMm:p.xMm*scale,yMm:p.yMm*scale}))})),before=structuredClone(charts),reports:SurfaceReport[]=[];
  const merged=await mergeDesignCharts(fixture.mesh,charts,async(faces,seed)=>{
   expect(seed).toBeDefined();
   const raw=await request(worker,{protocolVersion:1,operation:'surface.unwrap',mesh:{vertices:fixture.mesh.vertices,faces,method:'lscm',iterations:30,repair_cuts:false,initial_uv:seed}},undefined,{timeoutMs:120000,bytes:1024*1024});
   const reply=raw as {patches:SurfaceReport[]};expect(reply.patches).toHaveLength(1);
   const report=measureBoundaryStrain({...fixture.mesh,faces},reply.patches[0]);reports.push(report);
   // Return even this bad measured report to the actual production merge gate.
   // Independent edge/area measurements below establish why it must fail.
   return report;
  });
  expect(reports).toHaveLength(1);expect(merged).toHaveLength(2);
  const measured=physicalMeasurements(fixture.mesh,{pieceId:'probe',surfaceId:fixture.mesh.id,topologyVersion:fixture.mesh.topologyVersion,geometryHash:'probe',surfaceHash:'probe',report:reports[0]});
  expect(measured.maxEdge).toBeGreaterThan(scale-1-1e-6);
  expect(Math.abs(measured.uvArea/measured.sourceTotal-scale*scale)).toBeLessThanOrEqual(1e-6);
  expect(reports[0].seamErrorMax).toBeGreaterThan(.0005);expect(designQualityFailure(reports[0])).toBe(true);
  if(scale===1.01){expect(reports[0].areaErrorMax).toBeLessThan(.15);expect(reports[0].edgeErrorMax).toBeLessThan(.1);}
  expect(charts).toEqual(before);
 },120000);
}
