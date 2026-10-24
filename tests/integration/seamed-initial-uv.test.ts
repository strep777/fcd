import {expect,it} from 'vitest';
import {resolve} from 'node:path';
import {parseObj} from '../../apps/desktop/main/surface';
import {request} from '../../apps/desktop/main/worker';
import {surfaceReportSchema} from '../../packages/schema/index';

// Run only after the coordinator releases native tests and identifies the
// freshly built worker. No solver process starts while merely preparing this.
const worker=resolve(process.env.FPCAD_SEAM_TEST_WORKER??'target/release/fpcad-worker.exe');
function input(scale=1,offset=0){
 const surface=parseObj(`v ${offset} ${offset} 0\nv ${offset+100*scale} ${offset} 0\nv ${offset+100*scale} ${offset+100*scale} 0\nv ${offset} ${offset+100*scale} 0\nf 1 2 3\nf 1 3 4`);
 return {protocolVersion:1,operation:'surface.unwrap',mesh:{vertices:surface.vertices,faces:surface.faces,repair_cuts:false,method:'arap-seamed',iterations:30,initial_uv:surface.vertices.map(v=>({vertexId:v.id,xMm:v.xMm-offset,yMm:v.yMm-offset}))}};
}
it.each(['missing','duplicate','collapsed','reversed','overlapped'] as const)('rejects invalid initial_uv (%s) through the real native protocol',async kind=>{
 const job=input(),seed=job.mesh.initial_uv;
 if(kind==='missing')seed.pop();
 if(kind==='duplicate')seed.push({...seed[0]});
 if(kind==='collapsed')seed.forEach(v=>{v.xMm=0;v.yMm=0;});
 if(kind==='reversed')seed.forEach(v=>v.yMm=-v.yMm);
 if(kind==='overlapped'){seed[3].xMm=120;seed[3].yMm=10;}
 await expect(request(worker,job)).rejects.toMatchObject({code:kind==='missing'?'INVALID_MESH':kind==='duplicate'?'NUMERICAL_FAILURE':'UNWRAP_FLIPPED'});
});
it.each([{scale:1e-6,offset:0},{scale:.001,offset:-900000},{scale:1,offset:0},{scale:1000,offset:-900000}])('preserves millimetre boundary lengths for scale=$scale offset=$offset',async({scale,offset})=>{
 const job=input(scale,offset),result=await request(worker,job) as {patches:unknown};
 const patches=surfaceReportSchema.array().parse(result.patches);expect(patches).toHaveLength(1);
 expect(patches[0].faceIds.sort()).toEqual(job.mesh.faces.map(f=>f.id).sort());
 expect(patches[0].areaErrorMax).toBeLessThanOrEqual(.15);expect(patches[0].edgeErrorMax).toBeLessThanOrEqual(.1);
 expect(patches[0].seamErrorMax).toBeDefined();expect(patches[0].seamErrorMax!).toBeLessThanOrEqual(.0005);expect(patches[0].seamLengthErrorMm!).toBeLessThanOrEqual(.25);
 const uv=new Map(patches[0].uv.map(p=>[p.vertexId,p]));
 for(let i=0;i<4;i++){const a=job.mesh.vertices[i],b=job.mesh.vertices[(i+1)%4],p=uv.get(a.id)!,q=uv.get(b.id)!,rest=Math.hypot(a.xMm-b.xMm,a.yMm-b.yMm);expect(Math.abs(Math.hypot(p.xMm-q.xMm,p.yMm-q.yMm)/rest-1)).toBeLessThanOrEqual(.0005);}
});

it('retains a valid skinny triangle and measures its 0.0000001 mm boundary edge',async()=>{
 const surface=parseObj('v 0 0 0\nv 100 0 0\nv 100 0.0000001 0\nf 1 2 3'),job={protocolVersion:1,operation:'surface.unwrap',mesh:{vertices:surface.vertices,faces:surface.faces,repair_cuts:false,method:'arap-seamed',initial_uv:surface.vertices.map(v=>({vertexId:v.id,xMm:v.xMm,yMm:v.yMm}))}};
 const result=await request(worker,job) as {patches:unknown},patches=surfaceReportSchema.array().parse(result.patches);expect(patches).toHaveLength(1);expect(patches[0].faceIds).toEqual(surface.faces.map(f=>f.id));
 const points=new Map(patches[0].uv.map(v=>[v.vertexId,v])),a=points.get(surface.vertices[1].id)!,b=points.get(surface.vertices[2].id)!;
 expect(Math.abs(Math.hypot(a.xMm-b.xMm,a.yMm-b.yMm)/1e-7-1)).toBeLessThanOrEqual(.0005);expect(patches[0].areaErrorMax).toBeLessThanOrEqual(.15);expect(patches[0].seamErrorMax!).toBeLessThanOrEqual(.0005);
});
