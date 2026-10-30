import type {Surface} from '../schema/index';
import {shapePoint,type Shape,type Point} from './attached-edit';
import {sampleShapeContour} from './shape-contour';
import {createPlacementClips} from './garment-anatomy';

type V=[number,number,number];
const dot=(a:V,b:V)=>a.reduce((s,x,i)=>s+x*b[i],0);
const cross=(a:V,b:V):V=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
const unit=(a:V):V=>{const l=Math.hypot(...a);return l>1e-12?a.map(x=>x/l) as V:[0,0,1];};
const sub=(a:V,b:V)=>a.map((x,i)=>x-b[i]) as V;
/** Intrinsic local coordinates. Integrate edge lengths in parallel-transported
 * tangent frames, so a decal can cross the silhouette of its original plane.
 * Vertices have one shared coordinate: neighbouring fragments cannot crack. */
export function decalChart(surface:Surface,shape:Shape):Map<string,Point&{distanceMm:number}>|undefined{
 if(!shape.wrap||!shape.anchorFaceId)return;
 const anchor=surface.faces.find(f=>f.id===shape.anchorFaceId);if(!anchor)return new Map();
 const positions=new Map(surface.vertices.map(v=>[v.id,[v.xMm,v.yMm,v.zMm] as V]));
 const normals=new Map<string,V>(),neighbors=new Map<string,Set<string>>(),regionClips=shape.regions?createPlacementClips(surface,shape.regions):undefined;
 for(const f of surface.faces){
  if(regionClips&&!regionClips(f).length)continue;
  const [a,b,c]=f.vertices.map(id=>positions.get(id)!),n=cross(sub(b,a),sub(c,a));
  for(const id of f.vertices){const old=normals.get(id)??[0,0,0];normals.set(id,old.map((x,i)=>x+n[i]) as V);const row=neighbors.get(id)??new Set<string>();for(const other of f.vertices)if(id!==other)row.add(other);neighbors.set(id,row);}
 }
 for(const [id,n] of normals)normals.set(id,unit(n));
 const rotate=(v:V,a:V,b:V):V=>{const axis=cross(a,b),cos=Math.max(-1,Math.min(1,dot(a,b)));if(cos<-.999999)return v;const first=cross(axis,v),second=cross(axis,first);return v.map((x,i)=>x+first[i]+second[i]/(1+cos)) as V;};
 const coords=new Map<string,Point>(),frames=new Map<string,V>(),costs=new Map<string,number>();
 const heap:{id:string;cost:number}[]=[];
 const push=(item:{id:string;cost:number})=>{let i=heap.length;heap.push(item);while(i){const p=(i-1)>>1;if(heap[p].cost<=item.cost)break;heap[i]=heap[p];i=p;}heap[i]=item;};
 const pop=()=>{const first=heap[0],last=heap.pop()!;if(heap.length){let i=0;while(i*2+1<heap.length){let c=i*2+1;if(c+1<heap.length&&heap[c+1].cost<heap[c].cost)c++;if(heap[c].cost>=last.cost)break;heap[i]=heap[c];i=c;}heap[i]=last;}return first;};
 for(const id of anchor.vertices){const p=positions.get(id)!,n=normals.get(id);if(!n)continue;const q=shapePoint(shape,{xMm:p[0],yMm:p[1],zMm:p[2]});coords.set(id,q);frames.set(id,unit(rotate(shape.axes[0],shape.axes[2],n)));const cost=Math.hypot(...sub(p,shape.origin));costs.set(id,cost);push({id,cost});}
 // A local chart never traverses a whole shoulder to reach a disconnected
 // visual overlap. Limit geodesic travel to the source's own physical reach.
 // Vertex travel can be much longer than the distance to a face interior.
 // Include a complete coarse-triangle collar; otherwise a small decal at a
 // diagonal loses the adjacent triangle merely because its far corner lies
 // outside the decal radius (even on an exactly flat rectangular sheet).
 const localReach=Math.max(...sampleShapeContour(shape).map(p=>Math.hypot(p.xMm,p.yMm)),1)*2+Math.max(...anchor.vertices.map(id=>costs.get(id)??0));
 const connected=new Set(anchor.vertices),queue=[...anchor.vertices];let longestEdge=0;
 for(let i=0;i<queue.length;i++){const a=positions.get(queue[i])!;for(const id of neighbors.get(queue[i])??[]){const b=positions.get(id)!;if(Math.min(Math.hypot(...sub(a,shape.origin)),Math.hypot(...sub(b,shape.origin)))<=localReach)longestEdge=Math.max(longestEdge,Math.hypot(...sub(b,a)));if(!connected.has(id)){connected.add(id);queue.push(id);}}}
 const reach=localReach+2*longestEdge;
 while(heap.length){const item=pop();if(item.cost!==costs.get(item.id)||item.cost>reach)continue;const a=positions.get(item.id)!,na=normals.get(item.id)!,x=frames.get(item.id)!,q=coords.get(item.id)!;
  for(const id of neighbors.get(item.id)??[]){const b=positions.get(id)!,edge=sub(b,a),length=Math.hypot(...edge),cost=item.cost+length;if(cost>reach||cost>=(costs.get(id)??Infinity))continue;
   const nb=normals.get(id)!,xb=unit(rotate(x,na,nb)),mid=unit(na.map((v,i)=>v+nb[i]) as V),xm=unit(rotate(x,na,mid)),ym=cross(mid,xm),dx=dot(edge,xm),dy=dot(edge,ym),projected=Math.hypot(dx,dy);if(projected<1e-10)continue;
   costs.set(id,cost);frames.set(id,xb);coords.set(id,{xMm:q.xMm+dx*length/projected,yMm:q.yMm+dy*length/projected});push({id,cost});
  }
 }
 // An exponential map can meet itself beyond a curved part's cut locus.
 // Retain geodesic distance so projection selects the sheet reached from the
 // picked face first, rather than declaring every chart face coplanar.
 return new Map([...coords].map(([id,p])=>[id,{...p,distanceMm:costs.get(id)!}]));
}
