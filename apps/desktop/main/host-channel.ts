import {createInterface} from 'node:readline';
import {randomUUID} from 'node:crypto';
import {nativeDialogs} from './native-dialogs';
import {replyFrame} from './host-wire';

// Private inherited pipes only: no listening port or renderer-supplied paths.
const pending=new Map<string,{resolve:(value:any)=>void;reject:(error:Error)=>void}>();
const output=process.stdout.write.bind(process.stdout);
console.log=(...values:unknown[])=>console.error(...values);
function write(value:unknown){output(JSON.stringify(value)+'\n');}
export function publish(event:string,payload?:unknown){write({event,payload});}
export function nativeCall(method:string,payload:unknown):Promise<any>{
 const id=randomUUID();return new Promise((resolve,reject)=>{pending.set(id,{resolve,reject});write({native:id,method,payload});});
}
export const dialogs=nativeDialogs(nativeCall,publish);
export function serve(receive:(channel:string,payload:unknown)=>Promise<unknown>,shutdown:()=>Promise<void>){
 const input=createInterface({input:process.stdin,crlfDelay:Infinity});
 input.on('line',line=>{void(async()=>{
  let message:any;try{message=JSON.parse(line);}catch{return;}
  if(message.native){const task=pending.get(message.native);pending.delete(message.native);if(message.error)task?.reject(Error(message.error));else task?.resolve(message.value);return;}
  if(typeof message.id!=='number')return;
  try{const value=message.channel==='shutdown'?await shutdown():await receive(message.channel,message.payload);output(replyFrame(message.id,message.channel,value));}
  catch(error){write({id:message.id,error:error instanceof Error?error.message:'BACKEND_ERROR'});}
 })();});
 input.on('close',()=>{void shutdown().finally(()=>process.exit());});
 publish('fpcad:ready');
}
