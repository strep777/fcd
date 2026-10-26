import type {Project,Surface} from '../schema/index';
import {namedPart,type BodyPart,type BodySide} from './body-parts';
type Region=NonNullable<Project['patternLibrary']>[number];
export type PlacementContext=Pick<NonNullable<Region['anatomy']>,'part'|'side'>;
/** Reference sides always describe the character. Generated legacy group
 * names use front-view screen sides; an explicit model assignment overrides
 * those names. Confirming a source classification cannot change convention. */
const oppositeSide=(side:BodySide):BodySide=>side==='left'?'right':side==='right'?'left':side;
export const hasLegacySpeciesSides=(surface:Surface)=>surface.source==='species-template-1'||surface.source==='sculpt-1'&&surface.sculpt?.originalSource==='species-template-1';
export const canonicalModelSide=(surface:Surface,side:BodySide):BodySide=>hasLegacySpeciesSides(surface)?oppositeSide(side):side;
export function targetModelSide(surface:Surface,part:BodyPart,side:BodySide):BodySide{
 const assigned=surface.partAssignments?.some(a=>a.part===part);
 return assigned?side:canonicalModelSide(surface,side);
}
/** Classification controls persist character sides, including untouched groups. */
export function modelPartAssignment(surface:Surface,region:string){
 const explicit=surface.partAssignments?.find(a=>a.region===region);if(explicit)return {part:explicit.part,side:explicit.side};
 const inferred=namedPart(region);return {...inferred,side:canonicalModelSide(surface,inferred.side)};
}
/** A partly classified legacy part must use one convention for every group. */
export function placementModelPart(surface:Surface,region:string){
 const inferred=namedPart(region);
 return surface.partAssignments?.some(a=>a.region===region||a.part===inferred.part)?modelPartAssignment(surface,region):inferred;
}
/** One continuous source can support several anatomical frames without splitting its pigment. */
export function placementAnatomies(source:Region){const anatomy=source.anatomy;if(!anatomy)return [];return anatomy.method!=='manual'&&anatomy.contexts?.length?anatomy.contexts.map(c=>({...c,method:anatomy.method})): [anatomy];}
export function contextRegion(source:Region,context?:PlacementContext):Region{if(!context)return source;const anatomy=placementAnatomies(source).find(a=>a.part===context.part&&a.side===context.side);return anatomy?{...source,anatomy:{...source.anatomy!,...anatomy}}:source;}

/** Physical placement direction inferred for a recognized figure, never an image import choice. */
export function referenceProjection(project:Project,source:Region):'front'|'back'|undefined{
 if(source.sourceGroup===undefined)return source.view==='back'?'back':'front';
 const normal=project.references?.find(r=>r.id===source.referenceId)?.illustration?.figures?.find(f=>f.sourceGroup===source.sourceGroup)?.normalZ;
 return normal===1?'front':normal===-1?'back':undefined;
}
