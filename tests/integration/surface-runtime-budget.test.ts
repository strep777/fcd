import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {project} from '../fixtures';
import {parseObj} from '../../apps/desktop/main/surface';

const workers=vi.hoisted(()=>[] as {emit:(name:string,message:unknown)=>boolean;terminate:ReturnType<typeof vi.fn>}[]);
vi.mock('node:worker_threads',async()=>{
 const {EventEmitter}=await import('node:events');
 return {Worker:class extends EventEmitter{terminate=vi.fn(async()=>0);constructor(){super();workers.push(this);}}};
});
import {runCutPreview,runProjection} from '../../apps/desktop/main/surface-runtime';

beforeEach(()=>{vi.useFakeTimers();workers.length=0;});
afterEach(()=>{vi.useRealTimers();vi.restoreAllMocks();});
function preview(colorBoundaryCuts:boolean,controller=new AbortController(),partitionStrategy?:'design'|'mesh'){
 const p=project();p.surface=parseObj('v 0 0 0\nv 10 0 0\nv 0 10 0\nf 1 2 3');
 const result=runCutPreview('unused-worker',p.surface,p,{colorBoundaryCuts,partitionStrategy},'unused-assets',controller.signal).catch(error=>error.code);
 return {controller,result};
}
it('explicit mesh cutting retains its two-minute hard deadline',async()=>{
 const {result}=preview(false,new AbortController(),'mesh');await vi.advanceTimersByTimeAsync(120000);
 expect(await result).toBe('TIMEOUT');expect(workers[0].terminate).toHaveBeenCalledOnce();expect(vi.getTimerCount()).toBe(0);
});
it.each([undefined,'design'] as const)('uncolored %s design cutting remains live beyond two minutes with a finite deadline',async partitionStrategy=>{
 const kill=vi.spyOn(process,'kill').mockImplementation(()=>true),{result}=preview(false,new AbortController(),partitionStrategy);let settled=false;void result.then(()=>{settled=true;});
 workers[0].emit('message',{kind:'child',pid:123460});await vi.advanceTimersByTimeAsync(120001);
 expect(settled).toBe(false);expect(workers[0].terminate).not.toHaveBeenCalled();expect(kill).not.toHaveBeenCalled();
 await vi.advanceTimersByTimeAsync(600000-120001);expect(await result).toBe('TIMEOUT');expect(kill).toHaveBeenCalledWith(123460);expect(workers[0].terminate).toHaveBeenCalledOnce();expect(vi.getTimerCount()).toBe(0);
});
it('cancelling an uncolored default design cut beyond two minutes retains immediate child cleanup',async()=>{
 const kill=vi.spyOn(process,'kill').mockImplementation(()=>true),{result,controller}=preview(false);workers[0].emit('message',{kind:'child',pid:123461});
 await vi.advanceTimersByTimeAsync(121000);controller.abort();expect(await result).toBe('CANCELLED');expect(kill).toHaveBeenCalledWith(123461);expect(workers[0].terminate).toHaveBeenCalledOnce();expect(vi.getTimerCount()).toBe(0);
});
it('detailed color cutting can continue beyond the ordinary deadline and finish before its own bound',async()=>{
 const {result}=preview(true);let settled=false;void result.then(()=>{settled=true;});
 await vi.advanceTimersByTimeAsync(120001);expect(settled).toBe(false);expect(workers[0].terminate).not.toHaveBeenCalled();
 // A worker error proves the live message path settles the task, rather than a
 // prematurely resolved or orphaned promise surviving the old timer.
 workers[0].emit('message',{kind:'error',code:'COLOR_CUT_LIMIT'});expect(await result).toBe('COLOR_CUT_LIMIT');expect(vi.getTimerCount()).toBe(0);
});
it('the ten-minute color deadline still terminates the worker and its native children',async()=>{
 const kill=vi.spyOn(process,'kill').mockImplementation(()=>true),{result}=preview(true);
 workers[0].emit('message',{kind:'child',pid:123456});await vi.advanceTimersByTimeAsync(599999);expect(workers[0].terminate).not.toHaveBeenCalled();
 await vi.advanceTimersByTimeAsync(1);expect(await result).toBe('TIMEOUT');expect(kill).toHaveBeenCalledWith(123456);expect(workers[0].terminate).toHaveBeenCalledOnce();
 workers[0].emit('message',{kind:'child',pid:123457});expect(kill).toHaveBeenCalledWith(123457);expect(vi.getTimerCount()).toBe(0);
});
it('cancelling a long color cut rejects immediately, kills children and ignores late results',async()=>{
 const kill=vi.spyOn(process,'kill').mockImplementation(()=>true),{result,controller}=preview(true);
 workers[0].emit('message',{kind:'child',pid:123458});await vi.advanceTimersByTimeAsync(121000);controller.abort();
 expect(await result).toBe('CANCELLED');expect(kill).toHaveBeenCalledWith(123458);expect(workers[0].terminate).toHaveBeenCalledOnce();
 workers[0].emit('message',{kind:'result',value:{}});expect(await result).toBe('CANCELLED');expect(vi.getTimerCount()).toBe(0);
});
it('an already cancelled cut creates no worker or timer',async()=>{
 const controller=new AbortController();controller.abort();expect(await preview(true,controller).result).toBe('CANCELLED');expect(workers).toHaveLength(0);expect(vi.getTimerCount()).toBe(0);
});
it('projection jobs keep their original deadline',async()=>{
 const result=runProjection('unused-worker',project(),'source','front',0,0,new AbortController().signal).catch(error=>error.code);
 await vi.advanceTimersByTimeAsync(120000);expect(await result).toBe('TIMEOUT');expect(workers[0].terminate).toHaveBeenCalledOnce();
});
