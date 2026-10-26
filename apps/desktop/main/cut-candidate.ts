import {createHash} from 'node:crypto';
import type {Project} from '../../../packages/schema/index';

/** Persist live inputs and only the material snapshots used by this cut. */
export function cutCandidateInputHash(project:Project){
 const {surface,pieces,bindings,markings,patternLibrary,materials,defaultAllowanceMm}=project;
 const references=project.references?.map(({id,view,calibration,illustration})=>({id,view,calibration,illustration}));
 const used=new Set([project.activeCutId,...(markings??[]).filter(m=>m.source==='cut-library').map(m=>m.cutLibraryId)]),materialHistory=project.cuttingLibrary?.filter(e=>used.has(e.id)&&e.run.materialPalette).map(e=>({id:e.id,palette:e.run.materialPalette}));
 return createHash('sha256').update(JSON.stringify({surface,pieces,bindings,markings,patternLibrary,materials,defaultAllowanceMm,references,...(materialHistory?.length?{materialHistory}:{})})).digest('hex');
}
