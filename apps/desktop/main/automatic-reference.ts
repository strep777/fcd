import {clusterMasks} from '../../../packages/reference/color-cluster';
import {components,encode,pixels} from '../../../packages/reference/mask';
import {maskPieces,traceMask} from './reference-segmentation';
import type {Project,Reference} from '../../../packages/schema/index';
import upng from '@pdf-lib/upng';
import {DomainError} from './repository';
import {illustrationRegions,pigmentFamily} from '../../../packages/reference/illustration';
import {recoverSharedContours} from '../../../packages/reference/shared-contour';
import {partName,sideName} from '../../../packages/reference/body-parts';
import {randomUUID} from 'node:crypto';
import {borderBackground} from '../../../packages/reference/background';

const codec=(upng as unknown as {default?:typeof upng}).default??upng;

/** Background removal is restricted to the dominant border color's border-connected components. */
export function splitReferencePixels(reference:Reference,width:number,height:number,rgba:Uint8Array,clusters:number,excludeBackground:boolean):NonNullable<Project['patternLibrary']>{
 if(!reference.calibration)throw new DomainError('CALIBRATION_REQUIRED');
 const c=reference.calibration,scale=c.distanceMm/Math.hypot(c.a.x-c.b.x,c.a.y-c.b.y);
 if(!Number.isFinite(scale)||scale<=0)throw new DomainError('INVALID_CALIBRATION');
 if(!Number.isInteger(reference.width)||!Number.isInteger(reference.height)||reference.width<1||reference.height<1)throw new DomainError('IMAGE_LIMIT');
 const pixelMm=Math.max(reference.width/width,reference.height/height)*scale;
 const selections=clusterMasks(width,height,rgba,{space:'lab',clusters,minRegionPixels:8});
 const exterior=excludeBackground?borderBackground(width,height,rgba):new Uint8Array(width*height);
 const border=(i:number)=>i<width||i>=width*(height-1)||i%width===0||i%width===width-1;
 const counts=selections.map(s=>{let count=0;for(let i=0;i<s.mask.pixels.length;i++)if(s.mask.pixels[i]==='1'&&border(i))count++;return count;});
 const largest=Math.max(...counts),background=largest>(2*width+2*height-4)*.4?counts.indexOf(largest):-1;
 const result:NonNullable<Project['patternLibrary']>=[],blocked=exterior.slice(),labels=new Int16Array(width*height).fill(-1),queue:number[]=[];
 for(const [index,selection] of selections.entries()){
  let mask=selection.mask;
  if(excludeBackground){const data=pixels(mask);for(let i=0;i<data.length;i++)if(exterior[i])data[i]=0;mask=encode(width,height,data);}
  if(excludeBackground&&index===background){const data=pixels(mask);for(const component of components(mask))if(component.some(border))for(const i of component){data[i]=0;blocked[i]=1;}mask=encode(width,height,data);}
  // Background removal can split a previously large component into tiny islands.
  // Reapply the same noise threshold before tracing; never fail the whole image on those islands.
  const cleaned=pixels(mask);for(const group of components(mask))if(group.length<8)for(const i of group)cleaned[i]=0;
  for(let i=0;i<cleaned.length;i++)if(cleaned[i]){labels[i]=index;queue.push(i);}
 }
 // Removed color speckles borrow their nearest surviving foreground color, instead of
 // becoming hundreds of false pinholes. Exterior/transparent pixels are never filled.
 for(let k=0;k<queue.length;k++){const i=queue[k],x=i%width,y=Math.floor(i/width);for(const n of [x?i-1:-1,x+1<width?i+1:-1,y?i-width:-1,y+1<height?i+width:-1])if(n>=0&&labels[n]<0&&!blocked[n]&&rgba[n*4+3]>=128){labels[n]=labels[i];queue.push(n);}}
 for(const [index,selection] of selections.entries()){
  const mask=encode(width,height,Uint8Array.from(labels,label=>label===index?1:0));if(!mask.pixels.includes('1'))continue;
  const pieces=maskPieces(mask,reference.calibration,reference.width,reference.height,selection.color).pieces;
  for(const [i,raw] of pieces.entries()){
   const piece=raw;
   piece.name=`${reference.view==='front'?'正面':'背面'} ${selection.color} / ${i+1}`;
   result.push({piece,referenceId:reference.id,view:reference.view,category:selection.color});
  }
 }
 if(!result.length)throw new DomainError('EMPTY_MASK');
 return result;
}

export function splitReferences(references:Reference[],heightMm:number,clusters:number,excludeBackground:boolean,mode:'simple'|'precise'='simple',subject:'character'|'head'|'paw'|'foot'='character'){
 if(references.length!==2||new Set(references.map(r=>r.view)).size!==2)throw new DomainError('DUAL_VIEW_REQUIRED');
 const defaultCalibration=new Set(references.filter(r=>!r.calibration||r.calibrationMode==='automatic'||!r.calibrationMode&&r.calibration.a.x===r.width/2&&r.calibration.b.x===r.width/2&&r.calibration.a.y===r.height&&r.calibration.b.y===0).map(r=>r.id));
 const calibrated=references.map(r=>({...r,calibration:r.calibration??{a:{x:r.width/2,y:r.height},b:{x:r.width/2,y:0},distanceMm:heightMm}}));
 const regions=calibrated.flatMap(reference=>{
  if(!reference.resources)throw new DomainError('REFERENCE_PROXY_REQUIRED');
  const data=Buffer.from(reference.png.split(',')[1],'base64'),decoded=codec.decode(Uint8Array.from(data).buffer);
  const rgba=new Uint8Array(codec.toRGBA8(decoded)[0]);
  // Legacy mode values are accepted, but both use the same original-resolution pipeline.
  let result:ReturnType<typeof illustrationRegions>;try{result=illustrationRegions(decoded.width,decoded.height,rgba,excludeBackground,subject);}catch(error){throw new DomainError(error instanceof Error?error.message:'IMAGE_LIMIT');}
  const sourceBox=(b:typeof result.bounds)=>({minX:b.minX*reference.width/decoded.width,maxX:b.maxX*reference.width/decoded.width,minY:b.minY*reference.height/decoded.height,maxY:b.maxY*reference.height/decoded.height});
  if(defaultCalibration.has(reference.id)&&(result.anatomical||subject!=='character')){const b=sourceBox(result.bounds),x=(b.minX+b.maxX)/2;reference.calibration={a:{x,y:b.maxY},b:{x,y:b.minY},distanceMm:heightMm};reference.calibrationMode='automatic';}
  const scale=reference.calibration!.distanceMm/Math.hypot(reference.calibration!.a.x-reference.calibration!.b.x,reference.calibration!.a.y-reference.calibration!.b.y),pixelMm=Math.max(reference.width/decoded.width,reference.height/decoded.height)*scale;
  Object.assign(reference,{illustration:{algorithm:'illustration-2',edgeClipped:result.bounds.minX===0||result.bounds.maxX===decoded.width||result.bounds.minY===0||result.bounds.maxY===decoded.height,subject,bounds:sourceBox(result.bounds),partBounds:result.partBounds.map(({part,side,orientationRad,frameCorners,...bounds})=>({part,...(side?{side:reference.view==='front'?(side==='left'?'right':side==='right'?'left':side):side}:{}),...(orientationRad===undefined?{}:{orientationRad}),...(frameCorners?{frameCorners:frameCorners.map(p=>({x:p.x*reference.width/decoded.width,y:p.y*reference.height/decoded.height}))}:{}),bounds:sourceBox(bounds)})),foregroundPixels:result.foregroundPixels,discardedPixels:result.discardedPixels,palette:result.palette,smoothingPx:.8}});
  const originals=result.regions.map(region=>{let minX=decoded.width,minY=decoded.height,maxX=0,maxY=0;for(const index of region.indices){const x=index%decoded.width,y=Math.floor(index/decoded.width);minX=Math.min(minX,x);minY=Math.min(minY,y);maxX=Math.max(maxX,x);maxY=Math.max(maxY,y);}const w=maxX-minX+1,h=maxY-minY+1,pixels=new Uint8Array(w*h);for(const index of region.indices)pixels[(Math.floor(index/decoded.width)-minY)*w+index%decoded.width-minX]=1;const c=reference.calibration!,local={...c,a:{x:c.a.x-minX,y:c.a.y-minY},b:{x:c.b.x-minX,y:c.b.y-minY}};return traceMask(w,h,pixels,local,w,h,region.color,true).piece;});
  let pieces:typeof originals;try{pieces=recoverSharedContours(originals,pixelMm*.8,randomUUID).pieces;}catch(error){throw new DomainError(error instanceof Error?error.message:'RESOURCE_LIMIT');}
  return result.regions.map((region,i)=>{const piece=pieces[i],side=region.side==='center'||region.side==='unknown'?region.side:reference.view==='front'?(region.side==='left'?'right':'left'):region.side;
   piece.name=`${reference.view==='front'?'正面':'背面'} ${partName(region.part)} ${sideName(side)} / ${i+1}`;
   return {piece,referenceId:reference.id,view:reference.view,category:partName(region.part),anatomy:{part:region.part,side,confidence:region.confidence,method:'silhouette-1' as const,...(region.contexts?.length?{contexts:region.contexts.map(c=>({...c,side:c.side==='center'||c.side==='unknown'?c.side:reference.view==='front'?(c.side==='left'?'right':'left'):c.side}))}:{})}};
  });
 });
 if(regions.length>500)throw new DomainError('RESOURCE_LIMIT');

 return {references:calibrated,regions};
}


