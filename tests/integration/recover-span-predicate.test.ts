// Intended destination: tests/integration/recover-span-predicate.test.ts.
// Private acceptance predicate correctness only. Public recovery is covered
// separately by image-contour and shared-contour-local-fallback suites.
import {afterAll,beforeAll,expect,it} from 'vitest';
import {formalSpanPredicates} from '../fixtures/private-recovery-access';
import type {Point} from '../../packages/schema/index';
const p=(xMm:number,yMm:number):Point=>({id:'',xMm,yMm});
let api:Awaited<ReturnType<typeof formalSpanPredicates>>,comparisons=0;
beforeAll(async()=>{api=await formalSpanPredicates();});
afterAll(()=>console.info(`recovery span predicate: ${comparisons} exact boolean comparisons`));
// Exhaustive original j/count grid, no adaptive intervals, spatial index,
// production metric or copied fitting/model logic supplies the expectation.
function exhaustive(a:Point[],b:Point[],spacing:number):number{
 const directed=(from:Point[],to:Point[])=>{let maximum=0;for(let i=0;i+1<from.length;i++){
  const u=from[i],v=from[i+1],count=Math.max(1,Math.ceil(Math.hypot(v.xMm-u.xMm,v.yMm-u.yMm)/spacing));
  if(Number.isFinite(count)&&count>10000)throw Error('TEST_FIXTURE_GRID_TOO_LARGE');
  for(let j=0;j<=count;j++){const t=j/count,q=p(u.xMm+(v.xMm-u.xMm)*t,u.yMm+(v.yMm-u.yMm)*t);let nearest=Infinity;
   for(let k=0;k+1<to.length;k++){const c=to[k],d=to[k+1],dx=d.xMm-c.xMm,dy=d.yMm-c.yMm,square=dx*dx+dy*dy,f=square?Math.max(0,Math.min(1,((q.xMm-c.xMm)*dx+(q.yMm-c.yMm)*dy)/square)):0;nearest=Math.min(nearest,Math.hypot(q.xMm-c.xMm-f*dx,q.yMm-c.yMm-f*dy));}
   maximum=Math.max(maximum,nearest);
  }
 }return maximum;};return Math.max(directed(a,b),directed(b,a));
}
function check(a:Point[],b:Point[],pixel=1,spacing=.1,margin=.06,limit=1.05){
 const before=structuredClone([a,b]),actual=api.spansWithin(a,b,pixel,spacing,margin,limit),numeric=Math.max(api.spanError(a,b,pixel,spacing),api.spanError(b,a,pixel,spacing))+margin<=limit;
 expect(Object.is(actual,numeric)).toBe(true);comparisons++;
 expect(Object.is(actual,exhaustive(a,b,spacing)+margin<=limit)).toBe(true);comparisons++;
 expect([a,b]).toStrictEqual(before);
}
function next(x:number,direction:1|-1){const bits=new BigUint64Array(1),value=new Float64Array(bits.buffer);value[0]=x;bits[0]+=BigInt(direction);return value[0];}
it('cannot skip an interior peak or a narrow spike merely because both ends pass',()=>{
 check([p(0,0),p(10,0)],[p(0,0),p(0,2),p(10,2),p(10,0)],1,.03);
 for(const x of [.249,.501])for(const height of [.98,1.01])check([p(0,0),p(1,0)],[p(0,0),p(x-.00001,0),p(x,height),p(x+.00001,0),p(1,0)],1,.01);
});
it('preserves the exact <= boundary at adjacent floating-point offsets',()=>{
 for(const margin of [.05,.06]){const threshold=1.05-margin;for(const y of [next(threshold,-1),threshold,next(threshold,1)])check([p(0,0),p(4,0)],[p(0,y),p(4,y)],1,.1,margin);}
});
it('agrees across the short/indexed cutoff, calibration transforms and closed endpoints',()=>{
 for(const count of [16,17])for(const scale of [.05,1,10]){
  const angle=.37,shift=123,world=(q:Point)=>p(shift+scale*(q.xMm*Math.cos(angle)-q.yMm*Math.sin(angle)),-shift+scale*(q.xMm*Math.sin(angle)+q.yMm*Math.cos(angle)));
  const a=Array.from({length:count},(_,i)=>p(i*.3,Math.sin(i*.2)*.1)),b=a.map(q=>p(q.xMm,q.yMm+.4));check(a.map(world),b.map(world),scale,scale*.1,scale*.06,scale*1.05);
 }
 const a=[p(0,0),p(4,0),p(4,4),p(0,4),p(0,0)],b=a.map(q=>p(q.xMm+.2,q.yMm));check(a,b);
});
it('retains empty/degenerate and terminating nonfinite or overflow fallback decisions',()=>{
 for(const a of [[],[p(0,0)],[p(0,0),p(0,0)]])for(const b of [[],[p(0,0)],[p(0,0),p(1,0)]])check(a,b);
 for(const x of [NaN,Infinity])check([p(x,0),p(x,1)],[p(0,0),p(1,0)]);
 check([p(0,0),p(1e200,0)],[p(0,1e199),p(1e200,1e199)],1e200,1e200,0,1.05e200);
 for(const limit of [NaN,Infinity,-Infinity])check([p(0,0),p(1,0)],[p(0,.4),p(1,.4)],1,.1,.06,limit);
 // Do not call the inherited unbounded old grid with spacing0 and a
 // positive-length edge. This test does not invent a new resource contract.
});
