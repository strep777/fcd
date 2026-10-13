import {registrationFingerprint,placementAnatomies,contextRegion} from './placement-registration';
import type {Project,Marking} from '../schema/index';
import {namedPart} from './body-parts';

/** Classification changes invalidate old attachments even when the geometry hash was refreshed. */
export function placementMatchesModel(project:Project,marking:Marking){
 const placement=marking.placement;if(!placement)return true;
 const modelSide=placement.modelSide??placement.side;
 const source=project.patternLibrary?.find(r=>r.piece.id===marking.sourcePieceId),mesh=project.surface;
 if(!mesh||!source||!placementAnatomies(source).some(a=>a.part===placement.part&&a.side===placement.side)||source.view!==marking.view||placement.sourceGroupHash!==registrationFingerprint(project,contextRegion(source,placement)))return false;
 const groups=new Map([...new Set(mesh.faces.map(f=>f.region))].map(region=>[region,mesh.partAssignments?.find(a=>a.region===region)??namedPart(region)]));
 if(placement.regions.some(region=>{const group=groups.get(region);return !group||group.part!==placement.part||modelSide==='left'&&group.side!=='left'&&group.side!=='center'||modelSide==='right'&&group.side!=='right'&&group.side!=='center';}))return false;
 const faces=new Map(mesh.faces.map(f=>[f.id,f]));
 return marking.fragments.every(fragment=>{const face=faces.get(fragment.faceId);return !!face&&placement.regions.includes(face.region);});
}
