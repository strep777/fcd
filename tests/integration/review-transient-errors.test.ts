import {afterEach,expect,it,vi} from 'vitest';
import {resolve} from 'node:path';
import {randomUUID} from 'node:crypto';
import {project} from '../fixtures';
import * as planar from '../../packages/surface/planar';
import * as projected from '../../packages/surface/projected-report';
import * as worker from '../../apps/desktop/main/worker';
import {DomainError} from '../../apps/desktop/main/repository';
import {parseObj,unwrapSurface} from '../../apps/desktop/main/surface';
import {prepareDesignSurface} from '../../apps/desktop/main/design-cuts';
afterEach(()=>vi.restoreAllMocks());
it('propagates a native resource failure during balanced retry',async()=>{
 const p=project();p.pieces=[];p.defaultAllowanceMm=0;p.surface=parseObj('v 0 0 0\nv 100 0 0\nv 100 100 0\nv 0 100 0\nf 1 2 3\nf 1 3 4');
 const before=structuredClone(p),rawPlanar=planar.planarReports,rawProjected=projected.projectedReport,rawSession=worker.createWorkerSession;let firstPlanar=true,firstProjection=true,injected=0;
 vi.spyOn(planar,'planarReports').mockImplementation((mesh,...rest)=>{if(firstPlanar){firstPlanar=false;return {reports:[],holes:new Map(),remaining:mesh.faces};}return rawPlanar(mesh,...rest);});
 vi.spyOn(projected,'projectedReport').mockImplementation((...args)=>{if(firstProjection){firstProjection=false;return undefined;}return rawProjected(...args);});
 vi.spyOn(worker,'createWorkerSession').mockImplementation((path,signal)=>{const native=rawSession(path,signal);return {dispose:native.dispose,request:async(input,limits)=>{const job=input as {operation?:string;mesh?:{method?:string}};if(job.operation==='surface.unwrap'&&job.mesh?.method==='arap-balanced'){injected++;throw new DomainError('RESOURCE_LIMIT');}const output=await native.request(input,limits);if(job.operation==='surface.unwrap'){const report=output as {patches:{areaErrorMax:number}[]};for(const patch of report.patches)patch.areaErrorMax=.2;}return output;}};});
 const result=await unwrapSurface(resolve('target/release/fpcad-worker.exe'),p.surface,p,{partitionStrategy:'design',automaticCuts:true,method:'arap'}).then(run=>({succeeded:true,pieces:run.pieces.length}),error=>({code:error.code}));
 expect(injected).toBe(1);expect(result).toEqual({code:'RESOURCE_LIMIT'});expect(p).toEqual(before);
});

it.each(['RESOURCE_LIMIT','TIMEOUT','CANCELLED'] as const)('propagates %s during intrinsic seed certification without changing the project',async code=>{
 const p=project();p.pieces=[];p.defaultAllowanceMm=0;p.surface=parseObj('v 0 0 0\nv 100 0 0\nv 100 100 0\nv 0 100 0\nf 1 2 3\nf 1 3 4');
 const before=structuredClone(p),rawSession=worker.createWorkerSession;let injected=0,disposed=0,solved=0;
 vi.spyOn(planar,'planarReports').mockImplementation(mesh=>({reports:[],holes:new Map(),remaining:mesh.faces}));
 vi.spyOn(projected,'projectedReport').mockReturnValue(undefined);
 vi.spyOn(worker,'createWorkerSession').mockImplementation((path,signal)=>{const native=rawSession(path,signal);return {dispose:async()=>{disposed++;return native.dispose();},request:async(input,limits)=>{
  const job=input as {operation?:string;mesh?:{method?:string;initial_uv?:unknown}};
  if(job.operation==='surface.unwrap'&&job.mesh?.initial_uv){expect(job.mesh.method).toBe('lscm');injected++;throw new DomainError(code);}
  const output=await native.request(input,limits);if(job.operation==='surface.unwrap')for(const patch of (output as {patches:{areaErrorMax:number}[]}).patches)patch.areaErrorMax=.2;return output;
 }};});
 const result=await unwrapSurface(resolve('target/release/fpcad-worker.exe'),p.surface,p,{partitionStrategy:'design',automaticCuts:true,method:'arap'},undefined,()=>{solved++;}).then(()=>({succeeded:true}),error=>({code:error.code}));
 expect(injected).toBe(1);expect(disposed).toBe(1);expect(solved).toBe(0);expect(result).toEqual({code});expect(p).toEqual(before);
});

it('a rejected seed certificate continues to the real ARAP retry and retains the full source',async()=>{
 const p=project();p.pieces=[];p.defaultAllowanceMm=0;p.surface=parseObj('v 0 0 0\nv 100 0 0\nv 100 100 0\nv 0 100 0\nf 1 2 3\nf 1 3 4');
 const before=structuredClone(p),rawSession=worker.createWorkerSession;let refused=0,seededArap=0;
 vi.spyOn(planar,'planarReports').mockImplementation(mesh=>({reports:[],holes:new Map(),remaining:mesh.faces}));vi.spyOn(projected,'projectedReport').mockReturnValue(undefined);
 vi.spyOn(worker,'createWorkerSession').mockImplementation((path,signal)=>{const native=rawSession(path,signal);return {dispose:native.dispose,request:async(input,limits)=>{
  const job=input as {operation?:string;mesh?:{method?:string;initial_uv?:unknown}};
  if(job.operation==='surface.unwrap'&&job.mesh?.initial_uv&&job.mesh.method==='lscm'&&refused===0){refused++;throw new DomainError('UNWRAP_OVERLAP');}
  if(job.operation==='surface.unwrap'&&job.mesh?.initial_uv&&job.mesh.method==='arap')seededArap++;
  const output=await native.request(input,limits);if(job.operation==='surface.unwrap'&&!job.mesh?.initial_uv)for(const patch of (output as {patches:{areaErrorMax:number}[]}).patches)patch.areaErrorMax=.2;return output;
 }};});
 const run=await unwrapSurface(resolve('target/release/fpcad-worker.exe'),p.surface,p,{partitionStrategy:'design',automaticCuts:true,method:'arap'});
 expect(refused).toBe(1);expect(seededArap).toBeGreaterThanOrEqual(1);expect(run.pieces).toHaveLength(1);expect(run.bindings.flatMap(b=>b.report.faceIds).sort()).toEqual(p.surface.faces.map(f=>f.id).sort());expect(run.bindings.every(b=>b.report.areaErrorMax<=.15&&b.report.edgeErrorMax<=.1&&b.report.distortionMax<=.15&&b.report.seamLengthErrorMm!<=.25)).toBe(true);expect(p).toEqual(before);
});

it('a resource failure after trial-seam solving cannot commit the welded candidate to the project',async()=>{
 const p=project();p.pieces=[];p.defaultAllowanceMm=0;p.surface=parseObj('v 0 0 0\nv 100 0 0\nv 100 100 0\nv 0 100 0\nf 1 2 3\nf 1 3 4');
 const working=await prepareDesignSurface(resolve('target/release/fpcad-worker.exe'),p,true,true),vertices=new Map(working.surface.vertices.map(v=>[v.id,v]));working.surface.faces[1].vertices=working.surface.faces[1].vertices.map(id=>{const copy={...vertices.get(id)!,id:randomUUID()};working.surface.vertices.push(copy);return copy.id;}) as [string,string,string];
 const originalFaces=new Map(p.surface.faces.map(f=>[f.id,f]));
 const canRejoin=(a:string,b:string)=>{const left=originalFaces.get(a),right=originalFaces.get(b);return !!left&&!!right&&(a===b||left.vertices.filter(id=>right.vertices.includes(id)).length===2);};
 const before=structuredClone(p),workingBefore=structuredClone(working.surface),rawSession=worker.createWorkerSession;let injected=0,solved=0,disposed=0;
 vi.spyOn(worker,'createWorkerSession').mockImplementation((path,signal)=>{const native=rawSession(path,signal);return {dispose:async()=>{disposed++;return native.dispose();},request:async(input,limits)=>{
  if(Array.isArray((input as {pieces?:unknown[]}).pieces)){expect((input as {pieces:unknown[]}).pieces).toHaveLength(1);injected++;throw new DomainError('RESOURCE_LIMIT');}return native.request(input,limits);
 }};});
 const result=await unwrapSurface(resolve('target/release/fpcad-worker.exe'),working.surface,p,{partitionStrategy:'design',automaticCuts:true,colorBoundaryCuts:true,method:'arap'},undefined,()=>{solved++;},undefined,p.surface,canRejoin).then(()=>({succeeded:true}),error=>({code:error.code}));
 expect(injected).toBe(1);expect(disposed).toBe(1);expect(solved).toBe(0);expect(result).toEqual({code:'RESOURCE_LIMIT'});expect(p).toEqual(before);expect(working.surface).toEqual(workingBefore);
});
