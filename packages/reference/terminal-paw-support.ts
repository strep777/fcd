import type {BodyPart,BodySide} from './body-parts';
type Side='left'|'right';
type Box={minX:number;minY:number;maxX:number;maxY:number};
type Region={part:BodyPart;side:BodySide;confidence:number;indices:readonly number[];contexts?:{part:BodyPart}[]};
type Options={width:number;span:number;top:number;head:Box;regions:readonly Region[];saturation:Float32Array;value:Float32Array;arms:ReadonlyMap<Side,readonly number[]>;existing:ReadonlySet<Side>};
const bounds=(indices:readonly number[],width:number)=>{const b={minX:Infinity,minY:Infinity,maxX:-Infinity,maxY:-Infinity};for(const i of indices){const x=i%width,y=Math.floor(i/width);b.minX=Math.min(b.minX,x);b.minY=Math.min(b.minY,y);b.maxX=Math.max(b.maxX,x+1);b.maxY=Math.max(b.maxY,y+1);}return b;};
const center=(indices:readonly number[],width:number)=>{let x=0,y=0;for(const i of indices){x+=i%width+.5;y+=Math.floor(i/width)+.5;}return{x:x/indices.length,y:y/indices.length};};
/** Missing-paw metadata evidence only. A compact neutral arm-terminal material
 * plus at least two separate, distal dark tips supports a hand. Existing pads
 * take precedence. This never paints, merges, expands or changes source pixels,
 * and returns only entire qualifying instances rather than a padded hand box. */
export function terminalPawSupport({width,span,top,head,regions,saturation,value,arms,existing}:Options){
 if(existing.has('left')&&existing.has('right'))return [];
 const selected:{side:Side;regionIndices:number[];box:Box}[]=[],headCenter=(head.minX+head.maxX)/2,headWidth=head.maxX-head.minX;
 const mean=(r:Region,data:Float32Array)=>r.indices.reduce((sum,i)=>sum+data[i],0)/r.indices.length;
 const boxes=regions.map(r=>bounds(r.indices,width)),centers=regions.map(r=>center(r.indices,width));
 for(const side of ['left','right']as const){
  if(existing.has(side))continue;const arm=arms.get(side);if(!arm||arm.length<Math.max(64,span*span*.0005))continue;
  const m=center(arm,width);let xx=0,xy=0,yy=0;for(const i of arm){const x=i%width+.5-m.x,y=Math.floor(i/width)+.5-m.y;xx+=x*x;xy+=x*y;yy+=y*y;}
  if(Math.hypot(xx-yy,2*xy)/(xx+yy||1)<.2)continue;
  const angle=.5*Math.atan2(2*xy,xx-yy);let ux=Math.cos(angle),uy=Math.sin(angle);if(Math.abs(ux)<.2)continue;if((side==='left'?-1:1)*ux<0){ux=-ux;uy=-uy;}
  const u=(p:{x:number;y:number})=>(p.x-m.x)*ux+(p.y-m.y)*uy,v=(p:{x:number;y:number})=>-(p.x-m.x)*uy+(p.y-m.y)*ux;
  let minU=Infinity,maxU=-Infinity;for(const i of arm){const t=u({x:i%width+.5,y:Math.floor(i/width)+.5});minU=Math.min(minU,t);maxU=Math.max(maxU,t);}const length=maxU-minU;if(length<span*.06)continue;
  const candidates:{side:Side;regionIndices:number[];box:Box}[]=[];
  for(const [index,r]of regions.entries()){
   const b=boxes[index],c=centers[index],w=b.maxX-b.minX,h=b.maxY-b.minY,t=(c.y-top)/span;
   if(r.part!=='arm'||r.side!==side||r.confidence<.35||r.contexts?.some(c=>c.part!=='arm')||r.indices.length<Math.max(64,span*span*.0005)||r.indices.length>span*span*.025)continue;
   if(mean(r,saturation)>.25||mean(r,value)<.45||Math.min(w,h)<span*.025||Math.max(w,h)>span*.18||t<.27||t>.74)continue;
   if(Math.abs(c.x-headCenter)<headWidth*.6||u(c)<maxU-length*.3||u(c)>maxU+span*.16||Math.abs(v(c))>span*.1)continue;
   const tips=regions.flatMap((tip,j)=>{
    if(j===index||!['arm','paw'].includes(tip.part)||tip.side!==side||tip.indices.length<Math.max(6,span*span*.00005)||tip.indices.length>span*span*.0025||tip.contexts?.some(c=>!['arm','paw'].includes(c.part))||mean(tip,value)>.3)return [];
    const tb=boxes[j],tc=centers[j],tw=tb.maxX-tb.minX,th=tb.maxY-tb.minY,tt=(tc.y-top)/span;
    if(Math.max(tw,th)>span*.065||Math.min(tw,th)<span*.005||tt<.27||tt>.78||Math.abs(tc.x-headCenter)<headWidth*.5)return [];
    const near=Math.hypot(Math.max(b.minX-tc.x,0,tc.x-b.maxX),Math.max(b.minY-tc.y,0,tc.y-b.maxY));
    return near<=span*.025&&u(tc)>u(c)+span*.01?[j]:[];
   });
   const independent=tips.some(a=>tips.some(b=>a!==b&&Math.abs(v(centers[a])-v(centers[b]))>span*.012&&Math.abs(u(centers[a])-u(centers[b]))<span*.08));
   if(!independent)continue;
   const ids=[index,...tips],hand=bounds(ids.flatMap(i=>[...regions[i].indices]),width);candidates.push({side,regionIndices:ids,box:hand});
  }
  // Two competing neutral terminal materials are not sufficient evidence of
  // a unique palm. Keep the existing editable classification in that case.
  if(candidates.length===1)selected.push(candidates[0]);
 }
 return selected;
}
