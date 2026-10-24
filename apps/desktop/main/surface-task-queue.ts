import type {Request} from '../../../packages/schema/index';

import {isCancellableSurfaceRequest} from '../../../packages/schema/cancellable-methods';
type PendingTask={projectId:string;revision:number;requestId:string;cancelled:boolean};

/** Register before waiting on the mutation queue, so cancellation also owns
 * work that has not created its worker/controller yet. */
export class SurfaceTaskQueue {
 private readonly pending=new Set<PendingTask>();
 private readonly earlyCancellations=new Set<string>();
 private key(projectId:string,revision:number,requestId:string){return `${projectId}:${revision}:${requestId}`;}
 track(request:Request){
  if(!isCancellableSurfaceRequest(request.method,request.payload)||!('projectId' in request))return;
  const key=this.key(request.projectId,request.expectedRevision,request.requestId);
  const task={projectId:request.projectId,revision:request.expectedRevision,requestId:request.requestId,cancelled:this.earlyCancellations.delete(key)};this.pending.add(task);return task;
 }
 cancel(projectId:string,revision:number,targetRequestIds?:string[]){
  const targets=targetRequestIds===undefined?undefined:new Set(targetRequestIds);
  for(const task of this.pending)if(task.projectId===projectId&&task.revision===revision&&(!targets||targets.has(task.requestId))){task.cancelled=true;targets?.delete(task.requestId);}
  // A small cancel IPC can overtake a large image request. Retain its exact IDs,
  // never a project-wide flag that would also cancel a subsequent retry.
  for(const requestId of targets??[])this.earlyCancellations.add(this.key(projectId,revision,requestId));
  while(this.earlyCancellations.size>4096)this.earlyCancellations.delete(this.earlyCancellations.values().next().value!);
 }
 release(task:PendingTask|undefined){if(task)this.pending.delete(task);}
}
