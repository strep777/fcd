import {afterEach,expect,it,vi} from 'vitest';
import {randomUUID} from 'node:crypto';
import {resolve} from 'node:path';
import {project} from '../fixtures';
import type {Surface} from '../../packages/schema/index';
import * as planar from '../../packages/surface/planar';
import * as projected from '../../packages/surface/projected-report';
import * as workerApi from '../../apps/desktop/main/worker';
import {DomainError} from '../../apps/desktop/main/repository';
import {unwrapSurface,validateSurface} from '../../apps/desktop/main/surface';

afterEach(()=>vi.restoreAllMocks());
const worker=resolve('target/release/fpcad-worker.exe');
function fixture(targetLast:boolean){
 const vertices:Surface['vertices']=[{id:randomUUID(),xMm:0,yMm:0,zMm:30}];
 for(let i=0;i<8;i++)vertices.push({id:randomUUID(),xMm:100*Math.cos(i*Math.PI/4),yMm:100*Math.sin(i*Math.PI/4),zMm:0});
 const target:Surface['faces']=Array.from({length:8},(_,i)=>({id:randomUUID(),vertices:[vertices[0].id,vertices[1+i].id,vertices[1+(i+1)%8].id] as [string,string,string],region:'curved-cap'}));
 const island=[[300,0,0],[400,0,0],[300,100,0]].map(([xMm,yMm,zMm])=>({id:randomUUID(),xMm,yMm,zMm}));vertices.push(...island);
 const untouched={id:randomUUID(),vertices:island.map(v=>v.id) as [string,string,string],region:'untouched-island'};
 const mesh:Surface={id:randomUUID(),source:'obj',topologyVersion:1,vertices,faces:targetLast?[untouched,...target]:[...target,untouched]};
 return{mesh,target,untouched};
}
async function exercise(targetLast:boolean,rejectDarts:boolean){
 const {mesh,target,untouched}=fixture(targetLast),source=structuredClone(mesh),targetIds=new Set(target.map(f=>f.id)),originalIds=new Set(mesh.vertices.map(v=>v.id));
 const isTarget=(faces:Surface['faces'])=>faces.length===target.length&&faces.every(f=>targetIds.has(f.id));
 const isUnopened=(faces:Surface['faces'])=>isTarget(faces)&&faces.every(f=>f.vertices.every(id=>originalIds.has(id)));
 const nativePlanar=planar.planarReports,nativeProjection=projected.projectedReport,nativeSession=workerApi.createWorkerSession;
 // Reject only the original closed apex chart, to exercise the production
 // dart path deterministically. Opened charts, all UVs, manufacturing and
 // final sewing constraints use the real native worker and original gates.
 vi.spyOn(planar,'planarReports').mockImplementation((...args)=>isUnopened(args[0].faces)?{reports:[],holes:new Map(),remaining:args[0].faces}:nativePlanar(...args));
 vi.spyOn(projected,'projectedReport').mockImplementation((...args)=>isUnopened(args[0].faces)?undefined:nativeProjection(...args));
 let rejectedOriginal=0,rejectedOpened=0,openedRequests=0;
 vi.spyOn(workerApi,'createWorkerSession').mockImplementation((path,signal)=>{
  const native=nativeSession(path,signal);
  return{dispose:native.dispose,request:async(input,limits)=>{
   const job=input as {operation?:string;mesh?:{vertices:Surface['vertices'];faces:Surface['faces']}};
   if(job.operation==='surface.unwrap'&&job.mesh&&isTarget(job.mesh.faces)){
    if(isUnopened(job.mesh.faces)){rejectedOriginal++;throw new DomainError('PATCH_NEEDS_CUTS');}
    openedRequests++;
    // Observe transport validity, rather than a particular vertex count or
    // implementation-specific indexing strategy.
    const ids=new Set(job.mesh.vertices.map(v=>v.id));
    expect(job.mesh.faces.every(f=>f.vertices.every(id=>ids.has(id)))).toBe(true);
    if(rejectDarts){rejectedOpened++;throw new DomainError('UNWRAP_NOT_CONVERGED');}
   }
   return native.request(input,limits);
  }};
 });
 const p=project();p.pieces=[];p.defaultAllowanceMm=0;p.surface=source;
 let solved:Surface|undefined;
 const run=await unwrapSurface(worker,mesh,p,{partitionStrategy:'design',method:'arap',automaticCuts:true,iterations:60},undefined,value=>{solved=structuredClone(value);});
 expect(rejectedOriginal).toBeGreaterThan(0);expect(openedRequests).toBeGreaterThan(0);expect(solved).toBeDefined();validateSurface(solved!);
 const finalPoints=new Map(solved!.vertices.map(v=>[v.id,v]));
 // This is the regression: accepting a local chart may append duplicated
 // seam vertices, but must retain vertices belonging to every other chart.
 for(const vertex of source.vertices)expect(finalPoints.get(vertex.id)).toEqual(vertex);
 expect(solved!.faces.find(f=>f.id===untouched.id)).toEqual(untouched);
 expect(new Set(run.bindings.flatMap(b=>b.report.faceIds))).toEqual(new Set(source.faces.map(f=>f.id)));
 expect(run.bindings.reduce((sum,b)=>sum+b.report.faceIds.length,0)).toBe(source.faces.length);
 for(const binding of run.bindings){
  const report=binding.report,uv=new Set(report.uv.map(v=>v.vertexId));
  expect(report.areaErrorMax).toBeLessThanOrEqual(.15);expect(report.edgeErrorMax).toBeLessThanOrEqual(.1);
  for(const id of report.faceIds){const face=solved!.faces.find(f=>f.id===id)!;expect(face.vertices.every(id=>finalPoints.has(id)&&uv.has(id))).toBe(true);}
 }
 if(rejectDarts){
  expect(rejectedOpened).toBeGreaterThan(0);expect(solved!.vertices).toHaveLength(source.vertices.length);
  for(const face of solved!.faces)expect(face.vertices).toEqual(source.faces.find(f=>f.id===face.id)!.vertices);
 }else{
  const added=solved!.vertices.filter(v=>!originalIds.has(v.id));expect(added.length).toBeGreaterThan(0);
  for(const v of added)expect(source.vertices.some(p=>p.xMm===v.xMm&&p.yMm===v.yMm&&p.zMm===v.zMm)).toBe(true);
  expect(solved!.faces.filter(f=>targetIds.has(f.id)).some(f=>f.vertices.some(id=>!originalIds.has(id)))).toBe(true);
 }
}

it.each([false,true])('accepted local darts retain the other chart before/after its solve (targetLast=%s)',async targetLast=>{await exercise(targetLast,false);},30000);
it('rejected local darts leave no duplicate seam vertices or changed face stations in later child charts',async()=>{await exercise(true,true);},30000);
