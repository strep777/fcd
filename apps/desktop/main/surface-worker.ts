import {editLibraryRegion} from './library-region-edit';
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
void (async()=>{try{parentPort!.postMessage({kind:'result',value:workerData.kind==='library-edit'?await editLibraryRegion(workerData.workerPath,workerData.project,workerData.pieceId,workerData.edit,workerData.replaceManual):workerData.kind==='surface-edit'?(workerData.stroke?await brushSurfaceMarking(workerData.workerPath,workerData.project,workerData.markingId,workerData.stroke):await editSurfaceMarking(workerData.workerPath,workerData.project,workerData.markingId,workerData.shape)):workerData.kind==='mask'?manualCandidate(workerData.reference,workerData.sourceHash,workerData.mask,workerData.color):workerData.kind==='references'?splitReferences(workerData.references,workerData.heightMm,workerData.clusters,workerData.excludeBackground,workerData.mode,workerData.subject):workerData.kind==='cut-preview'?await cutPreview(workerData.workerPath,workerData.surface,workerData.project,workerData.options,workerData.directory):workerData.kind==='inference'?await inferMarking(workerData.workerPath,workerData.project,workerData.markingId,workerData.mode,workerData.distanceMm,workerData.planeXmm):workerData.kind==='surface-marking'?await surfaceMarking(workerData.workerPath,workerData.project,workerData.shape,workerData.color,workerData.name):workerData.kind==='texture'?await textureMarking(workerData.workerPath,workerData.project,workerData.textureId,workerData.seed,workerData.tolerance):workerData.kind==='marking'?await projectMarking(workerData.workerPath,workerData.project,workerData.sourceId,workerData.view,workerData.offsetXmm,workerData.offsetYmm,workerData.replaceManual,workerData.automatic,workerData.context):await unwrapSurface(workerData.workerPath,workerData.surface,workerData.project,workerData.options)});}catch(e){parentPort!.postMessage({kind:'error',code:e instanceof DomainError?e.code:'UNWRAP_FAILED'});}
})();
