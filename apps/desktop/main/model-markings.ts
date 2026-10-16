import type {Project} from '../../../packages/schema/index';
import {placementAnatomies} from '../../../packages/reference/placement-context';
import {projectMarking} from './markings';
import {DomainError} from './repository';

/** A shared source edit must also update attachments saved with inactive models. */
export async function refreshSavedModelMarkings(worker:string,project:Project,sourceId:string,replaceManual=false,anatomyOverride=false){
 const records:NonNullable<Project['modelLibrary']>=[];
 for(const model of project.modelLibrary??[]){
  if(model.id===project.surface?.id){records.push(model);continue;}
  const related=model.markings?.filter(m=>m.sourcePieceId===sourceId)??[];if(!related.length){records.push(model);continue;}
  if(related.some(m=>m.locked))throw new DomainError('MARKING_LOCKED');
  const activeBound=new Set(project.bindings?.map(binding=>binding.pieceId)),shared=project.pieces.filter(piece=>!activeBound.has(piece.id));
  const proposed={...project,surface:model.surface,pieces:[...shared,...model.pieces??[]],bindings:model.bindings??[],markings:model.markings??[]},updated:NonNullable<Project['markings']>=[];
  for(const marking of related){const source=project.patternLibrary?.find(r=>r.piece.id===sourceId),context=anatomyOverride&&marking.placement&&source&&!placementAnatomies(source).some(a=>a.part===marking.placement!.part&&a.side===marking.placement!.side)?undefined:marking.placement;const next=await projectMarking(worker,proposed,sourceId,marking.view,marking.offsetXmm,marking.offsetYmm,replaceManual,anatomyOverride&&!!marking.placement,context);updated.push({...next,id:marking.id});}
  records.push({...model,markings:model.markings?.map(m=>updated.find(next=>next.id===m.id)??m)});
 }
 return records;
}
