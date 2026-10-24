import {spawn} from 'node:child_process';
import {resolve} from 'node:path';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {analyze,createWorkerSession} from '../../apps/desktop/main/worker';
import {terminateNativeProcess} from '../../apps/desktop/main/native-process';
import {project} from '../fixtures';

// Every request and termination still uses the real Rust worker. Inject only a
// failure to confirm cleanup after the original terminator has observed exit.
vi.mock('node:child_process',async original=>{const actual=await original<typeof import('node:child_process')>();return {...actual,spawn:vi.fn(actual.spawn)};});
vi.mock('../../apps/desktop/main/native-process',async original=>{
 const actual=await original<typeof import('../../apps/desktop/main/native-process')>();
 return {...actual,terminateNativeProcess:vi.fn(async(...args:Parameters<typeof actual.terminateNativeProcess>)=>{
  await actual.terminateNativeProcess(...args);
  throw Object.assign(new Error('WORKER_CRASH'),{code:'WORKER_CRASH'});
 })};
});

const worker=resolve('target/release/fpcad-worker.exe'),starts=vi.mocked(spawn),cleanup=vi.mocked(terminateNativeProcess);
const input=()=>({protocolVersion:1,pieces:project().pieces});
function expectExited(){
 expect(starts).toHaveBeenCalledOnce();
 const child=starts.mock.results[0].value;
 expect(child.exitCode!==null||child.signalCode!==null,'cleanup must observe the real native exit before reporting a confirmation failure').toBe(true);
}
beforeEach(()=>{starts.mockClear();cleanup.mockClear();});
afterEach(async()=>{
 const actual=await vi.importActual<typeof import('../../apps/desktop/main/native-process')>('../../apps/desktop/main/native-process');
 for(const call of starts.mock.results)if(call.type==='return')await actual.terminateNativeProcess(call.value);
});

it('reports explicit disposal failure to every caller without repeating native cleanup',async()=>{
 const session=createWorkerSession(worker);
 try{
  await expect(session.request(input())).resolves.toMatchObject({ok:true});
  const results=await Promise.allSettled([session.dispose(),session.dispose()]);
  expect(results).toEqual([{status:'rejected',reason:expect.objectContaining({code:'WORKER_CRASH'})},{status:'rejected',reason:expect.objectContaining({code:'WORKER_CRASH'})}]);
  await expect(session.dispose()).rejects.toMatchObject({code:'WORKER_CRASH'});
  await expect(session.request(input())).rejects.toMatchObject({code:'CANCELLED'});
  expect(cleanup).toHaveBeenCalledOnce();expectExited();
 }finally{await session.dispose().catch(()=>{});}
});

it('does not return successful owned analysis when native cleanup cannot be confirmed',async()=>{
 await expect(analyze(worker,project())).rejects.toMatchObject({code:'WORKER_CRASH'});
 expect(cleanup).toHaveBeenCalledOnce();expectExited();
});

it('rejects an aborted pending request after cleanup failure without an unhandled rejection',async()=>{
 const unhandled:unknown[]=[],observe=(error:unknown)=>{unhandled.push(error);};
 process.on('unhandledRejection',observe);
 const controller=new AbortController(),session=createWorkerSession(worker,controller.signal);
 try{
  const observed=expect(session.request(input())).rejects.toMatchObject({code:'WORKER_CRASH'});
  controller.abort();await observed;
  await expect(session.dispose()).rejects.toMatchObject({code:'WORKER_CRASH'});
  await new Promise<void>(done=>setImmediate(done));await new Promise<void>(done=>setImmediate(done));
  expect(unhandled).toEqual([]);expect(cleanup).toHaveBeenCalledOnce();expectExited();
 }finally{await session.dispose().catch(()=>{});process.removeListener('unhandledRejection',observe);}
});
