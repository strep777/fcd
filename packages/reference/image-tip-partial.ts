import {inferTips,compareSourceTips} from './image-line-corners';
import type {Point} from '../schema/index';
type XY={xMm:number;yMm:number};
const distance=(a:XY,b:XY)=>Math.hypot(a.xMm-b.xMm,a.yMm-b.yMm);
export function partialTips(vertices:Point[],source:Point[],observed:Point[],closed:boolean,width:number,height:number,rgba:Uint8Array,createId:()=>string,modelInput?:ReturnType<typeof inferTips>){
 const model=modelInput??inferTips(vertices,closed,width,height,rgba),n=source.length;if(!n||model.source.length!==n||observed.length!==n)return;
 type Candidate=typeof model.candidates[number];
 type Span={a:number;b:number;tips:Point[];first:Candidate;last:Candidate};
 const at=(i:number)=>source[(i%n+n)%n],proposals:Span[]=[];
 // Rank source evidence, but suppress a nearby alternative only after the
 // better-ranked model has a valid splice window on this particular path.
 // A photometric fit alone does not establish usable source endpoints.
 for(const c of model.candidates.filter(v=>v.accepted).sort(compareSourceTips)){
  if(proposals.some(v=>distance(v.first.tip,c.tip)<12))continue;
  let nearest=c.i,best=Infinity;for(let j=c.i-12;j<=c.i+12;j++){if(!closed&&(j<0||j>=n))continue;const d=distance(at(j),c.tip);if(d<best){nearest=j;best=d;}}
  const x=Math.floor(c.point.xMm)+.5,y=Math.floor(c.point.yMm)+.5,within=(p:XY)=>Math.abs(p.xMm-x)<=c.radius&&Math.abs(p.yMm-y)<=c.radius;
  let a=nearest,b=nearest;for(let guard=0;guard<n/2&&within(at(a))&&(closed||a>0);guard++)a--;for(let guard=0;guard<n/2&&within(at(b))&&(closed||b<n-1);guard++)b++;
  if(a===nearest||b===nearest||b-a>=n||!closed&&(a<1||b>=n-1))continue;
  const p=at(a),q=at(b),left=Math.abs((p.xMm-c.tip.xMm)*c.n1.xMm+(p.yMm-c.tip.yMm)*c.n1.yMm),right=Math.abs((q.xMm-c.tip.xMm)*c.n2.xMm+(q.yMm-c.tip.yMm)*c.n2.yMm);
  if(left>1.5||right>1.5)continue;
  proposals.push({a,b,tips:[{...c.tip,id:createId()}],first:c,last:c});
 }
 if(!proposals.length)return;
 // Choose a gap before sorting a cyclic chain. The sequence of supported
 // corners must not depend on which model happened to have the lowest error.
 const start=closed?source.findIndex((_,i)=>!proposals.some(s=>[0,-n,n].some(offset=>i>=s.a+offset&&i<=s.b+offset))):0;
 if(start<0)return;
 const normalized=proposals.map(s=>{const a=closed?((s.a-start)%n+n)%n:s.a;return{...s,a,b:a+s.b-s.a};}).sort((a,b)=>a.a-b.a||a.b-b.b);
 if(normalized.some(s=>s.a<0||s.b<=s.a||s.b>=n))return;
 const agrees=(left:Candidate,right:Candidate)=>{
  const dx=right.tip.xMm-left.tip.xMm,dy=right.tip.yMm-left.tip.yMm,length=Math.hypot(dx,dy);
  if(length<1||Math.abs(dx*left.n2.xMm+dy*left.n2.yMm)>.5||Math.abs(dx*right.n1.xMm+dy*right.n1.yMm)>.5)return false;
  // Require independent RGB models to agree on the common straight flank,
  // and require their actual observation patches to cover it without a gap.
  const interval=(corner:Candidate)=>{let lo=0,hi=1;for(const[p,d,center]of[[left.tip.xMm,dx,Math.floor(corner.point.xMm)+.5],[left.tip.yMm,dy,Math.floor(corner.point.yMm)+.5]]){if(Math.abs(d)<1e-10){if(Math.abs(p-center)>corner.radius)return;continue;}const u=(center-corner.radius-p)/d,v=(center+corner.radius-p)/d;lo=Math.max(lo,Math.min(u,v));hi=Math.min(hi,Math.max(u,v));}return lo<=hi?[lo,hi]:undefined;};
  const a=interval(left),b=interval(right);return !!a&&!!b&&Math.min(a[0],b[0])<=1e-8&&Math.max(a[1],b[1])>=1-1e-8&&Math.max(a[0],b[0])<=Math.min(a[1],b[1])+1e-8;
 };
 const spans:Span[]=[];
 for(const span of normalized){const previous=spans.at(-1);if(!previous||previous.b<=span.a){spans.push(span);continue;}
  if(previous.a<span.a&&previous.b<span.b&&agrees(previous.last,span.first)){previous.b=span.b;previous.tips.push(...span.tips);previous.last=span.last;}
  // Conflicting evidence cannot justify joining two source paths. Keep the
  // already accepted interval rather than silently bridging the conflict.
 }
 const points:Point[]=[],baseline:Point[]=[],tips=new Set<string>();let i=0;
 for(const span of spans){for(;i<span.a;i++){const j=(start+i)%n;points.push(observed[j]);baseline.push(source[j]);}// Disjoint interiors may share their original source endpoint. It is
  // neither competing evidence nor permission to replace the intervening
  // side by a chord. Retain that source anchor once in both baselines.
  if(i<=span.a){points.push(observed[(start+span.a)%n]);baseline.push(source[(start+span.a)%n]);}
  points.push(...span.tips,observed[(start+span.b)%n]);baseline.push(...span.tips,source[(start+span.b)%n]);for(const p of span.tips)tips.add(p.id);i=span.b+1;}
 for(;i<n;i++){const j=(start+i)%n;points.push(observed[j]);baseline.push(source[j]);}
 return{points,baseline,tips,windows:spans.map(s=>({from:at(start+s.a),to:at(start+s.b),tip:s.tips[0],through:s.tips.slice(1)}))};
}
