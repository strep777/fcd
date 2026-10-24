import {referenceKey} from '../../../packages/reference/resources';
import {fitReferenceCandidate} from './reference-contour-fit';
import {clusterMask,type ClusterOptions} from '../../../packages/reference/color-cluster';
import {randomUUID} from 'node:crypto';
import UPNG from '@pdf-lib/upng';
import {referenceRunSchema,type Reference,type ReferenceRun} from '../../../packages/schema/index';
import {DomainError,hash} from './repository';
import {maskPieces,segmentPixels} from './reference-segmentation';
import {validateReference} from './reference-validation';
const pngCodec=(UPNG as unknown as {default?:typeof UPNG}).default??UPNG;
export function segmentReferenceCandidate(reference:Reference,seed:{x:number;y:number},tolerance:number,options?:ClusterOptions,fitToleranceMm?:number,proxyPng?:string):ReferenceRun{
 validateReference(reference);if(!reference.calibration)throw new DomainError('CALIBRATION_REQUIRED');const buffer=Buffer.from((options?(proxyPng??reference.resources?.proxy.png):reference.png)!.split(',')[1],'base64');const decoded=pngCodec.decode(Uint8Array.from(buffer).buffer),rgba=new Uint8Array(pngCodec.toRGBA8(decoded)[0]);if(options){let clustered;try{clustered=clusterMask(decoded.width,decoded.height,rgba,{x:seed.x*decoded.width/reference.width,y:seed.y*decoded.height/reference.height},options);}catch(e){throw new DomainError(e instanceof Error?e.message:'IMAGE_LIMIT');}const result=maskPieces(clustered.mask,reference.calibration,reference.width,reference.height,clustered.color,fitToleranceMm===undefined);result.pieces.forEach((p,i)=>p.name=(reference.view+': '+reference.name+' / '+(i+1)).slice(0,120));return finishReference({referenceId:reference.id,sourceHash:hash(referenceKey(reference)),piece:result.pieces[0],...result,mask:clustered.mask,clustering:clustered.report,algorithm:options.space==='lab'?'cluster-lab-1':'cluster-hsv-1',proxyWidth:decoded.width,proxyHeight:decoded.height,accepted:false},fitToleranceMm,reference);}
 const result=segmentPixels(decoded.width,decoded.height,rgba,seed,tolerance,reference.calibration,reference.width,reference.height,fitToleranceMm===undefined,true);result.piece.name=`${reference.view}: ${reference.name}`.slice(0,120);return finishReference({referenceId:reference.id,sourceHash:hash(referenceKey(reference)),...result,algorithm:'color-flood-1',proxyWidth:decoded.width,proxyHeight:decoded.height,accepted:false},fitToleranceMm,reference);
}

function finishReference(run:ReferenceRun,toleranceMm:number|undefined,reference:Reference):ReferenceRun{
 if(toleranceMm===undefined)return referenceRunSchema.parse(run);
 const calibration=reference.calibration!;
 const pixelMm=.8*Math.max(reference.width/run.proxyWidth,reference.height/run.proxyHeight)*calibration.distanceMm/Math.hypot(calibration.a.x-calibration.b.x,calibration.a.y-calibration.b.y);
 const results=(run.pieces??[run.piece]).map(p=>fitReferenceCandidate(p,toleranceMm,pixelMm,randomUUID)),pieces=results.map(r=>r.piece);
 const curveFit={algorithm:'bezier-ls-bounded-1' as const,toleranceMm,maxDeviationMm:Math.max(...results.map(r=>r.report.maxDeviationMm)),inputNodes:results.reduce((s,r)=>s+r.report.inputNodes,0),outputNodes:results.reduce((s,r)=>s+r.report.outputNodes,0),fallbackCount:results.reduce((s,r)=>s+r.report.fallbackCount,0)};
 return referenceRunSchema.parse({...run,piece:pieces[0],pieces,curveFit});
}
