import type {Project,Geometry,Issue} from '../schema/index';
export const MAX_OUTPUT_INSTANCES=2000,MAX_OUTPUT_POINTS=1000000;
/** Check expansion before layout/SVG/PDF allocations, including repeated markings and holes. */
export function assertOutputBudget(project:Project,geometry:Geometry[]){
 let instances=0,points=0;const markings=new Map<string,number>();
 for(const marking of project.markings??[])for(const path of marking.paths)markings.set(path.pieceId,(markings.get(path.pieceId)??0)+path.rings.reduce((n,r)=>n+r.length,0));
 for(const [i,piece] of project.pieces.entries()){
  const g=geometry[i];if(!g||g.id!==piece.id)throw Error('INVALID_GEOMETRY');instances+=piece.cutQty;
  const count=g.cut.length+(g.seam?.length??piece.nodes.length)+(g.cutHoles??[]).reduce((n,h)=>n+h.length,0)+(g.seamHoles??piece.holes??[]).reduce((n,h)=>n+h.length,0)+(markings.get(piece.id)??0)+(piece.notches?.length??0)*2+(piece.labels?.length??0);
  points+=piece.cutQty*count;if(instances>MAX_OUTPUT_INSTANCES||points>MAX_OUTPUT_POINTS)throw Error('RESOURCE_LIMIT');
 }
}
export function outputBudgetIssues(project:Project,geometry:Geometry[]):Issue[]{
 try{assertOutputBudget(project,geometry);return [];}catch(error){return [{ruleId:project.id+':output-budget',entityId:project.pieces[0]?.id??project.id,severity:'error',messageKey:(error as Error).message}];}
}
