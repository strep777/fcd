import type {Project} from '../schema/index';
type Region=NonNullable<Project['patternLibrary']>[number];
export type PlacementContext=Pick<NonNullable<Region['anatomy']>,'part'|'side'>;
/** One continuous source can support several anatomical frames without splitting its pigment. */
export function placementAnatomies(source:Region){const anatomy=source.anatomy;if(!anatomy)return [];return anatomy.method!=='manual'&&anatomy.contexts?.length?anatomy.contexts.map(c=>({...c,method:anatomy.method})): [anatomy];}
export function contextRegion(source:Region,context?:PlacementContext):Region{if(!context)return source;const anatomy=placementAnatomies(source).find(a=>a.part===context.part&&a.side===context.side);return anatomy?{...source,anatomy:{...source.anatomy!,...anatomy}}:source;}
