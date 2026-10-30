import {invoke} from '@tauri-apps/api/core';
import {listen} from '@tauri-apps/api/event';
import {setNativeDialogOpen} from './modules/useDelayedActivity';
let dialogReady:Promise<unknown>|undefined;
async function hostInvoke(channel:string,payload:unknown){
 // Register before sending: a native dialog can open as soon as the host reads it.
 dialogReady??=listen('fpcad:dialog-state',event=>{
  const value=event.payload;
  if(value&&typeof value==='object'&&'open' in value&&typeof value.open==='boolean')setNativeDialogOpen(value.open);
 }).catch(error=>{dialogReady=undefined;throw error;});
 try{await dialogReady;return await invoke<any>('desktop_request',{channel,payload});}
 catch(error){setNativeDialogOpen(false);throw error;}
}
function subscribe(channel:string,callback:(value:unknown)=>void){let stopped=false;const pending=listen(channel,event=>{if(!stopped)callback(event.payload);});return ()=>{stopped=true;void pending.then(unlisten=>unlisten()).catch(()=>{});};}
import type { DesktopApi,Request } from '../../../packages/schema/index';
import {surfaceProgressSchema} from '../../../packages/schema/index';
import {isCancellableSurfaceRequest} from '../../../packages/schema/cancellable-methods';
type TextApi={ [K in keyof DesktopApi]:DesktopApi[K] extends (...args:infer A)=>Promise<unknown>?(...args:A)=>Promise<string>:DesktopApi[K] };
const inFlight=new Map<string,{projectId:string;revision:number}>();
const send=async(method:string,payload:unknown,projectId?:string,expectedRevision?:number):Promise<string>=>{
 const requestId=crypto.randomUUID();
 if(projectId&&expectedRevision!==undefined&&isCancellableSurfaceRequest(method,payload))inFlight.set(requestId,{projectId,revision:expectedRevision});
 try{
  const response=await hostInvoke('fpcad:request-text',{protocolVersion:1,requestId,method,payload,...(projectId?{projectId,expectedRevision}:{})} as Request);
  if(typeof response==='string')return response;
  if(response instanceof ArrayBuffer)return new TextDecoder().decode(response);
  throw Error('INVALID_RESPONSE');
 }
 finally{inFlight.delete(requestId);}
};
const api:Omit<TextApi,"assistantSettings"|"editLibraryRegion"|"autoPlaceMarkings"|"assistant"|"patternPreview"|"patternOverview"|"autoReference"|"splitAllReferences"|"workflowFile"|"patternBundle"|"patternOutput"|"inferMarking"|"surfaceMarking"|"editSurfaceMarking"|"editSurfaceMarkings"|"brushSurfaceMarking"|"textureMarking"|"corner"|"cancelSurface"|"pairNotches"|"exportSurface"|"fitSpecies"|"morphTemplate"|"sculptSurface"|"importPattern"|"editMarkingSource"|"importTemplate"|"exportTemplate"|"fitTemplate"|"maskReference"|"allowance"|"offset"|"cancelJob"|"acceptResult"|"discardResult"|"onChanged"|"onStorageError"|"onSurfaceProgress"|"boolean"|"nest"|"importSurface"|"generateSpecies"|"assembleSpecies"|"generateBody"|"unwrapSurface"|"acceptSurface"|"editMarking"|"projectMarking"|"importReference"|"segmentReference"|"acceptReference">={read:()=>send('session.read',{}),activate:sessionId=>send('session.activate',{sessionId}),deleteSession:sessionId=>send('session.delete',{sessionId}),create:p=>send('project.create',p),open:()=>send('project.open',{}),save:(id,r,saveAs)=>send('project.save',{saveAs},id,r),apply:(id,r,p)=>send('command.apply',p,id,r),undo:(id,r)=>send('command.undo',{},id,r),redo:(id,r)=>send('command.redo',{},id,r),validate:(id,r)=>send('validation.run',{},id,r),export:(id,r,format,warningAckIds,paper,nested)=>send('export.create',{format,warningAckIds,...(paper?{paper}:{}),...(nested?{nested}:{})},id,r),restore:(id,r,revision)=>send('recovery.restore',{revision},id,r)};
const full:TextApi={...api,
 assistantSettings:async request=>JSON.stringify(await hostInvoke('fpcad:assistant-settings',request)),
 editLibraryRegion:(id,r,pieceId,edit)=>send('library.region.edit',{pieceId,edit},id,r),
 autoPlaceMarkings:(id,r,pieceIds,parts)=>send('marking.auto',{pieceIds,...(parts?{parts}:{})},id,r),
 assistant:async action=>JSON.stringify(await hostInvoke("fpcad:assistant",action)),
 autoReference:(id,r,layout,heightMm,clusters,excludeBackground,mode,subject)=>send('reference.auto',{layout,heightMm,clusters,excludeBackground,...(mode?{mode}:{}),...(subject?{subject}:{})},id,r),
 splitAllReferences:(id,r,heightMm,clusters,excludeBackground,mode,subject,swapViews)=>send('reference.splitAll',{heightMm,clusters,excludeBackground,...(mode?{mode}:{}),...(subject?{subject}:{}),...(swapViews?{swapViews}:{})},id,r),
 workflowFile:(id,r,action)=>send('workflow.file',{action},id,r),
 patternBundle:(id,r,action)=>send('patterns.bundle',{action},id,r),
 patternOutput:(id,r,pieceIds,format,paper,warningAckIds,pageNumbers)=>send('patterns.output',{pieceIds,format,paper,warningAckIds,...(pageNumbers?{pageNumbers}: {})},id,r),
 patternPreview:(id,r,pieceIds,paper,warningAckIds)=>send('patterns.preview',{pieceIds,paper,warningAckIds},id,r),
 patternOverview:(id,r,pieceIds,paper,warningAckIds)=>send('patterns.preview',{pieceIds,paper,warningAckIds,overviewOnly:true},id,r),
 pairNotches:(id,r,seamId,count,depthMm)=>send('seam.notches',{seamId,count,depthMm},id,r),
 exportSurface:(id,r)=>send('surface.export',{},id,r),
 fitSpecies:(id,r,targets)=>send('species.fit',{targets},id,r),
 morphTemplate:(id,r,weights)=>send('template.morph',{weights},id,r),
 sculptSurface:(id,r,input)=>send('surface.sculpt',input,id,r),
 corner:(id,r,pieceId,nodeId,kind,sizeMm)=>send('pattern.corner',{pieceId,nodeId,kind,sizeMm},id,r),
 importPattern:(id,r,scale)=>send('pattern.import',{scale},id,r),
 allowance:(id,r,pieceId,edgeAllowances,allowanceSource)=>send('pattern.allowance',{pieceId,edgeAllowances:edgeAllowances??[],allowanceSource},id,r),
 editMarking:(id,r,markingId,pieceId,rings)=>send('marking.edit',{markingId,pieceId,rings},id,r),
 inferMarking:(id,r,markingId,mode,distanceMm,planeXmm)=>send('marking.infer',{markingId,mode,distanceMm,planeXmm},id,r),
 editSurfaceMarking:(id,r,markingId,shape)=>send('marking.surface.edit',{markingId,shape},id,r),
 editSurfaceMarkings:(id,r,edits)=>send('marking.surface.editMany',{edits},id,r),
 brushSurfaceMarking:(id,r,markingId,stroke)=>send('marking.surface.brush',{markingId,stroke},id,r),
 surfaceMarking:(id,r,shape,color,name,fabrication)=>send('marking.surface',{shape,color,name,...(fabrication?{fabrication}:{})},id,r),
 textureMarking:(id,r,textureId,seed,tolerance)=>send('marking.texture',{textureId,seed,tolerance},id,r),
 projectMarking:(id,r,pieceId,view,offsetXmm,offsetYmm,replaceManual=false)=>send('marking.project',{pieceId,view,offsetXmm,offsetYmm,replaceManual},id,r),
 importReference:(id,r,view)=>send('reference.import',{view},id,r),
 editMarkingSource:(id,r,pieceId,nodeId,xMm,yMm,replaceManual)=>send('marking.source.edit',{pieceId,nodeId,xMm,yMm,replaceManual},id,r),
 importTemplate:(id,r)=>send('template.import',{},id,r),
 exportTemplate:(id,r)=>send('template.export',{},id,r),
 fitTemplate:(id,r,targets)=>send('template.fit',{targets},id,r),
 maskReference:(id,r,referenceId,sourceHash,mask,color,library)=>send('reference.mask',{referenceId,sourceHash,mask,color,...(library===undefined?{}:{library})},id,r),
 segmentReference:(id,r,referenceId,seed,tolerance,options,fitToleranceMm,library)=>send('reference.segment',{referenceId,seed,tolerance,...(options?{options}:{}),...(fitToleranceMm===undefined?{}:{fitToleranceMm}),...(library===undefined?{}:{library})},id,r),
 acceptReference:(id,r,library)=>send('reference.accept',{...(library?{library}: {})},id,r),
 importSurface:(id,r,scale)=>send('surface.import',{scale},id,r),
 assembleSpecies:(id,r)=>send('species.assemble',{},id,r),
 generateSpecies:(id,r,parameters)=>send('species.generate',parameters,id,r),
 generateBody:(id,r,parameters)=>send('body.generate',parameters,id,r),
 cancelSurface:(id,r)=>send('surface.cancel',{targetRequestIds:[...inFlight].filter(([,task])=>task.projectId===id&&task.revision===r).map(([requestId])=>requestId)},id,r),
 unwrapSurface:(id,r,options={})=>send('surface.unwrap',options,id,r),
 acceptSurface:(id,r,acknowledgeReview)=>send('surface.accept',{acknowledgeReview},id,r),
 nest:(id,r,options)=>send('nesting.run',options,id,r),
 boolean:(id,r,a,b,operation)=>send('pattern.boolean',{a,b,operation},id,r),
 offset:(id,r,pieceId,distanceMm,join='miter')=>send('pattern.offset',{pieceId,distanceMm,join},id,r),
 cancelJob:(id,r,jobId)=>send('job.cancel',{jobId},id,r),
 acceptResult:(id,r,jobId,resultHash)=>send('result.accept',{jobId,resultHash},id,r),
 discardResult:(id,r,jobId)=>send('result.discard',{jobId},id,r),
 onChanged:callback=>subscribe('fpcad:changed',()=>callback()),
 onStorageError:callback=>subscribe('fpcad:storage-error',()=>callback()),
 onSurfaceProgress:callback=>subscribe('fpcad:surface-progress',value=>{const progress=surfaceProgressSchema.safeParse(value);if(progress.success)callback(progress.data);})
};
Object.defineProperty(window,'fpcadTransport',{value:Object.freeze(full)});
Object.defineProperty(window,'fpcadLocale',{value:(window as any).__fpcadTestLocale??navigator.language});
