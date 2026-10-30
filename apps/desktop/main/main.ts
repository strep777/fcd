import {mirrorPaintShape} from '../../../packages/surface/symmetry';
import {encodeResponse} from '../../../packages/api/response-wire';
import {withPatternSpacing} from '../../../packages/manufacturing/pattern-spacing';
import {SurfaceTaskQueue} from './surface-task-queue';
import {patternOverview} from './print-preview-batch';
import {AssistantSettings} from './assistant-settings';
import {editableLibraryRegion,refreshLibraryRegionMetadata} from './library-region-edit';
import {moveNode} from '../../../packages/pattern/edit';
import {editableMarking} from './surface-marking-edit';
import {runAutomaticPlacement,runReferences,runManualMask,runReferenceSegment} from './surface-runtime';
import {classifyModel} from './model-anatomy';
import {AssistantBridge} from './assistant-bridge';
import {editSurfaceCuts,normalizeCutSurface} from './cut-tools';
import {svgPrintPlan} from '../../../packages/manufacturing/print-pages';
import {mappedMarking} from './fragment-mapping';
import {adjustPattern} from './pattern-adjustment';
import {workflowBytes,readWorkflow,cutBundle,readCutBundle,selectedProject,printHtml} from './workflow-exchange';
import {unlink} from 'node:fs/promises';
import {cornerPiece} from '../../../packages/pattern/corners';
import {randomUUID} from 'node:crypto';
import {runEditLibraryRegion,runEditSurfaceMarking,runEditSurfaceMarkings,runCutPreview,runProjection,runTexture,runSurfaceMarking,runInference} from './surface-runtime';
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
import {dialogs as dialog,publish,serve} from './host-channel';
import {windowsVault} from './windows-vault';
import { join,resolve } from 'node:path';
import { mkdir } from 'node:fs/promises';
import { requestSchema,type Request,type Session,type Response,type Project,type Geometry } from '../../../packages/schema/index';
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
import {wholeReferenceSheet,readReference,segmentationProxy,manualReference,validateReference,referenceFromPng} from './references';
const dataDirectory=resolve(process.env.FPCAD_DATA_DIR??'.local/workspace');let repository:Repository;let jobs:JobManager;let queue:Promise<unknown>=Promise.resolve();let debounce:NodeJS.Timeout|undefined,maxWait:NodeJS.Timeout|undefined;
let surfaceController:AbortController|undefined;
const surfaceTasks=new SurfaceTaskQueue();let publishedState:Session|undefined,activeSurfaceTask:ReturnType<SurfaceTaskQueue['track']>;
function createSurfaceController(){const controller=new AbortController();if(activeSurfaceTask?.cancelled)controller.abort();return controller;}
const geometryCache=new Map<string,Geometry>();
const root=resolve(__dirname,'../..');const workerPath=join(root,'dist/bin',process.platform==='win32'?'fpcad-worker.exe':'fpcad-worker');
configureExportAssets(join(root,'dist/assets'));
function checkpoint(){clearTimeout(debounce);clearTimeout(maxWait);debounce=undefined;maxWait=undefined;repository.checkpoint();}
function autosave(){clearTimeout(debounce);debounce=setTimeout(()=>{try{checkpoint();}catch{publish('fpcad:storage-error');}},3000);if(!maxWait)maxWait=setTimeout(()=>{try{checkpoint();}catch{publish('fpcad:storage-error');}},30000);}
function profile(stage:string,started:number){if(process.env.FPCAD_PROFILE==='1')console.log('FPCAD_PROFILE '+JSON.stringify({stage,elapsedMs:performance.now()-started}));return performance.now();}
function changed(){publish('fpcad:changed');}
const geometryKey=(project:Project,p:Project['pieces'][number])=>hash(JSON.stringify({piece:p,material:materialFor(project,p),defaultAllowanceMm:project.defaultAllowanceMm}));
function cache(project:Project,geometry:Geometry[]){project.pieces.forEach((p,i)=>geometryCache.set(geometryKey(project,p),geometry[i]));while(geometryCache.size>500)geometryCache.delete(geometryCache.keys().next().value!);}
async function projectGeometry(project:Project){const current=new Map<string,Geometry>(),missing:Project['pieces']=[];for(const p of project.pieces){const key=geometryKey(project,p),value=geometryCache.get(key);if(value){current.set(p.id,value);geometryCache.delete(key);geometryCache.set(key,value);}else missing.push(p);}if(missing.length){const input={...project,pieces:missing},geometry=await analyze(workerPath,input);cache(input,geometry);missing.forEach((p,i)=>current.set(p.id,geometry[i]));}return project.pieces.map(p=>current.get(p.id)!);}
async function printableSelection(project:Project,pieceIds:string[],ack:string[]){const subset=selectedProject(project,pieceIds),selected=new Set(pieceIds),geometry=await analyze(workerPath,subset),markingError=markingIssues(project).find(i=>selected.has(i.entityId));if(markingError)throw new DomainError(markingError.messageKey);if(outputSeamIssues(project,await projectGeometry(project),pieceIds).length)throw new DomainError('INVALID_SEAMS');gate(subset,geometry,ack);return {subset,geometry};}
async function state(project:Project|null=repository.snapshot()):Promise<Session>{let geometry:Geometry[]=[];if(project)try{geometry=(await projectGeometry(project)).map(g=>({...g,issues:[...g.issues]}));}catch(e){geometry=project.pieces.map(p=>({id:p.id,cut:[],areaMm2:0,perimeterMm:0,issues:[{ruleId:`${p.id}:worker`,severity:'error',entityId:p.id,messageKey:e instanceof DomainError?e.code:'WORKER_CRASH'}]}));}if(project){for(const issue of [...seamIssues(project,geometry),...bindingIssues(project),...markingIssues(project)]){const g=geometry.find(g=>g.id===issue.entityId);if(g)g.issues=[...g.issues,issue];}}return publishedState={sessionId:repository.sessionId??undefined,project,geometry,...((repository.startupNotice??repository.maintenanceWarning)?{notice:repository.startupNotice??repository.maintenanceWarning}:{}),...repository.status(),recent:repository.recent(),jobs:jobs.list()};}
async function projectDestination(saveAs:boolean){const metadata=repository.projectMetadata();if(!metadata)throw new DomainError('PROJECT_MISSING');let path=saveAs?null:metadata.destination;
 if(!path){const choice=await dialog.save({defaultPath:`${metadata.name.replace(/[<>:"/\\|?*]/g,'_')}.fpcad`,filters:[{name:'FurryPattern CAD',extensions:['fpcad']}]});if(choice.canceled||!choice.filePath)return false;path=choice.filePath;}
 return path;
}
async function writeSavedProject(project:Project,path:string){checkpoint();const result=pack(project);unpack(result.bytes);await atomicWrite(path,result.bytes);repository.markSaved(path,project.revision);}
async function save(saveAs:boolean){const path=await projectDestination(saveAs);if(!path)return false;await writeSavedProject(repository.snapshot()!,path);return true;
}
async function handle(raw:unknown):Promise<Response>{try{
 if(Buffer.byteLength(JSON.stringify(raw))>64*1024*1024)throw new DomainError('RESOURCE_LIMIT');const req=requestSchema.parse(raw);
 const fingerprint=hash(JSON.stringify(req));
 if(['command.apply','command.undo','command.redo','result.accept','pattern.boolean','nesting.run','surface.unwrap','surface.accept','body.generate','species.generate','species.assemble','reference.segment','reference.mask','seam.notches','species.fit','template.morph','surface.sculpt','pattern.corner','pattern.import','surface.import','template.import','template.fit','reference.accept','reference.auto','reference.splitAll','marking.auto','marking.infer','marking.surface','marking.surface.edit','marking.surface.editMany','marking.surface.brush','marking.texture','marking.project','marking.source.edit','library.region.edit','marking.edit'].includes(req.method)&&repository.replay(req.requestId,fingerprint))return {ok:true,data:await state()};
 if('projectId' in req)repository.assertRevision(req.projectId,req.expectedRevision);
 // Reuse validated command results; do not reload and parse their large assets again.
 let committedProject:Project|undefined;
 switch(req.method){
 case 'session.read':break;
 case 'session.delete':{const active=repository.sessionId===req.payload.sessionId;repository.deleteSession(req.payload.sessionId);jobs.releaseDeleted();geometryCache.clear();if(active){clearTimeout(debounce);clearTimeout(maxWait);debounce=undefined;maxWait=undefined;}break;}
 case 'session.activate':checkpoint();repository.activate(req.payload.sessionId);break;
 case 'project.create':checkpoint();repository.create(req.payload.name);break;
 case 'project.open':{const selection=await dialog.open({properties:['openFile'],filters:[{name:'FurryPattern CAD',extensions:['fpcad']}]});if(selection.canceled)return {ok:true,data:publishedState??await state(),cancelled:true};let started=performance.now();const p=await readProject(selection.filePaths[0]);started=profile('open:archive',started);if(p.surface)validateSurface(p.surface);for(const model of p.modelLibrary??[])validateSurface(model.surface);for(const ref of p.references??[])validateReference(ref);started=profile('open:assets',started);cache(p,await analyze(workerPath,p));started=profile('open:geometry',started);checkpoint();committedProject=repository.open(p,selection.filePaths[0]);profile('open:database',started);break;}
 case 'project.save':if(!await save(req.payload.saveAs))return {ok:true,data:publishedState??await state(),cancelled:true};break;
 case 'command.apply':{const current=repository.snapshot()!;if(['markings.batch','marking.source.update','marking.put','reference.put','reference.candidate','reference.accept','unwrap.candidate','unwrap.accept','piece.adjusted','surface.refined'].includes(req.payload.type))throw new DomainError('FORBIDDEN');else if(req.payload.type==='patterns.allowance'){
 const controller=createSurfaceController();surfaceController=controller;
 try{const proposed=withPatternSpacing(current,req.payload.widthMm,req.payload.join),geometry=await analyze(workerPath,proposed,controller.signal);if(controller.signal.aborted)throw new DomainError('CANCELLED');if(geometry.some(piece=>piece.issues.some(issue=>issue.severity==='error')))throw new DomainError('INVALID_GEOMETRY');repository.assertRevision(current.id,current.revision);repository.commit(req.payload,req.requestId,fingerprint);cache(repository.snapshot()!,geometry);autosave();}finally{if(surfaceController===controller)surfaceController=undefined;}break;
 }else if(req.payload.type==='surface.curve'||req.payload.type==='surface.section'||req.payload.type==='surface.cutScope'||req.payload.type==='surface.cutLine.meta'||req.payload.type==='surface.cutLine.delete'){
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
 }else committedProject=repository.commit(req.payload,req.requestId,fingerprint);autosave();break;}
 case 'command.undo':committedProject=repository.historyMove(false,req.requestId,fingerprint);autosave();break;
 case 'command.redo':committedProject=repository.historyMove(true,req.requestId,fingerprint);autosave();break;
 case 'recovery.restore':repository.restore(req.payload.revision);break;
 case 'validation.run':geometryCache.clear();break;
 case 'library.region.edit':{const p=repository.snapshot()!,controller=createSurfaceController();editableLibraryRegion(p,req.payload.pieceId);surfaceController=controller;try{const result=await runEditLibraryRegion(workerPath,p,req.payload.pieceId,req.payload.edit,controller.signal);if(controller.signal.aborted)throw new DomainError('CANCELLED');repository.assertRevision(p.id,p.revision);repository.commit({type:'library.region.update',...result},req.requestId,fingerprint);autosave();}finally{if(surfaceController===controller)surfaceController=undefined;}break;}
 case 'marking.source.edit':{const p=repository.snapshot()!,r=req.payload,source=p.patternLibrary?.find(region=>region.piece.id===r.pieceId)?.piece;
  if(source){
   editableLibraryRegion(p,r.pieceId,r.replaceManual);if(![...source.nodes,...source.holes?.flat()??[]].some(n=>n.id===r.nodeId))throw new DomainError('ENTITY_MISSING');
   const piece=moveNode(source,r.nodeId,r.xMm,r.yMm),controller=createSurfaceController();surfaceController=controller;
   try{const result=await runEditLibraryRegion(workerPath,p,r.pieceId,{piece,operations:[]},controller.signal,r.replaceManual);if(controller.signal.aborted)throw new DomainError('CANCELLED');repository.assertRevision(p.id,p.revision);repository.commit({type:'library.region.update',...result},req.requestId,fingerprint);autosave();}finally{if(surfaceController===controller)surfaceController=undefined;}
  }else{const controller=createSurfaceController();surfaceController=controller;try{const result=await editMarkingSource(workerPath,p,r.pieceId,r.nodeId,r.xMm,r.yMm,r.replaceManual,controller.signal),proposed={...p,pieces:p.pieces.map(piece=>piece.id===result.piece.id?result.piece:piece)},models=await refreshSavedModelMarkings(workerPath,proposed,r.pieceId,r.replaceManual,false,controller.signal);if(controller.signal.aborted)throw new DomainError('CANCELLED');repository.assertRevision(p.id,p.revision);repository.commit({type:'marking.source.update',...result,models},req.requestId,fingerprint);autosave();}finally{if(surfaceController===controller)surfaceController=undefined;}}break;}
 case 'marking.edit':{const p=repository.snapshot()!,marking=await editMarking(workerPath,p,req.payload.markingId,req.payload.pieceId,req.payload.rings);repository.commit({type:'marking.put',marking},req.requestId,fingerprint);autosave();break;}
 case 'marking.infer':{const p=repository.snapshot()!,r=req.payload,controller=createSurfaceController();surfaceController=controller;try{let m=await runInference(workerPath,p,r.markingId,r.mode,r.distanceMm,r.planeXmm,controller.signal);if(p.bindings?.some(b=>b.trim))m=await mappedMarking(workerPath,p,m,controller.signal);if(controller.signal.aborted)throw new DomainError('CANCELLED');repository.assertRevision(p.id,p.revision);repository.commit({type:'marking.put',marking:m},req.requestId,fingerprint);autosave();}finally{if(surfaceController===controller)surfaceController=undefined;}break;}
 case 'marking.surface.editMany':{
  const p=repository.snapshot()!,edits=req.payload.edits,controller=createSurfaceController();
  if(new Set(edits.map(edit=>edit.markingId)).size!==edits.length)throw new DomainError('INVALID_SELECTION');
  for(const edit of edits)editableMarking(p,edit.markingId);
  surfaceController=controller;
  try{
   const markings=await runEditSurfaceMarkings(workerPath,p,edits,controller.signal);
   if(controller.signal.aborted)throw new DomainError('CANCELLED');
   if(markings.length!==edits.length||markings.some((marking,index)=>marking.id!==edits[index].markingId))throw new DomainError('WORKER_PROTOCOL');
   repository.assertRevision(p.id,p.revision);
   committedProject=repository.commit({type:'markings.batch',markings},req.requestId,fingerprint);autosave();
  }finally{if(surfaceController===controller)surfaceController=undefined;}
  break;
 }
 case 'marking.surface.edit':case 'marking.surface.brush':{const p=repository.snapshot()!,controller=createSurfaceController();if(req.payload.markingId)editableMarking(p,req.payload.markingId);surfaceController=controller;try{const m=await runEditSurfaceMarking(workerPath,p,req.payload.markingId,req.method==='marking.surface.edit'?req.payload.shape:undefined,req.method==='marking.surface.brush'?req.payload.stroke:undefined,controller.signal);const markings=[m];if(req.method==='marking.surface.brush'&&req.payload.stroke.symmetric){if(req.payload.markingId||!m.surfaceShape||!p.surface)throw new DomainError('MARKING_EDIT_FRAME');let mirrored=await runSurfaceMarking(workerPath,p,mirrorPaintShape(p.surface,m.surfaceShape),m.color,(m.name+' · 对称').slice(0,120),controller.signal);if(p.bindings?.some(b=>b.trim))mirrored=await mappedMarking(workerPath,p,mirrored,controller.signal);markings.push(mirrored);}if(controller.signal.aborted)throw new DomainError('CANCELLED');repository.assertRevision(p.id,p.revision);repository.commit(markings.length>1?{type:'markings.batch',markings}:{type:'marking.put',marking:m},req.requestId,fingerprint);autosave();}finally{if(surfaceController===controller)surfaceController=undefined;}break;}
 case 'marking.surface':{const p=repository.snapshot()!,r=req.payload,controller=createSurfaceController();surfaceController=controller;try{let m=await runSurfaceMarking(workerPath,p,r.shape,r.color,r.name,controller.signal,r.fabrication);if(p.bindings?.some(b=>b.trim))m=await mappedMarking(workerPath,p,m,controller.signal);if(controller.signal.aborted)throw new DomainError('CANCELLED');repository.assertRevision(p.id,p.revision);repository.commit({type:'marking.put',marking:m},req.requestId,fingerprint);autosave();}finally{if(surfaceController===controller)surfaceController=undefined;}break;}
 case 'marking.texture':{const p=repository.snapshot()!,r=req.payload,controller=createSurfaceController();surfaceController=controller;try{let m=await runTexture(workerPath,p,r.textureId,r.seed,r.tolerance,controller.signal);if(p.bindings?.some(b=>b.trim))m=await mappedMarking(workerPath,p,m,controller.signal);if(controller.signal.aborted)throw new DomainError('CANCELLED');repository.assertRevision(p.id,p.revision);repository.commit({type:'marking.put',marking:m},req.requestId,fingerprint);autosave();}finally{if(surfaceController===controller)surfaceController=undefined;}break;}
 case 'marking.project':{const p=repository.snapshot()!,controller=createSurfaceController();surfaceController=controller;try{const m=await runProjection(workerPath,p,req.payload.pieceId,req.payload.view,req.payload.offsetXmm,req.payload.offsetYmm,controller.signal,req.payload.replaceManual);if(controller.signal.aborted)throw new DomainError('CANCELLED');repository.assertRevision(p.id,p.revision);repository.commit({type:'marking.put',marking:m},req.requestId,fingerprint);autosave();}finally{if(surfaceController===controller)surfaceController=undefined;}break;}
 case 'marking.auto':{
  const p=repository.snapshot()!,ids=req.payload.pieceIds;if(new Set(ids).size!==ids.length||ids.some(id=>!p.patternLibrary?.some(r=>r.piece.id===id)))throw new DomainError('INVALID_SELECTION');if(!p.surface)throw new DomainError('SURFACE_MISSING');
  const controller=createSurfaceController();surfaceController=controller;
  try{const {markings,skipped}=await runAutomaticPlacement(workerPath,p,ids,req.payload.parts,controller.signal);
   if(controller.signal.aborted)throw new DomainError('CANCELLED');repository.assertRevision(p.id,p.revision);if(markings.length){repository.commit({type:'markings.batch',markings},req.requestId,fingerprint);autosave();}return {ok:true,data:await state(),autoPlacementReport:{placed:markings.length,skipped}};
  }finally{if(surfaceController===controller)surfaceController=undefined;}break;
 }
 case 'reference.auto':case 'reference.splitAll':{
 const options=req.payload;let references:NonNullable<Project['references']>=[];
 if(req.method==='reference.auto'){
  const filters=[{name:'Reference image',extensions:['png','jpg','jpeg','webp']}];
  const choice=await dialog.open({title:'选择整张设定图',properties:['openFile'],filters});if(choice.canceled)return {ok:true,data:publishedState??await state(),cancelled:true};
  references=[await readReference(choice.filePaths[0],'sheet')];
 }
 const p=repository.snapshot()!;if(req.method==='reference.splitAll')references=[wholeReferenceSheet(p.references??[])];
 references=references.map(r=>r.resources?r:{...referenceFromPng(Buffer.from(r.png.split(',')[1],'base64'),r.name,r.view),id:r.id,calibration:r.calibration});
 const extractionController=createSurfaceController();surfaceController=extractionController;try{
 const result=await runReferences(references,options.heightMm,options.clusters,options.excludeBackground,options.mode??'simple',options.subject??'character',extractionController.signal);
 const geometry=await analyze(workerPath,{...p,pieces:result.regions.map(r=>r.piece)},extractionController.signal);if(geometry.some(g=>g.issues.some(i=>i.severity==='error')))throw new DomainError('INVALID_GEOMETRY');
 pack({...p,references:result.references,patternLibrary:result.regions});
 if(extractionController.signal.aborted)throw new DomainError('CANCELLED');repository.assertRevision(p.id,p.revision);
 repository.commit({type:'library.regions',...result,replaceViews:['sheet','front','back']},req.requestId,fingerprint);checkpoint();
 }finally{if(surfaceController===extractionController)surfaceController=undefined;}break;
 }
 case 'workflow.file':case 'patterns.bundle':{
  const flow=req.method==='workflow.file',extension=flow?'json':'zip';
  if(req.payload.action==='export'){
   const metadata=repository.projectMetadata();if(!metadata)throw new DomainError('PROJECT_MISSING');const choice=await dialog.save({defaultPath:`${metadata.name.replace(/[<>:"/\\|?*]/g,'_')}.${extension}`,filters:[{name:flow?'制作流 JSON':'裁片 ZIP',extensions:[extension]}]});
   if(choice.canceled||!choice.filePath)return {ok:true,data:publishedState??await state(),cancelled:true};
   const p=repository.snapshot()!;checkpoint();const bytes=flow?workflowBytes(p):cutBundle(p,await analyze(workerPath,p));await atomicWrite(choice.filePath,bytes);
  }else{
   const choice=await dialog.open({properties:['openFile'],filters:[{name:flow?'制作流 JSON':'裁片 ZIP',extensions:[extension]}]});if(choice.canceled)return {ok:true,data:publishedState??await state(),cancelled:true};
   if((await stat(choice.filePaths[0])).size>200*1024*1024)throw new DomainError('RESOURCE_LIMIT');
   const bytes=await readFile(choice.filePaths[0]),imported=flow?readWorkflow(bytes):readCutBundle(bytes);
   if(imported.surface)validateSurface(imported.surface);for(const m of imported.modelLibrary??[])validateSurface(m.surface);for(const r of imported.references??[])validateReference(r);
   pack(imported);cache(imported,await analyze(workerPath,imported));checkpoint();repository.open(imported,null);
  }break;
 }
 case 'patterns.preview':{const p=repository.snapshot()!,r=req.payload,{subset,geometry}=await printableSelection(p,r.pieceIds,r.warningAckIds);if(r.overviewOnly)return {ok:true,data:await state(),patternOverview:patternOverview(subset,geometry,r.warningAckIds)};const svg=svgExport(subset,geometry,r.warningAckIds);let plan;try{plan=svgPrintPlan(svg,r.paper);}catch(error){throw new DomainError((error as Error).message);}return {ok:true,data:await state(),printPreview:{svg,plan,revision:p.revision,pieceIds:r.pieceIds}};}
 case 'patterns.output':{
  const options=req.payload;
  let path:string|undefined;
  if(options.format!=='print'){
   const choice=await dialog.save({defaultPath:`patterns.${options.format}`,filters:[{name:options.format.toUpperCase(),extensions:[options.format]}]});if(choice.canceled||!choice.filePath)return {ok:true,data:publishedState??await state(),cancelled:true};path=choice.filePath;
  }
  const p=repository.snapshot()!,{subset,geometry:selectedGeometry}=await printableSelection(p,options.pieceIds,options.warningAckIds);checkpoint();
  if(options.format==='print'){
   const html=printHtml(svgExport(subset,selectedGeometry,options.warningAckIds),options.paper,options.pageNumbers);
   await dialog.print({html});
  }else{
   const bytes=options.format==='pdf'?await pdfExport(subset,selectedGeometry,options.warningAckIds,options.paper,false,options.pageNumbers):Buffer.from(svgExport(subset,selectedGeometry,options.warningAckIds));await atomicWrite(path!,bytes);
  }break;
 }
 case 'reference.import':{const selection=await dialog.open({properties:['openFile'],filters:[{name:'Reference image',extensions:['png','jpg','jpeg','webp']}]});if(selection.canceled)return {ok:true,data:publishedState??await state(),cancelled:true};const reference=await readReference(selection.filePaths[0],'sheet');pack({...repository.snapshot()!,references:[reference]});repository.commit({type:'reference.put',reference},req.requestId,fingerprint);autosave();break;}
 case 'reference.segment':{const p=repository.snapshot()!,reference=p.references?.find(r=>r.id===req.payload.referenceId);if(!reference)throw new DomainError('ENTITY_MISSING');const controller=createSurfaceController();surfaceController=controller;try{if(req.payload.options&&!reference.resources)validateReference(reference);const run=await runReferenceSegment(reference,req.payload.seed,req.payload.tolerance,req.payload.options,req.payload.fitToleranceMm,segmentationProxy(reference,req.payload.options),controller.signal);const geometry=await analyze(workerPath,{...p,pieces:run.pieces??[run.piece]},controller.signal);if(geometry.some(g=>g.issues.some(i=>i.severity==='error')))throw new DomainError('INVALID_GEOMETRY');if(controller.signal.aborted)throw new DomainError('CANCELLED');repository.assertRevision(p.id,p.revision);repository.commit({type:'reference.candidate',run,...(req.payload.library===undefined?{}:{library:req.payload.library})},req.requestId,fingerprint);autosave();}finally{if(surfaceController===controller)surfaceController=undefined;}break;}
 case 'reference.mask':{const p=repository.snapshot()!,reference=p.references?.find(r=>r.id===req.payload.referenceId);if(!reference)throw new DomainError('ENTITY_MISSING');validateReference(reference);const controller=createSurfaceController();surfaceController=controller;try{const run=await runManualMask(reference,req.payload.sourceHash,req.payload.mask,req.payload.color,controller.signal);const geometry=await analyze(workerPath,{...p,pieces:run.pieces??[run.piece]},controller.signal);if(geometry.some(g=>g.issues.some(i=>i.severity==='error')))throw new DomainError('INVALID_GEOMETRY');if(controller.signal.aborted)throw new DomainError('CANCELLED');if(repository.snapshot()?.revision!==p.revision)throw new DomainError('STALE_RESULT');repository.commit({type:'reference.candidate',run,...(req.payload.library===undefined?{}:{library:req.payload.library})},req.requestId,fingerprint);autosave();}finally{if(surfaceController===controller)surfaceController=undefined;}break;}
 case 'reference.accept':repository.commit({type:'reference.accept',library:req.payload.library},req.requestId,fingerprint);checkpoint();break;
 case 'template.import':{const selection=await dialog.open({properties:['openFile'],filters:[{name:'FurryPattern template JSON',extensions:['fpctemplate','json']}]});if(selection.canceled)return {ok:true,data:publishedState??await state(),cancelled:true};const path=selection.filePaths[0];if((await stat(path)).size>4*1024*1024)throw new DomainError('TEMPLATE_LIMIT');const definition=JSON.parse(await readFile(path,'utf8')),surface=fitTemplate(definition);pack({...repository.snapshot()!,surface});repository.commit({type:'surface.set',surface},req.requestId,fingerprint);autosave();break;}
 case 'seam.notches':{const p=repository.snapshot()!;const status=seamReports(p,await projectGeometry(p)).find(s=>s.id===req.payload.seamId)?.status;if(status!=='valid')throw new DomainError(status==='mismatch'?'SEAM_LENGTH_MISMATCH':'STALE_SEAM');const pieces=pairedNotches(p,req.payload.seamId,req.payload.count,req.payload.depthMm),geometry=await analyze(workerPath,{...p,pieces});if(geometry.some(g=>g.issues.some(i=>i.severity==='error')))throw new DomainError('INVALID_GEOMETRY');repository.commit({type:'pieces.replace',removeIds:pieces.map(p=>p.id),pieces},req.requestId,fingerprint);autosave();break;}
 case 'species.fit':case 'template.morph':case 'surface.sculpt':{
  const p=repository.snapshot()!,previous=p.surface;if(!previous)throw new DomainError('SURFACE_MISSING');
  const surface=req.method==='species.fit'?(previous.assembly&&previous.template?await runAssembly(fitSpecies(generateSpecies(previous.template.parameters),req.payload.targets)):fitSpecies(previous,req.payload.targets)):req.method==='template.morph'?morphTemplate(previous,req.payload.weights):sculptSurface(previous,req.payload);
  repository.assertRevision(p.id,p.revision);repository.commit({type:'surface.set',surface},req.requestId,fingerprint);autosave();break;
 }
 case 'template.fit':{const p=repository.snapshot()!,snapshot=p.surface?.customTemplate;if(!snapshot)throw new DomainError('TEMPLATE_MISSING');const surface=fitTemplate(snapshot.definition,req.payload.targets,p.surface);repository.commit({type:'surface.set',surface},req.requestId,fingerprint);autosave();break;}
 case 'template.export':{const selection=await dialog.save({defaultPath:'template.fpctemplate',filters:[{name:'FurryPattern template',extensions:['fpctemplate']}]});if(selection.canceled||!selection.filePath)return {ok:true,data:publishedState??await state(),cancelled:true};const snapshot=repository.snapshot()!.surface?.customTemplate;if(!snapshot)throw new DomainError('TEMPLATE_MISSING');await atomicWrite(selection.filePath,new TextEncoder().encode(JSON.stringify(snapshot.definition,null,2)));break;}
 case 'pattern.corner':{const p=repository.snapshot()!;let piece;try{piece=cornerPiece(p,req.payload.pieceId,req.payload.nodeId,req.payload.kind,req.payload.sizeMm,randomUUID);}catch(e){throw new DomainError((e as Error).message);}const geometry=await analyze(workerPath,{...p,pieces:[piece]});if(geometry.some(g=>g.issues.some(i=>i.severity==='error')))throw new DomainError('INVALID_GEOMETRY');repository.commit({type:'piece.put',piece},req.requestId,fingerprint);autosave();break;}
 case 'pattern.import':{const selection=await dialog.open({properties:['openFile'],filters:[{name:'SVG patterns',extensions:['svg']}]});if(selection.canceled)return {ok:true,data:publishedState??await state(),cancelled:true};const path=selection.filePaths[0];if((await stat(path)).size>4*1024*1024)throw new DomainError('RESOURCE_LIMIT');const pieces=parseSvg(await readFile(path,'utf8'),req.payload.scale),p=repository.snapshot()!;const geometry=await analyze(workerPath,{...p,pieces});if(geometry.some(g=>g.issues.some(i=>i.severity==='error')))throw new DomainError('INVALID_GEOMETRY');repository.commit({type:'pieces.replace',removeIds:[],pieces},req.requestId,fingerprint);autosave();break;}
 case 'surface.export':{const selection=await dialog.save({defaultPath:'surface.glb',filters:[{name:'Static GLB (metres)',extensions:['glb']}]});if(selection.canceled||!selection.filePath)return {ok:true,data:publishedState??await state(),cancelled:true};const surface=repository.snapshot()!.surface;if(!surface)throw new DomainError('SURFACE_MISSING');const bytes=await exportGlb(surface);await atomicWrite(selection.filePath,bytes);break;}
 case 'surface.import':{const selection=await dialog.open({properties:['openFile'],filters:[{name:'OBJ / GLB mesh',extensions:['obj','glb']}]});if(selection.canceled)return {ok:true,data:publishedState??await state(),cancelled:true};const path=selection.filePaths[0],surface=await (/\.glb$/i.test(path)?readGlb(path,req.payload.scale):readObj(path,req.payload.scale));repository.commit({type:'surface.set',surface},req.requestId,fingerprint);autosave();break;}
 case 'species.assemble':{const p=repository.snapshot()!;if(!p.surface)throw new DomainError('SURFACE_MISSING');const surface=await runAssembly(p.surface);repository.commit({type:'surface.set',surface},req.requestId,fingerprint);autosave();break;}
 case 'species.generate':{const p=repository.snapshot()!;const surface=await runAssembly(generateSpecies(req.payload,p.surface));repository.assertRevision(p.id,p.revision);repository.commit({type:'surface.set',surface},req.requestId,fingerprint);autosave();break;}
 case 'body.generate':{const surface=generateTorso(req.payload,repository.snapshot()!.surface);repository.commit({type:'surface.set',surface},req.requestId,fingerprint);autosave();break;}
 case 'surface.cancel':surfaceTasks.cancel(req.projectId,req.expectedRevision,req.payload.targetRequestIds);if(req.payload.targetRequestIds===undefined||activeSurfaceTask?.cancelled)surfaceController?.abort();return {ok:true,data:publishedState??await state(),cancelled:true};
 case 'surface.unwrap':{const p=repository.snapshot()!;if(!p.surface)throw new DomainError('SURFACE_MISSING');const controller=createSurfaceController();surfaceController=controller;try{const {run,markings}=await runCutPreview(workerPath,p.surface,p,req.payload,join(root,'dist/assets'),controller.signal,progress=>{if(surfaceController!==controller||controller.signal.aborted)return;publish('fpcad:surface-progress',{projectId:p.id,revision:p.revision,...progress});});if(controller.signal.aborted)throw new DomainError('CANCELLED');repository.assertRevision(p.id,p.revision);repository.commit({type:'unwrap.candidate',run,markings},req.requestId,fingerprint);autosave();}finally{if(surfaceController===controller)surfaceController=undefined;}break;}
 case 'surface.accept':{const p=repository.snapshot()!;if(!p.surfaceRun||p.surfaceRun.accepted)throw new DomainError('JOB_NOT_SUCCEEDED');if(p.surfaceRun.bindings.some(b=>b.report.status==='needsReview')&&!req.payload.acknowledgeReview)throw new DomainError('WARNING_ACK_REQUIRED');repository.commit({type:'unwrap.accept'},req.requestId,fingerprint,checkpoint=>checkpoint());clearTimeout(debounce);clearTimeout(maxWait);debounce=undefined;maxWait=undefined;break;}
 case 'nesting.run':{const p=repository.snapshot()!,geometry=await analyze(workerPath,p),nesting=await runNesting(p,geometry,req.payload);repository.commit({type:'nesting.set',nesting},req.requestId,fingerprint);autosave();break;}
 case 'pattern.boolean':{const p=repository.snapshot()!;const a=p.pieces.find(p=>p.id===req.payload.a),b=p.pieces.find(p=>p.id===req.payload.b);if(!a||!b)throw new DomainError('ENTITY_MISSING');const pieces=await booleanPieces(workerPath,a,b,req.payload.operation);const geometry=await analyze(workerPath,{...p,pieces});if(geometry.some(g=>g.issues.some(i=>i.severity==='error')))throw new DomainError('INVALID_GEOMETRY');repository.commit({type:'pieces.replace',removeIds:[a.id,b.id],pieces},req.requestId,fingerprint);autosave();break;}
 case 'pattern.allowance':{const piece=repository.snapshot()!.pieces.find(p=>p.id===req.payload.pieceId);if(!piece)throw new DomainError('ENTITY_MISSING');jobs.submit(piece.id,piece.allowanceMm,req.requestId,fingerprint,piece.join??'miter',{edgeAllowances:req.payload.edgeAllowances,allowanceSource:req.payload.allowanceSource});break;}
 case 'pattern.offset':jobs.submit(req.payload.pieceId,req.payload.distanceMm,req.requestId,fingerprint,req.payload.join);break;
 case 'job.cancel':jobs.cancel(req.payload.jobId);break;
 case 'result.discard':jobs.discard(req.payload.jobId);break;
 case 'result.accept':jobs.accept(req.payload.jobId,req.payload.resultHash,req.requestId,fingerprint);break;
 case 'export.create':{const projectPath=await projectDestination(false);if(!projectPath)return {ok:true,data:publishedState??await state(),cancelled:true};const choice=await dialog.save({defaultPath:`pattern.${req.payload.format}`,filters:[{name:req.payload.format.toUpperCase(),extensions:[req.payload.format]}]});if(choice.canceled||!choice.filePath)return {ok:true,data:publishedState??await state(),cancelled:true};const p=repository.snapshot()!,geometry=await analyze(workerPath,p);gate(p,geometry,req.payload.warningAckIds);await writeSavedProject(p,projectPath);const bytes=req.payload.format==='dxf'?Buffer.from(dxfExport(p,geometry,req.payload.warningAckIds,req.payload.nested)):req.payload.format==='svg'?Buffer.from(svgExport(p,geometry,req.payload.warningAckIds,req.payload.nested)):req.payload.format==='pdf'?await pdfExport(p,geometry,req.payload.warningAckIds,req.payload.paper,req.payload.nested):await pngExport(p,geometry,req.payload.warningAckIds,req.payload.nested);await atomicWrite(choice.filePath,bytes);break;}
 }
 const started=performance.now(),data=await state(committedProject);profile(req.method+':state',started);return {ok:true,data};
 }catch(e){const code=e instanceof DomainError?e.code:e instanceof Error&&e.name==='ZodError'?'VALIDATION_ERROR':'IO_ERROR';return {ok:false,error:{code,messageKey:code}};}}
function dispatch(raw:unknown,active=()=>true,request?:Request){const task=request?surfaceTasks.track(request):undefined;const next=queue.then(async()=>{try{if(!active())return {ok:false as const,error:{code:'ASSISTANT_DISABLED',messageKey:'ASSISTANT_DISABLED'}};if(task?.cancelled)return {ok:false as const,error:{code:'CANCELLED',messageKey:'CANCELLED'}};activeSurfaceTask=task;return await handle(raw);}finally{if(activeSurfaceTask===task)activeSurfaceTask=undefined;surfaceTasks.release(task);}});queue=next.catch(()=>{});return next;}
const assistant=new AssistantBridge(async(request,active)=>{const response=await dispatch(request,active,request);if(response.ok&&request.method!=='session.read'&&request.method!=='validation.run'&&request.method!=='patterns.preview')changed();return response;});

export let receiveRequest:(channel:string,raw:unknown)=>Promise<unknown>=async()=>{throw Error('BACKEND_STARTING');};
async function startup(){
 await mkdir(dataDirectory,{recursive:true});
 repository=new Repository(join(dataDirectory,'workspace.sqlite'));
 jobs=new JobManager(repository,(project,signal)=>analyze(workerPath,project,signal),changed,()=>publish('fpcad:storage-error'));
 const assistantSettings=new AssistantSettings(repository.db,windowsVault(dataDirectory));
 let closed=false;
 const shutdown=async()=>{if(closed)return;assistant.disable();surfaceController?.abort();await queue;checkpoint();jobs.dispose();repository.close();closed=true;};
 receiveRequest=async(channel,raw)=>{
  if(closed)throw Error('BACKEND_CLOSED');
  if(channel==='fpcad:request'||channel==='fpcad:request-text'){
   const parsed=requestSchema.safeParse(raw);
   const result=parsed.success&&parsed.data.method==='surface.cancel'?await handle(raw):await dispatch(raw,()=>!closed,parsed.success?parsed.data:undefined);
   return channel==='fpcad:request-text'?encodeResponse(result):result;
  }
  if(channel==='fpcad:assistant-settings'){
   try{const r=raw as {action?:string;config?:unknown;providerId?:string;serverId?:string};
    if(r?.action==='save')return {ok:true,config:assistantSettings.save(r.config)};
    if(r?.action==='read')return {ok:true,config:assistantSettings.read()};
    if(r?.action==='models'&&typeof r.providerId==='string')return {ok:true,models:await assistantSettings.models(r.providerId),config:assistantSettings.read()};
    if(r?.action==='mcp-test'&&typeof r.serverId==='string')return {ok:true,tools:await assistantSettings.mcpTest(r.serverId),config:assistantSettings.read()};
    return {ok:false,error:'VALIDATION_ERROR'};
   }catch(e){return {ok:false,error:e instanceof Error?e.message:'ASSISTANT_SETTINGS_FAILED'};}
  }
  if(channel==='fpcad:assistant'&&['status','enable','disable'].includes(String(raw))){
   try{return {ok:true,connection:raw==='enable'?await assistant.enable():raw==='disable'?assistant.disable():assistant.status()};}
   catch{return {ok:false,error:{code:'ASSISTANT_START_FAILED',messageKey:'ASSISTANT_START_FAILED'}};}
  }
  throw Error('FORBIDDEN');
 };serve(receiveRequest,shutdown);
}
startup().catch(error=>{console.error('[startup]',error);process.exit(1);});
