import {randomUUID} from 'node:crypto';
import {libraryRegionEditSchema,pieceSchema,type Project,type LibraryRegionEdit,type SourceRegionOperation,type Piece} from '../../../packages/schema/index';
import {edgeArcPoints} from '../../../packages/pattern/edit';
import {surfaceSpline} from '../../../packages/surface/spline';
import {drawingIssue} from '../../../packages/surface/drawing';
import {DomainError} from './repository';
import {analyze} from './worker';
import {area,positive,clip,projectMarking,type XY} from './markings';
import {refreshSavedModelMarkings} from './model-markings';
import {placementSources,contextRegion,placementAnatomies} from '../../../packages/reference/placement-registration';

/** Automatic registration shares a frame across all pigments in a body part. */
function affectedSources(project:Project,pieceId:string){
 const ids=new Set([pieceId]);
 for(const m of [...project.markings??[],...(project.modelLibrary??[]).flatMap(model=>model.markings??[])]){
  if(!m.placement||!m.sourcePieceId)continue;const source=project.patternLibrary?.find(r=>r.piece.id===m.sourcePieceId);
  if(source&&placementSources(project,contextRegion(source,m.placement)).some(r=>r.piece.id===pieceId))ids.add(m.sourcePieceId);
 }
 return ids;
}

/** Metadata can move a pigment between groups; both old and new frames change. */
export async function refreshLibraryRegionMetadata(worker:string,project:Project,region:NonNullable<Project['patternLibrary']>[number]){
 const id=region.piece.id,existing=project.patternLibrary?.some(r=>r.piece.id===id),proposed={...project,patternLibrary:[...(project.patternLibrary??[]).filter(r=>r.piece.id!==id),region]};
 if(existing)editableLibraryRegion(project,id);
 editableLibraryRegion(proposed,id);
 const sources=new Set([...affectedSources(project,id),...affectedSources(proposed,id)]),markings:NonNullable<Project['markings']>=[];
 for(const previous of project.markings?.filter(m=>m.sourcePieceId&&sources.has(m.sourcePieceId))??[]){const source=proposed.patternLibrary?.find(r=>r.piece.id===previous.sourcePieceId),context=previous.placement&&source&&placementAnatomies(source).some(a=>a.part===previous.placement!.part&&a.side===previous.placement!.side)?previous.placement:undefined;const next=await projectMarking(worker,proposed,previous.sourcePieceId!,previous.view,previous.offsetXmm,previous.offsetYmm,false,!!previous.placement,context);markings.push({...next,id:previous.id,source:previous.source,editMode:previous.editMode});}
 let models=project.modelLibrary??[];
 for(const sourceId of sources)models=await refreshSavedModelMarkings(worker,{...proposed,modelLibrary:models},sourceId,false,true);
 // Reprojection preserves manual source edits and resets placement review.
 models=models.map(model=>({...model,markings:model.markings?.map(m=>{const previous=project.modelLibrary?.find(v=>v.id===model.id)?.markings?.find(v=>v.id===m.id);return previous?{...m,source:previous.source,editMode:previous.editMode}:m;})}));
 return {region,markings,models};
}

export function editableLibraryRegion(project:Project,pieceId:string,replaceManual=false){
 const region=project.patternLibrary?.find(r=>r.piece.id===pieceId);if(!region)throw new DomainError('ENTITY_MISSING');
 if(project.bindings?.some(b=>b.pieceId===pieceId)||project.modelLibrary?.some(m=>m.bindings?.some(b=>b.pieceId===pieceId)))throw new DomainError('MARKING_SOURCE_BOUND');
 const sources=affectedSources(project,pieceId);
 for(const markings of [project.markings??[],...(project.modelLibrary??[]).map(m=>m.markings??[])]){
  const affected=new Set(markings.filter(m=>m.sourcePieceId&&sources.has(m.sourcePieceId)).map(m=>m.id));let count=-1;
  while(count!==affected.size){count=affected.size;for(const m of markings)if(m.inference&&affected.has(m.inference.sourceMarkingId))affected.add(m.id);}
  if(markings.some(m=>affected.has(m.id)&&m.locked))throw new DomainError('MARKING_LOCKED');
  if(markings.some(m=>m.sourcePieceId&&sources.has(m.sourcePieceId)&&!(replaceManual&&m.sourcePieceId===pieceId)&&(m.editMode==='uv-manual'||m.source==='manual'&&!m.editMode)))throw new DomainError('MANUAL_MARKING_REVIEW');
 }
 return region;
}
function flatten(piece:Piece):XY[][]{
 const outer:XY[]=[];for(const node of piece.nodes){outer.push(...edgeArcPoints(piece,node.id).slice(0,-1).map(p=>[p.xMm,p.yMm] as XY));if(outer.length>16000)throw new DomainError('RESOURCE_LIMIT');}
 return [positive(outer),...(piece.holes??[]).map(h=>positive(h.map(p=>[p.xMm,p.yMm] as XY)).reverse())];
}
function operationRings(operation:SourceRegionOperation):XY[][]{
 if(operation.kind==='pen'){
  const points=operation.spline?surfaceSpline(operation.points,operation.spline.tension,operation.spline.toleranceMm):operation.points;
  const issue=drawingIssue(points);if(issue)throw new DomainError(issue);return [positive(points.map(p=>[p.xMm,p.yMm]))];
 }
 const radius=operation.radiusMm,count=Math.max(16,Math.min(128,Math.ceil(Math.PI/Math.acos(Math.max(-1,1-.025/radius))))),result:XY[][]=[];
 for(let i=0;i<operation.points.length;i++){
  const p=operation.points[i];result.push(Array.from({length:count},(_,j)=>[p.xMm+radius*Math.cos(j*2*Math.PI/count),p.yMm+radius*Math.sin(j*2*Math.PI/count)] as XY));
  if(i){const a=operation.points[i-1],dx=p.xMm-a.xMm,dy=p.yMm-a.yMm,d=Math.hypot(dx,dy);if(d>1e-9){const x=-dy*radius/d,y=dx*radius/d;result.push(positive([[a.xMm+x,a.yMm+y],[a.xMm-x,a.yMm-y],[p.xMm-x,p.yMm-y],[p.xMm+x,p.yMm+y]]));}}
 }
 return result;
}
/** All draft edits and dependent projections succeed before a single commit. */
export async function editLibraryRegion(worker:string,project:Project,pieceId:string,input:LibraryRegionEdit,replaceManual=false){
 const old=editableLibraryRegion(project,pieceId,replaceManual),edit=libraryRegionEditSchema.parse(input);
 if(edit.piece.id!==pieceId||!edit.piece.closed)throw new DomainError('INVALID_SELECTION');
 if(edit.operations.reduce((sum,op)=>sum+op.points.length,0)>5000)throw new DomainError('RESOURCE_LIMIT');
 // Editing contours cannot change the source identity, calibration or metadata.
 let piece=pieceSchema.parse({...old.piece,nodes:edit.piece.nodes,holes:edit.piece.holes,curves:edit.piece.curves});
 const validate=async()=>{const geometry=await analyze(worker,{...project,pieces:[piece]});if(geometry.some(g=>g.issues.some(i=>i.severity==='error')))throw new DomainError('INVALID_GEOMETRY');};
 await validate();
 if(edit.operations.length){
  let rings=flatten(piece);
  for(const operation of edit.operations){const operand=(await clip(worker,[{subjects:operationRings(operation),union:true}]))[0];rings=(await clip(worker,[operation.mode==='add'?{subjects:[...rings,...operand],union:true}:{subjects:rings,union:true,subtract:operand}]))[0].filter(r=>Math.abs(area(r))>1e-6);}
  if(!rings.length)throw new DomainError('EMPTY_MARKING');
  const outers=rings.filter(r=>area(r)>0),holes=rings.filter(r=>area(r)<0);if(outers.length!==1)throw new DomainError('MARKING_DISCONNECTED');
  if(rings.some(r=>r.length>2000)||holes.length>32)throw new DomainError('RESOURCE_LIMIT');
  const nodes=(ring:XY[])=>ring.map(([xMm,yMm])=>({id:randomUUID(),xMm,yMm}));
  piece=pieceSchema.parse({...piece,nodes:nodes(outers[0]),holes:holes.map(nodes),curves:[],notches:[],edgeAllowances:[]});await validate();
 }
 const region={...old,piece},proposed={...project,pieces:project.pieces.map(p=>p.id===pieceId?piece:p),patternLibrary:project.patternLibrary!.map(r=>r.piece.id===pieceId?region:r)},markings:NonNullable<Project['markings']>=[];
 const sources=affectedSources(project,pieceId);
 for(const marking of project.markings?.filter(m=>m.sourcePieceId&&sources.has(m.sourcePieceId))??[]){const next=await projectMarking(worker,proposed,marking.sourcePieceId!,marking.view,marking.offsetXmm,marking.offsetYmm,replaceManual&&marking.sourcePieceId===pieceId,false,marking.placement);markings.push({...next,id:marking.id,source:marking.sourcePieceId===pieceId?'manual':marking.source,editMode:marking.sourcePieceId===pieceId?'source-manual':marking.editMode});}
 let models=project.modelLibrary??[];
 for(const sourceId of sources)models=await refreshSavedModelMarkings(worker,{...proposed,modelLibrary:models},sourceId,replaceManual&&sourceId===pieceId);
 models=models.map(model=>({...model,markings:model.markings?.map(m=>{if(!m.sourcePieceId||!sources.has(m.sourcePieceId)||model.id===project.surface?.id)return m;const oldMarking=project.modelLibrary?.find(v=>v.id===model.id)?.markings?.find(v=>v.id===m.id);return {...m,source:m.sourcePieceId===pieceId?'manual':oldMarking?.source??m.source,editMode:m.sourcePieceId===pieceId?'source-manual':oldMarking?.editMode??m.editMode};})}));
 return {region,markings,models};
}
