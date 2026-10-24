import {afterEach,expect,it,vi} from 'vitest';
import {resolve} from 'node:path';
import type {ChildProcess} from 'node:child_process';
import {rectangle} from '../fixtures';
const children=vi.hoisted(()=>[] as {proc:ChildProcess;exited:boolean}[]);
// Observe the real spawn/OS exit; never substitute the native computation.
vi.mock('node:child_process',async importOriginal=>{
 const actual=await importOriginal<typeof import('node:child_process')>();
 return {...actual,spawn:((...args:any[])=>{const proc=(actual.spawn as (...input:any[])=>ChildProcess)(...args),record={proc,exited:false};children.push(record);proc.once('exit',()=>record.exited=true);return proc;}) as typeof actual.spawn};
});
import {createWorkerSession,request} from '../../apps/desktop/main/worker';
afterEach(()=>{for(const {proc} of children)if(proc.exitCode==null&&proc.signalCode==null)try{proc.kill();}catch{}children.length=0;});
it.each(['request','session'] as const)('%s cancellation only completes after the real native PID has exited',async kind=>{
 const worker=resolve('target/release/fpcad-worker.exe'),controller=new AbortController(),input={protocolVersion:1,pieces:[rectangle()]},session=kind==='session'?createWorkerSession(worker,controller.signal):undefined;
 const result=session?session.request(input):request(worker,input,controller.signal),outcome=result.catch(error=>error.code);controller.abort();expect(await outcome).toBe('CANCELLED');
 expect(children).toHaveLength(1);const {proc,exited}=children[0];expect(proc.pid).toBeDefined();expect(exited).toBe(true);
 try{process.kill(proc.pid!,0);throw Error('native process is still alive after cancellation completed');}catch(error){expect(error).toMatchObject({code:'ESRCH'});}
});
