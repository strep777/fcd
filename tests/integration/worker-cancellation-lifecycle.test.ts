import {afterEach,beforeEach,expect,it,vi} from 'vitest';
const children=vi.hoisted(()=>[] as any[]);
vi.mock('node:child_process',async()=>{
 const {EventEmitter}=await import('node:events');
 return {spawn:vi.fn(()=>{const proc=Object.assign(new EventEmitter(),{pid:123456,exitCode:null,signalCode:null,kill:vi.fn(()=>true),stdin:Object.assign(new EventEmitter(),{write:vi.fn(),end:vi.fn()}),stdout:new EventEmitter(),stderr:new EventEmitter()});children.push(proc);return proc;})};
});
import {createWorkerSession,request} from '../../apps/desktop/main/worker';
beforeEach(()=>{children.length=0;vi.useFakeTimers();});
afterEach(()=>{vi.useRealTimers();vi.restoreAllMocks();});
function operation(kind:'request'|'session',timeoutMs=10000){const controller=new AbortController(),session=kind==='session'?createWorkerSession('unused',controller.signal):undefined,result=session?session.request({protocolVersion:1},{timeoutMs,bytes:1024}):request('unused',{protocolVersion:1},controller.signal,{timeoutMs,bytes:1024});return {controller,result,proc:children[0],session};}

it.each(['request','session'] as const)('%s cancellation stays pending through kill and error until the native exit is observed',async kind=>{
 const {controller,result,proc,session}=operation(kind),settled=vi.fn(),outcome=result.catch(error=>error.code);void result.then(settled,settled);controller.abort();
 await vi.advanceTimersByTimeAsync(100);expect(settled).not.toHaveBeenCalled();proc.emit('error',Error('exit race'));await Promise.resolve();expect(settled).not.toHaveBeenCalled();
 proc.signalCode='SIGTERM';proc.emit('exit',null,'SIGTERM');expect(await outcome).toBe('CANCELLED');expect(settled).toHaveBeenCalledOnce();proc.emit('close',null,'SIGTERM');expect(settled).toHaveBeenCalledOnce();expect(vi.getTimerCount()).toBe(0);if(session)await expect(session.request({})).rejects.toMatchObject({code:'CANCELLED'});
});

it.each(['request','session'] as const)('%s timeout remains pending until close and ignores later exit/error events',async kind=>{
 const {result,proc}=operation(kind,10),settled=vi.fn(),outcome=result.catch(error=>error.code);void result.then(settled,settled);await vi.advanceTimersByTimeAsync(10);expect(settled).not.toHaveBeenCalled();
 proc.emit('close',1,null);expect(await outcome).toBe('TIMEOUT');proc.emit('exit',1,null);proc.emit('error',Error('late error'));expect(settled).toHaveBeenCalledOnce();expect(vi.getTimerCount()).toBe(0);
});

it.each(['request','session'] as const)('%s reports a bounded cleanup failure when a child never exits',async kind=>{
 const {controller,result,proc}=operation(kind),outcome=result.catch(error=>error.code);controller.abort();await vi.advanceTimersByTimeAsync(1999);let settled=false;void outcome.then(()=>settled=true);await Promise.resolve();expect(settled).toBe(false);await vi.advanceTimersByTimeAsync(1);expect(await outcome).toBe('WORKER_CRASH');expect(proc.kill).toHaveBeenCalledWith('SIGKILL');expect(vi.getTimerCount()).toBe(0);
});

it.each(['request','session'] as const)('%s handles a failed spawn without waiting for an exit from a nonexistent process',async kind=>{
 const {result,proc}=operation(kind),outcome=result.catch(error=>error.code);proc.pid=undefined;proc.emit('error',Error('spawn failed'));expect(await outcome).toBe('WORKER_CRASH');proc.emit('close',-2,null);expect(vi.getTimerCount()).toBe(0);
});
