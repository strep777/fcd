import {afterEach,expect,it,vi} from 'vitest';
import {resolve} from 'node:path';
import {project} from '../fixtures';
import * as planar from '../../packages/surface/planar';
import * as projected from '../../packages/surface/projected-report';
import * as worker from '../../apps/desktop/main/worker';
import {DomainError} from '../../apps/desktop/main/repository';
import {parseObj,unwrapSurface} from '../../apps/desktop/main/surface';
afterEach(()=>vi.restoreAllMocks());
it('propagates a native resource failure during balanced retry',async()=>{
 const p=project();p.pieces=[];p.defaultAllowanceMm=0;p.surface=parseObj('v 0 0 0\nv 100 0 0\nv 100 100 0\nv 0 100 0\nf 1 2 3\nf 1 3 4');
 const rawPlanar=planar.planarReports,rawProjected=projected.projectedReport,rawSession=worker.createWorkerSession;let firstPlanar=true,firstProjection=true,initial=true,injected=0;
 vi.spyOn(planar,'planarReports').mockImplementation((mesh,...rest)=>{if(firstPlanar){firstPlanar=false;return {reports:[],holes:new Map(),remaining:mesh.faces};}return rawPlanar(mesh,...rest);});
 vi.spyOn(projected,'projectedReport').mockImplementation((...args)=>{if(firstProjection){firstProjection=false;return undefined;}return rawProjected(...args);});
 vi.spyOn(worker,'createWorkerSession').mockImplementation((path,signal)=>{const native=rawSession(path,signal);return {dispose:native.dispose,request:async(input,limits)=>{const job=input as {operation?:string;mesh?:{method?:string}};if(job.operation==='surface.unwrap'&&job.mesh?.method==='arap-balanced'){injected++;throw new DomainError('RESOURCE_LIMIT');}const output=await native.request(input,limits);if(initial&&job.operation==='surface.unwrap'){initial=false;const report=output as {patches:{areaErrorMax:number}[]};for(const patch of report.patches)patch.areaErrorMax=.2;}return output;}};});
 const result=await unwrapSurface(resolve('target/release/fpcad-worker.exe'),p.surface,p,{partitionStrategy:'design',automaticCuts:true,method:'arap'}).then(run=>({succeeded:true,pieces:run.pieces.length}),error=>({code:error.code}));
 expect(injected).toBe(1);expect(result).toEqual({code:'RESOURCE_LIMIT'});
});
