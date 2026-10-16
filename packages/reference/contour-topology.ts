import {segmentDistanceIndex} from './segment-distance-index';
import type {Piece} from '../schema/index';
import {boxIndex,type Box} from '../surface/spatial';
type P={xMm:number;yMm:number};
const cross=(a:P,b:P,c:P)=>(b.xMm-a.xMm)*(c.yMm-a.yMm)-(b.yMm-a.yMm)*(c.xMm-a.xMm);
const area=(r:P[])=>r.reduce((sum,a,i)=>{const b=r[(i+1)%r.length];const o=r[0];return sum+(a.xMm-o.xMm)*(b.yMm-o.yMm)-(b.xMm-o.xMm)*(a.yMm-o.yMm);},0)/2;
const segmentDistance=(p:P,a:P,b:P)=>{const x=b.xMm-a.xMm,y=b.yMm-a.yMm,d=x*x+y*y,t=d?Math.max(0,Math.min(1,((p.xMm-a.xMm)*x+(p.yMm-a.yMm)*y)/d)):0;return Math.hypot(p.xMm-a.xMm-t*x,p.yMm-a.yMm-t*y);};
function flattened(piece:Piece,tolerance:number):P[][]{
 const outer:P[]=[],curves=new Map(piece.curves?.map(c=>[c.startNodeId,c])),mid=(a:P,b:P)=>({xMm:(a.xMm+b.xMm)/2,yMm:(a.yMm+b.yMm)/2});
 const append=(a:P,c1:P,c2:P,b:P,depth=0)=>{
  if(depth>24||outer.length>12000)throw Error('RESOURCE_LIMIT');
  if(Math.max(segmentDistance(c1,a,b),segmentDistance(c2,a,b))<=tolerance){outer.push(a);return;}
  const p=mid(a,c1),q=mid(c1,c2),r=mid(c2,b),s=mid(p,q),t=mid(q,r),m=mid(s,t);append(a,p,s,m,depth+1);append(m,t,r,b,depth+1);
 };
 for(let i=0;i<piece.nodes.length;i++){const a=piece.nodes[i],b=piece.nodes[(i+1)%piece.nodes.length],c=curves.get(a.id);if(c)append(a,c.c1,c.c2,b);else outer.push(a);}
 return [outer,...(piece.holes??[])];
}
/** Conservative, bidirectional boundary error in mm. Sampling each segment at
 * step/2 intervals and adding half that interval bounds unsampled distances,
 * since distance to a closed boundary is 1-Lipschitz. Holes match individually. */
export function contourBoundaryError(candidate:Piece,original:Piece,stepMm:number,limitMm=Infinity):number{
 return boundaryMetric(candidate,original,stepMm,limitMm,false);
}
/** Certify the same finite sampling grid as contourBoundaryError. An interval
 * can skip interior samples only when the 1-Lipschitz distance bound proves
 * every one would pass. The original sample budget is charged in full. */
export function contourWithinBoundary(candidate:Piece,original:Piece,stepMm:number,limitMm:number):boolean{
 return Number.isFinite(limitMm)&&limitMm>=0&&boundaryMetric(candidate,original,stepMm,limitMm,true)<=limitMm;
}
function boundaryMetric(candidate:Piece,original:Piece,stepMm:number,limitMm:number,certify:boolean):number{
 if(!Number.isFinite(stepMm)||stepMm<=0)return Infinity;
 const tolerance=Math.min(.01,stepMm*.05),after=flattened(candidate,tolerance),before=flattened(original,tolerance);if(after.length!==before.length)return Infinity;
 const curveMargin=(candidate.curves?.length?tolerance:0)+(original.curves?.length?tolerance:0);let maximum=0,samples=0;
 const directed=(source:P[],target:P[])=>{
  const index=segmentDistanceIndex(target,true);
  for(let i=0;i<source.length;i++){
   const a=source[i],b=source[(i+1)%source.length],length=Math.hypot(b.xMm-a.xMm,b.yMm-a.yMm),count=Math.max(1,Math.ceil(length/(stepMm/2))),margin=length/count/2;
   samples+=count+1;if(!Number.isFinite(count)||samples>1000000){maximum=Infinity;return false;}
   if(certify){
    const sample=(j:number)=>{const t=j/count,p={xMm:a.xMm+(b.xMm-a.xMm)*t,yMm:a.yMm+(b.yMm-a.yMm)*t};return index.nearest(p,limitMm);};
    const first=sample(0),last=sample(count);
    maximum=Math.max(maximum,first+margin+curveMargin,last+margin+curveMargin);if(!(maximum<=limitMm))return false;
    const slack=128*Number.EPSILON*Math.max(1,Math.abs(a.xMm),Math.abs(a.yMm),Math.abs(b.xMm),Math.abs(b.yMm),length,limitMm);
    const intervals:{lo:number;hi:number;left:number;right:number}[]=[{lo:0,hi:count,left:first,right:last}];
    while(intervals.length){const span=intervals.pop()!;if(span.hi-span.lo<2)continue;
     const width=(span.hi-span.lo)*length/count;
     const upper=Math.max(span.left,span.right,(span.left+span.right+width)/2)+slack;
     if(upper+margin+curveMargin<=limitMm){maximum=Math.max(maximum,upper+margin+curveMargin);continue;}
     const middle=Math.floor((span.lo+span.hi)/2),value=sample(middle);maximum=Math.max(maximum,value+margin+curveMargin);if(!(maximum<=limitMm))return false;
     intervals.push({lo:middle,hi:span.hi,left:value,right:span.right},{lo:span.lo,hi:middle,left:span.left,right:value});
    }
    continue;
   }
   for(let j=0;j<=count;j++){
    const t=j/count,p={xMm:a.xMm+(b.xMm-a.xMm)*t,yMm:a.yMm+(b.yMm-a.yMm)*t};
    const nearest=index.nearest(p,Number.isFinite(limitMm)?limitMm:Infinity);
    maximum=Math.max(maximum,nearest+margin+curveMargin);if(maximum>limitMm)return false;
   }
  }
  return true;
 };
 for(let i=0;i<after.length;i++)if(!directed(after[i],before[i])||!directed(before[i],after[i]))return maximum;
 return maximum;
}
function inside(p:P,r:P[]){let yes=false;for(let i=0,j=r.length-1;i<r.length;j=i++){const a=r[i],b=r[j];if((a.yMm>p.yMm)!==(b.yMm>p.yMm)&&p.xMm<(b.xMm-a.xMm)*(p.yMm-a.yMm)/(b.yMm-a.yMm)+a.xMm)yes=!yes;}return yes;}
function touches(a:P,b:P,c:P,d:P){
 const on=(p:P,u:P,v:P)=>Math.abs(cross(u,v,p))<=1e-9&&p.xMm>=Math.min(u.xMm,v.xMm)-1e-9&&p.xMm<=Math.max(u.xMm,v.xMm)+1e-9&&p.yMm>=Math.min(u.yMm,v.yMm)-1e-9&&p.yMm<=Math.max(u.yMm,v.yMm)+1e-9;
 return cross(a,b,c)*cross(a,b,d)<0&&cross(c,d,a)*cross(c,d,b)<0||on(a,c,d)||on(b,c,d)||on(c,a,b)||on(d,a,b);
}
/** A raster recovery pass must not close a slit, cross a hole, or invert a contour. */
export function safeContour(candidate:Piece,original:Piece,pixelMm:number,sourceAreaAllowance:readonly number[]=[],boundaryCheck?:{stepMm:number;limitMm:number}){
 try{
  if(sourceAreaAllowance.some(v=>!Number.isFinite(v)||v<0))return false;
  // Flattened samples are a geometric error-checking budget, not editable
  // control nodes. A valid native painted arc can need >1800 samples at the
  // millimetre tolerance despite having only a few hundred fitted cubics.
  const rings=flattened(candidate,Math.min(.01,pixelMm*.025)),outer=rings[0],before=flattened(original,Math.min(.01,pixelMm*.025));if(outer.length>12000)return false;
  if(rings.length!==before.length||rings.reduce((n,r)=>n+r.length,0)>24000)return false;
  for(let i=0;i<rings.length;i++){const a=area(rings[i]),b=area(before[i]);if(rings[i].length<3||a*b<=0||Math.abs(a-b)>Math.max(pixelMm*pixelMm,Math.abs(b)*.03,sourceAreaAllowance[i]??0))return false;}
  const edges=rings.flatMap((ring,r)=>ring.map((a,i)=>({a,b:ring[(i+1)%ring.length],r,i,length:ring.length}))),boxes:Box[]=edges.map(({a,b})=>[Math.min(a.xMm,b.xMm)-1e-9,Math.min(a.yMm,b.yMm)-1e-9,Math.max(a.xMm,b.xMm)+1e-9,Math.max(a.yMm,b.yMm)+1e-9]),index=boxIndex(boxes);
  for(let i=0;i<edges.length;i++){const a=edges[i];if(Math.hypot(a.a.xMm-a.b.xMm,a.a.yMm-a.b.yMm)<1e-9)return false;for(const j of index.query(boxes[i])){if(j<=i)continue;const b=edges[j];if(a.r===b.r&&(Math.abs(a.i-b.i)===1||Math.abs(a.i-b.i)===a.length-1))continue;if(touches(a.a,a.b,b.a,b.b))return false;}}
  for(let i=1;i<rings.length;i++){if(!inside(rings[i][0],outer))return false;for(let j=1;j<i;j++)if(inside(rings[i][0],rings[j])||inside(rings[j][0],rings[i]))return false;}
  // Area and intersection checks alone accept a translated or locally bowed
  // contour. Bound both the fitted edge and every original notch/indentation.
  const step=boundaryCheck?.stepMm??pixelMm*.25,limit=boundaryCheck?.limitMm??pixelMm*1.75;
  // Additional callers may request a stricter boundary check, never relax it.
  if(!Number.isFinite(step)||!Number.isFinite(limit)||step<=0||limit<=0||step>pixelMm*.25||limit>pixelMm*1.75)return false;
  if(!contourWithinBoundary(candidate,original,step,limit))return false;
  return true;
 }catch{return false;}
}
