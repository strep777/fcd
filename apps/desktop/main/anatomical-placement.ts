import {placementSources,registrationFingerprint} from '../../../packages/reference/placement-registration';
import type {Project,Marking} from '../../../packages/schema/index';
import {namedPart,type BodyPart,type BodySide} from '../../../packages/reference/body-parts';
import {pointBounds,edgeArcPoints} from '../../../packages/pattern/edit';
import {calibratedPoint} from './reference-segmentation';
import {principalDirection} from '../../../packages/reference/placement-transform';
import {DomainError} from './repository';
export type Region=NonNullable<Project['patternLibrary']>[number];
// A newly supported neutral terminal hand has one palm material and separate
// dark tips. Existing colored pads keep their established paw registration.
const neutralTerminalPaw=(sources:Region[])=>sources.length>=3&&new Set(sources.map(s=>s.piece.id)).size===sources.length&&sources.every(s=>s.anatomy?.method==='silhouette-1'&&s.anatomy.part==='paw'&&s.anatomy.confidence>=.7&&!s.anatomy.contexts?.length)&&sources.filter(s=>{const rgb=[1,3,5].map(i=>parseInt(s.piece.color.slice(i,i+2),16)),hi=Math.max(...rgb),lo=Math.min(...rgb);return hi>=115&&(hi-lo)/(hi||1)<.25;}).length===1&&sources.filter(s=>Math.max(...[1,3,5].map(i=>parseInt(s.piece.color.slice(i,i+2),16)))<77).length===sources.length-1;
export function modelParts(project:Project){const surface=project.surface;if(!surface)return [];return [...new Set(surface.faces.map(f=>f.region))].map(region=>({region,...(surface.partAssignments?.find(a=>a.region===region)??namedPart(region))}));}
/** Preserve relative pigment positions inside a part; never stretch a whole character over a partial model. */
export function anatomicalPlacement(project:Project,source:Region):NonNullable<Marking['placement']>{
 const mesh=project.surface,part=source.anatomy?.part,side=source.anatomy?.side??'unknown';if(!mesh)throw new DomainError('SURFACE_MISSING');if(!part||part==='unknown')throw new DomainError('ANATOMY_REQUIRED');
 // Built-in templates name negative X "left" (screen-left in the front view).
 // Silhouette references store the character's own left/right. Imported and
 // manually classified groups retain their explicitly supplied convention.
 const modelSide=source.anatomy?.method==='silhouette-1'&&mesh.source==='species-template-1'?(side==='left'?'right':side==='right'?'left':side):side;
 const parts=modelParts(project);if(['arm','leg','paw','foot','ear','horn'].includes(part)&&modelSide!=='unknown'&&modelSide!=='center'&&!parts.some(p=>p.part===part&&p.side===modelSide)&&parts.some(p=>p.part===part&&(p.side==='center'||p.side==='unknown')))throw new DomainError('ANATOMY_SIDE_REQUIRED');const targets=parts.filter(p=>p.part===part&&(modelSide==='center'||modelSide==='unknown'||p.side==='center'||p.side===modelSide));if(!targets.length)throw new DomainError('MODEL_PART_MISSING');
 // Multiple left/right target parts require a definite source side, rather than painting both limbs.
 if((modelSide==='unknown'||modelSide==='center')&&targets.some(t=>t.side==='left'||t.side==='right')&&['arm','leg','paw','foot','ear','horn'].includes(part))throw new DomainError('ANATOMY_SIDE_REQUIRED');
 const regionNames=targets.map(t=>t.region),faces=mesh.faces.filter(f=>regionNames.includes(f.region)),ids=new Set(faces.flatMap(f=>f.vertices)),sign=source.view==='front'?1:-1,vertices=mesh.vertices.filter(v=>ids.has(v.id)),targetPoints=vertices.map(v=>({...v,xMm:sign*v.xMm})),target=pointBounds(targetPoints),sources=placementSources(project,source),signedArea=(ring:{xMm:number;yMm:number}[])=>ring.reduce((n,a,i)=>{const b=ring[(i+1)%ring.length];return n+a.xMm*b.yMm-b.xMm*a.yMm;},0)/2;
 const sourceRings=sources.flatMap(r=>{const outer=r.piece.nodes.flatMap(n=>edgeArcPoints(r.piece,n.id).slice(0,-1)),positive=signedArea(outer)>0?outer:outer.reverse();return [positive,...(r.piece.holes??[]).map(h=>signedArea(h)<0?h:[...h].reverse())];}),sourcePoints=sourceRings.flat();
 // Full calibrated part bounds prevent a lone accent (for example one cheek)
 // from being enlarged into the entire head after other colors are removed.
 const reference=project.references?.find(r=>r.id===source.referenceId),context=reference?.illustration?.partBounds.find(b=>b.part===part&&b.side===side)??reference?.illustration?.partBounds.find(b=>b.part===part&&!b.side),pixelPart=context?.bounds;
 if(reference?.calibration&&pixelPart&&(['head','body','tail'].includes(part)||context?.side===side)){sourcePoints.length=0;const corners=context?.frameCorners??[pixelPart.minX,pixelPart.maxX].flatMap(x=>[pixelPart.minY,pixelPart.maxY].map(y=>({x,y})));for(const {x,y} of corners)sourcePoints.push(calibratedPoint(x,y,reference.calibration));}
 const original=pointBounds(sourcePoints),sourceCenter={xMm:(original.minX+original.maxX)/2,yMm:(original.minY+original.maxY)/2},targetCenter={xMm:(target.minX+target.maxX)/2,yMm:(target.minY+target.maxY)/2};
 let rotationRad=0;
 if(['arm','leg','tail'].includes(part)){
  const sourceBody=placementSources(project,{...source,anatomy:{...source.anatomy!,part:'body',side:'center'}}).flatMap(r=>r.piece.nodes),sourceAll=sourceBody.length?sourceBody:(project.patternLibrary??[]).filter(r=>r.view===source.view&&r.referenceId===source.referenceId).flatMap(r=>r.piece.nodes),bodyContext=reference?.illustration?.partBounds.find(b=>b.part==='body')?.bounds,sourceBodyFrame=bodyContext&&reference?.calibration?[calibratedPoint(bodyContext.minX,bodyContext.minY,reference.calibration),calibratedPoint(bodyContext.maxX,bodyContext.maxY,reference.calibration)]:undefined,sourceMiddle=pointBounds(sourceBodyFrame??(sourceAll.length?sourceAll:sourcePoints)),bodyRegions=parts.filter(p=>p.part==='body').map(p=>p.region),bodyIds=new Set(mesh.faces.filter(f=>bodyRegions.includes(f.region)).flatMap(f=>f.vertices)),bodyPoints=mesh.vertices.filter(v=>bodyIds.has(v.id)),targetMiddle=pointBounds((bodyPoints.length?bodyPoints:mesh.vertices).map(v=>({...v,xMm:sign*v.xMm}))),byId=new Map(mesh.vertices.map(v=>[v.id,v])),targetRings=faces.map(face=>face.vertices.map(id=>{const v=byId.get(id)!;return {xMm:sign*v.xMm,yMm:v.yMm};})).filter(r=>signedArea(r)>1e-6),sourceOutward={xMm:sourceCenter.xMm-(sourceMiddle.minX+sourceMiddle.maxX)/2,yMm:sourceCenter.yMm-(sourceMiddle.minY+sourceMiddle.maxY)/2},pigmentAngle=principalDirection(sourceRings,sourceOutward),targetAngle=principalDirection(targetRings,{xMm:targetCenter.xMm-(targetMiddle.minX+targetMiddle.maxX)/2,yMm:targetCenter.yMm-(targetMiddle.minY+targetMiddle.maxY)/2});
  let sourceAngle=pigmentAngle;
  if(context?.orientationRad!==undefined&&reference?.calibration&&pixelPart){const x=(pixelPart.minX+pixelPart.maxX)/2,y=(pixelPart.minY+pixelPart.maxY)/2,a=calibratedPoint(x,y,reference.calibration),b=calibratedPoint(x+Math.cos(context.orientationRad),y+Math.sin(context.orientationRad),reference.calibration);sourceAngle=Math.atan2(b.yMm-a.yMm,b.xMm-a.xMm);
   // A raised arm can have the same steep PCA axis as a hanging arm, with its
   // wrist at the opposite end. A definite lateral component points away from
   // the torso for sided silhouette arms; torso-height or image-down guesses
   // invert raised wrists/cuffs. Nearly vertical axes retain the down fallback.
   const silhouette=source.anatomy?.method==='silhouette-1',down=calibratedPoint(x,y+1,reference.calibration),right=calibratedPoint(x+1,y,reference.calibration),lateral={xMm:right.xMm-a.xMm,yMm:right.yMm-a.yMm},lateralSign=Math.sign(lateral.xMm*sourceOutward.xMm+lateral.yMm*sourceOutward.yMm),sidedArm=silhouette&&part==='arm'&&['left','right'].includes(side)&&Math.abs(Math.cos(context.orientationRad))>.2&&lateralSign!==0,uprightLimb=silhouette&&['arm','leg'].includes(part)&&Math.abs(Math.sin(context.orientationRad))>=Math.abs(Math.cos(context.orientationRad)),outward=sidedArm?{xMm:lateralSign*lateral.xMm,yMm:lateralSign*lateral.yMm}:uprightLimb?{xMm:down.xMm-a.xMm,yMm:down.yMm-a.yMm}:sourceOutward;
   if(Math.cos(sourceAngle)*outward.xMm+Math.sin(sourceAngle)*outward.yMm<0)sourceAngle+=Math.PI;}
  if(sourceAngle!==undefined&&targetAngle!==undefined)rotationRad=Math.atan2(Math.sin(targetAngle-sourceAngle),Math.cos(targetAngle-sourceAngle));
 }
 if(part==='paw'&&mesh.source==='species-template-1'&&reference?.calibration&&neutralTerminalPaw(sources)){
  const armContext=reference.illustration?.partBounds.find(b=>b.part==='arm'&&b.side===side),armRegions=parts.filter(p=>p.part==='arm'&&p.side===modelSide).map(p=>p.region),armIds=new Set(mesh.faces.filter(f=>armRegions.includes(f.region)).flatMap(f=>f.vertices)),armPoints=mesh.vertices.filter(v=>armIds.has(v.id)).map(v=>({...v,xMm:sign*v.xMm}));
  if(armContext?.orientationRad!==undefined&&armPoints.length){
   // A neutral hand's broad palm PCA can point across its fingers. Its adjacent
   // forearm supplies the wrist-to-tip direction, including raised poses.
   // Direct both axes from the real arm anchor, never the torso midpoint.
   const b=armContext.bounds,x=(b.minX+b.maxX)/2,y=(b.minY+b.maxY)/2,a=calibratedPoint(x,y,reference.calibration),d=calibratedPoint(x+Math.cos(armContext.orientationRad),y+Math.sin(armContext.orientationRad),reference.calibration),out={xMm:sourceCenter.xMm-a.xMm,yMm:sourceCenter.yMm-a.yMm},armBox=pointBounds(armPoints),targetOut={xMm:targetCenter.xMm-(armBox.minX+armBox.maxX)/2,yMm:targetCenter.yMm-(armBox.minY+armBox.maxY)/2},byId=new Map(mesh.vertices.map(v=>[v.id,v])),targetRings=faces.map(f=>f.vertices.map(id=>{const v=byId.get(id)!;return{xMm:sign*v.xMm,yMm:v.yMm};})).filter(r=>signedArea(r)>1e-6);
   let sourceAngle=Math.atan2(d.yMm-a.yMm,d.xMm-a.xMm);const direction=Math.cos(sourceAngle)*out.xMm+Math.sin(sourceAngle)*out.yMm,targetAngle=principalDirection(targetRings,targetOut);
   if(Math.abs(direction)>.01&&targetAngle!==undefined){if(direction<0)sourceAngle+=Math.PI;rotationRad=Math.atan2(Math.sin(targetAngle-sourceAngle),Math.cos(targetAngle-sourceAngle));}
  }
 }
 const c=Math.cos(rotationRad),s=Math.sin(rotationRad),rotated=pointBounds(sourcePoints.map(p=>({xMm:c*(p.xMm-sourceCenter.xMm)-s*(p.yMm-sourceCenter.yMm),yMm:s*(p.xMm-sourceCenter.xMm)+c*(p.yMm-sourceCenter.yMm)}))),width=target.maxX-target.minX,height=target.maxY-target.minY,sourceWidth=rotated.maxX-rotated.minX,sourceHeight=rotated.maxY-rotated.minY;
 if(Math.min(width,height,sourceWidth,sourceHeight)<.01)throw new DomainError('NO_VISIBLE_PROJECTION');
 // A tail pointing away from the camera has a narrow projected footprint.
 // Fitting a broad illustrated tail into that footprint invents a tiny accent.
 // Keep the source available for manual placement rather than claiming a match.
 const fitX=width/sourceWidth,fitY=height/sourceHeight;
 if(part==='tail'&&Math.min(fitX,fitY)<Math.max(fitX,fitY)*.2)throw new DomainError('NO_VISIBLE_PROJECTION');
 const scale=Math.min(fitX,fitY);if(scale<.001||scale>1000)throw new DomainError('INVALID_PLACEMENT');
 return {algorithm:'anatomy-2',rotationRad,sourceGroupHash:registrationFingerprint(project,source),part,side,modelSide,regions:regionNames,scaleX:scale,scaleY:scale,sourceCenter,targetCenter,reviewed:false};
}

