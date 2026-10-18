import type {Surface} from '../schema/index';
import {boxIndex,type Box} from './spatial';

type ScreenPoint={x:number;y:number;z:number;inverseDepth:number};
type ScreenLine={key:string;a:ScreenPoint;b:ScreenPoint};
const box=(points:ScreenPoint[]):Box=>[Math.min(...points.map(p=>p.x)),Math.min(...points.map(p=>p.y)),Math.max(...points.map(p=>p.x)),Math.max(...points.map(p=>p.y))];

/** Clip overlays to the visible surface, independent of the GPU/Canvas/SVG
 * renderer. Reciprocal camera depth is affine in screen space, so perspective
 * occlusion and depth crossings can be clipped exactly without pixel sampling. */
export function surfaceLineVisibility(surface:Surface,project:(p:Surface['vertices'][number])=>ScreenPoint,perspective=false){
 const vertices=new Map(surface.vertices.map(v=>[v.id,project(v)]));
 const triangles=surface.faces.map(face=>{
  const p=face.vertices.map(id=>vertices.get(id)!);
  const det=(p[1].x-p[0].x)*(p[2].y-p[0].y)-(p[1].y-p[0].y)*(p[2].x-p[0].x);
  return {p,det,box:box(p)};
 }).filter(t=>Math.abs(t.det)>1e-10);
 const index=boxIndex(triangles.map(t=>t.box));
 return function visible<T extends ScreenLine>(lines:T[]):T[]{
  return lines.flatMap(line=>{
   const {a,b}=line,hidden:[number,number][]=[];
   for(const id of index.query(box([a,b]))){
    const {p,det}=triangles[id];
    if(Math.max(...p.map(v=>v.z))<Math.min(a.z,b.z)-1e-6)continue;
    const weights=(v:ScreenPoint)=>{
     const u=((v.x-p[0].x)*(p[2].y-p[0].y)-(v.y-p[0].y)*(p[2].x-p[0].x))/det;
     const w=((p[1].x-p[0].x)*(v.y-p[0].y)-(p[1].y-p[0].y)*(v.x-p[0].x))/det;
     return [1-u-w,u,w];
    };
    const wa=weights(a),wb=weights(b);let lo=0,hi=1;
    // Restrict this screen segment to the triangle and then its front half-space.
    const clip=(v0:number,v1:number)=>{
     if(v0<0&&v1<0)return false;
     if(v0<0)lo=Math.max(lo,v0/(v0-v1));
     else if(v1<0)hi=Math.min(hi,v0/(v0-v1));
     return hi>lo;
    };
    if(!wa.every((w,i)=>clip(w+1e-10,wb[i]+1e-10)))continue;
    const depth=(v:ScreenPoint)=>perspective?v.inverseDepth:v.z;
    // A 1e-6 mm depth bias prevents a seam hiding itself through roundoff.
    const bias=1e-6*(perspective?Math.max(a.inverseDepth,b.inverseDepth,...p.map(v=>v.inverseDepth))**2:1);
    const front=(w:number[],v:ScreenPoint)=>w.reduce((s,n,i)=>s+n*depth(p[i]),0)-depth(v)-bias;
    if(clip(front(wa,a),front(wb,b)))hidden.push([lo,hi]);
   }
   hidden.sort((a,b)=>a[0]-b[0]);
   const intervals:[number,number][]=[];let start=0;
   for(const [lo,hi] of hidden){if(lo>start+1e-9)intervals.push([start,lo]);start=Math.max(start,hi);}
   if(start<1-1e-9)intervals.push([start,1]);
   const at=(t:number):ScreenPoint=>{
    const q=a.inverseDepth+(b.inverseDepth-a.inverseDepth)*t;
    return {x:a.x+(b.x-a.x)*t,y:a.y+(b.y-a.y)*t,inverseDepth:q,z:((1-t)*a.z*a.inverseDepth+t*b.z*b.inverseDepth)/q};
   };
   return intervals.map(([lo,hi],i)=>({...line,key:line.key+':visible:'+i,a:at(lo),b:at(hi)}));
  });
 };
}
