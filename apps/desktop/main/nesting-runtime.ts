import {Worker} from 'node:worker_threads';
import {join} from 'node:path';
import type {Project,Geometry,NestingOptions,Nesting} from '../../../packages/schema/index';
import {nestingSchema} from '../../../packages/schema/index';
import {DomainError} from './repository';
/** Keep contour search off the Main event loop; budget expiry retains its validated conservative baseline. */
export function runNesting(project:Project,geometry:Geometry[],options:NestingOptions):Promise<Nesting>{return new Promise((resolve,reject)=>{const worker=new Worker(join(__dirname,'nesting-worker.cjs'),{workerData:{project,geometry,options}});let done=false,baseline:Nesting|undefined;
 const finish=(result?:Nesting,error?:Error)=>{if(done)return;done=true;clearTimeout(timer);void worker.terminate();if(error)reject(error);else resolve(result!);};
 const timer=setTimeout(()=>baseline?finish(baseline):finish(undefined,new DomainError('TIMEOUT')),10000);
 worker.on('message',(message:{kind:string;value?:Nesting;code?:string})=>{try{if(message.kind==='baseline')baseline=nestingSchema.parse(message.value);else if(message.kind==='result')finish(nestingSchema.parse(message.value));else finish(undefined,new DomainError(message.code??'INVALID_NESTING'));}catch{finish(undefined,new DomainError('INVALID_NESTING'));}});
 worker.on('error',()=>finish(undefined,new DomainError('WORKER_CRASH')));worker.on('exit',code=>{if(!done)finish(undefined,new DomainError('WORKER_CRASH'));});
 });}
