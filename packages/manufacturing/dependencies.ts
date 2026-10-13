import type {Project} from '../schema/index';

/** Includes dormant models, historical cuts and candidates that can become active. */
export function projectPieces(project:Project){
 return [...project.pieces,...(project.patternLibrary??[]).map(r=>r.piece),
  ...(project.modelLibrary??[]).flatMap(m=>m.pieces??[]),...(project.surfaceRun?.pieces??[]),
  ...(project.cuttingLibrary??[]).flatMap(entry=>entry.run.pieces),
  ...(project.referenceRun?(project.referenceRun.pieces??[project.referenceRun.piece]):[])];
}
export function materialInUse(project:Project,materialId:string){
 return projectPieces(project).some(piece=>piece.materialId===materialId);
}
