import {randomUUID} from 'node:crypto';
import {resolve} from 'node:path';
import {expect,it} from 'vitest';
import type {Surface,SurfaceReport} from '../../packages/schema/index';
import {request} from '../../apps/desktop/main/worker';
import {parseObj,unwrapSurface} from '../../apps/desktop/main/surface';
import {prepareDesignSurface,unwrapDesignSurface,restoreDesignBindings} from '../../apps/desktop/main/design-cuts';
import {mergeDesignCharts} from '../../packages/surface/merge-design-charts';
import {projectedReport} from '../../packages/surface/projected-report';
import {mapFromSurface,mapToSurface} from '../../packages/surface/mapping';
import {project} from '../fixtures';

const worker=resolve('target/release/fpcad-worker.exe');
function panel(){
 const mesh=parseObj('v 0 0 0\nv 100 0 0\nv 100 100 0\nv 0 0 0\nv 100 100 0\nv 0 100 0\nf 1 2 3\nf 4 5 6');
 mesh.faces.forEach(f=>f.region='material:blue');return mesh;
}
const charts=(mesh:Surface)=>mesh.faces.map(f=>projectedReport({...mesh,faces:[f]})!);
async function native(mesh:Surface,faces:Surface['faces'],seed?:SurfaceReport['uv']){
 const used=new Set(faces.flatMap(f=>f.vertices));
 const result=await request(worker,{protocolVersion:1,operation:'surface.unwrap',mesh:{vertices:mesh.vertices.filter(v=>used.has(v.id)),faces,method:'arap-seamed',iterations:100,repair_cuts:false,...(seed?{initial_uv:seed}:{})}}) as {patches:SurfaceReport[]};
 return result.patches.length===1?result.patches[0]:undefined;
}
function assertCoverage(mesh:Surface,reports:SurfaceReport[]){
 const covered=reports.flatMap(r=>r.faceIds);expect(covered.slice().sort()).toEqual(mesh.faces.map(f=>f.id).sort());expect(new Set(covered).size).toBe(covered.length);
 for(const report of reports){
  const flat=new Map(report.uv.map(p=>[p.vertexId,p])),world=new Map(mesh.vertices.map(p=>[p.id,p]));
  expect(new Set(report.uv.map(p=>p.vertexId)).size).toBe(report.uv.length);
  for(const f of mesh.faces.filter(f=>report.faceIds.includes(f.id))){
   const q=f.vertices.map(id=>flat.get(id)!);expect(q.every(Boolean)).toBe(true);
   expect((q[1].xMm-q[0].xMm)*(q[2].yMm-q[0].yMm)-(q[1].yMm-q[0].yMm)*(q[2].xMm-q[0].xMm)).toBeGreaterThan(0);
   for(let i=0;i<3;i++){const j=(i+1)%3,a=world.get(f.vertices[i])!,b=world.get(f.vertices[j])!,length=Math.hypot(a.xMm-b.xMm,a.yMm-b.yMm,a.zMm-b.zMm);expect(Math.abs(Math.hypot(q[i].xMm-q[j].xMm,q[i].yMm-q[j].yMm)-length)).toBeLessThan(1e-7);}
  }
 }
}

it('opt-in rejoins a physical trial seam with duplicated IDs into one native-solved panel without resizing or losing faces',async()=>{
 const mesh=panel(),input=charts(mesh),before=structuredClone({mesh,input});let calls=0;
 const result=await mergeDesignCharts(mesh,input,async(faces,seed)=>{calls++;expect(seed).toBeDefined();return native(mesh,faces,seed);},new Set(),()=>true,true);
 expect(calls).toBe(1);expect(result).toHaveLength(1);expect(new Set(mesh.faces.flatMap(f=>f.vertices)).size).toBe(4);assertCoverage(mesh,result);
 expect(mesh.vertices).toEqual(before.mesh.vertices);expect(mesh.faces.map(f=>f.id)).toEqual(before.mesh.faces.map(f=>f.id));expect(input).toEqual(before.input);
});

it.each(['default disabled','different material','nearby but not coincident'] as const)('preserves the original panels when %s',async kind=>{
 const mesh=panel();if(kind==='different material')mesh.faces[1].region='material:yellow';if(kind==='nearby but not coincident')mesh.vertices.slice(3).forEach(v=>v.zMm=1e-10);
 const input=charts(mesh),before=structuredClone({mesh,input});let calls=0;
 const solve=async(faces:Surface['faces'],seed?:SurfaceReport['uv'])=>{calls++;return native(mesh,faces,seed);};
 const result=kind==='default disabled'?await mergeDesignCharts(mesh,input,solve):await mergeDesignCharts(mesh,input,solve,new Set(),()=>true,true);
 expect(calls).toBe(0);expect(result).toEqual(input);expect({mesh,input}).toEqual(before);
});

it.each(['native refusal','area distortion','sewing distortion','incomplete source coverage'] as const)('a trial with %s leaves both mesh and input unchanged',async kind=>{
 const mesh=panel(),input=charts(mesh),before=structuredClone({mesh,input});let calls=0;
 const result=await mergeDesignCharts(mesh,input,async(faces,seed)=>{calls++;const solved=await native(mesh,faces,seed);expect(solved).toBeDefined();if(kind==='native refusal')return undefined;if(kind==='area distortion')return {...solved!,areaErrorMax:.150001};if(kind==='sewing distortion')return {...solved!,seamLengthErrorMm:.250001};return {...solved!,faceIds:solved!.faceIds.slice(0,1)};},new Set(),()=>true,true);
 expect(calls).toBe(1);expect(result).toEqual(input);expect({mesh,input}).toEqual(before);
});

it('rejects a closed tetrahedron trial through the real native disk gate without committing its vertex weld',async()=>{
 const mesh=parseObj('v 0 0 0\nv 100 0 0\nv 0 100 0\nv 0 0 100\nf 1 3 2\nf 1 2 4\nf 1 4 3\nf 2 3 4');
 const right=new Set(mesh.faces.slice(2).flatMap(f=>f.vertices)),copies=new Map([...right].map(id=>[id,randomUUID()]));
 mesh.vertices.push(...mesh.vertices.filter(v=>right.has(v.id)).map(v=>({...v,id:copies.get(v.id)!})));mesh.faces.slice(2).forEach(f=>f.vertices=f.vertices.map(id=>copies.get(id)!) as [string,string,string]);
 const input=[] as SurfaceReport[];for(const faces of [mesh.faces.slice(0,2),mesh.faces.slice(2)]){const report=await native(mesh,faces);expect(report).toBeDefined();input.push(report!);}
 const before=structuredClone({mesh,input}),errors=[] as string[];let calls=0;
 const result=await mergeDesignCharts(mesh,input,async faces=>{calls++;try{return await native(mesh,faces);}catch(e){errors.push((e as Error).message);return undefined;}},new Set(),()=>true,true);
 expect(calls).toBe(1);expect(errors).toHaveLength(1);expect(errors[0]).toMatch(/PATCH_NOT_DISK|PATCH_NEEDS_CUTS/);expect(result).toEqual(input);expect({mesh,input}).toEqual(before);
});

it('a physical edge with three owners is not offered as a two-panel seam',async()=>{
 const mesh=panel(),a={...mesh.vertices[0],id:randomUUID()},c={...mesh.vertices[2],id:randomUUID()},tip={id:randomUUID(),xMm:50,yMm:50,zMm:100};mesh.vertices.push(a,c,tip);mesh.faces.push({id:randomUUID(),vertices:[a.id,c.id,tip.id],region:'material:blue'});
 const input=charts(mesh),before=structuredClone({mesh,input});let calls=0;
 const result=await mergeDesignCharts(mesh,input,async(faces,seed)=>{calls++;return native(mesh,faces,seed);},new Set(),()=>true,true);
 expect(calls).toBe(0);expect(result).toEqual(input);expect({mesh,input}).toEqual(before);
});

it.each(['none','source surface','project surface'] as const)('full design unwrap keeps source coverage and honors locked user constraints on %s',async locked=>{
 const source=panel(),p=project();p.pieces=[];p.defaultAllowanceMm=0;p.surface=structuredClone(source);
 if(locked!=='none'){const target=locked==='source surface'?source:p.surface;target.cutConstraints=[{a:target.vertices[0].id,b:target.vertices[2].id,locked:true}];}
 const before=structuredClone(p),original=structuredClone(source);let solved:Surface|undefined;
 const run=await unwrapSurface(worker,source,p,{partitionStrategy:'design',automaticCuts:true,colorBoundaryCuts:true,method:'arap'},undefined,mesh=>solved=mesh);
 expect(run.pieces).toHaveLength(2);expect(solved).toBeDefined();assertCoverage(solved!,run.bindings.map(b=>b.report));
 for(const binding of run.bindings)for(const id of binding.report.faceIds){
  const face=original.faces.find(f=>f.id===id)!,weights:[number,number,number]=[.2,.3,.5],point=mapFromSurface(binding,id,weights,solved!);expect(point).not.toBeNull();
  const mapped=mapToSurface(solved!,binding,point!);expect(mapped).not.toBeNull();expect(mapped!.faceId).toBe(id);
  const vertices=new Map(original.vertices.map(v=>[v.id,v])),expected=[0,1,2].map(axis=>weights.reduce((sum,w,i)=>{const v=vertices.get(face.vertices[i])!;return sum+w*[v.xMm,v.yMm,v.zMm][axis];},0));
  expect(Math.hypot(mapped!.position.xMm-expected[0],mapped!.position.yMm-expected[1],mapped!.position.zMm-expected[2])).toBeLessThan(1e-8);
 }
 expect(p).toEqual(before);
});

it('a direct candidate preserves pre-existing coincident source vertex identities, the project and complete reversible bindings',async()=>{
 const p=project();p.pieces=[];p.defaultAllowanceMm=0;p.surface=panel();const before=structuredClone(p);
 const run=await unwrapSurface(worker,p.surface,p,{partitionStrategy:'design',automaticCuts:true,colorBoundaryCuts:true,method:'arap'});
 expect(run.pieces).toHaveLength(2);expect(p).toEqual(before);assertCoverage(p.surface,run.bindings.map(b=>b.report));
 for(const binding of run.bindings)for(const faceId of binding.report.faceIds){
  const point=mapFromSurface(binding,faceId,[.2,.3,.5],p.surface);expect(point).not.toBeNull();const hit=mapToSurface(p.surface,binding,point!);expect(hit).not.toBeNull();expect(hit!.faceId).toBe(faceId);
 }
});

it.each([false,true])('prepared same-material trial seams rejoin only without a locked user seam and restore exact source provenance (locked=%s)',async locked=>{
 const p=project();p.pieces=[];p.defaultAllowanceMm=0;p.surface=parseObj('v 0 0 0\nv 100 0 0\nv 100 100 0\nv 0 100 0\nf 1 2 3\nf 1 3 4');
 if(locked)p.surface.cutConstraints=[{a:p.surface.vertices[0].id,b:p.surface.vertices[2].id,locked:true}];
 const before=structuredClone(p),working=await prepareDesignSurface(worker,p,true,true),right=working.surface.faces[1],positions=new Map(working.surface.vertices.map(v=>[v.id,v]));
 // Duplicate the already prepared material domain's right trial fan. Its exact
 // source-face/barycentric provenance remains untouched, unlike source cuts.
 right.vertices=right.vertices.map(id=>{const copy={...positions.get(id)!,id:randomUUID()};working.surface.vertices.push(copy);return copy.id;}) as [string,string,string];
 const flattened=await unwrapDesignSurface(worker,p,working,{partitionStrategy:'design',automaticCuts:true,colorBoundaryCuts:true,method:'arap'});
 expect(flattened.run.pieces).toHaveLength(locked?2:1);assertCoverage(working.surface,flattened.run.bindings.map(b=>b.report));
 const run=restoreDesignBindings(p,working,flattened.run),coverage=new Map<string,number>();
 for(const binding of run.bindings){
  expect(binding.trim).toBeDefined();for(const t of binding.trim!.triangles){const [a,b,c]=t.barycentric,ratio=(b[1]-a[1])*(c[2]-a[2])-(b[2]-a[2])*(c[1]-a[1]);expect(ratio).toBeGreaterThan(0);coverage.set(t.faceId,(coverage.get(t.faceId)??0)+ratio);}
  for(const faceId of binding.report.faceIds){const point=mapFromSurface(binding,faceId,[.2,.3,.5],p.surface);expect(point).not.toBeNull();const hit=mapToSurface(p.surface,binding,point!);expect(hit).not.toBeNull();expect(hit!.faceId).toBe(faceId);const f=p.surface.faces.find(f=>f.id===faceId)!,vv=new Map(p.surface.vertices.map(v=>[v.id,v])),expected=[0,1,2].map(axis=>[.2,.3,.5].reduce((sum,w,i)=>{const v=vv.get(f.vertices[i])!;return sum+w*[v.xMm,v.yMm,v.zMm][axis];},0));expect(Math.hypot(hit!.position.xMm-expected[0],hit!.position.yMm-expected[1],hit!.position.zMm-expected[2])).toBeLessThan(1e-8);}
 }
 for(const f of p.surface.faces)expect(coverage.get(f.id)).toBeCloseTo(1,12);expect(p).toEqual(before);
});
