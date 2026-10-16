import {afterAll,expect,it} from 'vitest';
import {contourBoundaryError,contourWithinBoundary} from '../../packages/reference/contour-topology';
import type {Piece} from '../../packages/schema/index';
import {rectangle} from '../fixtures';

type XY={xMm:number;yMm:number};
const p=(xMm:number,yMm:number):XY=>({xMm,yMm});
const shape=(points:XY[],holes:XY[][]=[]):Piece=>({...rectangle(),nodes:points.map((q,i)=>({...q,id:`n${i}`})),holes:holes.map((ring,r)=>ring.map((q,i)=>({...q,id:`h${r}-${i}`}))),curves:[]});
const rect=(x=0,y=0,s=1)=>shape([p(x,y),p(x+12*s,y),p(x+12*s,y+8*s),p(x,y+8*s)]);
function curve(x=0,y=0,s=1,bow=3):Piece{
 const q=rect(x,y,s);
 q.curves=[{id:'c0',startNodeId:'n0',endNodeId:'n1',c1:{id:'a',...p(x+3*s,y-bow*s)},c2:{id:'b',...p(x+9*s,y-bow*s)}},{id:'c2',startNodeId:'n2',endNodeId:'n3',c1:{id:'c',...p(x+9*s,y+(8+bow)*s)},c2:{id:'d',...p(x+3*s,y+(8+bow)*s)}}];return q;
}
let comparisons=0;
afterAll(()=>console.info(`contour boundary predicate: ${comparisons} Object.is comparisons`));
function next(x:number,direction:number):number{
 if(Number.isNaN(x)||x===direction)return x;
 if(x===0)return direction>0?Number.MIN_VALUE:-Number.MIN_VALUE;
 const buffer=new ArrayBuffer(8),view=new DataView(buffer);view.setFloat64(0,x);
 view.setBigUint64(0,view.getBigUint64(0)+((x>0)===(direction>x)?1n:-1n));return view.getFloat64(0);
}
function thresholds(a:Piece,b:Piece,step:number):number[]{
 const full=contourBoundaryError(a,b,step);
 return Number.isFinite(full)?[0,next(full,-Infinity),full,next(full,Infinity),full+step].filter(x=>Number.isFinite(x)&&x>=0):[0,.1,100];
}
function compare(a:Piece,b:Piece,step:number,limits=thresholds(a,b,step)):void{
 const before=structuredClone([a,b]);
 for(const limit of limits){
  expect(Object.is(contourWithinBoundary(a,b,step,limit),contourBoundaryError(a,b,step,limit)<=limit)).toBe(true);comparisons++;
 }
 expect([a,b]).toStrictEqual(before);
}

// Independent exhaustive straight-boundary grid. No accelerated distance
// helper or adaptive interval is used; the original j/count samples and full
// resource charge are explicit. Cubic checks below use the public metric.
function straightMetric(a:Piece,b:Piece,step:number,limit:number):number{
 const after=[a.nodes,...a.holes??[]],before=[b.nodes,...b.holes??[]];
 if(after.length!==before.length)return Infinity;
 let maximum=0,samples=0;
 function directed(source:XY[],target:XY[]):boolean{
  for(let i=0;i<source.length;i++){
   const u=source[i],v=source[(i+1)%source.length],length=Math.hypot(v.xMm-u.xMm,v.yMm-u.yMm),count=Math.max(1,Math.ceil(length/(step/2))),margin=length/count/2;
   samples+=count+1;if(!Number.isFinite(count)||samples>1000000){maximum=Infinity;return false;}
   for(let j=0;j<=count;j++){
    const t=j/count,q=p(u.xMm+(v.xMm-u.xMm)*t,u.yMm+(v.yMm-u.yMm)*t);let best=Infinity;
    for(let k=0;k<target.length;k++){
     const c=target[k],d=target[(k+1)%target.length];
     if(!(q.xMm-limit<=Math.max(c.xMm,d.xMm)&&Math.min(c.xMm,d.xMm)<=q.xMm+limit&&q.yMm-limit<=Math.max(c.yMm,d.yMm)&&Math.min(c.yMm,d.yMm)<=q.yMm+limit))continue;
     const dx=d.xMm-c.xMm,dy=d.yMm-c.yMm,square=dx*dx+dy*dy,f=square?Math.max(0,Math.min(1,((q.xMm-c.xMm)*dx+(q.yMm-c.yMm)*dy)/square)):0;
     best=Math.min(best,Math.hypot(q.xMm-c.xMm-f*dx,q.yMm-c.yMm-f*dy));
    }
    maximum=Math.max(maximum,best+margin);if(maximum>limit)return false;
   }
  }return true;
 }
 for(let i=0;i<after.length;i++)if(!directed(after[i],before[i])||!directed(before[i],after[i]))return maximum;
 return maximum;
}

it('agrees exactly with exhaustive grid samples at adjacent floating-point thresholds',()=>{
 const cases:[[Piece,Piece],[Piece,Piece],[Piece,Piece]]=[[rect(),rect()],[rect(.03,-.02),rect()],[shape([p(0,0),p(6,-1),p(12,0),p(12,8),p(0,8)]),rect()]];
 for(const [a,b] of cases)for(const step of [.1,.7,2])for(const limit of thresholds(a,b,step)){
  compare(a,b,step,[limit]);expect(Object.is(contourBoundaryError(a,b,step,limit),straightMetric(a,b,step,limit))).toBe(true);comparisons++;
 }
});

it('retains cubic flattening margins at multiple scales and translations',()=>{
 for(const s of [.0001,.1,1,17]){
  const a=curve(.03*s,-.02*s,s,2.25),b=curve(0,0,s,3);
  compare(a,b,.3*s);compare(b,a,.7*s);
 }
});

it('matches each ordered hole and rejects missing holes instead of measuring only the outer ring',()=>{
 const hole=[p(3,2),p(5,2),p(5,4),p(3,4)],b=rect();b.holes=[hole.map((q,i)=>({...q,id:`h${i}`}))];
 for(const shift of [0,.01,.5,3]){const a=structuredClone(b);a.holes=a.holes!.map(r=>r.map(q=>({...q,xMm:q.xMm+shift})));compare(a,b,.5);}
 compare(rect(),b,.5,[0,1,100]);expect(contourWithinBoundary(rect(),b,.5,100)).toBe(false);
 const a=structuredClone(b);a.holes!.push(a.holes![0].map(q=>({...q,id:q.id+'b',xMm:q.xMm+3})));
 const reversed=structuredClone(a);reversed.holes!.reverse();compare(a,reversed,.5);
});

it('charges the full original million-sample budget even when intervals can be proven safe',()=>{
 // Two-node closed path: 2 edges * 2 directions * (ceil(length/.5)+1).
 for(const [length,accepted] of [[124999.5,true],[125000,false]] as const){
  const a=shape([p(0,0),p(length,0)]);compare(a,a,1,[1]);expect(Object.is(contourWithinBoundary(a,a,1,1),accepted)).toBe(true);comparisons++;
 }
 const withHole=shape([p(0,0),p(124999.5,0)],[[p(0,0),p(1,0)]]);
 expect(contourWithinBoundary(withHole,withHole,1,1)).toBe(false);comparisons++;
});

it('rejects invalid finite-limit contracts and retains degenerate/overflow metric decisions',()=>{
 for(const step of [0,-1,NaN,Infinity,-Infinity,Number.MIN_VALUE])compare(rect(),rect(),step,[0,.1,100]);
 for(const limit of [Infinity,-Infinity,NaN,-1]){expect(contourWithinBoundary(rect(),rect(),.2,limit)).toBe(false);comparisons++;}
 for(const points of [[],[p(0,0)],Array.from({length:9},()=>p(2,3)),[p(NaN,0),p(1,1)],[p(Infinity,0),p(1,1)],[p(-1e308,0),p(1e308,0)]]){const a=shape(points);compare(a,a,.5,[0,.1,100]);}
 const huge=shape([p(0,0),p(1e200,0),p(0,1e200)]);
 expect(Number.isNaN(contourBoundaryError(huge,huge,1e199,1.05e200))).toBe(true);
 expect(contourWithinBoundary(huge,huge,1e199,1.05e200)).toBe(false);comparisons+=2;
});

it('depends on geometry rather than color/material metadata and leaves inputs unchanged',()=>{
 const a=curve(),b=rect(),before=structuredClone([a,b]);compare(a,b,.5);
 const recolored={...a,color:'#abcdef',material:'another material',mirror:!a.mirror};
 for(const limit of thresholds(a,b,.5)){
  expect(Object.is(contourBoundaryError(recolored,b,.5,limit),contourBoundaryError(a,b,.5,limit))).toBe(true);
  expect(Object.is(contourWithinBoundary(recolored,b,.5,limit),contourWithinBoundary(a,b,.5,limit))).toBe(true);comparisons+=2;
 }
 expect([a,b]).toStrictEqual(before);
 // These APIs take Piece/coordinates, not RGBA. Alpha qualification remains an
 // image-entry contract; no fake alpha field is added to this geometry test.
});
