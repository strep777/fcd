import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
import {expect,it} from 'vitest';
import {request} from '../../apps/desktop/main/worker';
import {joinedChartSeed} from '../../packages/surface/joined-chart-seed';
import {mergeDesignCharts} from '../../packages/surface/merge-design-charts';
import type {Surface,SurfaceReport} from '../../packages/schema/index';

// Exact native mesh + both original charts captured by the root agent from the
// real 86 mm2 / 635 mm2 collar panels. The fixture intentionally retains the
// native reproducer's derived face labels; it is not a serialized Project.
const fixtureBytes=readFileSync(new URL('../fixtures/joined-panel-seed.json',import.meta.url));
const fixture=JSON.parse(fixtureBytes.toString('utf8')) as {mesh:Pick<Surface,'vertices'|'faces'>;charts:[SurfaceReport,SurfaceReport]};
const worker=resolve('target/release/fpcad-worker.exe');
const length=(a:number[],b:number[])=>Math.hypot(...a.map((v,i)=>v-b[i]));
const uv=(p:{xMm:number;yMm:number})=>[p.xMm,p.yMm];
const xyz=(p:{xMm:number;yMm:number;zMm:number})=>[p.xMm,p.yMm,p.zMm];
const cross=(a:number[],b:number[])=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
const sub=(a:number[],b:number[])=>a.map((v,i)=>v-b[i]);
const signedArea=(a:number[],b:number[],c:number[])=>((b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]))/2;

async function solve(seed?:SurfaceReport['uv']){
 const raw=await request(worker,{protocolVersion:1,operation:'surface.unwrap',mesh:{...fixture.mesh,method:'arap-seamed',iterations:100,repair_cuts:false,...(seed?{initial_uv:seed}:{})}},undefined,{timeoutMs:120000,bytes:16*1024*1024});
 expect(raw).toMatchObject({ok:true,protocolVersion:1});
 const result=raw as {patches:SurfaceReport[]};expect(Array.isArray(result.patches)).toBe(true);
 return result.patches;
}

function measure(report:SurfaceReport){
 const world=new Map(fixture.mesh.vertices.map(v=>[v.id,xyz(v)])),flat=new Map(report.uv.map(v=>[v.vertexId,uv(v)]));
 expect(new Set(report.faceIds)).toEqual(new Set(fixture.mesh.faces.map(f=>f.id)));
 expect(new Set(report.uv.map(v=>v.vertexId)).size).toBe(report.uv.length);
 expect(new Set(flat.keys())).toEqual(new Set(world.keys()));
 const edges=new Set<string>();let area3=0,area2=0,maxAreaError=0,maxEdgeError=0;
 for(const face of fixture.mesh.faces){
  const w=face.vertices.map(id=>world.get(id)!),q=face.vertices.map(id=>flat.get(id)!);
  expect(q.flat().every(Number.isFinite)).toBe(true);
  const actual3=Math.hypot(...cross(sub(w[1],w[0]),sub(w[2],w[0])))/2,actual2=signedArea(q[0],q[1],q[2]);
  expect(actual3).toBeGreaterThan(0);expect(actual2,'Every physical triangle preserves handedness').toBeGreaterThan(0);
  area3+=actual3;area2+=actual2;maxAreaError=Math.max(maxAreaError,Math.abs(actual2/actual3-1));
  for(let i=0;i<3;i++){
   const j=(i+1)%3,key=[face.vertices[i],face.vertices[j]].sort().join(':');if(edges.has(key))continue;edges.add(key);
   maxEdgeError=Math.max(maxEdgeError,Math.abs(length(q[i],q[j])/length(w[i],w[j])-1));
  }
 }
 // Independent measurements catch normalization/rescaling even if a report's
 // summary fields were accidentally copied from one of the two input charts.
 expect(maxAreaError).toBeLessThanOrEqual(.001);
 expect(maxEdgeError).toBeLessThanOrEqual(.001);
 expect(Math.abs(area2/area3-1)).toBeLessThanOrEqual(.0001);
 expect(report.areaErrorMax).toBeLessThanOrEqual(.15);
 expect(report.edgeErrorMax).toBeLessThanOrEqual(.1);
 expect(report.distortionMax).toBeLessThanOrEqual(.15);
 expect(report.seamLengthErrorMm).toBeDefined();expect(report.seamLengthErrorMm!).toBeLessThanOrEqual(.25);
 return {area3,area2,maxAreaError,maxEdgeError};
}

function assertRigidPairs(before:SurfaceReport['uv'],after:SurfaceReport['uv']){
 const flat=new Map(after.map(p=>[p.vertexId,p]));
 for(let i=0;i<before.length;i++)for(let j=i+1;j<before.length;j++){
  const original=length(uv(before[i]),uv(before[j])),current=length(uv(flat.get(before[i].vertexId)!),uv(flat.get(before[j].vertexId)!));
  expect(Math.abs(current-original),'Rigid chart alignment must not resize its physical distances').toBeLessThanOrEqual(Math.max(1e-10,original*1e-12));
 }
}

it('rigid seed alignment keeps each real chart at its original millimetre size and never mutates the input',()=>{
 expect(createHash('sha256').update(fixtureBytes).digest('hex')).toBe('35d2bf604957d07e282b616108c6b82a9f2cbc472cedfee3ae1d21b8aec5b82d');
 const before=structuredClone(fixture),seed=joinedChartSeed(...fixture.charts);expect(seed).toBeDefined();
 const left=new Set(fixture.charts[0].uv.map(p=>p.vertexId));
 assertRigidPairs(fixture.charts[0].uv,seed!);
 // Shared seam nodes are represented once by chart A; only B's unique nodes
 // are free rigid-transform observations, so its old seam roundoff cannot be
 // mistaken for deliberate scaling.
 assertRigidPairs(fixture.charts[1].uv.filter(p=>!left.has(p.vertexId)),seed!);
 expect(seed!.length).toBe(fixture.mesh.vertices.length);
 expect(new Set(seed!.map(p=>p.vertexId)).size).toBe(seed!.length);
 expect(fixture).toEqual(before);
});

it('the exact real union becomes one correctly sized native panel both with and without the joined seed',async()=>{
 const before=structuredClone(fixture);
 // Equilibrated residual correction now also solves this former failure
 // without a seed. Both routes must satisfy the same physical oracle.
 const unseeded=await solve();expect(unseeded).toHaveLength(1);expect(unseeded[0].faceIds).toHaveLength(49);measure(unseeded[0]);
 const seed=joinedChartSeed(...fixture.charts)!;expect(seed).toBeDefined();
 const saved=structuredClone(seed),patches=await solve(seed);
 expect(patches).toHaveLength(1);expect(patches[0].faceIds).toHaveLength(49);measure(patches[0]);
 expect(seed).toEqual(saved);expect(fixture).toEqual(before);
},120000);

it('the real merge callback receives the seed and preserves every original face in one native-solved panel',async()=>{
 const mesh:Surface={id:'joined-collar-reproducer',source:'obj',topologyVersion:1,...structuredClone(fixture.mesh)},before=structuredClone({mesh,charts:fixture.charts});
 let calls=0;
 const result=await mergeDesignCharts(mesh,fixture.charts,async(faces,seed)=>{
  calls++;expect(new Set(faces.map(f=>f.id))).toEqual(new Set(mesh.faces.map(f=>f.id)));expect(seed).toBeDefined();
  const reports=await solve(seed);return reports.length===1?reports[0]:undefined;
 });
 expect(calls).toBe(1);expect(result).toHaveLength(1);measure(result[0]);
 expect({mesh,charts:fixture.charts}).toEqual(before);
},120000);

it.each(['whole joined seed','second chart'] as const)('a mirrored %s cannot bypass native orientation/overlap rejection',async kind=>{
 let seed:SurfaceReport['uv']|undefined;
 if(kind==='whole joined seed')seed=joinedChartSeed(...fixture.charts)!.map(p=>({...p,xMm:-p.xMm}));
 else{const mirrored={...fixture.charts[1],uv:fixture.charts[1].uv.map(p=>({...p,xMm:-p.xMm}))};seed=joinedChartSeed(fixture.charts[0],mirrored);}
 expect(seed).toBeDefined();
 await expect(solve(seed)).rejects.toThrow('UNWRAP_FLIPPED');
},120000);

it('does not create an orientation guess from a single common point or coincident seam points',()=>{
 const a=structuredClone(fixture.charts[0]),b=structuredClone(fixture.charts[1]);
 const shared=a.uv.filter(p=>b.uv.some(q=>q.vertexId===p.vertexId));expect(shared.length).toBeGreaterThanOrEqual(2);
 const first=shared[0].vertexId,sharedSet=new Set(shared.map(p=>p.vertexId));
 const one={...b,uv:b.uv.filter(p=>p.vertexId===first||!sharedSet.has(p.vertexId))};
 expect(joinedChartSeed(a,one)).toBeUndefined();
 const collapsed=(r:SurfaceReport)=>({...r,uv:r.uv.map(p=>sharedSet.has(p.vertexId)?{...p,xMm:17,yMm:23}:p)});
 expect(joinedChartSeed(collapsed(a),collapsed(b))).toBeUndefined();
});
