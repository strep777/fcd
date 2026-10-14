import type {BoundaryFit} from './image-contour';
import type {Piece,Point} from '../schema/index';
import {recoverContour,recoverBoundaryChain,recoverBoundaryLoop,contourPolyline} from './recover-contour';
import {safeContour,contourBoundaryError} from './contour-topology';
import {boxIndex,type Box} from '../surface/spatial';
type Curve=NonNullable<Piece['curves']>[number];
type Edge={a:string;b:string;owners:Set<number>;rings:Set<string>;pair:string;chain?:number};
type Path={keys:string[];edges:string[]};
type Chain={raw:Point[];closed:boolean;anchors:string[];edges:string[];owners:Set<number>;hole:boolean;nodes:Point[];curves:Curve[];restored:boolean;raster?:{nodes:Point[];curves:Curve[]}};
/** Joint source-network recovery. Shared edges are fitted once and traversed
 * in reverse by their other owner. This neither expands materials nor fills
 * gaps after the fact: adjacency and junctions come from the traced pixel graph.
 * Contact repairs retain only the affected raster spans for both owners. */
export function recoverSharedContours(originals:Piece[],pixelMm:number,createId:()=>string,imageFit?:BoundaryFit){
 if(!Number.isFinite(pixelMm)||pixelMm<=0)throw Error('INVALID_CALIBRATION');
 const size=pixelMm/.8,origin=originals[0]?.nodes[0]??{xMm:0,yMm:0};
 const local=(p:Point)=>({...p,xMm:(p.xMm-origin.xMm)/size,yMm:(p.yMm-origin.yMm)/size}),world=(p:Point)=>({...p,xMm:p.xMm*size+origin.xMm,yMm:p.yMm*size+origin.yMm});
 // Source-pixel coordinates make all contact, flattening and work budgets
 // independent of the user's millimetre calibration and world translation.
 const input=originals.map(p=>({...p,nodes:p.nodes.map(local),holes:p.holes?.map(r=>r.map(local)),curves:p.curves?.map(c=>({...c,c1:local(c.c1),c2:local(c.c2)}))}));
 const localFit:BoundaryFit|undefined=imageFit?((points,closed,colors,id)=>{const fit=imageFit(points.map(world),closed,colors,id);return fit?{nodes:fit.nodes.map(local),curves:fit.curves.map(c=>({...c,c1:local(c.c1),c2:local(c.c2)}))}:undefined;}):undefined;
 const result=recoverNetwork(input,.8,createId,localFit);
 return {...result,pieces:result.pieces.map(p=>({...p,nodes:p.nodes.map(world),holes:p.holes?.map(r=>r.map(world)),curves:p.curves?.map(c=>({...c,c1:world(c.c1),c2:world(c.c2)}))}))};
}
function recoverNetwork(originals:Piece[],pixelMm:number,createId:()=>string,imageFit?:BoundaryFit){
 const g=pixelMm/.8,origin=originals[0]?.nodes[0]??{xMm:0,yMm:0},key=(p:Point)=>`${Math.round((p.xMm-origin.xMm)/g*1e8)}:${Math.round((p.yMm-origin.yMm)/g*1e8)}`,edgeKey=(a:string,b:string)=>a<b?a+'|'+b:b+'|'+a;
 const vertices=new Map<string,Point>(),rawRings=originals.map(p=>[p.nodes,...p.holes??[]]),first=rawRings.flat().find(r=>r.some((p,i)=>Math.hypot(p.xMm-r[(i+1)%r.length].xMm,p.yMm-r[(i+1)%r.length].yMm)>g*.5));
 if(!first)return {pieces:originals.map(p=>recoverContour(p,pixelMm,createId)),report:{chains:0,sharedChains:0,closedSharedChains:0,restoredChains:0,imageSupportedChains:0}};
 const ia=first.findIndex((p,i)=>Math.hypot(p.xMm-first[(i+1)%first.length].xMm,p.yMm-first[(i+1)%first.length].yMm)>g*.5),a=first[ia],b=first[(ia+1)%first.length],d=Math.hypot(b.xMm-a.xMm,b.yMm-a.yMm),ux=(b.xMm-a.xMm)/d,uy=(b.yMm-a.yMm)/d;
 const project=(p:Point)=>({u:(p.xMm-a.xMm)*ux+(p.yMm-a.yMm)*uy,v:-(p.xMm-a.xMm)*uy+(p.yMm-a.yMm)*ux}),line=(p:Point,q:Point)=>{const x=project(p),y=project(q);return Math.abs(x.v-y.v)<g*1e-6?'u:'+Math.round(x.v/g*1e8):Math.abs(x.u-y.u)<g*1e-6?'v:'+Math.round(x.u/g*1e8):undefined;},coordinate=(p:Point,l:string)=>l.startsWith('u:')?project(p).u:project(p).v;
 const buckets=new Map<string,Map<string,Point>>();for(const rings of rawRings)for(const r of rings)for(let i=0;i<r.length;i++){const p=r[i],q=r[(i+1)%r.length];vertices.set(key(p),vertices.get(key(p))??p);vertices.set(key(q),vertices.get(key(q))??q);const l=line(p,q);if(l){const bucket=buckets.get(l)??new Map();bucket.set(key(p),vertices.get(key(p))!);bucket.set(key(q),vertices.get(key(q))!);buckets.set(l,bucket);}}
 const sorted=new Map([...buckets].map(([l,v])=>[l,[...v.values()].sort((a,b)=>coordinate(a,l)-coordinate(b,l))]));
 const graph=new Map<string,Edge>(),paths:Path[][]=[];
 for(const [owner,rings]of rawRings.entries()){const group:Path[]=[];for(const [ri,r]of rings.entries()){const keys:string[]=[],edges:string[]=[];
  for(let i=0;i<r.length;i++){const p=r[i],q=r[(i+1)%r.length],l=line(p,q),x=l?coordinate(p,l):0,y=l?coordinate(q,l):0;
   let span=l?sorted.get(l)!.filter(n=>coordinate(n,l)>=Math.min(x,y)-g*1e-7&&coordinate(n,l)<=Math.max(x,y)+g*1e-7):[p,q];if(l&&x>y)span=span.reverse();
   for(let j=0;j+1<span.length;j++){const ka=key(span[j]),kb=key(span[j+1]);if(ka===kb)continue;const k=edgeKey(ka,kb),e=graph.get(k)??{a:ka,b:kb,owners:new Set<number>(),rings:new Set<string>(),pair:''};e.owners.add(owner);e.rings.add(owner+':'+ri);graph.set(k,e);keys.push(ka);edges.push(k);}
  }group.push({keys,edges});}paths.push(group);}
 const atVertex=new Map<string,string[]>();for(const [k,e]of graph){e.pair=[...e.owners].sort((a,b)=>a-b).join(':');for(const v of[e.a,e.b]){const ids=atVertex.get(v)??[];ids.push(k);atVertex.set(v,ids);}}
 const junction=(v:string,pair:string)=>{const edges=atVertex.get(v)!;return edges.some(k=>graph.get(k)!.pair!==pair)||edges.filter(k=>graph.get(k)!.pair===pair).length!==2;};
 const chains:Chain[]=[];
 for(const [initial,e]of graph){if(e.chain!==undefined)continue;const start=junction(e.a,e.pair)?e.a:junction(e.b,e.pair)?e.b:e.a,keys=[start],edgeIds:string[]=[];let current=start,nextEdge=initial;
  for(let guard=0;guard<=graph.size;guard++){const edge=graph.get(nextEdge)!;if(edge.chain!==undefined)break;edge.chain=chains.length;edgeIds.push(nextEdge);current=edge.a===current?edge.b:edge.a;keys.push(current);if(current===start||junction(current,e.pair))break;const next=atVertex.get(current)!.find(k=>k!==nextEdge&&graph.get(k)!.pair===e.pair&&graph.get(k)!.chain===undefined);if(!next)break;nextEdge=next;}
  const closed=keys.at(-1)===start;if(closed)keys.pop();const raw=keys.map(k=>vertices.get(k)!),owners=new Set(edgeIds.flatMap(k=>[...graph.get(k)!.owners])),hole=edgeIds.some(k=>[...graph.get(k)!.rings].some(r=>!r.endsWith(':0')));
  // Cycle traversal can start inside an open path. Finish its other half so
  // each nonbranching component has exactly its true junction endpoints.
  if(!closed&&!junction(start,e.pair)){
   let head=start;while(!junction(head,e.pair)){const previous=atVertex.get(head)!.find(k=>graph.get(k)!.pair===e.pair&&graph.get(k)!.chain===undefined);if(!previous)break;const edge=graph.get(previous)!;edge.chain=chains.length;edgeIds.unshift(previous);head=edge.a===head?edge.b:edge.a;raw.unshift(vertices.get(head)!);}
  }
  const anchors=raw.filter(p=>junction(key(p),e.pair)).map(key);
  // A closed contact loop has a real junction, unlike an isolated island.
  // Retain its raster anchors; moving it would detach the neighbouring chain.
  const rasterFit=closed?anchors.length?recoverBoundaryLoop(raw,pixelMm,createId,new Set(raw.filter(p=>anchors.includes(key(p))).map(p=>p.id))):recoverContour({...originals[[...owners][0]],nodes:raw,holes:[],curves:[]},pixelMm,createId):recoverBoundaryChain(raw,pixelMm,createId);
  const measured=closed&&anchors.length?undefined:imageFit?.(raw,closed,[...owners].map(owner=>originals[owner].color),createId);
  const fitted=measured??rasterFit;
  // Polygon-only holes and their other owner share these exact samples. The
  // finer curve fit need not turn flattening samples into excessive editable
  // nodes; the assembled polygon still passes the full 1.05-pixel bound below.
  let nodes=fitted.nodes,curves=fitted.curves??[];if(hole){nodes=contourPolyline(nodes,curves,closed,g*.06,createId);curves=[];}
  chains.push({raw,closed,anchors,edges:edgeIds,owners,hole,nodes,curves,restored:false,...(fitted===measured?{raster:{nodes:hole?contourPolyline(rasterFit.nodes,rasterFit.curves??[],closed,g*.06,createId):rasterFit.nodes,curves:hole?[]:rasterFit.curves??[]}}:{})});
 }
 const reverse=(c:Chain)=>({nodes:[...c.nodes].reverse(),curves:c.curves.map(v=>({...v,startNodeId:v.endNodeId,endNodeId:v.startNodeId,c1:v.c2,c2:v.c1}))});
 const signed=(r:Point[])=>r.reduce((s,p,i)=>{const q=r[(i+1)%r.length],o=r[0];return s+(p.xMm-o.xMm)*(q.yMm-o.yMm)-(q.xMm-o.xMm)*(p.yMm-o.yMm);},0);
 const assemble=()=>originals.map((original,owner)=>{let outerCurves:Curve[]=[];const rings=paths[owner].map((path,ri)=>{const chainIds=path.edges.map(k=>graph.get(k)!.chain!);let start=chainIds.findIndex((id,i)=>id!==chainIds[(i+chainIds.length-1)%chainIds.length]);if(start<0)start=Math.max(0,path.keys.indexOf(key(chains[chainIds[0]].raw[0])));
   const nodes:Point[]=[],pending:Curve[]=[];let consumed=0;
   while(consumed<chainIds.length){const index=(start+consumed)%chainIds.length,id=chainIds[index],c=chains[id];let count=1;while(consumed+count<chainIds.length&&chainIds[(index+count)%chainIds.length]===id)count++;
    const directed=c.closed?Math.sign(signed(c.raw))===Math.sign(signed(rawRings[owner][ri]))?c:reverse(c):path.keys[index]===key(c.raw[0])&&path.keys[(index+1)%path.keys.length]===key(c.raw[1])?c:reverse(c);
    const list=c.closed?directed.nodes:directed.nodes.slice(0,-1);nodes.push(...list);if(!ri)pending.push(...directed.curves);consumed+=count;
   }
   const fresh=nodes.map(p=>({...p,id:createId()})),byCoordinate=new Map(fresh.map(p=>[key(p),p.id]));if(!ri)outerCurves=pending.map(c=>{const startPoint=nodes.find(p=>p.id===c.startNodeId)!,endPoint=nodes.find(p=>p.id===c.endNodeId)!;return {...c,id:createId(),startNodeId:byCoordinate.get(key(startPoint))!,endNodeId:byCoordinate.get(key(endPoint))!,c1:{...c.c1,id:createId()},c2:{...c.c2,id:createId()}};});return fresh;
  });return {...original,nodes:rings[0],holes:rings.slice(1),curves:outerCurves};});
 const crossingChains=()=>{
  const segments:{a:Point;b:Point;chain:number;index:number;count:number}[]=[],boxes:Box[]=[],epsilon=g*1e-8;
  for(const [chain,c]of chains.entries()){const ring=contourPolyline(c.nodes,c.curves,c.closed,Math.min(.001,g*.005),createId),count=ring.length-(c.closed?0:1);for(let i=0;i<count;i++){const a=ring[i],b=ring[(i+1)%ring.length];segments.push({a,b,chain,index:i,count});boxes.push([Math.min(a.xMm,b.xMm)-epsilon,Math.min(a.yMm,b.yMm)-epsilon,Math.max(a.xMm,b.xMm)+epsilon,Math.max(a.yMm,b.yMm)+epsilon]);}}
  const index=boxIndex(boxes),bad=new Map<number,Point[]>(),distance=(p:Point,a:Point,b:Point)=>{const x=b.xMm-a.xMm,y=b.yMm-a.yMm,l=x*x+y*y,t=l?Math.max(0,Math.min(1,((p.xMm-a.xMm)*x+(p.yMm-a.yMm)*y)/l)):0;return Math.hypot(p.xMm-a.xMm-t*x,p.yMm-a.yMm-t*y);},cross=(a:Point,b:Point,p:Point)=>(b.xMm-a.xMm)*(p.yMm-a.yMm)-(b.yMm-a.yMm)*(p.xMm-a.xMm);
  for(const [i,s]of segments.entries())for(const j of index.query(boxes[i])){if(j>=i)continue;const t=segments[j];if(s.chain===t.chain&&(Math.abs(s.index-t.index)===1||chains[s.chain].closed&&Math.abs(s.index-t.index)===s.count-1))continue;
   const a=cross(s.a,s.b,t.a),b=cross(s.a,s.b,t.b),c=cross(t.a,t.b,s.a),d=cross(t.a,t.b,s.b),sl=Math.hypot(s.b.xMm-s.a.xMm,s.b.yMm-s.a.yMm),tl=Math.hypot(t.b.xMm-t.a.xMm,t.b.yMm-t.a.yMm),proper=a*b<0&&c*d<0&&Math.min(Math.abs(a),Math.abs(b))>epsilon*sl&&Math.min(Math.abs(c),Math.abs(d))>epsilon*tl;
   const ca=chains[s.chain],cb=chains[t.chain],ends=(v:Chain)=>v.anchors,common=new Set(ends(ca).filter(k=>ends(cb).includes(k)));
   const contact=[[s.a,t.a,t.b],[s.b,t.a,t.b],[t.a,s.a,s.b],[t.b,s.a,s.b]].some(([p,a,b])=>distance(p,a,b)<=epsilon&&!common.has(key(p)));
   if(proper||contact){const points=proper?[{...t.a,xMm:t.a.xMm+(t.b.xMm-t.a.xMm)*a/(a-b),yMm:t.a.yMm+(t.b.yMm-t.a.yMm)*a/(a-b)}]:[[s.a,t.a,t.b],[s.b,t.a,t.b],[t.a,s.a,s.b],[t.b,s.a,s.b]].filter(([p,a,b])=>distance(p,a,b)<=epsilon&&!common.has(key(p))).map(([p])=>p);for(const edge of [s,t])bad.set(edge.chain,[...(bad.get(edge.chain)??[]),...points]);}
  }
  return bad;
 };
 let pieces=assemble();const valid=(piece:Piece,i:number)=>piece.nodes.length>=3&&piece.nodes.length<=2000&&piece.holes?.every(r=>r.length>=3&&r.length<=2000)!==false&&safeContour(piece,originals[i],pixelMm)&&contourBoundaryError(piece,originals[i],g*.1,g*1.05)<=g*1.05;
 // A coarse arc may satisfy the distance envelope but miss a small owner's
 // area budget. Increase the fit's resolution before discarding its geometry.
 // Subdivision uses original measured vertices; both material owners still
 // receive exactly the same boundary and the final contracts are unchanged.
 const refine=(chain:Chain,depth:number)=>{
  const source=chain.closed?[...chain.raw,chain.raw[0]]:chain.raw;
  const fit=(raw:Point[],level:number):{nodes:Point[];curves:Curve[]}=>{
   if(!level||raw.length<4)return recoverBoundaryChain(raw,pixelMm,createId);
   const arc=[0];for(let i=1;i<raw.length;i++)arc.push(arc.at(-1)!+Math.hypot(raw[i].xMm-raw[i-1].xMm,raw[i].yMm-raw[i-1].yMm));
   let middle=1;while(middle+1<raw.length-1&&arc[middle]<arc.at(-1)!/2)middle++;
   const a=fit(raw.slice(0,middle+1),level-1),b=fit(raw.slice(middle),level-1);
   return {nodes:[...a.nodes.slice(0,-1),...b.nodes],curves:[...a.curves,...b.curves]};
  };
  const result=fit(source,depth);if(chain.closed)result.nodes.pop();
  if(chain.hole)return {nodes:contourPolyline(result.nodes,result.curves,chain.closed,g*.06,createId),curves:[]};
  return result;
 };
 // Restore shared chains coherently. Prefer the smallest one-chain repair that
 // makes the failed source valid; never let its neighbour keep a different fit.
 // A restoration consumes a chain; between restorations, each accepted refit
 // makes at least one additional owner valid without invalidating another.
 // Include both kinds of progress in the bound (a refit consumes no chain).
 const maxPasses=(chains.length+1)*(originals.length+1);
 const protectedEdges=new Map<Chain,Set<number>>();
 // A subpixel collision at a narrow gap must not turn the rest of a long
 // shared contour back into stairs. Retain measured edges only at that gap;
 // refit the remaining intervals with these exact contact endpoints fixed.
 const protectContact=(chain:Chain,contacts:Point[])=>{
  const raw=chain.raw,n=raw.length-(chain.closed?0:1),protectedSet=protectedEdges.get(chain)??new Set<number>();
  for(const p of contacts){let nearest=0,best=Infinity;for(let i=0;i<n;i++){const a=raw[i],b=raw[(i+1)%raw.length],dx=b.xMm-a.xMm,dy=b.yMm-a.yMm,t=Math.max(0,Math.min(1,((p.xMm-a.xMm)*dx+(p.yMm-a.yMm)*dy)/(dx*dx+dy*dy||1))),d=Math.hypot(p.xMm-a.xMm-t*dx,p.yMm-a.yMm-t*dy);if(d<best){best=d;nearest=i;}}
   const before=protectedSet.size;for(let radius=2;radius<=n;radius++){for(let k=nearest-radius;k<=nearest+radius;k++){if(chain.closed)protectedSet.add((k%n+n)%n);else if(k>=0&&k<n)protectedSet.add(k);}if(protectedSet.size>before||protectedSet.size===n)break;}
  }
  if(chain.closed)for(let i=0;i<raw.length;i++)if(chain.anchors.includes(key(raw[i]))){protectedSet.add(i);protectedSet.add((i+n-1)%n);}
  protectedEdges.set(chain,protectedSet);if(protectedSet.size===n){chain.nodes=raw;chain.curves=[];chain.restored=true;return;}
  const start=chain.closed?[...protectedSet][0]:0,nodes:Point[]=[],curves:Curve[]=[];let consumed=0;
  while(consumed<n){const index=(start+consumed)%raw.length,keep=protectedSet.has(index);let count=1;while(consumed+count<n&&protectedSet.has((start+consumed+count)%raw.length)===keep)count++;
   const span=Array.from({length:count+1},(_,k)=>raw[(start+consumed+k)%raw.length]),fit=keep?{nodes:span,curves:[]}:recoverBoundaryChain(span,pixelMm,createId);nodes.push(...fit.nodes.slice(0,-1));curves.push(...fit.curves);consumed+=count;
  }
  if(!chain.closed)nodes.push(raw.at(-1)!);
  chain.nodes=chain.hole?contourPolyline(nodes,curves,chain.closed,g*.06,createId):nodes;chain.curves=chain.hole?[]:curves;
 };
 for(let pass=0;pass<maxPasses;pass++){
  const crossing=crossingChains();if(crossing.size){const active=[...crossing].filter(([i])=>!chains[i].restored);if(!active.length)throw Error('RESOURCE_LIMIT');for(const [i,contacts] of active){const c=chains[i];if(c.raster){Object.assign(c,c.raster);c.raster=undefined;}else protectContact(c,contacts);}pieces=assemble();continue;}
  const failed=pieces.findIndex((p,i)=>!valid(p,i));if(failed<0)break;
  const measured=chains.filter(c=>c.owners.has(failed)&&c.raster);if(measured.length){for(const c of measured){Object.assign(c,c.raster);c.raster=undefined;}pieces=assemble();continue;}
  const incident=chains.filter(c=>c.owners.has(failed)&&!c.restored).sort((a,b)=>a.raw.length-a.nodes.length-(b.raw.length-b.nodes.length));let fixed=false;
  for(const c of incident){
   const before={nodes:c.nodes,curves:c.curves};
   for(const depth of [1,2]){
    Object.assign(c,refine(c,depth));const candidate=assemble();
    if(valid(candidate[failed],failed)&&[...c.owners].every(owner=>!valid(pieces[owner],owner)||valid(candidate[owner],owner))){pieces=candidate;fixed=true;break;}
    Object.assign(c,before);
   }
   if(fixed)break;
  }
  if(fixed)continue;
  for(const c of incident){const before={nodes:c.nodes,curves:c.curves};c.nodes=c.raw;c.curves=[];const candidate=assemble();if(valid(candidate[failed],failed)){c.restored=true;pieces=candidate;fixed=true;break;}Object.assign(c,before);}
  if(!fixed){if(!incident.length)throw Error('RESOURCE_LIMIT');for(const c of incident){c.nodes=c.raw;c.curves=[];c.restored=true;}pieces=assemble();}
 }
 if(pieces.some((p,i)=>!valid(p,i)))throw Error('RESOURCE_LIMIT');
 return {pieces,report:{imageSupportedChains:chains.filter(c=>!!c.raster).length,chains:chains.length,sharedChains:chains.filter(c=>c.owners.size>1).length,closedSharedChains:chains.filter(c=>c.closed&&c.owners.size>1).length,restoredChains:chains.filter(c=>c.restored).length}};
}
