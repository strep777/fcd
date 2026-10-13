import {expect,it} from 'vitest';
import {minimumSTCut,type CutArc} from '../../packages/reference/minimum-cut';

const energy=(arcs:CutArc[],side:ArrayLike<number>)=>arcs.reduce((sum,e)=>sum+(side[e.from]&&!side[e.to]?e.capacity:0),0);
function brute(nodes:number,arcs:CutArc[]){
 let best=Infinity;
 for(let bits=0;bits<2**(nodes-2);bits++){
  const side=Array.from({length:nodes},(_,i)=>i===0?1:i===nodes-1?0:(bits>>(i-1))&1);
  best=Math.min(best,energy(arcs,side));
 }
 return best;
}
function verify(nodes:number,arcs:CutArc[]){
 const unchanged=structuredClone(arcs),result=minimumSTCut(nodes,arcs,0,nodes-1,1_000_000);
 if(!result.side)throw Error('Small graph unexpectedly exhausted its budget');
 expect(result.converged).toBe(true);
 expect(result.side[0]).toBe(1);expect(result.side[nodes-1]).toBe(0);
 expect(energy(arcs,result.side)).toBe(brute(nodes,arcs));
 expect(arcs).toEqual(unchanged);
}
it('finds the independent exhaustive minimum for all four-node directed graphs',()=>{
 const pairs:number[][]=[];for(let from=0;from<4;from++)for(let to=0;to<4;to++)if(from!==to)pairs.push([from,to]);
 for(let bits=0;bits<2**pairs.length;bits++)verify(4,pairs.flatMap(([from,to],i)=>bits&(1<<i)?[{from,to,capacity:1}]:[]));
});
it('matches exhaustive cuts with fractional capacities, parallel arcs, self loops and disconnected nodes',()=>{
 let seed=472894;const random=()=>{seed=(1664525*seed+1013904223)>>>0;return seed/2**32;};
 for(let sample=0;sample<400;sample++){
  const nodes=3+Math.floor(random()*6),arcs:CutArc[]=[];
  for(let from=0;from<nodes;from++)for(let to=0;to<nodes;to++)if(random()<.4){arcs.push({from,to,capacity:Math.floor(random()*128)/16});if(random()<.2)arcs.push({from,to,capacity:Math.floor(random()*32)/16});}
  verify(nodes,arcs);
 }
});
it('retains hard material seeds and returns no partially solved ownership when its budget is exhausted',()=>{
 const arcs=[{from:0,to:1,capacity:1e8},{from:1,to:2,capacity:3},{from:2,to:1,capacity:3},{from:2,to:3,capacity:1e8}],original=structuredClone(arcs);
 const solved=minimumSTCut(4,arcs,0,3,10_000);
 expect(Array.from(solved.side!)).toEqual([1,1,0,0]);
 for(const limit of [0,1,5,10]){
  const result=minimumSTCut(4,arcs,0,3,limit);
  expect(result).toEqual({side:null,operations:limit,converged:false});
 }
 expect(arcs).toEqual(original);
});
it('solves a long material path without recursive stack growth',()=>{
 const nodes=50_000,arcs=Array.from({length:nodes-1},(_,i)=>({from:i,to:i+1,capacity:i===25_000?1:2}));
 const result=minimumSTCut(nodes,arcs,0,nodes-1,1_000_000);
 expect(result.converged).toBe(true);expect(result.side).not.toBeNull();
 expect(energy(arcs,result.side!)).toBe(1);
 expect(result.side![25_000]).toBe(1);expect(result.side![25_001]).toBe(0);
});
it('rejects invalid graph endpoints and capacities',()=>{
 for(const arcs of [[{from:-1,to:1,capacity:1}],[{from:0,to:4,capacity:1}],[{from:0,to:1,capacity:NaN}],[{from:0,to:1,capacity:-1}],[{from:0,to:1,capacity:Infinity}]])expect(()=>minimumSTCut(4,arcs,0,3,100)).toThrow('INVALID_GRAPH');
 expect(()=>minimumSTCut(4,[],0,0,100)).toThrow('INVALID_GRAPH');
 expect(()=>minimumSTCut(4,[],0,3,-1)).toThrow('INVALID_GRAPH');
});
