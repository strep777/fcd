import type {Project,Seam} from '../../../packages/schema/index';
import {DomainError} from './repository';
import {markingFingerprint} from './markings';

/** Model switching must never silently discard a seam to a standalone pattern. */
export function assertModelDetach(project:Project,removed:Set<string>){
 if(project.seams?.some(s=>removed.has(s.a.pieceId)!==removed.has(s.b.pieceId)))throw new DomainError('SEAM_DEPENDENCY');
}

export function saveActiveModel(project:Project){
 const mesh=project.surface;if(!mesh)return;
 const existing=project.modelLibrary?.find(m=>m.id===mesh.id),bound=new Set(project.bindings?.filter(b=>b.surfaceId===mesh.id).map(b=>b.pieceId));
 const record={id:mesh.id,name:existing?.name??mesh.template?.id??('模型 '+((project.modelLibrary?.length??0)+1)),surface:mesh,pieces:project.pieces.filter(p=>bound.has(p.id)),bindings:project.bindings?.filter(b=>b.surfaceId===mesh.id),markings:project.markings?.filter(m=>m.surfaceId===mesh.id),seams:project.seams?.filter(s=>bound.has(s.a.pieceId)&&bound.has(s.b.pieceId))};
 project.modelLibrary=[...(project.modelLibrary??[]).filter(m=>m.id!==mesh.id),record];
}

export function assertSeamEdit(previous:Seam|undefined,next?:Seam){
 if(previous?.locked&&(!next||JSON.stringify({...previous,locked:false})!==JSON.stringify({...next,locked:false})))throw new DomainError('SEAM_LOCKED');
}

/** Removing a cut retains the surface paint but removes only that cut's UV paths. */
export function detachCutPaths(project:Project,removed:Set<string>){
 const original=project.markings??[];
 if(original.some(m=>m.locked&&m.paths.some(path=>removed.has(path.pieceId))))throw new DomainError('MARKING_LOCKED');
 const updated=original.map(m=>({...m,paths:m.paths.filter(path=>!removed.has(path.pieceId))}));
 for(const m of updated)if(m.inference){
  const oldParent=original.find(parent=>parent.id===m.inference!.sourceMarkingId),parent=updated.find(parent=>parent.id===m.inference!.sourceMarkingId);
  // Rebase only a previously valid dependency, so this edit cannot bless stale paint.
  if(oldParent&&parent&&m.inference.sourceFingerprint===markingFingerprint(oldParent)&&markingFingerprint(parent)!==markingFingerprint(oldParent)){
   if(m.locked)throw new DomainError('MARKING_LOCKED');
   m.inference={...m.inference,sourceFingerprint:markingFingerprint(parent),reviewed:false};
  }
 }
 if(project.markings)project.markings=updated;
 project.bindings=project.bindings?.filter(b=>!removed.has(b.pieceId));
 project.surfaceRun=undefined;project.previewMarkings=undefined;project.nesting=undefined;
}

/** Delete a source and its dependent inferences as one undoable edit. */
export function deleteMarking(project:Project,id:string){
 const markings=project.markings??[];
 if(!markings.some(m=>m.id===id))throw new DomainError('ENTITY_MISSING');
 const removed=new Set([id]);let count=-1;
 while(count!==removed.size){count=removed.size;for(const m of markings)if(m.inference&&removed.has(m.inference.sourceMarkingId))removed.add(m.id);}
 if(markings.some(m=>removed.has(m.id)&&m.locked))throw new DomainError('MARKING_LOCKED');
 project.markings=markings.filter(m=>!removed.has(m.id));
}
