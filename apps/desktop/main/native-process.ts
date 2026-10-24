import type {ChildProcess} from 'node:child_process';
import {DomainError} from './repository';

const terminationLimitMs=2000,forceAfterMs=250;
const missing=(error:unknown)=>(error as NodeJS.ErrnoException)?.code==='ESRCH';

/** Killing is a request. Keep the owner pending until the OS reports an exit. */
export function terminateNativeProcess(proc:ChildProcess):Promise<void>{
 if(proc.pid===undefined||proc.exitCode!=null||proc.signalCode!=null)return Promise.resolve();
 return new Promise((resolve,reject)=>{
  let done=false;
  const finish=(error?:Error)=>{if(done)return;done=true;clearTimeout(force);clearTimeout(deadline);proc.removeListener('exit',exited);proc.removeListener('close',exited);if(error)reject(error);else resolve();};
  const exited=()=>finish();
  const force=setTimeout(()=>{try{proc.kill('SIGKILL');}catch(error){if(missing(error))finish();}},forceAfterMs);
  const deadline=setTimeout(()=>finish(new DomainError('WORKER_CRASH')),terminationLimitMs);
  proc.once('exit',exited);proc.once('close',exited);
  try{proc.kill();}catch(error){if(missing(error))finish();}
 });
}

/** Worker threads report PIDs rather than process handles. After their thread
 * has stopped, probe those PIDs so thread termination cannot hide a live child. */
export function terminateNativeChildren(children:Set<number>):Promise<void>{
 if(!children.size)return Promise.resolve();
 return new Promise((resolve,reject)=>{
  const killed=new Set<number>(),forced=new Set<number>(),started=Date.now();let done=false;
  const finish=(error?:Error)=>{if(done)return;done=true;clearInterval(poll);clearTimeout(deadline);if(error)reject(error);else resolve();};
  const check=()=>{for(const pid of children){try{if(!killed.has(pid)){killed.add(pid);process.kill(pid);}if(Date.now()-started>=forceAfterMs&&!forced.has(pid)){forced.add(pid);process.kill(pid,'SIGKILL');}process.kill(pid,0);}catch(error){if(missing(error))children.delete(pid);}}if(!children.size)finish();};
  const poll=setInterval(check,20),deadline=setTimeout(()=>finish(new DomainError('WORKER_CRASH')),terminationLimitMs);
  check();
 });
}
