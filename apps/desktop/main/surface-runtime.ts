import type {PlacementContext} from '../../../packages/reference/placement-registration';
import {z} from 'zod';
import {Worker} from 'node:worker_threads';
import {join} from 'node:path';
import {regionSchema,modelRecordSchema,type LibraryRegionEdit,referenceRunSchema,surfaceRunSchema,markingSchema,referenceSchema,projectSchema,type Reference,type SurfaceBrush,type Marking,type Surface,type Project,type UnwrapOptions,type SurfaceRun} from '../../../packages/schema/index';
import {DomainError} from './repository';
/** Geometry jobs need calibrated registration metadata, but never image pixels.
 * Removing whole references changes anatomical groups and their fingerprints. */
function geometryProject(project:Project):Project{return {...project,referenceRun:undefined,references:project.references?.map(({png,resources,sheet,...reference})=>({...reference,png:'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg=='}))};}
/** A terminated calculation owns no project state. Child solvers are also terminated. */
function runTask<T>(workerData:Record<string,unknown>,schema:z.ZodType<T>,signal:AbortSignal,timeoutMs=120000):Promise<T>{return new Promise((resolve,reject)=>{
 if(signal.aborted){reject(new DomainError('CANCELLED'));return;}
 const worker=new Worker(join(__dirname,'surface-worker.cjs'),{workerData,resourceLimits:{maxOldGenerationSizeMb:1024}}),children=new Set<number>();let done=false;
 const finish=(result?:T,error?:Error)=>{if(done)return;done=true;clearTimeout(timer);signal.removeEventListener('abort',cancel);for(const pid of children)try{process.kill(pid);}catch{}void worker.terminate();if(error)reject(error);else resolve(result!);};
 const cancel=()=>finish(undefined,new DomainError('CANCELLED'));
 const timer=setTimeout(()=>finish(undefined,new DomainError('TIMEOUT')),timeoutMs);signal.addEventListener('abort',cancel,{once:true});
 worker.on('message',(m:{kind:string;pid?:number;value?:unknown;code?:string})=>{if(m.kind==='child'){if(m.pid){if(done){try{process.kill(m.pid);}catch{}}else children.add(m.pid);}return;}if(m.kind==='childExit'){if(m.pid)children.delete(m.pid);return;}if(done)return;try{if(m.kind==='result')finish(schema.parse(m.value));else finish(undefined,new DomainError(m.code??'UNWRAP_FAILED'));}catch{finish(undefined,new DomainError('WORKER_PROTOCOL'));}});
 worker.on('error',()=>finish(undefined,new DomainError('WORKER_CRASH')));worker.on('exit',()=>{if(!done)finish(undefined,new DomainError('WORKER_CRASH'));});
});}

export function runUnwrap(workerPath:string,surface:Surface,project:Project,options:UnwrapOptions,signal:AbortSignal):Promise<SurfaceRun>{return runTask({kind:'unwrap',workerPath,surface,project:geometryProject(project),options},surfaceRunSchema,signal);}
// Design cuts, including uncolored whole models, require many bounded native
// chart/clipping/validation jobs. Allow the complete pipeline ten minutes;
// cancellation still terminates the thread and its children immediately.
// Explicit mesh cuts without color inserts keep their two-minute deadline.
export function runCutPreview(workerPath:string,surface:Surface,project:Project,options:UnwrapOptions,directory:string,signal:AbortSignal){return runTask({kind:'cut-preview',workerPath,surface,project:geometryProject(project),options,directory},z.object({run:surfaceRunSchema,markings:z.array(markingSchema).max(500)}).strict(),signal,options.colorBoundaryCuts||options.partitionStrategy!=='mesh'?600000:120000);}
export function runProjection(workerPath:string,project:Project,sourceId:string,view:'front'|'back',offsetXmm:number,offsetYmm:number,signal:AbortSignal,replaceManual=false,automatic=false,context?:PlacementContext):Promise<Marking>{return runTask({kind:'marking',workerPath,project:geometryProject(project),sourceId,view,offsetXmm,offsetYmm,replaceManual,automatic,context},markingSchema,signal);}

export function runTexture(workerPath:string,project:Project,textureId:string,seed:{x:number;y:number},tolerance:number,signal:AbortSignal):Promise<Marking>{return runTask({kind:'texture',workerPath,project:geometryProject(project),textureId,seed,tolerance},markingSchema,signal);}

export function runSurfaceMarking(workerPath:string,project:Project,shape:NonNullable<Marking['surfaceShape']>,color:string,name:string,signal:AbortSignal):Promise<Marking>{return runTask({kind:'surface-marking',workerPath,project:geometryProject(project),shape,color,name},markingSchema,signal);}

export function runInference(workerPath:string,project:Project,markingId:string,mode:'extend'|'symmetry',distanceMm:number,planeXmm:number,signal:AbortSignal):Promise<Marking>{return runTask({kind:'inference',workerPath,project:geometryProject(project),markingId,mode,distanceMm,planeXmm},markingSchema,signal);}

export function runReferences(references:Reference[],heightMm:number,clusters:number,excludeBackground:boolean,mode:'simple'|'precise',subject:'character'|'head'|'paw'|'foot',signal:AbortSignal){return runTask({kind:'references',references,heightMm,clusters,excludeBackground,mode,subject},z.object({references:z.array(referenceSchema),regions:projectSchema.shape.patternLibrary.unwrap()}),signal);}

export function runManualMask(reference:Reference,sourceHash:string,mask:{width:number;height:number;pixels:string},color:string,signal:AbortSignal){return runTask({kind:'mask',reference,sourceHash,mask,color},referenceRunSchema,signal);}

export function runEditSurfaceMarking(workerPath:string,project:Project,markingId:string,shape:NonNullable<Marking['surfaceShape']>|undefined,stroke:SurfaceBrush|undefined,signal:AbortSignal):Promise<Marking>{return runTask({kind:'surface-edit',workerPath,project:geometryProject(project),markingId,shape,stroke},markingSchema,signal);}

export function runEditLibraryRegion(workerPath:string,project:Project,pieceId:string,edit:LibraryRegionEdit,signal:AbortSignal,replaceManual=false){return runTask({kind:'library-edit',workerPath,project:geometryProject(project),pieceId,edit,replaceManual},z.object({region:regionSchema,markings:z.array(markingSchema).max(500),models:z.array(modelRecordSchema).max(30)}).strict(),signal);}
