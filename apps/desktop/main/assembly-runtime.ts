import {Worker} from 'node:worker_threads';
import {join} from 'node:path';
import {surfaceSchema,type Surface} from '../../../packages/schema/index';
import {DomainError} from './repository';
export function runAssembly(surface:Surface):Promise<Surface>{return new Promise((resolve,reject)=>{
 const worker=new Worker(join(__dirname,'assembly-worker.mjs'),{workerData:{surface,assetDirectory:join(__dirname,'../assets')}});let done=false;
 const finish=(result?:Surface,error?:Error)=>{if(done)return;done=true;clearTimeout(timer);void worker.terminate();if(error)reject(error);else resolve(result!);};
 const timer=setTimeout(()=>finish(undefined,new DomainError('TIMEOUT')),20000);
 worker.on('message',(m:{kind:string;value?:Surface;code?:string})=>{try{if(m.kind==='result')finish(surfaceSchema.parse(m.value));else finish(undefined,new DomainError(m.code??'ASSEMBLY_FAILED'));}catch{finish(undefined,new DomainError('ASSEMBLY_FAILED'));}});
 worker.on('error',()=>finish(undefined,new DomainError('WORKER_CRASH')));worker.on('exit',()=>{if(!done)finish(undefined,new DomainError('WORKER_CRASH'));});
});}
