import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {createPinia,disposePinia,setActivePinia} from 'pinia';
import {effectScope,ref} from 'vue';
import {useSession} from '../../apps/desktop/src/store';
import {activityDelayMs,setNativeDialogOpen,useDelayedActivity} from '../../apps/desktop/src/modules/useDelayedActivity';
import type {Response} from '../../packages/schema/index';

let pinia:ReturnType<typeof createPinia>;
beforeEach(()=>{vi.useFakeTimers();setNativeDialogOpen(false);pinia=createPinia();setActivePinia(pinia);});
afterEach(()=>{disposePinia(pinia);setNativeDialogOpen(false);vi.useRealTimers();});
function deferred(){let resolve!:(value:Response)=>void;const promise=new Promise<Response>(done=>{resolve=done;});return {promise,resolve};}

it('locks repeated actions immediately but never flashes loading for quick work',async()=>{
 const store=useSession(),pending=deferred(),next=vi.fn();
 const running=store.run(()=>pending.promise);
 expect(store.busy).toBe(true);expect(store.working).toBe(false);
 expect(await store.run(next)).toBe(false);expect(next).not.toHaveBeenCalled();
 pending.resolve({ok:true,data:store.data});expect(await running).toBe(true);
 await vi.advanceTimersByTimeAsync(activityDelayMs*2);
 expect(store.working).toBe(false);expect(store.busy).toBe(false);expect(vi.getTimerCount()).toBe(0);
});

it('waits through successive file choices and starts timing only during background processing',async()=>{
 const store=useSession(),pending=deferred(),running=store.run(()=>pending.promise);
 setNativeDialogOpen(true);await vi.advanceTimersByTimeAsync(5000);
 expect(store.busy).toBe(true);expect(store.working).toBe(false);
 setNativeDialogOpen(false);await vi.advanceTimersByTimeAsync(20);setNativeDialogOpen(true);
 await vi.advanceTimersByTimeAsync(5000);expect(store.working).toBe(false);
 setNativeDialogOpen(false);await vi.advanceTimersByTimeAsync(activityDelayMs-1);expect(store.working).toBe(false);
 await vi.advanceTimersByTimeAsync(1);expect(store.working).toBe(true);expect(store.task!.startedAt).toBe(Date.now());
 pending.resolve({ok:true,data:store.data});await running;expect(store.working).toBe(false);expect(vi.getTimerCount()).toBe(0);
});

it('a cancelled file choice stays quiet and releases the operation lock',async()=>{
 const store=useSession(),pending=deferred(),running=store.run(()=>pending.promise);
 const original=store.data;
 setNativeDialogOpen(true);await vi.advanceTimersByTimeAsync(5000);setNativeDialogOpen(false);
 pending.resolve({ok:true,cancelled:true,data:JSON.parse(JSON.stringify(store.data))});expect(await running).toBe(false);
 expect(store.data).toBe(original);
 await vi.advanceTimersByTimeAsync(500);expect(store.working).toBe(false);expect(store.busy).toBe(false);
 expect(store.taskOutcome).toBe('');expect(await store.run(async()=>({ok:true,data:store.data}))).toBe(true);
});

it('a later dialog immediately suspends active feedback and a failed request clears it',async()=>{
 const store=useSession(),pending=deferred(),running=store.run(()=>pending.promise);
 await vi.advanceTimersByTimeAsync(activityDelayMs);expect(store.working).toBe(true);
 setNativeDialogOpen(true);expect(store.working).toBe(false);
 setNativeDialogOpen(false);pending.resolve({ok:false,error:{code:'IO_ERROR',messageKey:'IO_ERROR'}});
 await running;await vi.advanceTimersByTimeAsync(500);expect(store.error).toBe('IO_ERROR');expect(store.working).toBe(false);
});

it('disposed local activities cannot publish late loading or retain timers',async()=>{
 const scope=effectScope(),active=ref(true),visible=scope.run(()=>useDelayedActivity(()=>active.value))!;
 expect(vi.getTimerCount()).toBe(1);scope.stop();expect(vi.getTimerCount()).toBe(0);
 await vi.advanceTimersByTimeAsync(500);expect(visible.value).toBe(false);
});
