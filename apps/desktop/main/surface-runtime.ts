import type {PlacementContext} from '../../../packages/reference/placement-registration';
import {z} from 'zod';
import {Worker} from 'node:worker_threads';
import {join} from 'node:path';
import {regionSchema,modelRecordSchema,type LibraryRegionEdit,referenceRunSchema,surfaceRunSchema,markingSchema,referenceSchema,projectSchema,type Reference,type SurfaceBrush,type SurfaceMarkingEdit,type Marking,type Surface,type Project,type UnwrapOptions,type SurfaceRun} from '../../../packages/schema/index';
import {DomainError} from './repository';
import {terminateNativeChildren} from './native-process';
import {surfaceProgressStepSchema,type SurfaceProgressStep} from '../../../packages/schema/index';
import type {ClusterOptions} from '../../../packages/reference/color-cluster';
/** Geometry jobs need calibrated registration metadata, but never image pixels.
 * Removing whole references changes anatomical groups and their fingerprints. */
function geometryProject(project:Project):Project{return {...project,referenceRun:undefined,references:project.references?.map(({png,resources,sheet,...reference})=>({...reference,png:'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg=='}))};}
/** A terminated calculation owns no project state. Child solvers are also terminated. */
function runTask<T>(workerData:Record<string,unknown>,schema:z.ZodType<T>,signal:AbortSignal,timeoutMs=120000,onProgress?:(progress:SurfaceProgressStep)=>void):Promise<T>{return new Promise((resolve,reject)=>{
 if(signal.aborted){reject(new DomainError('CANCELLED'));return;}
 const worker=new Worker(join(__dirname,'surface-worker.cjs'),{workerData,resourceLimits:{maxOldGenerationSizeMb:1024}}),children=new Set<number>();let done=false;
 let lastProgressStage:SurfaceProgressStep['stage']|undefined,lastProgressAt=-Infinity;
 const finish=(result?:T,error?:Error)=>{if(done)return;done=true;clearTimeout(timer);signal.removeEventListener('abort',cancel);for(const pid of children)try{process.kill(pid);}catch{}let threadFailed=false;const settle=()=>{if(threadFailed)reject(new DomainError('WORKER_CRASH'));else if(error)reject(error);else resolve(result!);};void worker.terminate().catch(()=>{threadFailed=true;}).then(()=>terminateNativeChildren(children)).then(settle,()=>reject(new DomainError('WORKER_CRASH')));};
 const cancel=()=>finish(undefined,new DomainError('CANCELLED'));
 const timer=setTimeout(()=>finish(undefined,new DomainError('TIMEOUT')),timeoutMs);signal.addEventListener('abort',cancel,{once:true});
 worker.on('message',(m:{kind:string;pid?:number;value?:unknown;code?:string})=>{if(m.kind==='child'){if(m.pid){children.add(m.pid);if(done){try{process.kill(m.pid);}catch{}}}return;}if(m.kind==='childExit'){if(m.pid)children.delete(m.pid);return;}if(done)return;if(m.kind==='progress'){
  const progress=surfaceProgressStepSchema.safeParse(m.value);if(!progress.success||signal.aborted)return;
  // Forward measured values only. Stage transitions are immediate; bursts
  // within a stage are bounded without another timer or delayed callback.
  const now=performance.now();if(progress.data.stage===lastProgressStage&&now-lastProgressAt<200)return;
  lastProgressStage=progress.data.stage;lastProgressAt=now;try{onProgress?.(progress.data);}catch{}return;
 }try{if(m.kind==='result')finish(schema.parse(m.value));else finish(undefined,new DomainError(m.code??'UNWRAP_FAILED'));}catch{finish(undefined,new DomainError('WORKER_PROTOCOL'));}});
 worker.on('error',()=>finish(undefined,new DomainError('WORKER_CRASH')));worker.on('exit',()=>{if(!done)finish(undefined,new DomainError('WORKER_CRASH'));});
});}

export function runUnwrap(workerPath:string,surface:Surface,project:Project,options:UnwrapOptions,signal:AbortSignal):Promise<SurfaceRun>{return runTask({kind:'unwrap',workerPath,surface,project:geometryProject(project),options},surfaceRunSchema,signal);}
// Exact color subdivisions require more work than the source face count shows.
// Keep a bounded deadline and the same cancellation/transaction guarantees.
export function cutPreviewTimeout(project:Project,options:UnwrapOptions){const points=options.colorBoundaryCuts?(project.markings??[]).reduce((n,m)=>n+m.fragments.reduce((sum,f)=>sum+f.rings.reduce((count,r)=>count+r.length,0),0),0):0;return Math.min(900000,Math.max(60000,points*20,options.automaticCuts&&(options.partitionStrategy??'design')==='design'?(project.surface?.faces.length??0)*40:0));}
export function runCutPreview(workerPath:string,surface:Surface,project:Project,options:UnwrapOptions,directory:string,signal:AbortSignal,onProgress?:(progress:SurfaceProgressStep)=>void){return runTask({kind:'cut-preview',workerPath,surface,project:geometryProject(project),options,directory},z.object({run:surfaceRunSchema,markings:z.array(markingSchema).max(500)}).strict(),signal,cutPreviewTimeout(project,options),onProgress);}
export function runProjection(workerPath:string,project:Project,sourceId:string,view:'front'|'back',offsetXmm:number,offsetYmm:number,signal:AbortSignal,replaceManual=false,automatic=false,context?:PlacementContext):Promise<Marking>{return runTask({kind:'marking',workerPath,project:geometryProject(project),sourceId,view,offsetXmm,offsetYmm,replaceManual,automatic,context},markingSchema,signal);}

export function runTexture(workerPath:string,project:Project,textureId:string,seed:{x:number;y:number},tolerance:number,signal:AbortSignal):Promise<Marking>{return runTask({kind:'texture',workerPath,project:geometryProject(project),textureId,seed,tolerance},markingSchema,signal);}

export function runSurfaceMarking(workerPath:string,project:Project,shape:NonNullable<Marking['surfaceShape']>,color:string,name:string,signal:AbortSignal,fabrication?:Marking['fabrication']):Promise<Marking>{return runTask({kind:'surface-marking',workerPath,project:geometryProject(project),shape,color,name,fabrication},markingSchema,signal);}

export function runInference(workerPath:string,project:Project,markingId:string,mode:'extend'|'symmetry',distanceMm:number,planeXmm:number,signal:AbortSignal):Promise<Marking>{return runTask({kind:'inference',workerPath,project:geometryProject(project),markingId,mode,distanceMm,planeXmm},markingSchema,signal);}

export function runReferences(references:Reference[],heightMm:number,clusters:number,excludeBackground:boolean,mode:'simple'|'precise',subject:'character'|'head'|'paw'|'foot',signal:AbortSignal){return runTask({kind:'references',references,heightMm,clusters,excludeBackground,mode,subject},z.object({references:z.array(referenceSchema),regions:projectSchema.shape.patternLibrary.unwrap()}),signal);}

export function runManualMask(reference:Reference,sourceHash:string,mask:{width:number;height:number;pixels:string},color:string,signal:AbortSignal){return runTask({kind:'mask',reference,sourceHash,mask,color},referenceRunSchema,signal);}

export function runReferenceSegment(reference:Reference,seed:{x:number;y:number},tolerance:number,options:ClusterOptions|undefined,fitToleranceMm:number|undefined,proxyPng:string|undefined,signal:AbortSignal){return runTask({kind:'segment',reference,seed,tolerance,options,fitToleranceMm,proxyPng},referenceRunSchema,signal);}

export function runEditSurfaceMarking(workerPath:string,project:Project,markingId:string|undefined,shape:NonNullable<Marking['surfaceShape']>|undefined,stroke:SurfaceBrush|undefined,signal:AbortSignal):Promise<Marking>{return runTask({kind:'surface-edit',workerPath,project:geometryProject(project),markingId,shape,stroke},markingSchema,signal);}
export function runEditSurfaceMarkings(workerPath:string,project:Project,edits:SurfaceMarkingEdit[],signal:AbortSignal):Promise<Marking[]>{return runTask({kind:'surface-edit-many',workerPath,project:geometryProject(project),edits},z.array(markingSchema).min(1).max(500),signal);}

export function runEditLibraryRegion(workerPath:string,project:Project,pieceId:string,edit:LibraryRegionEdit,signal:AbortSignal,replaceManual=false){return runTask({kind:'library-edit',workerPath,project:geometryProject(project),pieceId,edit,replaceManual},z.object({region:regionSchema,markings:z.array(markingSchema).max(500),models:z.array(modelRecordSchema).max(30)}).strict(),signal);}

export function runAutomaticPlacement(workerPath:string,project:Project,pieceIds:string[],parts:import('../../../packages/reference/body-parts').BodyPart[]|undefined,signal:AbortSignal){return runTask({kind:'automatic-placement',workerPath,project:geometryProject(project),pieceIds,parts},z.object({markings:z.array(markingSchema).max(500),skipped:z.array(z.object({pieceId:z.string(),name:z.string(),reason:z.string()}))}),signal);}
