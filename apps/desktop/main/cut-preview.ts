import {assertUserCutsValid} from '../../../packages/surface/cut-path-contract';
import {DomainError} from './repository';
import type {Project,Surface,UnwrapOptions} from '../../../packages/schema/index';
import {unwrapSurface} from './surface';
import {unwrapMarkings} from './unwrap-markings';
import {colorCuts} from './color-cuts';
import {applyHalfCutScope} from './cut-tools';
import {analyze,withWorkerSession} from './worker';
import {prepareCutMarkings} from './cut-markings';
import {prepareDesignSurface,restoreDesignBindings,unwrapDesignSurface} from './design-cuts';
import {parentPort} from 'node:worker_threads';

/** One worker owns the entire candidate calculation, including colored cuts and preview geometry. */
export async function cutPreview(worker:string,surface:Surface,project:Project,options:UnwrapOptions,directory:string){
 return withWorkerSession(worker,()=>computeCutPreview(worker,surface,project,options,directory));
}
async function computeCutPreview(worker:string,surface:Surface,project:Project,options:UnwrapOptions,directory:string){
 try{assertUserCutsValid(surface);}catch(error){throw new DomainError((error as Error).message);}
 options={...options,partitionStrategy:options.partitionStrategy??'design'};
 parentPort?.postMessage({kind:'progress',value:{stage:'prepare'}});
 if(options.colorBoundaryCuts)project=await prepareCutMarkings(worker,project);
 const bound=new Set(project.bindings?.filter(b=>b.surfaceId===surface.id).map(b=>b.pieceId));
 parentPort?.postMessage({kind:'progress',value:{stage:'partition'}});
 const design=options.partitionStrategy==='design'?await prepareDesignSurface(worker,project,options.colorBoundaryCuts===true,options.automaticCuts===true,directory):undefined;
 parentPort?.postMessage({kind:'progress',value:{stage:'unwrap'}});
 const unbound={...project,pieces:project.pieces.filter(piece=>!bound.has(piece.id))},flattened=design?await unwrapDesignSurface(worker,unbound,design,options):undefined;
 let run=flattened?.run??await unwrapSurface(worker,surface,unbound,options);
 if(design)run=restoreDesignBindings(project,design,run);
 const precision=9;
 if(options.colorBoundaryCuts&&!design){const projected=await unwrapMarkings(worker,project,run,precision,1e-9);run=await colorCuts(worker,project,run,projected,directory);}run=applyHalfCutScope(surface,run);
 parentPort?.postMessage({kind:'progress',value:{stage:'remap'}});
 const markings=await unwrapMarkings(worker,project,run,precision,1e-9);
 if(!options.colorBoundaryCuts)for(const piece of run.pieces)piece.color='#eceae5';
 parentPort?.postMessage({kind:'progress',value:{stage:'validate'}});
 run.cutPreview=(await analyze(worker,{...project,pieces:run.pieces})).map(g=>({id:g.id,cut:g.cut,cutHoles:g.cutHoles}));
 return {run,markings};
}

