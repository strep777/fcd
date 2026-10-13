import {parentPort,workerData} from 'node:worker_threads';
import {nest} from './nesting';
import {DomainError} from './repository';
try{const {project,geometry,options}=workerData;if(options.mode==='contour'){parentPort!.postMessage({kind:'baseline',value:nest(project,geometry,{...options,mode:'shelf'})});}parentPort!.postMessage({kind:'result',value:nest(project,geometry,options)});}catch(e){parentPort!.postMessage({kind:'error',code:e instanceof DomainError?e.code:'INVALID_NESTING'});}
