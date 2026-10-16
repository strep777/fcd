import {createHash} from 'node:crypto';
import type {Project} from '../schema/index';
type Region=NonNullable<Project['patternLibrary']>[number];
import {placementAnatomies} from './placement-context';
export {placementAnatomies,contextRegion,type PlacementContext} from './placement-context';
/** Server-side fingerprint of the complete color group sharing one placement transform. */
export function placementSources(project:Project,source:Region){const part=source.anatomy?.part,side=source.anatomy?.side??'unknown',hasReference=project.references?.some(r=>r.id===source.referenceId);return project.patternLibrary?.filter(r=>r.view===source.view&&(!hasReference||r.referenceId===source.referenceId)&&placementAnatomies(r).some(a=>a.part===part&&(side==='unknown'||side==='center'||a.side===side)))??[source];}
export function registrationFingerprint(project:Project,source:Region){const sources=placementSources(project,source).map(r=>({id:r.piece.id,view:r.view,part:r.anatomy?.contexts?source.anatomy?.part:r.anatomy?.part,side:r.anatomy?.contexts?source.anatomy?.side:r.anatomy?.side,...(r.anatomy?.contexts?{contexts:placementAnatomies(r)}:{}),nodes:r.piece.nodes,curves:r.piece.curves,holes:r.piece.holes})).sort((a,b)=>a.id.localeCompare(b.id)),reference=project.references?.find(r=>r.id===source.referenceId);return createHash('sha256').update(JSON.stringify({sources,...(reference?{reference:{calibration:reference.calibration,illustration:reference.illustration}}:{})})).digest('hex');}
