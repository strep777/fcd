import {beforeEach,expect,it,vi} from 'vitest';
import {randomUUID} from 'node:crypto';
import type {Marking,SurfaceMarkingEdit} from '../../packages/schema/index';
import {project} from '../fixtures';

const worker=vi.hoisted(()=>({data:{} as Record<string,unknown>,post:vi.fn(),edit:vi.fn()}));
vi.mock('node:worker_threads',async original=>({...await original<typeof import('node:worker_threads')>(),parentPort:{postMessage:worker.post},get workerData(){return worker.data;}}));
vi.mock('../../apps/desktop/main/surface-marking-edit',async original=>({...await original<typeof import('../../apps/desktop/main/surface-marking-edit')>(),editSurfaceMarking:worker.edit}));
beforeEach(()=>{vi.resetModules();worker.post.mockReset();worker.edit.mockReset();});
const edits=():SurfaceMarkingEdit[]=>[0,1].map(()=>({markingId:randomUUID(),shape:{origin:[0,0,0],axes:[[1,0,0],[0,1,0],[0,0,1]],nodes:[{xMm:0,yMm:0},{xMm:20,yMm:0},{xMm:0,yMm:20}]}}));

it('resolves edits sequentially in one worker against the same immutable project and publishes only the complete array',async()=>{
 const p=project(),input=edits(),before=structuredClone(p),results=input.map(edit=>({id:edit.markingId}) as Marking);let finishFirst!:(value:Marking)=>void;
 worker.data={kind:'surface-edit-many',workerPath:'native-worker',project:p,edits:input};worker.edit.mockImplementationOnce(()=>new Promise(resolve=>{finishFirst=resolve;})).mockResolvedValueOnce(results[1]);
 await import('../../apps/desktop/main/surface-worker');expect(worker.edit).toHaveBeenCalledTimes(1);expect(worker.post).not.toHaveBeenCalled();
 finishFirst(results[0]);await vi.waitFor(()=>expect(worker.post).toHaveBeenCalledWith({kind:'result',value:results}));expect(worker.edit).toHaveBeenCalledTimes(2);
 input.forEach((edit,index)=>{expect(worker.edit.mock.calls[index]).toEqual(['native-worker',p,edit.markingId,edit.shape]);expect(worker.edit.mock.calls[index][1]).toBe(p);});expect(p).toEqual(before);expect(worker.post).toHaveBeenCalledOnce();
});

it('a failure after one resolved edit publishes only an error and never emits its partial array',async()=>{
 const {DomainError}=await import('../../apps/desktop/main/repository'),p=project(),input=edits();worker.data={kind:'surface-edit-many',workerPath:'native-worker',project:p,edits:input};worker.edit.mockResolvedValueOnce({id:input[0].markingId}).mockRejectedValueOnce(new DomainError('NO_VISIBLE_PROJECTION'));
 await import('../../apps/desktop/main/surface-worker');await vi.waitFor(()=>expect(worker.post).toHaveBeenCalledWith({kind:'error',code:'NO_VISIBLE_PROJECTION'}));expect(worker.edit).toHaveBeenCalledTimes(2);expect(worker.post).toHaveBeenCalledOnce();
});
