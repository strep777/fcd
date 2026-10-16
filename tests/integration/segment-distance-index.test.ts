import {afterAll,expect,it} from 'vitest';
import {segmentDistanceIndex} from '../../packages/reference/segment-distance-index';

type XY={xMm:number;yMm:number};
type Query={point:XY;radius?:number};
const p=(xMm:number,yMm:number):XY=>({xMm,yMm});
let comparisons=0;
afterAll(()=>console.info(`segment-distance-index: ${comparisons} Object.is exhaustive-oracle comparisons`));

// Independent exhaustive oracle: visit every segment, with no index, seed,
// cache or bounding-distance shortcut. Retain the public per-segment arithmetic
// order because a squared-distance oracle would hide floating-point changes.
function scan(points:readonly XY[],closed:boolean,q:XY,radius=Infinity):number{
 let result=Infinity;
 for(let i=0;i<Math.max(0,points.length-(closed?0:1));i++){
  const a=points[i],b=points[(i+1)%points.length];
  if(!(q.xMm-radius<=Math.max(a.xMm,b.xMm)&&Math.min(a.xMm,b.xMm)<=q.xMm+radius&&q.yMm-radius<=Math.max(a.yMm,b.yMm)&&Math.min(a.yMm,b.yMm)<=q.yMm+radius))continue;
  const dx=b.xMm-a.xMm,dy=b.yMm-a.yMm,lengthSquared=dx*dx+dy*dy;
  const t=lengthSquared?Math.max(0,Math.min(1,((q.xMm-a.xMm)*dx+(q.yMm-a.yMm)*dy)/lengthSquared)):0;
  result=Math.min(result,Math.hypot(q.xMm-a.xMm-t*dx,q.yMm-a.yMm-t*dy));
 }
 return result;
}
function verify(points:XY[],closed:boolean,queries:Query[],mutate=false):number{
 const snapshot=structuredClone(points),index=segmentDistanceIndex(points,closed);
 if(mutate){for(const q of points){q.xMm+=777;q.yMm=-999;}points.reverse();points.push(p(999,999));}
 let checked=0;
 // Reverse and revisit queries to exercise coherent seeds and cached no-hits.
 for(const q of [...queries,...queries.slice().reverse(),...queries]){
  const expected=scan(snapshot,closed,q.point,q.radius);
  expect(Object.is(index.nearest(q.point,q.radius),expected)).toBe(true);checked++;
 }
 if(!mutate)expect(points).toStrictEqual(snapshot);
 comparisons+=checked;return checked;
}

it('matches exhaustive scan for open/closed empty, singleton and degenerate paths',()=>{
 for(const closed of [false,true])for(const points of [[],[p(3,4)],[p(3,4),p(3,4)],Array.from({length:20},()=>p(3,4)),[p(0,0),p(0,0),p(8,0),p(8,8)]]){
  verify(points,closed,[p(0,0),p(3,4),p(100,100)].flatMap(point=>[undefined,0,-0,.1,1,Infinity,-1,NaN].map(radius=>({point,radius}))));
 }
});

it('uses a square radius filter, including exact bbox contact and an empty-hit recovery',()=>{
 const points=[p(0,2),p(2,0)];
 expect(Object.is(segmentDistanceIndex(points,false).nearest(p(0,0),1),Math.SQRT2)).toBe(true);
 for(const closed of [false,true])verify(points,closed,[p(0,0),p(1,1),p(100,100)].flatMap(point=>[0,1-Number.EPSILON,1,1+Number.EPSILON,Infinity,-Infinity,NaN].map(radius=>({point,radius}))));
});

it('preserves exact results across tree branches, near ties and calibrated coordinate ranges',()=>{
 let state=0x67a2c109;
 const random=()=>{state=(Math.imul(state,1664525)+1013904223)>>>0;return state/2**32;};
 for(const scale of [1e-150,1e-8,1,1e8,1e100,1e149])for(const closed of [false,true]){
  const points=Array.from({length:40},(_,i)=>{const angle=i*Math.PI/2;return p(Math.cos(angle)*scale*(1+(i%7-3)*Number.EPSILON),Math.sin(angle)*scale*(1+(i%9-4)*Number.EPSILON));});
  verify(points,closed,Array.from({length:24},(_,i)=>({point:p((random()-.5)*scale*3,(random()-.5)*scale*3),radius:i%3?Infinity:scale})));
 }
});

it('retains Math.hypot arithmetic for subnormals and overflowing projections',()=>{
 for(const scale of [Number.MIN_VALUE,2**-1022,2**-540,2**-512,1e-154,1e-153])for(const closed of [false,true]){
  const points=Array.from({length:20},(_,i)=>p((i%7-3)*scale,(i%11-5)*scale));
  verify(points,closed,Array.from({length:12},(_,i)=>({point:p((i%9-4)*scale,(i%5-2)*scale),radius:i%3?Infinity:scale})));
 }
 for(const closed of [false,true])for(const points of [[p(-1e151,0),p(1e151,0),p(1e151,1e151)],[p(-1e308,0),p(1e308,0),p(1e308,1e308)],[p(1e300,1e300),p(1e300,1e300),p(-1e300,-1e300)]]){
  verify(points,closed,[p(0,0),p(1e151,1e151),p(-1e308,1e308),p(Infinity,0),p(0,NaN)].flatMap(point=>[0,1e151,1e308,Infinity,NaN].map(radius=>({point,radius}))));
 }
});

it('snapshots source coordinates and does not cache a mutable query object by identity',()=>{
 const points=Array.from({length:36},(_,i)=>p(i*.3,Math.sin(i)*4));
 verify(points,true,[p(0,0),p(2,3),p(-5,8)].flatMap(point=>[0,1,Infinity].map(radius=>({point,radius}))),true);
 const source=Array.from({length:36},(_,i)=>p(i*.3,Math.cos(i)*4)),before=structuredClone(source),index=segmentDistanceIndex(source,false),query=p(0,0);
 for(let i=0;i<30;i++){query.xMm=i%9;query.yMm=i%7;expect(Object.is(index.nearest(query,3),scan(source,false,query,3))).toBe(true);comparisons++;}
 expect(source).toStrictEqual(before);
});

it('keys repeated queries by signed coordinates and radius without contaminating other indexes',()=>{
 const points=Array.from({length:32},(_,i)=>p(i*4,Math.sin(i)*20));
 verify(points,false,Array.from({length:35},(_,i)=>({point:p(i%3?-0:0,i%5?-0:0),radius:[0,-0,.001,1,Infinity,NaN,-1][i%7]})));
 const first=segmentDistanceIndex([p(0,0),p(1,0)],false),second=segmentDistanceIndex([p(10,10),p(11,10)],false);
 for(let i=0;i<6;i++){
  expect(Object.is(first.nearest(p(0,0)),0)).toBe(true);
  expect(Object.is(second.nearest(p(0,0)),Math.hypot(10,10))).toBe(true);comparisons+=2;
 }
});
