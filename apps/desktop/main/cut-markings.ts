import type {Project} from '../../../packages/schema/index';
import {projectReferenceGeometry,staleMarkingIds} from './markings';
import {DomainError} from './repository';

/** Recover exact source intersections for old coarse-grid projections. Saved
 * placement transforms remain authoritative. Manual UV paint and inference
 * dependencies retain their original fragments. This only prepares a candidate. */
export async function prepareCutMarkings(worker:string,project:Project):Promise<Project>{
 if(staleMarkingIds(project,false).size)throw new DomainError('STALE_MARKING');
 const parents=new Set(project.markings?.flatMap(m=>m.inference?[m.inference.sourceMarkingId]:[])??[]),markings=[];
 for(const marking of project.markings??[]){
  const canReproject=marking.sourcePieceId&&!marking.inference&&!parents.has(marking.id)&&!marking.textureId&&!marking.surfaceShape&&(marking.source==='reference'&&marking.editMode!=='uv-manual'||marking.source==='manual'&&marking.editMode==='source-manual');
  if(!canReproject){markings.push(marking);continue;}
  const {fragments}=await projectReferenceGeometry(worker,{...project,bindings:[]},marking.sourcePieceId!,marking.view,marking.offsetXmm,marking.offsetYmm,marking.placement);
  markings.push({...marking,fragments});
 }
 return {...project,markings};
}
