import {createHash} from 'node:crypto';
import type {Project} from '../../../packages/schema/index';

/** Persist the live inputs, excluding the candidate and immutable history itself. */
export function cutCandidateInputHash(project:Project){
 const {surface,pieces,bindings,markings,patternLibrary,materials,defaultAllowanceMm}=project;
 const references=project.references?.map(({id,view,calibration,illustration})=>({id,view,calibration,illustration}));
 return createHash('sha256').update(JSON.stringify({surface,pieces,bindings,markings,patternLibrary,materials,defaultAllowanceMm,references})).digest('hex');
}
