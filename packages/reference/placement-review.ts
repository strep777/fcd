import {placementRegion,createPlacementMembership,garmentAnatomy} from '../surface/garment-anatomy';
import {referenceProjection,targetModelSide,placementModelPart} from './placement-context';
import {registrationFingerprint,placementAnatomies,contextRegion} from './placement-registration';
import type {Project,Marking} from '../schema/index';

/** Classification changes invalidate old attachments even when the geometry hash was refreshed. */
export function placementMatchesModel(project:Project,marking:Marking){
 const placement=marking.placement;if(!placement)return true;
 const modelSide=placement.modelSide??placement.side;
 const source=project.patternLibrary?.find(r=>r.piece.id===marking.sourcePieceId),mesh=project.surface;
 if(!mesh||!source||!placementAnatomies(source).some(a=>a.part===placement.part&&a.side===placement.side)||referenceProjection(project,source)!==marking.view||placement.sourceGroupHash!==registrationFingerprint(project,contextRegion(source,placement)))return false;
 if(modelSide!==targetModelSide(mesh,placement.part,placement.side))return false;
 const names=mesh.faces.flatMap(f=>placement.algorithm==='anatomy-3'?[placementRegion(mesh,f)]:[f.region,placementRegion(mesh,f)]);
 const groups=new Map([...new Set(names)].map(region=>[region,placementModelPart(mesh,region)]));
 if(placement.regions.some(region=>{const group=groups.get(region);return !group||group.part!==placement.part||modelSide==='left'&&group.side!=='left'&&group.side!=='center'||modelSide==='right'&&group.side!=='right'&&group.side!=='center';}))return false;
 if(placement.algorithm==='anatomy-3'&&!garmentAnatomy(mesh))return false;
 const faces=new Map(mesh.faces.map(f=>[f.id,f])),matches=createPlacementMembership(mesh,placement.regions,placement.algorithm==='anatomy-3'?marking.view:undefined);
 return marking.fragments.every(fragment=>{const face=faces.get(fragment.faceId);return !!face&&matches(face,fragment.rings);});
}
