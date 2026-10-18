import {beforeEach,expect,it,vi} from 'vitest';
import {createPinia,setActivePinia} from 'pinia';
import {useSession} from '../../apps/desktop/src/store';
import type {Response,Session} from '../../packages/schema/index';

function deferred<T>(){let resolve!:(value:T)=>void;const promise=new Promise<T>(done=>{resolve=done;});return {promise,resolve};}
function session(sessionId='original'):Session{return {sessionId,project:null,geometry:[],canUndo:false,canRedo:false,savedRevision:null,recovery:[],history:[],recent:[],jobs:[]};}
const success=(sessionId='original'):Response=>({ok:true,data:session(sessionId)});
beforeEach(()=>setActivePinia(createPinia()));

it('keeps the mutation lock until a cancelled task settles and never publishes the cancellation acknowledgement',async()=>{
 const store=useSession(),work=deferred<Response>(),cancel=vi.fn(async()=>success('cancel-ack'));store.data=session();store.setErrorScope('cutting');
 const running=store.run(()=>work.promise,{label:'Cutting patterns',cancel});expect(store.busy).toBe(true);expect(store.task).toMatchObject({label:'Cutting patterns',cancellable:true});expect(Number.isFinite(store.task?.startedAt)).toBe(true);
 store.setErrorScope('mapping');expect(await store.cancelRun()).toBe(true);expect(await store.cancelRun()).toBe(false);expect(cancel).toHaveBeenCalledTimes(1);expect(store.cancelling).toBe(true);expect(store.busy).toBe(true);expect(store.data.sessionId).toBe('original');
 const competing=vi.fn(async()=>success('competing'));expect(await store.run(competing)).toBe(false);expect(competing).not.toHaveBeenCalled();
 work.resolve({ok:false,error:{code:'CANCELLED',messageKey:'CANCELLED'}});expect(await running).toBe(false);expect(store.busy).toBe(false);expect(store.task).toBeUndefined();expect(store.taskOutcome).toBe('cancelled');expect(store.cancelling).toBe(false);expect(store.data.sessionId).toBe('original');store.setErrorScope('cutting');expect(store.error).toBe('');
 await store.run(async()=>success('next'));expect(store.taskOutcome).toBe('');expect(store.data.sessionId).toBe('next');
});

it('failed cancellation can be retried and retains the originating error scope',async()=>{
 const store=useSession(),work=deferred<Response>(),cancel=vi.fn<()=>Promise<Response>>().mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(success());store.setErrorScope('cutting');
 const running=store.run(()=>work.promise,{cancel});store.setErrorScope('mapping');expect(await store.cancelRun()).toBe(false);expect(store.busy).toBe(true);expect(store.cancelling).toBe(false);expect(store.taskCancelFailed).toBe(true);expect(store.error).toBe('');store.setErrorScope('cutting');expect(store.error).toBe('CONNECTION_ERROR');
 expect(await store.cancelRun()).toBe(true);expect(store.taskCancelFailed).toBe(false);expect(store.cancelling).toBe(true);expect(store.error).toBe('');work.resolve({ok:false,error:{code:'CANCELLED',messageKey:'CANCELLED'}});await running;expect(store.taskOutcome).toBe('cancelled');
});

it('a late cancel reply cannot alter a newer task or leak its failure to another page',async()=>{
 const store=useSession(),first=deferred<Response>(),ack=deferred<Response>(),second=deferred<Response>();store.setErrorScope('cutting');
 const firstRun=store.run(()=>first.promise,{cancel:()=>ack.promise}),cancel=store.cancelRun();first.resolve(success('finished'));expect(await firstRun).toBe(true);
 store.setErrorScope('mapping');const secondRun=store.run(()=>second.promise,{label:'New mapping task'});ack.resolve({ok:false,error:{code:'STALE_CANCEL',messageKey:'STALE_CANCEL'}});expect(await cancel).toBe(false);expect(store.busy).toBe(true);expect(store.task?.label).toBe('New mapping task');expect(store.cancelling).toBe(false);expect(store.taskCancelFailed).toBe(false);expect(store.error).toBe('');store.setErrorScope('cutting');expect(store.error).toBe('');second.resolve(success('second'));await secondRun;
});

it('ordinary tasks have loading metadata without exposing unsupported cancellation',async()=>{
 const store=useSession(),work=deferred<Response>();const running=store.run(()=>work.promise);expect(store.task?.cancellable).toBe(false);expect(await store.cancelRun()).toBe(false);work.resolve(success());expect(await running).toBe(true);expect(store.task).toBeUndefined();expect(store.taskOutcome).toBe('');
});

it('an unsolicited backend cancellation remains an operation error',async()=>{
 const store=useSession();expect(await store.run(async()=>({ok:false,error:{code:'CANCELLED',messageKey:'CANCELLED'}}))).toBe(false);expect(store.error).toBe('CANCELLED');expect(store.taskOutcome).toBe('');
});

it('successful work clears only its cancellation failure and preserves a newer storage error',async()=>{
 const store=useSession();for(const storageFailure of [false,true]){const work=deferred<Response>(),running=store.run(()=>work.promise,{cancel:async()=>{throw Error('offline');}});await store.cancelRun();expect(store.error).toBe('CONNECTION_ERROR');if(storageFailure)store.error='RECOVERY_SAVE_FAILED';work.resolve(success());expect(await running).toBe(true);expect(store.error).toBe(storageFailure?'RECOVERY_SAVE_FAILED':'');}
});
