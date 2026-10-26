import type {Project} from '../../../packages/schema/index';
import {projectReferenceGeometry,staleMarkingIds} from './markings';
import {DomainError} from './repository';
import {detailUnderlaySources} from './detail-underlay';

/** Recover exact source intersections for old coarse-grid projections. Saved
 * placement transforms remain authoritative. Manual UV paint and inference
 * dependencies retain their original fragments. This only prepares a candidate. */
export async function prepareCutMarkings(worker:string,project:Project):Promise<Project>{
 if(staleMarkingIds(project,false).size)throw new DomainError('STALE_MARKING');
 const underlays=await detailUnderlaySources(worker,project);
 const parents=new Set(project.markings?.flatMap(m=>m.inference?[m.inference.sourceMarkingId]:[])??[]),markings=[];
 for(const marking of project.markings??[]){
  const canReproject=marking.sourcePieceId&&!marking.inference&&!parents.has(marking.id)&&!marking.textureId&&!marking.surfaceShape&&(marking.source==='reference'&&marking.editMode!=='uv-manual'||marking.source==='manual'&&marking.editMode==='source-manual');
  if(!canReproject){markings.push(marking);continue;}
  const underlay=underlays.get(marking.id),input=underlay?{...project,pieces:project.pieces.map(p=>p.id===underlay.id?underlay:p),patternLibrary:project.patternLibrary?.map(r=>r.piece.id===underlay.id?{...r,piece:underlay}:r)}:project;
  const {fragments}=await projectReferenceGeometry(worker,{...input,bindings:[]},marking.sourcePieceId!,marking.view,marking.offsetXmm,marking.offsetYmm,marking.placement);
  markings.push({...marking,fragments});
 }
 return {...project,markings:[...markings.filter(m=>m.fabrication!=='detail'),...markings.filter(m=>m.fabrication==='detail')]};
}
