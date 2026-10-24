import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {project} from '../fixtures';
import {acceptedCutProject} from '../fixtures/accepted-cut';
import {parseObj} from '../../apps/desktop/main/surface';

const workers=vi.hoisted(()=>[] as {emit:(name:string,message:unknown)=>boolean;terminate:ReturnType<typeof vi.fn>}[]);
vi.mock('node:worker_threads',async()=>{
 const {EventEmitter}=await import('node:events');
 return {Worker:class extends EventEmitter{terminate=vi.fn(async()=>0);constructor(){super();workers.push(this);}}};
});
import {runCutPreview,runProjection,cutPreviewTimeout} from '../../apps/desktop/main/surface-runtime';

beforeEach(()=>{vi.useFakeTimers();workers.length=0;});
afterEach(()=>{vi.useRealTimers();vi.restoreAllMocks();});
function preview(colorBoundaryCuts:boolean,controller=new AbortController(),partitionStrategy?:'design'|'mesh'){
 const p=project();p.surface=parseObj('v 0 0 0\nv 10 0 0\nv 0 10 0\nf 1 2 3');
 const result=runCutPreview('unused-worker',p.surface,p,{colorBoundaryCuts,partitionStrategy},'unused-assets',controller.signal).catch(error=>error.code);
 return {p,controller,result};
}
it.each([
 {color:false,strategy:undefined},{color:false,strategy:'design' as const},
 {color:true,strategy:'design' as const},{color:false,strategy:'mesh' as const},{color:true,strategy:'mesh' as const}
])('small cuts retain a 60-second deadline, including color=$color strategy=$strategy',async({color,strategy})=>{
 const kill=vi.spyOn(process,'kill').mockImplementation((_pid,signal)=>{if(signal===0)throw Object.assign(Error('exited'),{code:'ESRCH'});return true;}),{result,p}=preview(color,new AbortController(),strategy),before=structuredClone(p);
 workers[0].emit('message',{kind:'child',pid:123456});await vi.advanceTimersByTimeAsync(59999);expect(workers[0].terminate).not.toHaveBeenCalled();
 await vi.advanceTimersByTimeAsync(1);expect(await result).toBe('TIMEOUT');expect(kill).toHaveBeenCalledWith(123456);expect(workers[0].terminate).toHaveBeenCalledOnce();expect(p).toEqual(before);
 workers[0].emit('message',{kind:'child',pid:123457});expect(kill).toHaveBeenCalledWith(123457);
 workers[0].emit('message',{kind:'result',value:{run:acceptedCutProject().surfaceRun,markings:[]}});expect(await result).toBe('TIMEOUT');expect(vi.getTimerCount()).toBe(0);
});
it('a complete validated candidate can finish before the deadline and clears the timeout',async()=>{
 const {result}=preview(true),run=acceptedCutProject().surfaceRun;await vi.advanceTimersByTimeAsync(59000);
 workers[0].emit('message',{kind:'result',value:{run,markings:[]}});expect(await result).toEqual({run,markings:[]});expect(vi.getTimerCount()).toBe(0);expect(workers[0].terminate).toHaveBeenCalledOnce();
});
it.each([false,true])('cancellation before the deadline immediately cleans up a color=%s cut and drops late results',async color=>{
 const kill=vi.spyOn(process,'kill').mockImplementation((_pid,signal)=>{if(signal===0)throw Object.assign(Error('exited'),{code:'ESRCH'});return true;}),{result,controller,p}=preview(color),before=structuredClone(p);
 workers[0].emit('message',{kind:'child',pid:123458});await vi.advanceTimersByTimeAsync(59000);controller.abort();
 expect(await result).toBe('CANCELLED');expect(kill).toHaveBeenCalledWith(123458);expect(workers[0].terminate).toHaveBeenCalledOnce();
 workers[0].emit('message',{kind:'result',value:{}});expect(await result).toBe('CANCELLED');expect(p).toEqual(before);expect(vi.getTimerCount()).toBe(0);
});
it('an already cancelled cut creates no worker or timer',async()=>{
 const controller=new AbortController();controller.abort();expect(await preview(true,controller).result).toBe('CANCELLED');expect(workers).toHaveLength(0);expect(vi.getTimerCount()).toBe(0);
});
it('projection jobs keep their original deadline',async()=>{
 const result=runProjection('unused-worker',project(),'source','front',0,0,new AbortController().signal).catch(error=>error.code);
 await vi.advanceTimersByTimeAsync(120000);expect(await result).toBe('TIMEOUT');expect(workers[0].terminate).toHaveBeenCalledOnce();
});

it('complex color cuts can pass one minute but retain a bounded deadline and cancellation',async()=>{
 const p=acceptedCutProject(),marking={fragments:[{rings:[Array.from({length:4000},()=>[1,0,0])]}]};p.markings=[marking] as unknown as NonNullable<typeof p.markings>;
 const options={colorBoundaryCuts:true},budget=cutPreviewTimeout(p,options);expect(budget).toBe(80000);
 const result=runCutPreview('unused',p.surface!,p,options,'unused',new AbortController().signal).catch(e=>e.code);
 await vi.advanceTimersByTimeAsync(60000);expect(workers[0].terminate).not.toHaveBeenCalled();await vi.advanceTimersByTimeAsync(20000);expect(await result).toBe('TIMEOUT');expect(workers[0].terminate).toHaveBeenCalledOnce();
 const controller=new AbortController(),cancelled=runCutPreview('unused',p.surface!,p,options,'unused',controller.signal).catch(e=>e.code);await vi.advanceTimersByTimeAsync(65000);controller.abort();expect(await cancelled).toBe('CANCELLED');expect(workers[1].terminate).toHaveBeenCalledOnce();
 p.markings=Array(100).fill(marking);expect(cutPreviewTimeout(p,options)).toBe(900000);expect(cutPreviewTimeout(p,{})).toBe(60000);expect(vi.getTimerCount()).toBe(0);
});
it('large lightly painted design cuts budget for the surface solver as well as pigment vertices',()=>{
 const p=project();p.surface=parseObj('v 0 0 0\nv 10 0 0\nv 0 10 0\nf 1 2 3');p.surface.faces=Array.from({length:8534},()=>p.surface!.faces[0]);
 expect(cutPreviewTimeout(p,{automaticCuts:true,partitionStrategy:'design',colorBoundaryCuts:true})).toBe(341360);
 expect(cutPreviewTimeout(p,{automaticCuts:false,partitionStrategy:'design'})).toBe(60000);
});
