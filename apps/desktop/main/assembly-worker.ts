import {parentPort,workerData} from 'node:worker_threads';
import {assembleSpecies} from './species-assembly';
import {DomainError} from './repository';
try{parentPort!.postMessage({kind:'result',value:await assembleSpecies(workerData.surface,workerData.assetDirectory)});}catch(e){parentPort!.postMessage({kind:'error',code:e instanceof DomainError?e.code:'ASSEMBLY_FAILED'});}
