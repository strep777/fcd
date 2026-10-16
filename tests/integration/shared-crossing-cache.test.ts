// Intended destination: tests/integration/shared-crossing-cache.test.ts.
// Private pair/cache contract only; these fixtures are not complete CAD
// networks. Public shared ownership/fallback has its own integration suites.
import {beforeAll,expect,it} from 'vitest';
import {formalCrossingFactory,type ProbeChain} from '../fixtures/private-recovery-access';
import {contourPolyline} from '../../packages/reference/recover-contour';
import type {Point} from '../../packages/schema/index';
const p=(xMm:number,yMm:number,id='p'):Point=>({id,xMm,yMm});
const chain=(xy:number[][],closed=false,anchors:string[]=[]):ProbeChain=>{const nodes=xy.map(([x,y],i)=>p(x,y,'n'+i));return{raw:nodes,nodes,curves:[],closed,anchors};};
let factory:Awaited<ReturnType<typeof formalCrossingFactory>>['factory'];
beforeAll(async()=>{({factory}=await formalCrossingFactory());});

// Independent exhaustive box-pair oracle: no global/local tree, cache or
// production crossing/pair generator supplies expected ordinal hits.
function expectedPairs(chains:ProbeChain[],changed:Set<number>,previousClean:boolean,g=1){
 const boxes:{chain:number;loX:number;loY:number;hiX:number;hiY:number}[]=[],epsilon=g*1e-8;
 for(const [owner,c]of chains.entries()){
  const flat=contourPolyline(c.nodes,c.curves,c.closed,Math.min(.001,g*.005),()=> 'oracle');
  for(let i=0;i<flat.length-(c.closed?0:1);i++){const a=flat[i],b=flat[(i+1)%flat.length];boxes.push({chain:owner,loX:Math.min(a.xMm,b.xMm)-epsilon,loY:Math.min(a.yMm,b.yMm)-epsilon,hiX:Math.max(a.xMm,b.xMm)+epsilon,hiY:Math.max(a.yMm,b.yMm)+epsilon});}
 }
 const result:number[]=[];for(let i=0;i<boxes.length;i++)for(let j=0;j<i;j++){
  const a=boxes[i],b=boxes[j];if(previousClean&&!changed.has(a.chain)&&!changed.has(b.chain))continue;
  if(a.loX<=b.hiX&&b.loX<=a.hiX&&a.loY<=b.hiY&&b.loY<=a.hiY)result.push(i,j);
 }return result;
}
function sequence(chains:ProbeChain[],steps:((chains:ProbeChain[])=>void)[]){
 let actual:number[]=[],previous:{nodes:Point[];curves:ProbeChain['curves']}[]|undefined,clean=false;
 const probe=factory(chains,()=> 'flatten',1,(i,j)=>actual.push(i,j),()=>{throw Error('SMALL_FIXTURE_UNEXPECTED_OVERFLOW');});
 for(const step of steps){step(chains);const changed=new Set(chains.flatMap((c,i)=>!previous||c.nodes!==previous[i].nodes||c.curves!==previous[i].curves?[i]:[])),expected=expectedPairs(chains,changed,clean),before=structuredClone(chains);actual=[];
  const bad=probe.check();expect(actual.length).toBe(expected.length);for(let i=0;i<expected.length;i++)if(!Object.is(actual[i],expected[i]))throw Error('EXACT_PAIR_ORDER_AT_'+i);
  expect(chains).toStrictEqual(before);previous=chains.map(c=>({nodes:c.nodes,curves:c.curves}));clean=bad.size===0;
 }
 return probe;
}
const noop=()=>{};
it('updates global offsets after length changes and does not reuse a clean result across a crossing or rollback',()=>{
 const chains=[chain([[20,20],[22,20]]),chain([[-5,0],[5,0]]),chain([[-5,5],[5,5]])],saved=chains[2].nodes;
 const probe=sequence(chains,[noop,c=>{c[0].nodes=[p(20,20),p(21,20),p(22,20),p(23,20)];},c=>{c[2].nodes=[p(0,-5),p(0,5)];},noop,c=>{c[2].nodes=saved;},noop]);
 expect(probe.check().size).toBe(0);
});
it('invalidates a ring when only cubic controls change and retains closed-edge pair checks',()=>{
 const curved=[chain([[-4,0],[4,0]]),chain([[-4,2],[4,2]])];
 const probe=sequence(curved,[noop,c=>{c[0].curves=[{id:'bow',startNodeId:'n0',endNodeId:'n1',c1:p(-4,4,'a'),c2:p(4,4,'b')}];}]);
 expect([...probe.check().keys()].sort((a,b)=>a-b)).toEqual([0,1]);
 const loop=[chain([[0,0],[4,0],[4,4],[0,4]],true)];
 const closed=sequence(loop,[noop,c=>{c[0].nodes=[p(0,0),p(4,4),p(0,4),p(4,0)];},noop]);expect([...closed.check().keys()]).toEqual([0]);
});
it('keeps empty groups and unchanged-ring metadata from corrupting unrelated local trees',()=>{
 const seed=[chain([]),chain([[0,0],[5,0]],false,['0:0']),chain([[0,0],[0,5]],false,['0:0'])];
 const probe=sequence(seed,[noop,noop,c=>{c[1].raster={nodes:[...c[1].nodes],curves:[]};},c=>{c[1].raster=undefined;}]);expect(probe.check().size).toBe(0);
});
it('preserves exact full traversal after the million relevant-pair budget overflows',()=>{
 //1,420 choose2=1,007,490. These rays have one genuine common endpoint.
 // Their boxes all overlap; expected full pair order is analytic i,j with
 // i increasing and j=0..i-1, independently of any spatial tree.
 const chains=Array.from({length:1420},(_,i)=>chain([[0,0],[100,1+i/20]],false,['0:0']));
 let outer=1,inner=0,count=0,overflow=0;
 const probe=factory(chains,()=>'',1,(i,j)=>{if(!Object.is(i,outer)||!Object.is(j,inner))throw Error('FULL_PAIR_ORDER_AT_'+count);count++;if(++inner===outer){outer++;inner=0;}},()=>{overflow++;});
 const check=()=>{outer=1;inner=0;count=0;overflow=0;const before=structuredClone(chains),bad=probe.check();expect(bad.size).toBe(0);expect(chains).toStrictEqual(before);};
 check();expect(count).toBe(1007490);expect(overflow).toBe(0);
 for(const c of chains)c.nodes=c.nodes.map(n=>({...n}));
 check();expect(count).toBe(1007490);expect(overflow).toBe(1);
 count=0;expect(probe.check().size).toBe(0);expect(count).toBe(0);
});
