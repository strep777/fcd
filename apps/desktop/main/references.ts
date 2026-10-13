import {manualCandidate} from './manual-candidate';
import {referenceKey} from '../../../packages/reference/resources';
import {inspectImage,orientationMatrix,orientPixels,IMAGE_FILE_BYTES,IMAGE_PIXELS,IMAGE_PNG_BYTES} from '../../../packages/reference/image-input';
import {fitCandidate} from '../../../packages/pattern/bezier-fit';
import {clusterMask,type ClusterOptions} from '../../../packages/reference/color-cluster';
import {nativeImage} from 'electron';
import {readFile,stat} from 'node:fs/promises';
import {basename} from 'node:path';
import {randomUUID} from 'node:crypto';
import UPNG from '@pdf-lib/upng';
const pngCodec=(UPNG as unknown as {default?:typeof UPNG}).default??UPNG;
import {referenceSchema,referenceRunSchema,type Reference,type ReferenceRun} from '../../../packages/schema/index';
import {DomainError,hash} from './repository';
import type {Mask} from '../../../packages/reference/mask';
import {maskPieces,segmentPixels} from './reference-segmentation';
const pngUri=(b:Uint8Array)=>'data:image/png;base64,'+Buffer.from(b).toString('base64');
function pngBytes(data:string,width:number,height:number,max=IMAGE_PNG_BYTES){const bytes=Buffer.from(data.slice('data:image/png;base64,'.length),'base64');let input;try{input=inspectImage(bytes,max);}catch(e){throw new DomainError((e as Error).message);}if(input.mime!=='image/png'||input.orientation!==1)throw new DomainError('IMAGE_DECODE');if(bytes.length<33||!bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))||bytes.toString('ascii',12,16)!=='IHDR'||bytes.readUInt32BE(16)!==width||bytes.readUInt32BE(20)!==height||width*height>IMAGE_PIXELS)throw new DomainError('IMAGE_DECODE');return bytes;}
export async function readReference(path:string,view:'front'|'back'):Promise<Reference>{
 if((await stat(path)).size>IMAGE_FILE_BYTES)throw new DomainError('IMAGE_LIMIT');const bytes=await readFile(path);let input;try{input=inspectImage(bytes);}catch(e){throw new DomainError((e as Error).message);}let image=nativeImage.createFromBuffer(Buffer.from(input.bytes));if(image.isEmpty())throw new DomainError('IMAGE_DECODE');let {width,height}=image.getSize();if(width!==input.width||height!==input.height)throw new DomainError('IMAGE_DECODE');
 if(input.orientation!==1){const decoded=pngCodec.decode(Uint8Array.from(image.toPNG()).buffer),turned=orientPixels(new Uint8Array(pngCodec.toRGBA8(decoded)[0]),width,height,input.orientation);image=nativeImage.createFromBuffer(Buffer.from(pngCodec.encode([turned.pixels.buffer as ArrayBuffer],turned.width,turned.height,0)));({width,height}=image.getSize());}
 const png=image.toPNG();if(png.length>IMAGE_PNG_BYTES)throw new DomainError('IMAGE_LIMIT');
 const variant=(limit:number)=>{const factor=Math.min(1,limit/Math.max(width,height)),w=Math.max(1,Math.round(width*factor)),h=Math.max(1,Math.round(height*factor)),data=image.resize({width:w,height:h,quality:'best'}).toPNG();return {width:w,height:h,png:pngUri(data),sha256:hash(data),scaleX:w/width,scaleY:h/height};};
 return referenceSchema.parse({id:randomUUID(),name:basename(path).slice(0,120),view,width,height,png:pngUri(png),resources:{version:1,source:{mime:input.mime,width:input.width,height:input.height,orientation:input.orientation,data:'data:'+input.mime+';base64,'+bytes.toString('base64'),sha256:hash(bytes),transform:orientationMatrix(input.width,input.height,input.orientation)},original:{sha256:hash(png)},proxy:variant(512),thumbnail:variant(128)}});
}
export function referenceFromPng(bytes:Buffer,name:string,view:'front'|'back'):Reference{
 const image=nativeImage.createFromBuffer(bytes),{width,height}=image.getSize();
 if(!width||!height||width*height>IMAGE_PIXELS)throw new DomainError('IMAGE_LIMIT');
 const variant=(limit:number)=>{const factor=Math.min(1,limit/Math.max(width,height)),w=Math.max(1,Math.round(width*factor)),h=Math.max(1,Math.round(height*factor)),data=image.resize({width:w,height:h,quality:'best'}).toPNG();return {width:w,height:h,png:pngUri(data),sha256:hash(data),scaleX:w/width,scaleY:h/height};};
 return referenceSchema.parse({id:randomUUID(),name:name.slice(0,120),view,width,height,png:pngUri(bytes),resources:{version:1,source:{mime:'image/png',width,height,orientation:1,data:pngUri(bytes),sha256:hash(bytes),transform:orientationMatrix(width,height,1)},original:{sha256:hash(bytes)},proxy:variant(512),thumbnail:variant(128)}});
}
export function validateReference(reference:Reference){
 referenceSchema.parse(reference);if(reference.sheet){const s=reference.sheet;if(s.x+reference.width>s.width||s.y+reference.height>s.height)throw new DomainError('IMAGE_RESOURCE_MISMATCH');if(s.png)pngBytes(s.png,s.width,s.height);}const normalized=pngBytes(reference.png,reference.width,reference.height),a=reference.resources;if(!a)return;
 const source=Buffer.from(a.source.data.slice(a.source.data.indexOf(',')+1),'base64');let input;try{input=inspectImage(source);}catch(e){throw new DomainError((e as Error).message);}
 if(hash(source)!==a.source.sha256||hash(normalized)!==a.original.sha256||!a.source.data.startsWith('data:'+a.source.mime+';base64,')||input.mime!==a.source.mime||input.width!==a.source.width||input.height!==a.source.height||input.orientation!==a.source.orientation||JSON.stringify(a.source.transform)!==JSON.stringify(orientationMatrix(input.width,input.height,input.orientation))||reference.width!==(input.orientation>=5?input.height:input.width)||reference.height!==(input.orientation>=5?input.width:input.height))throw new DomainError('IMAGE_RESOURCE_MISMATCH');
 for(const [asset,limit] of [[a.proxy,512],[a.thumbnail,128]] as const){const factor=Math.min(1,limit/Math.max(reference.width,reference.height));if(asset.width!==Math.max(1,Math.round(reference.width*factor))||asset.height!==Math.max(1,Math.round(reference.height*factor))||asset.scaleX!==asset.width/reference.width||asset.scaleY!==asset.height/reference.height||hash(pngBytes(asset.png,asset.width,asset.height,1500000))!==asset.sha256)throw new DomainError('IMAGE_RESOURCE_MISMATCH');}
}
export function segmentReference(reference:Reference,seed:{x:number;y:number},tolerance:number,options?:ClusterOptions,fitToleranceMm?:number):ReferenceRun{
 validateReference(reference);if(!reference.calibration)throw new DomainError('CALIBRATION_REQUIRED');const factor=Math.min(1,512/Math.max(reference.width,reference.height)),buffer=!options?Buffer.from(reference.png.split(',')[1],'base64'):reference.resources?Buffer.from(reference.resources.proxy.png.split(',')[1],'base64'):nativeImage.createFromDataURL(reference.png).resize({width:Math.max(1,Math.round(reference.width*factor)),height:Math.max(1,Math.round(reference.height*factor)),quality:'best'}).toPNG();const decoded=pngCodec.decode(Uint8Array.from(buffer).buffer),rgba=new Uint8Array(pngCodec.toRGBA8(decoded)[0]);if(options){let clustered;try{clustered=clusterMask(decoded.width,decoded.height,rgba,{x:seed.x*decoded.width/reference.width,y:seed.y*decoded.height/reference.height},options);}catch(e){throw new DomainError(e instanceof Error?e.message:'IMAGE_LIMIT');}const result=maskPieces(clustered.mask,reference.calibration,reference.width,reference.height,clustered.color,fitToleranceMm===undefined);result.pieces.forEach((p,i)=>p.name=(reference.view+': '+reference.name+' / '+(i+1)).slice(0,120));return finishReference(referenceRunSchema.parse({referenceId:reference.id,sourceHash:hash(referenceKey(reference)),piece:result.pieces[0],...result,mask:clustered.mask,clustering:clustered.report,algorithm:options.space==='lab'?'cluster-lab-1':'cluster-hsv-1',proxyWidth:decoded.width,proxyHeight:decoded.height,accepted:false}),fitToleranceMm);}
 const result=segmentPixels(decoded.width,decoded.height,rgba,seed,tolerance,reference.calibration,reference.width,reference.height,fitToleranceMm===undefined,true);result.piece.name=`${reference.view}: ${reference.name}`.slice(0,120);return finishReference(referenceRunSchema.parse({referenceId:reference.id,sourceHash:hash(referenceKey(reference)),...result,algorithm:'color-flood-1',proxyWidth:decoded.width,proxyHeight:decoded.height,accepted:false}),fitToleranceMm);
}

export function manualReference(reference:Reference,sourceHash:string,mask:Mask,color:string):ReferenceRun{validateReference(reference);return manualCandidate(reference,sourceHash,mask,color);}

function finishReference(run:ReferenceRun,toleranceMm?:number):ReferenceRun{if(toleranceMm===undefined)return run;const results=(run.pieces??[run.piece]).map(p=>fitCandidate(p,toleranceMm,randomUUID)),pieces=results.map(r=>r.piece),curveFit={algorithm:'bezier-ls-bounded-1' as const,toleranceMm,maxDeviationMm:Math.max(...results.map(r=>r.report.maxDeviationMm)),inputNodes:results.reduce((s,r)=>s+r.report.inputNodes,0),outputNodes:results.reduce((s,r)=>s+r.report.outputNodes,0),fallbackCount:results.reduce((s,r)=>s+r.report.fallbackCount,0)};return referenceRunSchema.parse({...run,piece:pieces[0],pieces,curveFit});}


