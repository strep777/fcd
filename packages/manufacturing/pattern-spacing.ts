import type {Join,Project} from '../schema/index';

/** Apply manufacturing settings to live pieces; archived cuts remain snapshots. */
export function withPatternSpacing(project:Project,widthMm:number,join?:Join):Project{
 return {...project,defaultAllowanceMm:widthMm,pieces:project.pieces.map(piece=>({...piece,allowanceMm:widthMm,allowanceSource:'piece' as const,edgeAllowances:undefined,...(join?{join}:{})})),nesting:undefined,...(project.surfaceRun&&!project.surfaceRun.accepted?{surfaceRun:undefined,previewMarkings:undefined}:{})};
}

export function patternSpacingMatches(project:Project,widthMm:number,join?:Join){
 return (project.defaultAllowanceMm??10)===widthMm&&project.pieces.every(piece=>piece.allowanceMm===widthMm&&(piece.allowanceSource??'piece')==='piece'&&!piece.edgeAllowances?.length&&(join===undefined||(piece.join??'miter')===join));
}
