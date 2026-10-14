import {beforeEach,afterEach,expect,it,vi} from 'vitest';
import {acceptedCutProject} from '../fixtures/accepted-cut';
import {surfaceProgressSchema,surfaceProgressStepSchema} from '../../packages/schema/index';
const workers=vi.hoisted(()=>[] as {emit:(name:string,value:unknown)=>boolean;terminate:ReturnType<typeof vi.fn>}[]);
vi.mock('node:worker_threads',async()=>{const {EventEmitter}=await import('node:events');return {Worker:class extends EventEmitter{terminate=vi.fn(async()=>0);constructor(){super();workers.push(this);}}};});
import {runCutPreview} from '../../apps/desktop/main/surface-runtime';
beforeEach(()=>{vi.useFakeTimers();workers.length=0;});
afterEach(()=>{vi.useRealTimers();vi.restoreAllMocks();});
function cut(onProgress=vi.fn(),controller=new AbortController()){
 const p=acceptedCutProject(),result=runCutPreview('unused',p.surface!,p,{partitionStrategy:'design'},'unused',controller.signal,onProgress);
 return {p,result,onProgress,controller};
}
it('strict progress envelopes accept only measured stages and valid project/revision counts',()=>{
 const p=acceptedCutProject(),step={stage:'partition',completed:3,total:8};
 expect(surfaceProgressStepSchema.safeParse(step).success).toBe(true);
 expect(surfaceProgressSchema.safeParse({...step,projectId:p.id,revision:p.revision}).success).toBe(true);
 for(const invalid of[{...step,stage:'done'},{...step,completed:9},{...step,completed:-1},{...step,total:2.5},{...step,percent:40}])expect(surfaceProgressStepSchema.safeParse(invalid).success).toBe(false);
 expect(surfaceProgressSchema.safeParse({...step,projectId:'another-window',revision:1}).success).toBe(false);
 expect(surfaceProgressSchema.safeParse({...step,projectId:p.id,revision:-1}).success).toBe(false);
});
it('progress does not settle or terminate a cut and the final result still completes it',async()=>{
 const {p,result,onProgress}=cut();let settled=false;void result.then(()=>{settled=true;});
 for(const value of[{stage:'prepare'},{stage:'unwrap',completed:2,total:4},{stage:'validate',completed:4,total:4}])workers[0].emit('message',{kind:'progress',value});
 await Promise.resolve();expect(settled).toBe(false);expect(onProgress).toHaveBeenCalledTimes(3);expect(workers[0].terminate).not.toHaveBeenCalled();
 workers[0].emit('message',{kind:'result',value:{run:p.surfaceRun,markings:[]}});
 expect(await result).toEqual({run:p.surfaceRun,markings:[]});expect(workers[0].terminate).toHaveBeenCalledOnce();expect(vi.getTimerCount()).toBe(0);
 workers[0].emit('message',{kind:'progress',value:{stage:'prepare'}});expect(onProgress).toHaveBeenCalledTimes(3);
});
it('malformed progress and observer errors cannot corrupt a running cut',async()=>{
 const {p,result}=cut(vi.fn(()=>{throw Error('observer failed');}));
 workers[0].emit('message',{kind:'progress',value:{stage:'unwrap',completed:8,total:4}});
 workers[0].emit('message',{kind:'progress',value:{stage:'partition'}});
 expect(workers[0].terminate).not.toHaveBeenCalled();workers[0].emit('message',{kind:'result',value:{run:p.surfaceRun,markings:[]}});expect(await result).toEqual({run:p.surfaceRun,markings:[]});
});
it('cancellation terminates once and drops late progress without resuming a task',async()=>{
 const {result,onProgress,controller}=cut(),rejected=result.catch(error=>error.code);
 workers[0].emit('message',{kind:'progress',value:{stage:'unwrap',completed:1,total:5}});controller.abort();expect(await rejected).toBe('CANCELLED');
 workers[0].emit('message',{kind:'progress',value:{stage:'unwrap',completed:5,total:5}});expect(onProgress).toHaveBeenCalledOnce();expect(workers[0].terminate).toHaveBeenCalledOnce();expect(vi.getTimerCount()).toBe(0);
});
it('same-stage bursts forward at most once per 200 ms, keeping received counts and immediate stage transitions',async()=>{
 let now=1000;vi.spyOn(performance,'now').mockImplementation(()=>now);
 const {p,result,onProgress}=cut(),send=(stage:string,completed:number,total=2000)=>workers[0].emit('message',{kind:'progress',value:{stage,completed,total}});
 send('unwrap',1);for(let i=2;i<=1314;i++)send('unwrap',i);expect(onProgress).toHaveBeenCalledTimes(1);expect(onProgress).toHaveBeenLastCalledWith({stage:'unwrap',completed:1,total:2000});
 now=1199;send('unwrap',1315);expect(onProgress).toHaveBeenCalledTimes(1);
 now=1200;send('unwrap',1316);expect(onProgress).toHaveBeenCalledTimes(2);expect(onProgress).toHaveBeenLastCalledWith({stage:'unwrap',completed:1316,total:2000});
 now=1201;send('remap',0,7);expect(onProgress).toHaveBeenCalledTimes(3);expect(onProgress).toHaveBeenLastCalledWith({stage:'remap',completed:0,total:7});
 send('remap',1,7);expect(onProgress).toHaveBeenCalledTimes(3);expect(vi.getTimerCount()).toBe(1);
 workers[0].emit('message',{kind:'result',value:{run:p.surfaceRun,markings:[]}});await result;expect(vi.getTimerCount()).toBe(0);
});
it('a cancelled worker cannot send a late stage into a replacement task and throttling is scoped per task',async()=>{
 vi.spyOn(performance,'now').mockReturnValue(1000);
 const callback=vi.fn(),old=cut(callback),oldResult=old.result.catch(error=>error.code);
 workers[0].emit('message',{kind:'progress',value:{stage:'unwrap',completed:1,total:8}});old.controller.abort();expect(await oldResult).toBe('CANCELLED');
 const next=cut(callback);workers[0].emit('message',{kind:'progress',value:{stage:'validate'}});expect(callback).toHaveBeenCalledOnce();
 workers[1].emit('message',{kind:'progress',value:{stage:'unwrap',completed:0,total:3}});expect(callback).toHaveBeenCalledTimes(2);expect(callback).toHaveBeenLastCalledWith({stage:'unwrap',completed:0,total:3});
 workers[1].emit('message',{kind:'result',value:{run:next.p.surfaceRun,markings:[]}});await next.result;
 workers[1].emit('message',{kind:'progress',value:{stage:'validate'}});expect(callback).toHaveBeenCalledTimes(2);expect(vi.getTimerCount()).toBe(0);
});
