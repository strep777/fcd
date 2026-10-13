import {vi} from 'vitest';

/** Explicit frames keep gesture tests faithful to browser batching and allow
 * cancellation and pointer-release ordering to be asserted deterministically. */
export function stubAnimationFrames(){
 let nextId=1;
 const pending=new Map<number,FrameRequestCallback>();
 vi.stubGlobal('requestAnimationFrame',(callback:FrameRequestCallback)=>{const id=nextId++;pending.set(id,callback);return id;});
 vi.stubGlobal('cancelAnimationFrame',(id:number)=>pending.delete(id));
 return {
  get pending(){return pending.size;},
  flush(){const frame=[...pending];pending.clear();for(const [,callback] of frame)callback(performance.now());}
 };
}
