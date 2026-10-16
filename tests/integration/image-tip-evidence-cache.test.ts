import {expect,it} from 'vitest';
import {sourceEvidenceCache} from '../../packages/reference/image-tip-evidence-cache';

// Observable pure-measurement contracts; source-image suites independently
// verify that the inference code reports every RGB/alpha pixel it reads.
it('invalidates an observed pixel on any RGB or alpha byte while preserving RGBA',()=>{
 for(const channel of [0,1,2,3]){
  const cache=sourceEvidenceCache<number>(),rgba=new Uint8Array([20,30,40,255]);let calls=0;
  const run=()=>cache(rgba,'ordered-geometry',observe=>{calls++;observe(0);return rgba[0];});
  run();run();expect(calls).toBe(1);rgba[channel]^=1;const before=rgba.slice();run();run();expect(calls).toBe(2);expect(rgba).toEqual(before);
 }
});

it('keeps unobserved changes cached and separates distinct image objects',()=>{
 const cache=sourceEvidenceCache<number>(),rgba=new Uint8Array([20,30,40,255,1,2,3,255]);let calls=0;
 const run=(image:Uint8Array)=>cache(image,'geometry',observe=>{calls++;observe(0);return image[0];});
 expect(run(rgba)).toBe(20);rgba[4]=90;expect(run(rgba)).toBe(20);expect(calls).toBe(1);
 expect(run(rgba.slice())).toBe(20);expect(calls).toBe(2);
});

it('isolates original and cache-hit nested return values from later edits',()=>{
 const cache=sourceEvidenceCache<{source:{xMm:number}[];params:number[]}>(),rgba=new Uint8Array(4);let calls=0;
 const original={source:[{xMm:2}],params:[3,4]},run=()=>cache(rgba,'geometry',observe=>{calls++;observe(0);return original;});
 const first=run();first.source[0].xMm=99;first.params.push(9);
 const hit=run();expect(hit).toEqual({source:[{xMm:2}],params:[3,4]});hit.params[0]=100;
 expect(run()).toEqual({source:[{xMm:2}],params:[3,4]});expect(calls).toBe(1);
});

it('propagates a measurement failure without retaining partial evidence',()=>{
 const cache=sourceEvidenceCache<number>(),rgba=new Uint8Array(4);let calls=0;
 const fail=()=>cache(rgba,'geometry',observe=>{calls++;observe(0);throw Error('measurement failed');});
 expect(fail).toThrow('measurement failed');expect(fail).toThrow('measurement failed');
 expect(cache(rgba,'geometry',()=>{calls++;return 42;})).toBe(42);expect(calls).toBe(3);
});

it('counts distinct observed pixels, safely declining tracking beyond its byte budget',()=>{
 for(const count of [32,33]){
  const cache=sourceEvidenceCache<number>(8,1024),rgba=new Uint8Array(33*4);let calls=0;
  const run=()=>cache(rgba,'key',observe=>{calls++;for(let i=0;i<count;i++)for(let j=0;j<3;j++)observe(i);return 7;});
  expect(run()).toBe(7);expect(run()).toBe(7);expect(calls).toBe(count===32?1:2);
 }
});

it('promotes a hit and evicts the least recently used of eight entries',()=>{
 const cache=sourceEvidenceCache<string>(),rgba=new Uint8Array(4),calls=new Map<string,number>();
 const run=(key:string)=>cache(rgba,key,()=>{calls.set(key,(calls.get(key)??0)+1);return key;});
 for(let i=0;i<8;i++)run(String(i));run('0');run('8');run('0');expect(calls.get('0')).toBe(1);run('1');expect(calls.get('1')).toBe(2);
});

it('returns an oversized plain result without caching or changing it',()=>{
 const cache=sourceEvidenceCache<string>(8,1024),rgba=new Uint8Array(4);let calls=0;
 const run=()=>cache(rgba,'key',()=>{calls++;return 'x'.repeat(1200);});
 expect(run()).toBe('x'.repeat(1200));expect(run()).toBe('x'.repeat(1200));expect(calls).toBe(2);
});
