// Independent sampled-contract geometry. No production imports or recovered
// output is used to select a cap or to construct its source reference.
export type XY={x:number;y:number};
export type Segment={a:XY;b:XY};
export type Bounds={left:number;right:number;top:number;bottom:number};
export type Cap={name:string;bounds:Bounds;tip:XY;ends:XY[]};
const point=(s:Segment,t:number):XY=>t===0?{...s.a}:t===1?{...s.b}:({x:s.a.x+(s.b.x-s.a.x)*t,y:s.a.y+(s.b.y-s.a.y)*t});
function seamPoint(s:Segment,t:number,bounds:Bounds[]):XY{
 const p=point(s,t);
 for(const b of bounds)for(const[key,faces]of [['x',[b.left,b.right]],['y',[b.top,b.bottom]]]as const){
  const delta=s.b[key]-s.a[key];
  if(delta!==0)for(const face of faces)if(t===(face-s.a[key])/delta)p[key]=face;
 }
 return p;
}
export const inBounds=(p:XY,b:Bounds)=>p.x>=b.left&&p.x<=b.right&&p.y>=b.top&&p.y<=b.bottom;
export function ringSegments(rings:XY[][]):Segment[]{return rings.flatMap(r=>r.map((a,i)=>({a,b:r[(i+1)%r.length]})));}

// Slab intersection of the ORIGINAL finite segment. An interval is allowed
// to collapse to a point: touching a fixed cap seam qualifies that owner.
export function segmentInterval(s:Segment,b:Bounds):[number,number]|undefined{
 let lo=0,hi=1;
 for(const[key,min,max]of [['x',b.left,b.right],['y',b.top,b.bottom]]as const){
  const origin=s.a[key],delta=s.b[key]-origin;
  if(delta===0){if(origin<min||origin>max)return;continue;}
  const u=(min-origin)/delta,v=(max-origin)/delta;
  lo=Math.max(lo,Math.min(u,v));hi=Math.min(hi,Math.max(u,v));if(lo>hi)return;
 }
 return[lo,hi];
}
export function clipSegments(segments:Segment[],bounds:Bounds):Segment[]{
 return segments.flatMap(s=>{const t=segmentInterval(s,bounds);return t?[{a:seamPoint(s,t[0],[bounds]),b:seamPoint(s,t[1],[bounds])}]:[];});
}
export function intersects(segments:Segment[],bounds:Bounds){return segments.some(s=>segmentInterval(s,bounds)!==undefined);}
export function partitionSegments(segments:Segment[],caps:readonly Pick<Cap,'name'|'bounds'>[]){
 const outside:Segment[]=[],inside:Record<string,Segment[]>=Object.fromEntries(caps.map(c=>[c.name,[]]));
 for(const s of segments){
  const intervals=caps.map(c=>({cap:c,t:segmentInterval(s,c.bounds)}));
  const cuts=[...new Set([0,1,...intervals.flatMap(v=>v.t??[])])].sort((a,b)=>a-b);
  for(let i=1;i<cuts.length;i++){
   const lo=cuts[i-1],hi=cuts[i];if(hi<=lo)continue;
   const part={a:seamPoint(s,lo,caps.map(c=>c.bounds)),b:seamPoint(s,hi,caps.map(c=>c.bounds))},middle=(lo+hi)/2,cover=intervals.filter(v=>v.t&&middle>=v.t[0]&&middle<=v.t[1]);
   if(!cover.length)outside.push(part);else for(const v of cover)inside[v.cap.name].push(part);
  }
  // Preserve isolated boundary contacts as explicit finite point segments.
  for(const v of intervals)if(v.t&&v.t[0]===v.t[1]){const p=seamPoint(s,v.t[0],[v.cap.bounds]);inside[v.cap.name].push({a:p,b:p});}
  if(cuts.length===1||s.a.x===s.b.x&&s.a.y===s.b.y){
   const cover=caps.filter(c=>inBounds(s.a,c.bounds));if(!cover.length)outside.push(s);else for(const c of cover)inside[c.name].push(s);
  }
 }
 return{outside,inside};
}
export function nearestSegment(p:XY,segments:Segment[]){
 let best=Infinity;
 for(const{a,b}of segments){const dx=b.x-a.x,dy=b.y-a.y,length2=dx*dx+dy*dy,t=length2?Math.max(0,Math.min(1,((p.x-a.x)*dx+(p.y-a.y)*dy)/length2)):0;best=Math.min(best,Math.hypot(p.x-a.x-t*dx,p.y-a.y-t*dy));}
 return best;
}
export function samples(segments:Segment[],spacing=.25){
 if(!Number.isFinite(spacing)||spacing<=0)throw Error('INVALID_SAMPLE_SPACING');
 return segments.flatMap(s=>{const n=Math.max(1,Math.ceil(Math.hypot(s.b.x-s.a.x,s.b.y-s.a.y)/spacing));return Array.from({length:n+1},(_,j)=>point(s,j/n));});
}
export function capSegments(cap:Cap):Segment[]{return cap.ends.map(b=>({a:cap.tip,b}));}
function sampledMaximum(from:Segment[],to:Segment[]){
 return from.length?Math.max(...samples(from).map(p=>nearestSegment(p,to))):0;
}
export function sameDomainMetrics(raw:Segment[],output:Segment[],caps:Cap[],roi:Bounds){
 // Clip each ORIGINAL segment independently. Never connect two endpoints
 // after removing an interior interval, and never close the retained list.
 const rawParts=partitionSegments(raw,caps),outputParts=partitionSegments(output,caps);
 const retainedRaw=clipSegments(rawParts.outside,roi),retainedOutput=clipSegments(outputParts.outside,roi);
 // ROI selects measured queries, not physical reference endpoints. Targets
 // retain their complete finite geometry within the SAME cap partition.
 // In particular, rawParts.outside still excludes all deleted cap interiors.
 const outsideForward=sampledMaximum(retainedOutput,rawParts.outside),outsideReverse=sampledMaximum(retainedRaw,outputParts.outside);
 const capMetrics=caps.map(cap=>{
  const fullReference=capSegments(cap),fullActual=outputParts.inside[cap.name],reference=clipSegments(fullReference,roi),actual=clipSegments(fullActual,roi);
  return{name:cap.name,forward:sampledMaximum(actual,fullReference),reverse:sampledMaximum(reference,fullActual),sourceSegments:reference.length,outputSegments:actual.length,sourceSamples:samples(reference).length,outputSamples:samples(actual).length};
 });
 const forward=Math.max(outsideForward,...capMetrics.map(c=>c.forward)),reverse=Math.max(outsideReverse,...capMetrics.map(c=>c.reverse));
 return{forward,reverse,maxBidirectional:Math.max(forward,reverse),outsideForward,outsideReverse,retainedRawSegments:retainedRaw.length,retainedOutputSegments:retainedOutput.length,retainedRawTargetSegments:rawParts.outside.length,retainedOutputTargetSegments:outputParts.outside.length,capMetrics,scope:'Finite raw/output polylines partitioned by fixed caps. ROI clips queries only; both directions retain complete finite targets of their same cap partition. Samples <=.25 include exact cap/ROI seam endpoints. This is not a continuous cubic or full-image Hausdorff proof.'};
}
