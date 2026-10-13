import {patternOverview} from './print-preview-batch';
import {placementAnatomies} from '../../../packages/reference/placement-registration';
import {partName,sideName} from '../../../packages/reference/body-parts';
import {AssistantSettings} from './assistant-settings';
import {editableLibraryRegion,refreshLibraryRegionMetadata} from './library-region-edit';
import {moveNode} from '../../../packages/pattern/edit';
import {editableMarking} from './surface-marking-edit';
import {runReferences,runManualMask} from './surface-runtime';
import {dualViewSplit} from '../../../packages/reference/dual-view-split';
import upng from '@pdf-lib/upng';
import {classifyModel} from './model-anatomy';
import {AssistantBridge} from './assistant-bridge';
import {editSurfaceCuts,normalizeCutSurface} from './cut-tools';
import {svgPrintPlan} from '../../../packages/manufacturing/print-pages';
import {mappedMarking} from './fragment-mapping';
import {adjustPattern} from './pattern-adjustment';
import {splitReferences} from './automatic-reference';
import {workflowBytes,readWorkflow,cutBundle,readCutBundle,selectedProject,printHtml} from './workflow-exchange';
import {unlink} from 'node:fs/promises';
import {cornerPiece} from '../../../packages/pattern/corners';
import {randomUUID} from 'node:crypto';
import {runEditLibraryRegion,runEditSurfaceMarking,runCutPreview,runProjection,runTexture,runSurfaceMarking,runInference} from './surface-runtime';
import {readFile,stat} from 'node:fs/promises';
import {pairedNotches} from './seam-notches';
import {fitSpecies,morphTemplate,sculptSurface} from './body-edit';
import {insertCutPoint} from './cut-points';
import {refreshSavedModelMarkings} from './model-markings';
import {splitProjectEdge} from './topology-edit';
import {parseSvg} from './svg-import';
import {readGlb,exportGlb} from './glb';
import {fitTemplate} from './custom-template';
import {materialFor} from '../../../packages/manufacturing/material';
import {runAssembly} from './assembly-runtime';
import {runNesting} from './nesting-runtime';
import {generateSpecies} from './species';
import {editMarking,editMarkingSource,markingIssues} from './markings';
import { app,BrowserWindow,ipcMain,dialog,session,Menu,nativeImage,safeStorage } from 'electron';
import { join,resolve } from 'node:path';
import { mkdir } from 'node:fs/promises';
import { requestSchema,type Session,type Response,type Project,type Geometry } from '../../../packages/schema/index';
import { Repository,DomainError,hash } from './repository';
import { atomicWrite,pack,unpack,readProject } from './archive';
import { analyze,booleanPieces } from './worker';
import { svgExport,pdfExport,dxfExport,gate } from './export';
import { pngExport } from './png';
import { configureExportAssets } from './export-assets';
import { ModuleRegistry } from '../../../packages/modules/index';
import { JobManager } from './jobs';
import {normalizeManualNesting} from './nesting';
import {seamIssues,seamReports,outputSeamIssues} from './seams';
import {readObj,generateTorso,validateSurface,bindingIssues} from './surface';
import {readReference,segmentReference,manualReference,validateReference,referenceFromPng} from './references';
let window:BrowserWindow;let repository:Repository;let jobs:JobManager;let queue:Promise<unknown>=Promise.resolve();let debounce:NodeJS.Timeout|undefined,maxWait:NodeJS.Timeout|undefined;
let surfaceController:AbortController|undefined;
const geometryCache=new Map<string,Geometry>();
const root=resolve(__dirname,'../..');const workerPath=join(root,'dist/bin',process.platform==='win32'?'fpcad-worker.exe':'fpcad-worker');
configureExportAssets(join(root,'dist/assets'));
function checkpoint(){clearTimeout(debounce);clearTimeout(maxWait);debounce=undefined;maxWait=undefined;repository.checkpoint();}
function autosave(){clearTimeout(debounce);debounce=setTimeout(()=>{try{checkpoint();}catch{window.webContents.send('fpcad:storage-error');}},3000);if(!maxWait)maxWait=setTimeout(()=>{try{checkpoint();}catch{window.webContents.send('fpcad:storage-error');}},30000);}
function profile(stage:string,started:number){if(process.env.FPCAD_PROFILE==='1')console.log('FPCAD_PROFILE '+JSON.stringify({stage,elapsedMs:performance.now()-started}));return performance.now();}
function changed(){if(window&&!window.isDestroyed())window.webContents.send('fpcad:changed');}
const geometryKey=(project:Project,p:Project['pieces'][number])=>hash(JSON.stringify({piece:p,material:materialFor(project,p),defaultAllowanceMm:project.defaultAllowanceMm}));
function cache(project:Project,geometry:Geometry[]){project.pieces.forEach((p,i)=>geometryCache.set(geometryKey(project,p),geometry[i]));while(geometryCache.size>500)geometryCache.delete(geometryCache.keys().next().value!);}
async function projectGeometry(project:Project){const current=new Map<string,Geometry>(),missing:Project['pieces']=[];for(const p of project.pieces){const key=geometryKey(project,p),value=geometryCache.get(key);if(value){current.set(p.id,value);geometryCache.delete(key);geometryCache.set(key,value);}else missing.push(p);}if(missing.length){const input={...project,pieces:missing},geometry=await analyze(workerPath,input);cache(input,geometry);missing.forEach((p,i)=>current.set(p.id,geometry[i]));}return project.pieces.map(p=>current.get(p.id)!);}
async function printableSelection(project:Project,pieceIds:string[],ack:string[]){const subset=selectedProject(project,pieceIds),selected=new Set(pieceIds),geometry=await analyze(workerPath,subset),markingError=markingIssues(project).find(i=>selected.has(i.entityId));if(markingError)throw new DomainError(markingError.messageKey);if(outputSeamIssues(project,await projectGeometry(project),pieceIds).length)throw new DomainError('INVALID_SEAMS');gate(subset,geometry,ack);return {subset,geometry};}
async function state():Promise<Session>{const project=repository.snapshot();let geometry:Geometry[]=[];if(project)try{geometry=(await projectGeometry(project)).map(g=>({...g,issues:[...g.issues]}));}catch(e){geometry=project.pieces.map(p=>({id:p.id,cut:[],areaMm2:0,perimeterMm:0,issues:[{ruleId:`${p.id}:worker`,severity:'error',entityId:p.id,messageKey:e instanceof DomainError?e.code:'WORKER_CRASH'}]}));}if(project){for(const issue of [...seamIssues(project,geometry),...bindingIssues(project),...markingIssues(project)]){const g=geometry.find(g=>g.id===issue.entityId);if(g)g.issues=[...g.issues,issue];}}return {sessionId:repository.sessionId??undefined,project,geometry,...((repository.startupNotice??repository.maintenanceWarning)?{notice:repository.startupNotice??repository.maintenanceWarning}:{}),...repository.status(),recent:repository.recent(),jobs:jobs.list()};}
async function save(saveAs:boolean){const p=repository.snapshot()!;let path=saveAs?null:repository.row()?.destination as string|null;
 if(!path){const choice=await dialog.showSaveDialog(window,{defaultPath:`${p.name.replace(/[<>:"/\\|?*]/g,'_')}.fpcad`,filters:[{name:'FurryPattern CAD',extensions:['fpcad']}]});if(choice.canceled||!choice.filePath)return false;path=choice.filePath;}
 checkpoint();const result=pack(p);unpack(result.bytes);await atomicWrite(path,result.bytes);repository.markSaved(path,p.revision);return true;
}
async function handle(raw:unknown):Promise<Response>{try{
 if(Buffer.byteLength(JSON.stringify(raw))>64*1024*1024)throw new DomainError('RESOURCE_LIMIT');const req=requestSchema.parse(raw);
 const fingerprint=hash(JSON.stringify(req));
 if(['command.apply','command.undo','command.redo','result.accept','pattern.boolean','nesting.run','surface.unwrap','surface.accept','body.generate','species.generate','species.assemble','reference.segment','reference.mask','seam.notches','species.fit','template.morph','surface.sculpt','pattern.corner','pattern.import','surface.import','template.import','template.fit','reference.accept','reference.auto','reference.splitAll','marking.auto','marking.infer','marking.surface','marking.surface.edit','marking.surface.brush','marking.texture','marking.project','marking.source.edit','library.region.edit','marking.edit'].includes(req.method)&&repository.replay(req.requestId,fingerprint))return {ok:true,data:await state()};
 if('projectId' in req)repository.assertRevision(req.projectId,req.expectedRevision);
 switch(req.method){
 case 'session.read':break;
 case 'session.delete':{const active=repository.sessionId===req.payload.sessionId;repository.deleteSession(req.payload.sessionId);jobs.releaseDeleted();geometryCache.clear();if(active){clearTimeout(debounce);clearTimeout(maxWait);debounce=undefined;maxWait=undefined;}break;}
 case 'session.activate':checkpoint();repository.activate(req.payload.sessionId);break;
 case 'project.create':checkpoint();repository.create(req.payload.name);break;
 case 'project.open':{const selection=await dialog.showOpenDialog(window,{properties:['openFile'],filters:[{name:'FurryPattern CAD',extensions:['fpcad']}]});if(selection.canceled)return {ok:true,data:await state(),cancelled:true};let started=performance.now();const p=await readProject(selection.filePaths[0]);started=profile('open:archive',started);if(p.surface)validateSurface(p.surface);for(const model of p.modelLibrary??[])validateSurface(model.surface);for(const ref of p.references??[])validateReference(ref);started=profile('open:assets',started);cache(p,await analyze(workerPath,p));started=profile('open:geometry',started);checkpoint();repository.open(p,selection.filePaths[0]);profile('open:database',started);break;}
 case 'project.save':if(!await save(req.payload.saveAs))return {ok:true,data:await state(),cancelled:true};break;
 case 'command.apply':{const current=repository.snapshot()!;if(['markings.batch','marking.source.update','marking.put','reference.put','reference.candidate','reference.accept','unwrap.candidate','unwrap.accept','piece.adjusted','surface.refined'].includes(req.payload.type))throw new DomainError('FORBIDDEN');else if(req.payload.type==='surface.curve'||req.payload.type==='surface.section'||req.payload.type==='surface.cutScope'||req.payload.type==='surface.cutLine.meta'||req.payload.type==='surface.cutLine.delete'){
 const refined=await editSurfaceCuts(workerPath,current,req.payload);repository.commit({type:'surface.refined',surface:refined.surface,markings:refined.markings},req.requestId,fingerprint);autosave();break;
 }else if(req.payload.type==='surface.split'){
 const refined=await insertCutPoint(workerPath,current,req.payload.a,req.payload.b,req.payload.t);repository.commit({type:'surface.refined',surface:refined.surface,markings:refined.markings},req.requestId,fingerprint);autosave();break;
 }else if(req.payload.type==='library.region.put'){
 const region=req.payload.region;if(!current.references?.some(r=>r.id===region.referenceId&&r.view===region.view))throw new DomainError('ENTITY_MISSING');
 const geometry=await analyze(workerPath,{...current,pieces:[region.piece]});if(geometry.some(g=>g.issues.some(i=>i.severity==='error')))throw new DomainError('INVALID_GEOMETRY');
 }else if(req.payload.type==='surface.classify'){if(!current.surface)throw new DomainError('SURFACE_MISSING');if(current.markings?.some(m=>m.placement&&m.locked))throw new DomainError('MARKING_LOCKED');repository.commit({type:'surface.anatomy',...classifyModel(current.surface,req.payload.kind,req.payload.footBoundaryMm,req.payload.side)},req.requestId,fingerprint);autosave();break;}else if(req.payload.type==='surface.anatomy'){const mesh=current.surface;if(!mesh)throw new DomainError('SURFACE_MISSING');if(req.payload.faceRegions)throw new DomainError('FORBIDDEN');if(new Set(req.payload.assignments.map(a=>a.region)).size!==req.payload.assignments.length||req.payload.assignments.some(a=>!mesh.faces.some(f=>f.region===a.region)))throw new DomainError('ENTITY_MISSING');if(current.markings?.some(m=>m.placement&&m.locked))throw new DomainError('MARKING_LOCKED');}else if(req.payload.type==='library.regions'||req.payload.type==='library.region.update')throw new DomainError('FORBIDDEN');else if(req.payload.type==='surface.set'){req.payload.surface=normalizeCutSurface(req.payload.surface,current.surface);validateSurface(req.payload.surface);}else if(req.payload.type==='seam.put'){const incoming=req.payload.seam,previous=current.seams?.find(s=>s.id===incoming.id),lockOnly=previous&&JSON.stringify({...previous,locked:false})===JSON.stringify({...req.payload.seam,locked:false});const proposed={...current,seams:[req.payload.seam]};if(!lockOnly&&(req.payload.seam.a.pieceId===req.payload.seam.b.pieceId&&req.payload.seam.a.nodeId===req.payload.seam.b.nodeId||seamReports(proposed,await projectGeometry(current)).some(r=>r.status==='stale')))throw new DomainError('STALE_SEAM');}else if(req.payload.type==='nesting.set'){req.payload.nesting=normalizeManualNesting(current,await analyze(workerPath,current),req.payload.nesting);}else if(req.payload.type==='piece.split'){await analyze(workerPath,splitProjectEdge(current,req.payload.pieceId,req.payload.nodeId,req.payload.t));}else if(req.payload.type==='piece.put'){
 const nextPiece=req.payload.piece,previous=current.pieces.find(p=>p.id===nextPiece.id);
 if(previous&&current.bindings?.some(b=>b.pieceId===previous.id)&&JSON.stringify([previous.nodes,previous.curves,previous.holes])!==JSON.stringify([req.payload.piece.nodes,req.payload.piece.curves,req.payload.piece.holes])){
  const geometry=await analyze(workerPath,{...current,pieces:[req.payload.piece]});if(geometry.some(g=>g.issues.some(i=>i.severity==='error')))throw new DomainError('INVALID_GEOMETRY');
  const adjustment=await adjustPattern(workerPath,current,req.payload.piece);if(adjustment){repository.commit({type:'piece.adjusted',...adjustment},req.requestId,fingerprint);autosave();break;}
 }
 const p={...current,pieces:[req.payload.piece]};cache(p,await analyze(workerPath,p));}else if(req.payload.type==='pieces.replace'){await analyze(workerPath,{...current,pieces:req.payload.pieces});}if(req.payload.type==='library.region.put'){
 const result=await refreshLibraryRegionMetadata(workerPath,current,req.payload.region);repository.commit({type:'library.region.update',...result},req.requestId,fingerprint);
 }else repository.commit(req.payload,req.requestId,fingerprint);autosave();break;}
 case 'command.undo':repository.historyMove(false,req.requestId,fingerprint);autosave();break;
 case 'command.redo':repository.historyMove(true,req.requestId,fingerprint);autosave();break;
 case 'recovery.restore':repository.restore(req.payload.revision);break;
 case 'validation.run':geometryCache.clear();break;
 case 'library.region.edit':{const p=repository.snapshot()!,controller=new AbortController();editableLibraryRegion(p,req.payload.pieceId);surfaceController=controller;try{const result=await runEditLibraryRegion(workerPath,p,req.payload.pieceId,req.payload.edit,controller.signal);if(controller.signal.aborted)throw new DomainError('CANCELLED');repository.assertRevision(p.id,p.revision);repository.commit({type:'library.region.update',...result},req.requestId,fingerprint);autosave();}finally{if(surfaceController===controller)surfaceController=undefined;}break;}
 case 'marking.source.edit':{const p=repository.snapshot()!,r=req.payload,source=p.patternLibrary?.find(region=>region.piece.id===r.pieceId)?.piece;
  if(source){
   editableLibraryRegion(p,r.pieceId,r.replaceManual);if(![...source.nodes,...source.holes?.flat()??[]].some(n=>n.id===r.nodeId))throw new DomainError('ENTITY_MISSING');
   const piece=moveNode(source,r.nodeId,r.xMm,r.yMm),controller=new AbortController();surfaceController=controller;
   try{const result=await runEditLibraryRegion(workerPath,p,r.pieceId,{piece,operations:[]},controller.signal,r.replaceManual);if(controller.signal.aborted)throw new DomainError('CANCELLED');repository.assertRevision(p.id,p.revision);repository.commit({type:'library.region.update',...result},req.requestId,fingerprint);autosave();}finally{if(surfaceController===controller)surfaceController=undefined;}
  }else{const result=await editMarkingSource(workerPath,p,r.pieceId,r.nodeId,r.xMm,r.yMm,r.replaceManual),proposed={...p,pieces:p.pieces.map(piece=>piece.id===result.piece.id?result.piece:piece)},models=await refreshSavedModelMarkings(workerPath,proposed,r.pieceId,r.replaceManual);repository.assertRevision(p.id,p.revision);repository.commit({type:'marking.source.update',...result,models},req.requestId,fingerprint);autosave();}break;}
 case 'marking.edit':{const p=repository.snapshot()!,marking=await editMarking(workerPath,p,req.payload.markingId,req.payload.pieceId,req.payload.rings);repository.commit({type:'marking.put',marking},req.requestId,fingerprint);autosave();break;}
 case 'marking.infer':{const p=repository.snapshot()!,r=req.payload,controller=new AbortController();surfaceController=controller;try{let m=await runInference(workerPath,p,r.markingId,r.mode,r.distanceMm,r.planeXmm,controller.signal);if(p.bindings?.some(b=>b.trim))m=await mappedMarking(workerPath,p,m);if(controller.signal.aborted)throw new DomainError('CANCELLED');repository.assertRevision(p.id,p.revision);repository.commit({type:'marking.put',marking:m},req.requestId,fingerprint);autosave();}finally{if(surfaceController===controller)surfaceController=undefined;}break;}
 case 'marking.surface.edit':case 'marking.surface.brush':{const p=repository.snapshot()!,controller=new AbortController();editableMarking(p,req.payload.markingId);surfaceController=controller;try{const m=await runEditSurfaceMarking(workerPath,p,req.payload.markingId,req.method==='marking.surface.edit'?req.payload.shape:undefined,req.method==='marking.surface.brush'?req.payload.stroke:undefined,controller.signal);if(controller.signal.aborted)throw new DomainError('CANCELLED');repository.assertRevision(p.id,p.revision);repository.commit({type:'marking.put',marking:m},req.requestId,fingerprint);autosave();}finally{if(surfaceController===controller)surfaceController=undefined;}break;}
 case 'marking.surface':{const p=repository.snapshot()!,r=req.payload,controller=new AbortController();surfaceController=controller;try{let m=await runSurfaceMarking(workerPath,p,r.shape,r.color,r.name,controller.signal);if(p.bindings?.some(b=>b.trim))m=await mappedMarking(workerPath,p,m);if(controller.signal.aborted)throw new DomainError('CANCELLED');repository.assertRevision(p.id,p.revision);repository.commit({type:'marking.put',marking:m},req.requestId,fingerprint);autosave();}finally{if(surfaceController===controller)surfaceController=undefined;}break;}
 case 'marking.texture':{const p=repository.snapshot()!,r=req.payload,controller=new AbortController();surfaceController=controller;try{let m=await runTexture(workerPath,p,r.textureId,r.seed,r.tolerance,controller.signal);if(p.bindings?.some(b=>b.trim))m=await mappedMarking(workerPath,p,m);if(controller.signal.aborted)throw new DomainError('CANCELLED');repository.assertRevision(p.id,p.revision);repository.commit({type:'marking.put',marking:m},req.requestId,fingerprint);autosave();}finally{if(surfaceController===controller)surfaceController=undefined;}break;}
 case 'marking.project':{const p=repository.snapshot()!,controller=new AbortController();surfaceController=controller;try{const m=await runProjection(workerPath,p,req.payload.pieceId,req.payload.view,req.payload.offsetXmm,req.payload.offsetYmm,controller.signal,req.payload.replaceManual);if(controller.signal.aborted)throw new DomainError('CANCELLED');repository.assertRevision(p.id,p.revision);repository.commit({type:'marking.put',marking:m},req.requestId,fingerprint);autosave();}finally{if(surfaceController===controller)surfaceController=undefined;}break;}
 case 'marking.auto':{
  const p=repository.snapshot()!,ids=req.payload.pieceIds;if(new Set(ids).size!==ids.length||ids.some(id=>!p.patternLibrary?.some(r=>r.piece.id===id)))throw new DomainError('INVALID_SELECTION');if(!p.surface)throw new DomainError('SURFACE_MISSING');
  const controller=new AbortController();surfaceController=controller;const timeout=setTimeout(()=>controller.abort(),120000);const markings:NonNullable<Project['markings']>=[],skipped:{pieceId:string;name:string;reason:string}[]=[];
  try{for(const id of ids){if(controller.signal.aborted)throw new DomainError('CANCELLED');const region=p.patternLibrary!.find(r=>r.piece.id===id)!,contexts=placementAnatomies(region).filter(a=>!req.payload.parts||req.payload.parts.includes(a.part));for(const context of contexts){if(controller.signal.aborted)throw new DomainError('CANCELLED');try{const m=await runProjection(workerPath,p,id,region.view,0,0,controller.signal,false,true,context);markings.push(m);if(new Set([...(p.markings??[]).map(m=>m.id),...markings.map(m=>m.id)]).size>500)throw new DomainError('PROJECTION_LIMIT');if(markings.reduce((sum,item)=>sum+item.fragments.reduce((count,f)=>count+f.rings.reduce((n,ring)=>n+ring.length,0),0),0)>1000000)throw new DomainError('PROJECTION_LIMIT');}catch(error){const code=error instanceof DomainError?error.code:'UNWRAP_FAILED';if(!['ANATOMY_REQUIRED','ANATOMY_SIDE_REQUIRED','MODEL_PART_MISSING','NO_VISIBLE_PROJECTION','INVALID_PLACEMENT','MARKING_LOCKED','MANUAL_MARKING_REVIEW','INVALID_GEOMETRY','AMBIGUOUS_PROJECTION'].includes(code))throw error;skipped.push({pieceId:id,name:region.anatomy?.contexts?region.piece.name+' / '+partName(context.part)+' '+sideName(context.side):region.piece.name,reason:code});}}}
   if(controller.signal.aborted)throw new DomainError('CANCELLED');repository.assertRevision(p.id,p.revision);if(markings.length){repository.commit({type:'markings.batch',markings},req.requestId,fingerprint);autosave();}return {ok:true,data:await state(),autoPlacementReport:{placed:markings.length,skipped}};
  }finally{clearTimeout(timeout);if(surfaceController===controller)surfaceController=undefined;}break;
 }
 case 'reference.auto':case 'reference.splitAll':{
 const p=repository.snapshot()!,options=req.payload;let references=p.references??[];
 if(req.method==='reference.auto'){
  const filters=[{name:'Reference image',extensions:['png','jpg','jpeg','webp']}];
  if(req.payload.layout==='separate'){
   const front=await dialog.showOpenDialog(window,{title:'选择正面图片',properties:['openFile'],filters});if(front.canceled)return {ok:true,data:await state(),cancelled:true};
   const back=await dialog.showOpenDialog(window,{title:'选择背面图片',properties:['openFile'],filters});if(back.canceled)return {ok:true,data:await state(),cancelled:true};
   references=[await readReference(front.filePaths[0],'front'),await readReference(back.filePaths[0],'back')];
  }else{
   const choice=await dialog.showOpenDialog(window,{title:'选择正背双视图合图',properties:['openFile'],filters});if(choice.canceled)return {ok:true,data:await state(),cancelled:true};
   const combined=await readReference(choice.filePaths[0],'front'),image=nativeImage.createFromDataURL(combined.png);let mid=Math.floor(combined.width/2);
   if(combined.resources){const codec=(upng as unknown as {default?:typeof upng}).default??upng,proxy=codec.decode(Uint8Array.from(Buffer.from(combined.resources.proxy.png.split(',')[1],'base64')).buffer),split=dualViewSplit(proxy.width,proxy.height,new Uint8Array(codec.toRGBA8(proxy)[0]),combined.width);mid=split.x;}
   if(mid<2)throw new DomainError('IMAGE_LIMIT');
   const left=image.crop({x:0,y:0,width:mid,height:combined.height}).toPNG(),right=image.crop({x:mid,y:0,width:combined.width-mid,height:combined.height}).toPNG(),frontLeft=req.payload.layout==='front-left';
   references=[referenceFromPng(frontLeft?left:right,combined.name+' / 正面','front'),referenceFromPng(frontLeft?right:left,combined.name+' / 背面','back')];
   references=references.map((r,i)=>({...r,sheet:{id:combined.id,width:combined.width,height:combined.height,x:(i===0?frontLeft:!frontLeft)?0:mid,y:0,...(i===0?{png:combined.png}:{})}}));
  }
 }
 if(req.method==='reference.splitAll'&&req.payload.swapViews)references=references.map(r=>({...r,view:r.view==='front'?'back' as const:'front' as const,name:r.name.replace(/\s*\/\s*(正面|背面)$/,r.view==='front'?' / 背面':' / 正面')}));
 references=references.map(r=>r.resources?r:{...referenceFromPng(Buffer.from(r.png.split(',')[1],'base64'),r.name,r.view),id:r.id,calibration:r.calibration});
 const extractionController=new AbortController();surfaceController=extractionController;try{
 const result=await runReferences(references,options.heightMm,options.clusters,options.excludeBackground,options.mode??'simple',options.subject??'character',extractionController.signal);
 const geometry=await analyze(workerPath,{...p,pieces:result.regions.map(r=>r.piece)});if(geometry.some(g=>g.issues.some(i=>i.severity==='error')))throw new DomainError('INVALID_GEOMETRY');
 pack({...p,references:result.references,patternLibrary:result.regions});
 if(extractionController.signal.aborted)throw new DomainError('CANCELLED');repository.assertRevision(p.id,p.revision);
 repository.commit({type:'library.regions',...result,replaceViews:['front','back']},req.requestId,fingerprint);checkpoint();
 }finally{if(surfaceController===extractionController)surfaceController=undefined;}break;
 }
 case 'workflow.file':case 'patterns.bundle':{
  const p=repository.snapshot()!,flow=req.method==='workflow.file',extension=flow?'json':'zip';
  if(req.payload.action==='export'){
   checkpoint();const bytes=flow?workflowBytes(p):cutBundle(p,await analyze(workerPath,p));
   const choice=await dialog.showSaveDialog(window,{defaultPath:`${p.name.replace(/[<>:"/\\|?*]/g,'_')}.${extension}`,filters:[{name:flow?'制作流 JSON':'裁片 ZIP',extensions:[extension]}]});
   if(choice.canceled||!choice.filePath)return {ok:true,data:await state(),cancelled:true};await atomicWrite(choice.filePath,bytes);
  }else{
   const choice=await dialog.showOpenDialog(window,{properties:['openFile'],filters:[{name:flow?'制作流 JSON':'裁片 ZIP',extensions:[extension]}]});if(choice.canceled)return {ok:true,data:await state(),cancelled:true};
   if((await stat(choice.filePaths[0])).size>200*1024*1024)throw new DomainError('RESOURCE_LIMIT');
   const bytes=await readFile(choice.filePaths[0]),imported=flow?readWorkflow(bytes):readCutBundle(bytes);
   if(imported.surface)validateSurface(imported.surface);for(const m of imported.modelLibrary??[])validateSurface(m.surface);for(const r of imported.references??[])validateReference(r);
   pack(imported);cache(imported,await analyze(workerPath,imported));checkpoint();repository.open(imported,null);
  }break;
 }
 case 'patterns.preview':{const p=repository.snapshot()!,r=req.payload,{subset,geometry}=await printableSelection(p,r.pieceIds,r.warningAckIds);if(r.overviewOnly)return {ok:true,data:await state(),patternOverview:patternOverview(subset,geometry,r.warningAckIds)};const svg=svgExport(subset,geometry,r.warningAckIds);let plan;try{plan=svgPrintPlan(svg,r.paper);}catch(error){throw new DomainError((error as Error).message);}return {ok:true,data:await state(),printPreview:{svg,plan,revision:p.revision,pieceIds:r.pieceIds}};}
 case 'patterns.output':{
  const p=repository.snapshot()!,options=req.payload,{subset,geometry:selectedGeometry}=await printableSelection(p,options.pieceIds,options.warningAckIds);checkpoint();
  if(options.format==='print'){
   const html=printHtml(svgExport(subset,selectedGeometry,options.warningAckIds),options.paper,options.pageNumbers),path=join(app.getPath('userData'),'print-'+randomUUID()+'.html');
   await atomicWrite(path,Buffer.from(html));const printWindow=new BrowserWindow({show:false,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false}});
   try{await printWindow.loadFile(path);await new Promise<void>((resolve,reject)=>printWindow.webContents.print({silent:false,printBackground:true,scaleFactor:100,margins:{marginType:'none'},pageSize:{width:Math.round(options.paper.widthMm*1000),height:Math.round(options.paper.heightMm*1000)}},(success,reason)=>success?resolve():reject(new DomainError(reason.toLowerCase().includes('cancel')?'PRINT_CANCELLED':'PRINT_FAILED'))));}finally{printWindow.destroy();await unlink(path).catch(()=>{});}
  }else{
   const choice=await dialog.showSaveDialog(window,{defaultPath:`patterns.${options.format}`,filters:[{name:options.format.toUpperCase(),extensions:[options.format]}]});if(choice.canceled||!choice.filePath)return {ok:true,data:await state(),cancelled:true};
   const bytes=options.format==='pdf'?await pdfExport(subset,selectedGeometry,options.warningAckIds,options.paper,false,options.pageNumbers):Buffer.from(svgExport(subset,selectedGeometry,options.warningAckIds));await atomicWrite(choice.filePath,bytes);
  }break;
 }
 case 'reference.import':{const selection=await dialog.showOpenDialog(window,{properties:['openFile'],filters:[{name:'Reference image',extensions:['png','jpg','jpeg','webp']}]});if(selection.canceled)return {ok:true,data:await state(),cancelled:true};const reference=await readReference(selection.filePaths[0],req.payload.view);pack({...repository.snapshot()!,references:[...(repository.snapshot()!.references??[]).filter(r=>r.view!==reference.view),reference]});repository.commit({type:'reference.put',reference},req.requestId,fingerprint);autosave();break;}
 case 'reference.segment':{const p=repository.snapshot()!,reference=p.references?.find(r=>r.id===req.payload.referenceId);if(!reference)throw new DomainError('ENTITY_MISSING');const run=segmentReference(reference,req.payload.seed,req.payload.tolerance,req.payload.options,req.payload.fitToleranceMm);const geometry=await analyze(workerPath,{...p,pieces:run.pieces??[run.piece]});if(geometry.some(g=>g.issues.some(i=>i.severity==='error')))throw new DomainError('INVALID_GEOMETRY');repository.commit({type:'reference.candidate',run,...(req.payload.library===undefined?{}:{library:req.payload.library})},req.requestId,fingerprint);autosave();break;}
 case 'reference.mask':{const p=repository.snapshot()!,reference=p.references?.find(r=>r.id===req.payload.referenceId);if(!reference)throw new DomainError('ENTITY_MISSING');validateReference(reference);const controller=new AbortController();surfaceController=controller;try{const run=await runManualMask(reference,req.payload.sourceHash,req.payload.mask,req.payload.color,controller.signal);const geometry=await analyze(workerPath,{...p,pieces:run.pieces??[run.piece]});if(geometry.some(g=>g.issues.some(i=>i.severity==='error')))throw new DomainError('INVALID_GEOMETRY');if(controller.signal.aborted)throw new DomainError('CANCELLED');if(repository.snapshot()?.revision!==p.revision)throw new DomainError('STALE_RESULT');repository.commit({type:'reference.candidate',run,...(req.payload.library===undefined?{}:{library:req.payload.library})},req.requestId,fingerprint);autosave();}finally{if(surfaceController===controller)surfaceController=undefined;}break;}
 case 'reference.accept':repository.commit({type:'reference.accept',library:req.payload.library},req.requestId,fingerprint);checkpoint();break;
 case 'template.import':{const selection=await dialog.showOpenDialog(window,{properties:['openFile'],filters:[{name:'FurryPattern template JSON',extensions:['fpctemplate','json']}]});if(selection.canceled)return {ok:true,data:await state(),cancelled:true};const path=selection.filePaths[0];if((await stat(path)).size>4*1024*1024)throw new DomainError('TEMPLATE_LIMIT');const definition=JSON.parse(await readFile(path,'utf8')),surface=fitTemplate(definition);pack({...repository.snapshot()!,surface});repository.commit({type:'surface.set',surface},req.requestId,fingerprint);autosave();break;}
 case 'seam.notches':{const p=repository.snapshot()!;const status=seamReports(p,await projectGeometry(p)).find(s=>s.id===req.payload.seamId)?.status;if(status!=='valid')throw new DomainError(status==='mismatch'?'SEAM_LENGTH_MISMATCH':'STALE_SEAM');const pieces=pairedNotches(p,req.payload.seamId,req.payload.count,req.payload.depthMm),geometry=await analyze(workerPath,{...p,pieces});if(geometry.some(g=>g.issues.some(i=>i.severity==='error')))throw new DomainError('INVALID_GEOMETRY');repository.commit({type:'pieces.replace',removeIds:pieces.map(p=>p.id),pieces},req.requestId,fingerprint);autosave();break;}
 case 'species.fit':case 'template.morph':case 'surface.sculpt':{
  const p=repository.snapshot()!,previous=p.surface;if(!previous)throw new DomainError('SURFACE_MISSING');
  const surface=req.method==='species.fit'?(previous.assembly&&previous.template?await runAssembly(fitSpecies(generateSpecies(previous.template.parameters),req.payload.targets)):fitSpecies(previous,req.payload.targets)):req.method==='template.morph'?morphTemplate(previous,req.payload.weights):sculptSurface(previous,req.payload);
  repository.assertRevision(p.id,p.revision);repository.commit({type:'surface.set',surface},req.requestId,fingerprint);autosave();break;
 }
 case 'template.fit':{const p=repository.snapshot()!,snapshot=p.surface?.customTemplate;if(!snapshot)throw new DomainError('TEMPLATE_MISSING');const surface=fitTemplate(snapshot.definition,req.payload.targets,p.surface);repository.commit({type:'surface.set',surface},req.requestId,fingerprint);autosave();break;}
 case 'template.export':{const snapshot=repository.snapshot()!.surface?.customTemplate;if(!snapshot)throw new DomainError('TEMPLATE_MISSING');const selection=await dialog.showSaveDialog(window,{defaultPath:'template.fpctemplate',filters:[{name:'FurryPattern template',extensions:['fpctemplate']}]});if(selection.canceled||!selection.filePath)return {ok:true,data:await state(),cancelled:true};await atomicWrite(selection.filePath,new TextEncoder().encode(JSON.stringify(snapshot.definition,null,2)));break;}
 case 'pattern.corner':{const p=repository.snapshot()!;let piece;try{piece=cornerPiece(p,req.payload.pieceId,req.payload.nodeId,req.payload.kind,req.payload.sizeMm,randomUUID);}catch(e){throw new DomainError((e as Error).message);}const geometry=await analyze(workerPath,{...p,pieces:[piece]});if(geometry.some(g=>g.issues.some(i=>i.severity==='error')))throw new DomainError('INVALID_GEOMETRY');repository.commit({type:'piece.put',piece},req.requestId,fingerprint);autosave();break;}
 case 'pattern.import':{const selection=await dialog.showOpenDialog(window,{properties:['openFile'],filters:[{name:'SVG patterns',extensions:['svg']}]});if(selection.canceled)return {ok:true,data:await state(),cancelled:true};const path=selection.filePaths[0];if((await stat(path)).size>4*1024*1024)throw new DomainError('RESOURCE_LIMIT');const pieces=parseSvg(await readFile(path,'utf8'),req.payload.scale),p=repository.snapshot()!;const geometry=await analyze(workerPath,{...p,pieces});if(geometry.some(g=>g.issues.some(i=>i.severity==='error')))throw new DomainError('INVALID_GEOMETRY');repository.commit({type:'pieces.replace',removeIds:[],pieces},req.requestId,fingerprint);autosave();break;}
 case 'surface.export':{const surface=repository.snapshot()!.surface;if(!surface)throw new DomainError('SURFACE_MISSING');const selection=await dialog.showSaveDialog(window,{defaultPath:'surface.glb',filters:[{name:'Static GLB (metres)',extensions:['glb']}]});if(selection.canceled||!selection.filePath)return {ok:true,data:await state(),cancelled:true};const bytes=await exportGlb(surface);await atomicWrite(selection.filePath,bytes);break;}
 case 'surface.import':{const selection=await dialog.showOpenDialog(window,{properties:['openFile'],filters:[{name:'OBJ / GLB mesh',extensions:['obj','glb']}]});if(selection.canceled)return {ok:true,data:await state(),cancelled:true};const path=selection.filePaths[0],surface=await (/\.glb$/i.test(path)?readGlb(path,req.payload.scale):readObj(path,req.payload.scale));repository.commit({type:'surface.set',surface},req.requestId,fingerprint);autosave();break;}
 case 'species.assemble':{const p=repository.snapshot()!;if(!p.surface)throw new DomainError('SURFACE_MISSING');const surface=await runAssembly(p.surface);repository.commit({type:'surface.set',surface},req.requestId,fingerprint);autosave();break;}
 case 'species.generate':{const p=repository.snapshot()!;const surface=await runAssembly(generateSpecies(req.payload,p.surface));repository.assertRevision(p.id,p.revision);repository.commit({type:'surface.set',surface},req.requestId,fingerprint);autosave();break;}
 case 'body.generate':{const surface=generateTorso(req.payload,repository.snapshot()!.surface);repository.commit({type:'surface.set',surface},req.requestId,fingerprint);autosave();break;}
 case 'surface.cancel':surfaceController?.abort();return {ok:true,data:await state(),cancelled:true};
 case 'surface.unwrap':{const p=repository.snapshot()!;if(!p.surface)throw new DomainError('SURFACE_MISSING');const controller=new AbortController();surfaceController=controller;try{const {run,markings}=await runCutPreview(workerPath,p.surface,p,req.payload,join(root,'dist/assets'),controller.signal);if(controller.signal.aborted)throw new DomainError('CANCELLED');repository.assertRevision(p.id,p.revision);repository.commit({type:'unwrap.candidate',run,markings},req.requestId,fingerprint);autosave();}finally{if(surfaceController===controller)surfaceController=undefined;}break;}
 case 'surface.accept':{const p=repository.snapshot()!;if(!p.surfaceRun||p.surfaceRun.accepted)throw new DomainError('JOB_NOT_SUCCEEDED');if(p.surfaceRun.bindings.some(b=>b.report.status==='needsReview')&&!req.payload.acknowledgeReview)throw new DomainError('WARNING_ACK_REQUIRED');repository.commit({type:'unwrap.accept'},req.requestId,fingerprint);checkpoint();break;}
 case 'nesting.run':{const p=repository.snapshot()!,geometry=await analyze(workerPath,p),nesting=await runNesting(p,geometry,req.payload);repository.commit({type:'nesting.set',nesting},req.requestId,fingerprint);autosave();break;}
 case 'pattern.boolean':{const p=repository.snapshot()!;const a=p.pieces.find(p=>p.id===req.payload.a),b=p.pieces.find(p=>p.id===req.payload.b);if(!a||!b)throw new DomainError('ENTITY_MISSING');const pieces=await booleanPieces(workerPath,a,b,req.payload.operation);const geometry=await analyze(workerPath,{...p,pieces});if(geometry.some(g=>g.issues.some(i=>i.severity==='error')))throw new DomainError('INVALID_GEOMETRY');repository.commit({type:'pieces.replace',removeIds:[a.id,b.id],pieces},req.requestId,fingerprint);autosave();break;}
 case 'pattern.allowance':{const piece=repository.snapshot()!.pieces.find(p=>p.id===req.payload.pieceId);if(!piece)throw new DomainError('ENTITY_MISSING');jobs.submit(piece.id,piece.allowanceMm,req.requestId,fingerprint,piece.join??'miter',{edgeAllowances:req.payload.edgeAllowances,allowanceSource:req.payload.allowanceSource});break;}
 case 'pattern.offset':jobs.submit(req.payload.pieceId,req.payload.distanceMm,req.requestId,fingerprint,req.payload.join);break;
 case 'job.cancel':jobs.cancel(req.payload.jobId);break;
 case 'result.discard':jobs.discard(req.payload.jobId);break;
 case 'result.accept':jobs.accept(req.payload.jobId,req.payload.resultHash,req.requestId,fingerprint);break;
 case 'export.create':{const p=repository.snapshot()!;const geometry=await analyze(workerPath,p);gate(p,geometry,req.payload.warningAckIds);if(!await save(false))return {ok:true,data:await state(),cancelled:true};const choice=await dialog.showSaveDialog(window,{defaultPath:`pattern.${req.payload.format}`,filters:[{name:req.payload.format.toUpperCase(),extensions:[req.payload.format]}]});if(choice.canceled||!choice.filePath)return {ok:true,data:await state(),cancelled:true};const bytes=req.payload.format==='dxf'?Buffer.from(dxfExport(p,geometry,req.payload.warningAckIds,req.payload.nested)):req.payload.format==='svg'?Buffer.from(svgExport(p,geometry,req.payload.warningAckIds,req.payload.nested)):req.payload.format==='pdf'?await pdfExport(p,geometry,req.payload.warningAckIds,req.payload.paper,req.payload.nested):await pngExport(p,geometry,req.payload.warningAckIds,req.payload.nested);await atomicWrite(choice.filePath,bytes);break;}
 }
 const started=performance.now(),data=await state();profile(req.method+':state',started);return {ok:true,data};
 }catch(e){const code=e instanceof DomainError?e.code:e instanceof Error&&e.name==='ZodError'?'VALIDATION_ERROR':'IO_ERROR';return {ok:false,error:{code,messageKey:code}};}}
function dispatch(raw:unknown,active=()=>true){const next=queue.then(async()=>{if(!active())return {ok:false as const,error:{code:'ASSISTANT_DISABLED',messageKey:'ASSISTANT_DISABLED'}};return handle(raw);});queue=next.catch(()=>{});return next;}
const assistant=new AssistantBridge(async(request,active)=>{const response=await dispatch(request,active);if(response.ok&&request.method!=='session.read'&&request.method!=='validation.run'&&request.method!=='patterns.preview')changed();return response;});
app.setPath('userData',process.env.FPCAD_DATA_DIR?resolve(process.env.FPCAD_DATA_DIR):join(app.getPath('appData'),'FurryPatternCAD'));
if(!app.requestSingleInstanceLock())app.quit();else{
app.on('second-instance',()=>{if(!process.argv.includes('--fpcad-background-test')){window?.show();window?.focus();}});
app.whenReady().then(async()=>{
 await mkdir(app.getPath('userData'),{recursive:true});
 const modules=new ModuleRegistry();await modules.start([{id:'project',version:'0.1.0',dependsOn:[],optional:false,capabilities:['project.basic'],initialize:async()=>{repository=new Repository(join(app.getPath('userData'),'workspace.sqlite'));},dispose:async()=>{repository.close();}}]);
 jobs=new JobManager(repository,(project,signal)=>analyze(workerPath,project,signal),changed,()=>window?.webContents.send('fpcad:storage-error'));
 session.defaultSession.setPermissionRequestHandler((_wc,_permission,callback)=>callback(false));
 session.defaultSession.webRequest.onBeforeRequest((details,callback)=>callback({cancel:!details.url.startsWith('file:')&&!details.url.startsWith('devtools:')}));
 Menu.setApplicationMenu(null);
 window=new BrowserWindow({show:!process.argv.includes('--fpcad-background-test'),width:1440,height:960,minWidth:1000,minHeight:680,backgroundColor:'#f3f5f6',title:'FurryPattern CAD',webPreferences:{backgroundThrottling:!process.argv.includes('--fpcad-background-test'),preload:join(__dirname,'preload.cjs'),nodeIntegration:false,contextIsolation:true,sandbox:true}});
 window.webContents.setWindowOpenHandler(()=>({action:'deny'}));window.webContents.on('will-navigate',e=>e.preventDefault());
 ipcMain.handle('fpcad:request',(event,raw:unknown)=>{if(event.sender!==window.webContents||event.senderFrame!==window.webContents.mainFrame)return {ok:false,error:{code:'FORBIDDEN',messageKey:'FORBIDDEN'}};const parsed=requestSchema.safeParse(raw);if(parsed.success&&parsed.data.method==='surface.cancel')return handle(raw);return dispatch(raw);});
 const assistantSettings=new AssistantSettings(repository.db,{available:()=>safeStorage.isEncryptionAvailable(),encrypt:v=>safeStorage.encryptString(v),decrypt:v=>safeStorage.decryptString(v)});
 ipcMain.handle('fpcad:assistant-settings',async(event,request:unknown)=>{if(event.sender!==window.webContents||event.senderFrame!==window.webContents.mainFrame)return {ok:false,error:'FORBIDDEN'};try{const r=request as {action?:string;config?:unknown;providerId?:string;serverId?:string};if(r?.action==='save')return {ok:true,config:assistantSettings.save(r.config)};if(r?.action==='read')return {ok:true,config:assistantSettings.read()};if(r?.action==='models'&&typeof r.providerId==='string')return {ok:true,models:await assistantSettings.models(r.providerId),config:assistantSettings.read()};if(r?.action==='mcp-test'&&typeof r.serverId==='string')return {ok:true,tools:await assistantSettings.mcpTest(r.serverId),config:assistantSettings.read()};return {ok:false,error:'VALIDATION_ERROR'};}catch(e){return {ok:false,error:e instanceof Error?e.message:'ASSISTANT_SETTINGS_FAILED'};}});
 ipcMain.handle('fpcad:assistant',async(event,action:unknown)=>{if(event.sender!==window.webContents||event.senderFrame!==window.webContents.mainFrame||!['status','enable','disable'].includes(String(action)))return {ok:false,error:{code:'FORBIDDEN',messageKey:'FORBIDDEN'}};try{return {ok:true,connection:action==='enable'?await assistant.enable():action==='disable'?assistant.disable():assistant.status()};}catch{return {ok:false,error:{code:'ASSISTANT_START_FAILED',messageKey:'ASSISTANT_START_FAILED'}};}});
 let closing=false;window.on('close',event=>{if(closing)return;event.preventDefault();assistant.disable();surfaceController?.abort();queue=queue.then(async()=>{try{checkpoint();closing=true;window.close();}catch{await dialog.showMessageBox(window,{type:'error',message:'无法保存恢复点。请释放磁盘空间后再关闭。'});}});});
 await window.loadFile(join(root,'dist/renderer/index.html'));
});app.on('window-all-closed',()=>app.quit());app.on('will-quit',()=>{assistant.disable();clearTimeout(debounce);clearTimeout(maxWait);surfaceController?.abort();jobs?.dispose();repository?.close();});
}


