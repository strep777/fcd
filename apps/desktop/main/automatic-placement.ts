import {referenceProjection} from '../../../packages/reference/placement-context';
import type {Project,Marking} from '../../../packages/schema/index';
import {placementAnatomies} from '../../../packages/reference/placement-registration';
import {partName,sideName,type BodyPart} from '../../../packages/reference/body-parts';
import {projectMarking} from './markings';
import {DomainError} from './repository';
import {withWorkerSession} from './worker';

/** One worker owns the complete batch; the caller commits it atomically. */
export async function automaticPlacement(worker:string,project:Project,pieceIds:string[],parts?:BodyPart[]){
 return withWorkerSession(worker,()=>placeBatch(worker,project,pieceIds,parts));
}
async function placeBatch(worker:string,project:Project,pieceIds:string[],parts?:BodyPart[]){
 const sources=new Map(project.patternLibrary?.map(r=>[r.piece.id,r]));
 if(new Set(pieceIds).size!==pieceIds.length||pieceIds.some(id=>!sources.has(id)))throw new DomainError('INVALID_SELECTION');
 if(!project.surface)throw new DomainError('SURFACE_MISSING');
 const markings:Marking[]=[],skipped:{pieceId:string;name:string;reason:string}[]=[];
 const ids=new Set(project.markings?.map(m=>m.id));let points=0;
 for(const id of pieceIds){
  const region=sources.get(id)!,contexts=placementAnatomies(region).filter(a=>!parts||parts.includes(a.part));
  if(!contexts.length){skipped.push({pieceId:id,name:region.piece.name,reason:'ANATOMY_REQUIRED'});continue;}
  for(const context of contexts){
   try{
    const view=referenceProjection(project,region);if(!view)throw new DomainError('ANATOMY_POSITION_REQUIRED');
    const marking=await projectMarking(worker,project,id,view,0,0,false,true,context);
    ids.add(marking.id);points+=marking.fragments.reduce((n,f)=>n+f.rings.reduce((sum,r)=>sum+r.length,0),0);
    if(ids.size>500||points>1000000)throw new DomainError('PROJECTION_LIMIT');
    markings.push(marking);
   }catch(error){
    const code=error instanceof DomainError?error.code:'UNWRAP_FAILED';
    if(!['ANATOMY_REQUIRED','ANATOMY_POSITION_REQUIRED','ANATOMY_SIDE_REQUIRED','MODEL_PART_MISSING','NO_VISIBLE_PROJECTION','INVALID_PLACEMENT','MARKING_LOCKED','MANUAL_MARKING_REVIEW','INVALID_GEOMETRY','AMBIGUOUS_PROJECTION'].includes(code))throw error;
    skipped.push({pieceId:id,name:region.anatomy?.contexts?region.piece.name+' / '+partName(context.part)+' '+sideName(context.side):region.piece.name,reason:code});
   }
  }
 }
 return {markings,skipped};
}
