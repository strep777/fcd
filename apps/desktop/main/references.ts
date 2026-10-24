import {manualCandidate} from './manual-candidate';
import {segmentReferenceCandidate} from './reference-candidate';
import {validateReference} from './reference-validation';
export {validateReference} from './reference-validation';
import {inspectImage,orientationMatrix,orientPixels,IMAGE_FILE_BYTES,IMAGE_PIXELS,IMAGE_PNG_BYTES} from '../../../packages/reference/image-input';

import {type ClusterOptions} from '../../../packages/reference/color-cluster';
import {rasterImage} from './raster-image';
import {readFile,stat} from 'node:fs/promises';
import {basename} from 'node:path';
import {randomUUID} from 'node:crypto';
import UPNG from '@pdf-lib/upng';
const pngCodec=(UPNG as unknown as {default?:typeof UPNG}).default??UPNG;
import {referenceSchema,type Reference,type ReferenceRun} from '../../../packages/schema/index';
import {DomainError,hash} from './repository';
import type {Mask} from '../../../packages/reference/mask';

const pngUri=(b:Uint8Array)=>'data:image/png;base64,'+Buffer.from(b).toString('base64');
export async function readReference(path:string,view:'front'|'back'):Promise<Reference>{
 if((await stat(path)).size>IMAGE_FILE_BYTES)throw new DomainError('IMAGE_LIMIT');const bytes=await readFile(path);let input;try{input=inspectImage(bytes);}catch(e){throw new DomainError((e as Error).message);}let image=await rasterImage.decode(Buffer.from(input.bytes));if(image.isEmpty())throw new DomainError('IMAGE_DECODE');let {width,height}=image.getSize();if(width!==input.width||height!==input.height)throw new DomainError('IMAGE_DECODE');
 if(input.orientation!==1){const decoded=pngCodec.decode(Uint8Array.from(image.toPNG()).buffer),turned=orientPixels(new Uint8Array(pngCodec.toRGBA8(decoded)[0]),width,height,input.orientation);image=rasterImage.createFromBuffer(Buffer.from(pngCodec.encode([turned.pixels.buffer as ArrayBuffer],turned.width,turned.height,0)));({width,height}=image.getSize());}
 const png=image.toPNG();if(png.length>IMAGE_PNG_BYTES)throw new DomainError('IMAGE_LIMIT');
 const variant=(limit:number)=>{const factor=Math.min(1,limit/Math.max(width,height)),w=Math.max(1,Math.round(width*factor)),h=Math.max(1,Math.round(height*factor)),data=image.resize({width:w,height:h,quality:'best'}).toPNG();return {width:w,height:h,png:pngUri(data),sha256:hash(data),scaleX:w/width,scaleY:h/height};};
 return referenceSchema.parse({id:randomUUID(),name:basename(path).slice(0,120),view,width,height,png:pngUri(png),resources:{version:1,source:{mime:input.mime,width:input.width,height:input.height,orientation:input.orientation,data:'data:'+input.mime+';base64,'+bytes.toString('base64'),sha256:hash(bytes),transform:orientationMatrix(input.width,input.height,input.orientation)},original:{sha256:hash(png)},proxy:variant(512),thumbnail:variant(128)}});
}
export function referenceFromPng(bytes:Buffer,name:string,view:'front'|'back'):Reference{
 const image=rasterImage.createFromBuffer(bytes),{width,height}=image.getSize();
 if(!width||!height||width*height>IMAGE_PIXELS)throw new DomainError('IMAGE_LIMIT');
 const variant=(limit:number)=>{const factor=Math.min(1,limit/Math.max(width,height)),w=Math.max(1,Math.round(width*factor)),h=Math.max(1,Math.round(height*factor)),data=image.resize({width:w,height:h,quality:'best'}).toPNG();return {width:w,height:h,png:pngUri(data),sha256:hash(data),scaleX:w/width,scaleY:h/height};};
 return referenceSchema.parse({id:randomUUID(),name:name.slice(0,120),view,width,height,png:pngUri(bytes),resources:{version:1,source:{mime:'image/png',width,height,orientation:1,data:pngUri(bytes),sha256:hash(bytes),transform:orientationMatrix(width,height,1)},original:{sha256:hash(bytes)},proxy:variant(512),thumbnail:variant(128)}});
}
/** Legacy references without proxy assets retain the native image resize used
 * by color clustering; pixel segmentation itself can run in a worker. */
export function segmentationProxy(reference:Reference,options?:ClusterOptions){
 if(!options||reference.resources)return undefined;
 const factor=Math.min(1,512/Math.max(reference.width,reference.height));
 return pngUri(rasterImage.createFromDataURL(reference.png).resize({width:Math.max(1,Math.round(reference.width*factor)),height:Math.max(1,Math.round(reference.height*factor)),quality:'best'}).toPNG());
}
export function segmentReference(reference:Reference,seed:{x:number;y:number},tolerance:number,options?:ClusterOptions,fitToleranceMm?:number):ReferenceRun{
 validateReference(reference);return segmentReferenceCandidate(reference,seed,tolerance,options,fitToleranceMm,segmentationProxy(reference,options));
}
export function manualReference(reference:Reference,sourceHash:string,mask:Mask,color:string):ReferenceRun{validateReference(reference);return manualCandidate(reference,sourceHash,mask,color);}

