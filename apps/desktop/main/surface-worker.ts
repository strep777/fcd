import {automaticPlacement} from './automatic-placement';
import {editLibraryRegion} from './library-region-edit';
import {segmentReferenceCandidate} from './reference-candidate';
import {editSurfaceMarking,brushSurfaceMarking} from './surface-marking-edit';
import {manualCandidate} from './manual-candidate';
import {splitReferences} from './automatic-reference';
import {inferMarking} from './marking-completion';
import {textureMarking} from './texture-markings';
import {parentPort,workerData} from 'node:worker_threads';
import {projectMarking,surfaceMarking} from './markings';
import {unwrapSurface} from './surface';
import {DomainError} from './repository';
import {cutPreview} from './cut-preview';
import type {Marking,SurfaceMarkingEdit} from '../../../packages/schema/index';
async function editSurfaceMarkings(){
 const markings:Marking[]=[];
 // Resolve each edit against the same committed input. Replacing one source
 // early would make another edit's inference dependency depend on input order.
 for(const edit of workerData.edits as SurfaceMarkingEdit[])markings.push(await editSurfaceMarking(workerData.workerPath,workerData.project,edit.markingId,edit.shape));
 return markings;
}
void (async()=>{try{parentPort!.postMessage({kind:'result',value:workerData.kind==='surface-edit-many'?await editSurfaceMarkings():workerData.kind==='automatic-placement'?await automaticPlacement(workerData.workerPath,workerData.project,workerData.pieceIds,workerData.parts):workerData.kind==='library-edit'?await editLibraryRegion(workerData.workerPath,workerData.project,workerData.pieceId,workerData.edit,workerData.replaceManual):workerData.kind==='surface-edit'?(workerData.stroke?await brushSurfaceMarking(workerData.workerPath,workerData.project,workerData.markingId,workerData.stroke):await editSurfaceMarking(workerData.workerPath,workerData.project,workerData.markingId,workerData.shape)):workerData.kind==='segment'?segmentReferenceCandidate(workerData.reference,workerData.seed,workerData.tolerance,workerData.options,workerData.fitToleranceMm,workerData.proxyPng):workerData.kind==='mask'?manualCandidate(workerData.reference,workerData.sourceHash,workerData.mask,workerData.color):workerData.kind==='references'?splitReferences(workerData.references,workerData.heightMm,workerData.clusters,workerData.excludeBackground,workerData.mode,workerData.subject):workerData.kind==='cut-preview'?await cutPreview(workerData.workerPath,workerData.surface,workerData.project,workerData.options,workerData.directory):workerData.kind==='inference'?await inferMarking(workerData.workerPath,workerData.project,workerData.markingId,workerData.mode,workerData.distanceMm,workerData.planeXmm):workerData.kind==='surface-marking'?await surfaceMarking(workerData.workerPath,workerData.project,workerData.shape,workerData.color,workerData.name,workerData.fabrication):workerData.kind==='texture'?await textureMarking(workerData.workerPath,workerData.project,workerData.textureId,workerData.seed,workerData.tolerance):workerData.kind==='marking'?await projectMarking(workerData.workerPath,workerData.project,workerData.sourceId,workerData.view,workerData.offsetXmm,workerData.offsetYmm,workerData.replaceManual,workerData.automatic,workerData.context):await unwrapSurface(workerData.workerPath,workerData.surface,workerData.project,workerData.options)});}catch(e){parentPort!.postMessage({kind:'error',code:e instanceof DomainError?e.code:'UNWRAP_FAILED'});}
})();
