import {expect,it} from 'vitest';
import {randomUUID} from 'node:crypto';
import type {Request} from '../../packages/schema/index';
import {requestSchema} from '../../packages/schema/index';
import {SurfaceTaskQueue} from '../../apps/desktop/main/surface-task-queue';

const projectId=randomUUID();
const cut=(revision=4,id=projectId):Extract<Request,{method:'surface.unwrap'}>=>({protocolVersion:1,requestId:randomUUID(),method:'surface.unwrap',projectId:id,expectedRevision:revision,payload:{}});

it('cancels a global spacing update arriving late without treating ordinary edits as surface work',()=>{
 const tasks=new SurfaceTaskQueue(),request:Request={...cut(),method:'command.apply',payload:{type:'patterns.allowance',widthMm:7}};
 tasks.cancel(projectId,4,[request.requestId]);const task=tasks.track(request)!;expect(task.cancelled).toBe(true);tasks.release(task);
 expect(tasks.track({...request,requestId:randomUUID()})!.cancelled).toBe(false);
 expect(tasks.track({...request,payload:{type:'project.rename',name:'Renamed'}})).toBeUndefined();
});

it('owns a batch transform round before its worker starts and targets cancellation without affecting a retry',()=>{
 const tasks=new SurfaceTaskQueue(),request:Extract<Request,{method:'marking.surface.editMany'}>={...cut(),method:'marking.surface.editMany',payload:{edits:[{markingId:randomUUID(),shape:{origin:[0,0,0],axes:[[1,0,0],[0,1,0],[0,0,1]],nodes:[{xMm:0,yMm:0},{xMm:10,yMm:0},{xMm:0,yMm:10}]}}]}};
 tasks.cancel(projectId,4,[request.requestId]);const pending=tasks.track(request)!;expect(pending.cancelled).toBe(true);tasks.release(pending);
 const retry=tasks.track({...request,requestId:randomUUID()})!;expect(retry.cancelled).toBe(false);tasks.release(retry);
});

it.each([{name:'legacy omitted targets',payload:{}},{name:'explicit empty targets',payload:{targetRequestIds:[]}},{name:'explicit UUID targets',payload:{targetRequestIds:[randomUUID()]}}])('preserves the $name cancellation contract without changing its meaning',({payload})=>{
 const request={...cut(),method:'surface.cancel',payload};expect(requestSchema.parse(request)).toEqual(request);
});

it('cancellation reaches matching work registered before its worker starts and does not poison a retry',async()=>{
 const tasks=new SurfaceTaskQueue(),pending=tasks.track(cut())!;let started=false;
 const queued=Promise.resolve().then(()=>{if(pending.cancelled)return 'CANCELLED';started=true;return 'COMMITTED';}).finally(()=>tasks.release(pending));
 tasks.cancel(projectId,4);expect(await queued).toBe('CANCELLED');expect(started).toBe(false);
 const retry=tasks.track(cut())!;expect(retry.cancelled).toBe(false);tasks.release(retry);
});

it('cancels only the requested project revision, including queued color selections',()=>{
 const tasks=new SurfaceTaskQueue(),matching=tasks.track(cut())!,newer=tasks.track(cut(5))!,other=tasks.track(cut(4,randomUUID()))!;
 const selection=tasks.track({...cut(),method:'reference.segment',payload:{referenceId:randomUUID(),seed:{x:1,y:1},tolerance:20}})!;
 tasks.cancel(projectId,4);expect(matching.cancelled).toBe(true);expect(selection.cancelled).toBe(true);expect(newer.cancelled).toBe(false);expect(other.cancelled).toBe(false);
 tasks.release(matching);tasks.release(selection);tasks.release(newer);tasks.release(other);
});

it('ordinary reads and acceptance never become cancellable surface work',()=>{
 const tasks=new SurfaceTaskQueue();
 expect(tasks.track({protocolVersion:1,requestId:randomUUID(),method:'session.read',payload:{}})).toBeUndefined();
 expect(tasks.track({...cut(),method:'surface.accept',payload:{acknowledgeReview:true}})).toBeUndefined();
});

it('remembers an explicitly targeted cancellation before mask registration and never starts or commits that task',async()=>{
 const tasks=new SurfaceTaskQueue(),request={...cut(),method:'reference.mask' as const,payload:{referenceId:randomUUID(),sourceHash:'a'.repeat(64),mask:{width:1,height:1,pixels:'1'},color:'#abcdef'}};
 tasks.cancel(projectId,4,[request.requestId]);
 const pending=tasks.track(request)!;expect(pending.requestId).toBe(request.requestId);expect(pending.cancelled).toBe(true);
 let started=false,committed=false;
 const result=await Promise.resolve().then(()=>{if(pending.cancelled)return 'CANCELLED';started=true;committed=true;return 'COMMITTED';}).finally(()=>tasks.release(pending));
 expect(result).toBe('CANCELLED');expect(started).toBe(false);expect(committed).toBe(false);
 const retry=tasks.track(cut())!;expect(retry.cancelled).toBe(false);tasks.release(retry);
});

it('explicit cancellation selects only named pending IDs and a same-revision new-ID retry stays usable',()=>{
 const tasks=new SurfaceTaskQueue(),request=cut(),target=tasks.track(request)!,unrelated=tasks.track(cut())!;
 tasks.cancel(projectId,4,[request.requestId]);expect(target.cancelled).toBe(true);expect(unrelated.cancelled).toBe(false);
 tasks.release(target);const retry=tasks.track(cut())!;expect(retry.requestId).not.toBe(target.requestId);expect(retry.cancelled).toBe(false);
 tasks.release(unrelated);tasks.release(retry);
});

it('a cancellation arriving first is scoped to both project and revision even when an ID is reused elsewhere',()=>{
 const tasks=new SurfaceTaskQueue(),request=cut(),otherProject=randomUUID();tasks.cancel(projectId,4,[request.requestId]);
 const other=tasks.track({...request,projectId:otherProject})!,newer=tasks.track({...request,expectedRevision:5})!,target=tasks.track(request)!;
 expect(other.cancelled).toBe(false);expect(newer.cancelled).toBe(false);expect(target.cancelled).toBe(true);
 tasks.release(other);tasks.release(newer);tasks.release(target);
});

it('explicit IDs also preserve other projects and revisions when every task is already registered',()=>{
 const tasks=new SurfaceTaskQueue(),request=cut(),target=tasks.track(request)!,other=tasks.track({...request,projectId:randomUUID()})!,newer=tasks.track({...request,expectedRevision:5})!;
 tasks.cancel(projectId,4,[request.requestId]);expect(target.cancelled).toBe(true);expect(other.cancelled).toBe(false);expect(newer.cancelled).toBe(false);
 tasks.release(target);tasks.release(other);tasks.release(newer);
});

it('an explicit empty target list cancels neither current work nor work arriving afterward',()=>{
 const tasks=new SurfaceTaskQueue(),current=tasks.track(cut())!;tasks.cancel(projectId,4,[]);
 expect(current.cancelled).toBe(false);const later=tasks.track(cut())!;expect(later.cancelled).toBe(false);tasks.release(current);tasks.release(later);
});

it('legacy cancellation without targets still cancels all matching registered tasks without cancelling a later retry',()=>{
 const tasks=new SurfaceTaskQueue(),first=tasks.track(cut())!,second=tasks.track(cut())!;tasks.cancel(projectId,4);
 expect(first.cancelled).toBe(true);expect(second.cancelled).toBe(true);tasks.release(first);tasks.release(second);
 const retry=tasks.track(cut())!;expect(retry.cancelled).toBe(false);tasks.release(retry);
});

it('legacy cancellation before any task arrives does not invent a target for the next same-revision request',()=>{
 const tasks=new SurfaceTaskQueue();tasks.cancel(projectId,4);const next=tasks.track(cut())!;expect(next.cancelled).toBe(false);tasks.release(next);
});
