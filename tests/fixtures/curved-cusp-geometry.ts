// Pure test geometry mechanically migrated from the validated diagnostic helper.
import type {Piece,Point} from '../../packages/schema/index';

export type XY={x:number;y:number};
export type GeometrySegment={a:XY;b:XY;c1?:XY|null;c2?:XY|null;ring:number;index?:number;segment?:number;startId:string;endId:string;t0?:number;t1?:number};
export type PathSegment=GeometrySegment&{index:number;c1:XY|null;c2:XY|null};
export type FlatEdge=GeometrySegment&{segment:number;t0:number;t1:number};
type Box=[number,number,number,number];
type IndexedEdge=FlatEdge&{ordinal:number;box:Box};
type TreeNode={bounds:Box;es?:IndexedEdge[];left?:TreeNode;right?:TreeNode};
type EdgeLocation=Pick<FlatEdge,'ring'|'segment'|'startId'|'endId'|'a'|'b'|'t0'|'t1'>&{ordinal:number};
type NearestHit={distance:number;point?:XY;t?:number;edge?:EdgeLocation;pathT?:number};
type Crossing={a:{ring:number;segment:number;flattenIndex:number};b:{ring:number;segment:number;flattenIndex:number}};

export const dist=(a:XY,b:XY)=>Math.hypot(a.x-b.x,a.y-b.y);
const lerp=(a:XY,b:XY,t:number)=>({x:a.x+(b.x-a.x)*t,y:a.y+(b.y-a.y)*t});
export function projection(p:XY,a:XY,b:XY){const dx=b.x-a.x,dy=b.y-a.y,l=dx*dx+dy*dy,t=l?Math.max(0,Math.min(1,((p.x-a.x)*dx+(p.y-a.y)*dy)/l)):0;const q=lerp(a,b,t);return{distance:dist(p,q),point:q,t};}
export function pathSegments(piece:Piece,map:(p:Pick<Point,'xMm'|'yMm'>)=>XY=p=>({x:p.xMm,y:p.yMm})):PathSegment[][]{
 const curves=new Map((piece.curves??[]).map(c=>[c.startNodeId,c]));
 return[piece.nodes,...piece.holes??[]].map((ring,ringIndex)=>ring.map((a,i)=>{const b=ring[(i+1)%ring.length],c=curves.get(a.id);return{ring:ringIndex,index:i,startId:a.id,endId:b.id,a:map(a),b:map(b),c1:c?map(c.c1):null,c2:c?map(c.c2):null};}));
}
export function evaluate(s:GeometrySegment,t:number){if(!s.c1)return lerp(s.a,s.b,t);const u=1-t;return{x:u**3*s.a.x+3*u*u*t*s.c1.x+3*u*t*t*s.c2!.x+t**3*s.b.x,y:u**3*s.a.y+3*u*u*t*s.c1.y+3*u*t*t*s.c2!.y+t**3*s.b.y};}
export function sampleSegments(segments:GeometrySegment[],step:number,endpoint=false){return segments.flatMap(s=>{const reach=s.c1?dist(s.a,s.c1)+dist(s.c1,s.c2!)+dist(s.c2!,s.b):dist(s.a,s.b),count=Math.max(1,Math.ceil(reach/step));return Array.from({length:count+(endpoint?1:0)},(_,j)=>({...evaluate(s,j/count),ring:s.ring,segment:s.index,t:j/count,startId:s.startId,endId:s.endId}));});}
export function flatten(segments:PathSegment[],tolerance=.001){const out:FlatEdge[]=[];function append(s:PathSegment,a:XY,c1:XY|null,c2:XY|null,b:XY,t0:number,t1:number,depth=0):void{if(depth>24||out.length>100000)throw Error('DIAGNOSTIC_FLATTEN_BUDGET');if(!c1||Math.max(projection(c1,a,b).distance,projection(c2!,a,b).distance)<=tolerance){out.push({a,b,ring:s.ring,segment:s.index,startId:s.startId,endId:s.endId,t0,t1});return;}const p=lerp(a,c1,.5),q=lerp(c1,c2!,.5),r=lerp(c2!,b,.5),u=lerp(p,q,.5),v=lerp(q,r,.5),m=lerp(u,v,.5),tm=(t0+t1)/2;append(s,a,p,u,m,t0,tm,depth+1);append(s,m,v,r,b,tm,t1,depth+1);}
 for(const s of segments)append(s,s.a,s.c1,s.c2,s.b,0,1);return out;
}
function box(s:Pick<GeometrySegment,'a'|'b'>):Box{return[Math.min(s.a.x,s.b.x),Math.min(s.a.y,s.b.y),Math.max(s.a.x,s.b.x),Math.max(s.a.y,s.b.y)];}
function union(bs:Box[]){return bs.reduce<Box>((a,b)=>[Math.min(a[0],b[0]),Math.min(a[1],b[1]),Math.max(a[2],b[2]),Math.max(a[3],b[3])],[Infinity,Infinity,-Infinity,-Infinity]);}
function boxDistance(p:XY,b:Box){return Math.hypot(Math.max(b[0]-p.x,0,p.x-b[2]),Math.max(b[1]-p.y,0,p.y-b[3]));}
export function nearestIndex(edges:FlatEdge[]){const indexed=edges.map((e,i)=>({...e,ordinal:i,box:box(e)}));function build(es:IndexedEdge[]):TreeNode{const bounds=union(es.map(e=>e.box));if(es.length<=8)return{bounds,es};const dim=bounds[2]-bounds[0]>=bounds[3]-bounds[1]?0:1;es.sort((a,b)=>a.box[dim]+a.box[dim+2]-b.box[dim]-b.box[dim+2]);const n=es.length>>1;return{bounds,left:build(es.slice(0,n)),right:build(es.slice(n))};}const root=build(indexed);return(p:XY,radius=Infinity)=>{let best:NearestHit={distance:Infinity};const eligible=(b:Box)=>b[0]<=p.x+radius&&b[2]>=p.x-radius&&b[1]<=p.y+radius&&b[3]>=p.y-radius;function visit(n:TreeNode):void{if(!eligible(n.bounds)||boxDistance(p,n.bounds)>best.distance)return;if(n.es){for(const e of n.es){if(!eligible(e.box)||boxDistance(p,e.box)>best.distance)continue;const hit=projection(p,e.a,e.b);if(hit.distance<best.distance)best={...hit,edge:{ring:e.ring,segment:e.segment,startId:e.startId,endId:e.endId,ordinal:e.ordinal,a:e.a,b:e.b,t0:e.t0,t1:e.t1},pathT:e.t0===undefined?undefined:e.t0+(e.t1-e.t0)*hit.t};}return;}const l=boxDistance(p,n.left!.bounds),r=boxDistance(p,n.right!.bounds);if(l<r){visit(n.left!);visit(n.right!);}else{visit(n.right!);visit(n.left!);}}visit(root);return best;};}
export const polygonArea=(ps:XY[])=>ps.reduce((v,a,i)=>{const b=ps[(i+1)%ps.length],o=ps[0];return v+(a.x-o.x)*(b.y-o.y)-(b.x-o.x)*(a.y-o.y);},0)/2;
export function exactPathArea(segments:PathSegment[]){let sum=0;for(const s of segments){const coeff=(a:number,c1:number|null,c2:number|null,b:number)=>c1===null?[a,b-a]:[a,3*(c1-a),3*(a-2*c1+c2!),-a+3*c1-3*c2!+b],x=coeff(s.a.x,s.c1?.x??null,s.c2?.x??null,s.b.x),y=coeff(s.a.y,s.c1?.y??null,s.c2?.y??null,s.b.y);for(let i=0;i<x.length;i++)for(let j=1;j<y.length;j++)sum+=(x[i]*j*y[j]-y[i]*j*x[j])/(i+j);}return sum/2;}
const cross=(a:XY,b:XY,c:XY)=>(b.x-a.x)*(c.y-a.y)-(b.y-a.y)*(c.x-a.x);
export function intersections(rings:FlatEdge[][]){const edges=rings.flatMap((es,r)=>es.map((e,i)=>({...e,r,i,n:es.length,box:box(e)}))).sort((a,b)=>a.box[0]-b.box[0]);const found:Crossing[]=[];const on=(p:XY,a:XY,b:XY)=>Math.abs(cross(a,b,p))<=1e-9&&p.x>=Math.min(a.x,b.x)-1e-9&&p.x<=Math.max(a.x,b.x)+1e-9&&p.y>=Math.min(a.y,b.y)-1e-9&&p.y<=Math.max(a.y,b.y)+1e-9;for(let i=0;i<edges.length;i++)for(let j=i+1;j<edges.length&&edges[j].box[0]<=edges[i].box[2]+1e-9;j++){const a=edges[i],b=edges[j];if(a.box[1]>b.box[3]+1e-9||b.box[1]>a.box[3]+1e-9)continue;if(a.r===b.r&&(Math.abs(a.i-b.i)===1||Math.abs(a.i-b.i)===a.n-1))continue;if(cross(a.a,a.b,b.a)*cross(a.a,a.b,b.b)<0&&cross(b.a,b.b,a.a)*cross(b.a,b.b,a.b)<0||on(a.a,b.a,b.b)||on(a.b,b.a,b.b)||on(b.a,a.a,a.b)||on(b.b,a.a,a.b))found.push({a:{ring:a.r,segment:a.segment,flattenIndex:a.i},b:{ring:b.r,segment:b.segment,flattenIndex:b.i}});}return found;}
