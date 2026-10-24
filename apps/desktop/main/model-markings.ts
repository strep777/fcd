import type {Project,Marking} from '../../../packages/schema/index';
import {placementAnatomies} from '../../../packages/reference/placement-context';
import {projectMarking,staleMarkingIds} from './markings';
import {DomainError} from './repository';

/** A classification correction may have no usable target on the current model.
 * Retain its previous geometry for inspection, but require explicit placement
 * before it can become a valid manufacturing dependency again. */
const invalidMetadataPlacement=(marking:Marking):Marking=>marking.placement?{...marking,placement:{...marking.placement,sourceGroupHash:undefined,reviewed:false}}:marking;
const recoverableRegistrationErrors=new Set(['ANATOMY_REQUIRED','ANATOMY_SIDE_REQUIRED','MODEL_PART_MISSING','NO_VISIBLE_PROJECTION','INVALID_PLACEMENT','AMBIGUOUS_PROJECTION']);

export async function refreshMetadataSourceMarkings(worker:string,project:Project,before:Project,sourceId:string,replaceManual=false,signal?:AbortSignal){
 const related=before.markings?.filter(m=>m.sourcePieceId===sourceId)??[],source=project.patternLibrary?.find(r=>r.piece.id===sourceId),contexts=source?placementAnatomies(source):[],stale=staleMarkingIds(before),claimed=new Set<string>(),updated:Marking[]=[];
 for(const previous of related){
  if(signal?.aborted)throw new DomainError('CANCELLED');
  if(previous.locked)throw new DomainError('MARKING_LOCKED');
  if((previous.editMode==='uv-manual'||previous.source==='manual'&&!previous.editMode)&&!replaceManual)throw new DomainError('MANUAL_MARKING_REVIEW');
  if(stale.has(previous.id)){updated.push(invalidMetadataPlacement(previous));continue;}
  let context=previous.placement?contexts.find(a=>a.part===previous.placement!.part&&a.side===previous.placement!.side):undefined;
  // Prefer the existing matching context. A removed body/arm context must not
  // create a second copy of the same new manual classification.
  if(previous.placement&&!context&&contexts.length===1&&!related.some(m=>m.view===previous.view&&m.placement?.part===contexts[0].part&&m.placement.side===contexts[0].side&&!stale.has(m.id)))context=contexts[0];
  const key=context?`${previous.view}:${context.part}:${context.side}`:undefined;
  if(previous.placement&&(!context||claimed.has(key!))){updated.push(invalidMetadataPlacement(previous));continue;}
  if(key)claimed.add(key);
  try{
   const next=await projectMarking(worker,project,sourceId,previous.view,previous.offsetXmm,previous.offsetYmm,replaceManual,!!previous.placement,context,undefined,signal);
   updated.push({...next,id:previous.id,source:previous.source,editMode:previous.editMode});
  }catch(error){
   if(!previous.placement||!(error instanceof DomainError)||!recoverableRegistrationErrors.has(error.code))throw error;
   updated.push(invalidMetadataPlacement(previous));
  }
 }
 return updated;
}

/** A shared source edit must also update attachments saved with inactive models. */
export async function refreshSavedModelMarkings(worker:string,project:Project,sourceId:string,replaceManual=false,anatomyOverride=false,signal?:AbortSignal,metadataBefore?:Project){
 if(signal?.aborted)throw new DomainError('CANCELLED');
 const records:NonNullable<Project['modelLibrary']>=[];
 for(const model of project.modelLibrary??[]){
  if(signal?.aborted)throw new DomainError('CANCELLED');
  if(model.id===project.surface?.id){records.push(model);continue;}
  const related=model.markings?.filter(m=>m.sourcePieceId===sourceId)??[];if(!related.length){records.push(model);continue;}
  if(related.some(m=>m.locked))throw new DomainError('MARKING_LOCKED');
  const activeBound=new Set(project.bindings?.map(binding=>binding.pieceId)),shared=project.pieces.filter(piece=>!activeBound.has(piece.id));
  const proposed={...project,surface:model.surface,pieces:[...shared,...model.pieces??[]],bindings:model.bindings??[],markings:model.markings??[]};let updated:NonNullable<Project['markings']>=[];
  if(anatomyOverride){
   const original=metadataBefore??project,previousModel=original.modelLibrary?.find(m=>m.id===model.id)??model,bound=new Set(original.bindings?.map(b=>b.pieceId)),before={...original,surface:previousModel.surface,pieces:[...original.pieces.filter(p=>!bound.has(p.id)),...previousModel.pieces??[]],bindings:previousModel.bindings??[],markings:previousModel.markings??[]};
   updated=await refreshMetadataSourceMarkings(worker,proposed,before,sourceId,replaceManual,signal);
  }else for(const marking of related){const next=await projectMarking(worker,proposed,sourceId,marking.view,marking.offsetXmm,marking.offsetYmm,replaceManual,false,marking.placement,undefined,signal);if(signal?.aborted)throw new DomainError('CANCELLED');updated.push({...next,id:marking.id});}
  records.push({...model,markings:model.markings?.map(m=>updated.find(next=>next.id===m.id)??m)});
 }
 return records;
}
