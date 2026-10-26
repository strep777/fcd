import type {Marking,Surface} from '../schema/index';
import {shapePoint,type Shape,type Point} from './attached-edit';
import {projectionFaces} from './projection-scope';
import {decalChart} from './decal-chart';
import {sampleShapeContour} from './shape-contour';
import {triangleWeights} from './triangles';
import {boxIndex,boxesOverlap,type Box} from './spatial';

const area=(r:Point[])=>r.reduce((s,p,i)=>{const q=r[(i+1)%r.length];return s+p.xMm*q.yMm-q.xMm*p.yMm;},0)/2;
function halfPlane(ring:Point[],value:(p:Point)=>number):Point[]{
 const out:Point[]=[];
 for(let i=0;i<ring.length;i++){const p=ring[i],q=ring[(i+1)%ring.length],a=value(p),b=value(q);if(a>=0)out.push(p);if((a>=0)!==(b>=0)){const t=a/(a-b);out.push({xMm:p.xMm+t*(q.xMm-p.xMm),yMm:p.yMm+t*(q.yMm-p.yMm)});}}
 return out;
}
const side=(a:Point,b:Point)=>(p:Point)=>(b.xMm-a.xMm)*(p.yMm-a.yMm)-(b.yMm-a.yMm)*(p.xMm-a.xMm);
function subtractConvex(ring:Point[],clip:Point[]):Point[][]{
 const outside:Point[][]=[];let inside=ring;
 for(let i=0;i<clip.length&&inside.length;i++){
  const value=side(clip[i],clip[(i+1)%clip.length]),part=halfPlane(inside,p=>-value(p));
  if(part.length>=3&&Math.abs(area(part))>1e-8)outside.push(part);
  inside=halfPlane(inside,value);
 }
 return outside;
}
/** Live and saved projection both subtract the triangle portion actually in
 * front, including partial occlusion and triangles crossing in depth. */
export function previewFragments(surface:Surface,shape:Shape,budget=2000000):Marking['fragments']|undefined{
 const outer=sampleShapeContour(shape),rings=[outer,...shape.holes??[]],scope=projectionFaces(surface,shape);
 const box=(points:Point[]):Box=>[Math.min(...points.map(p=>p.xMm)),Math.min(...points.map(p=>p.yMm)),Math.max(...points.map(p=>p.xMm)),Math.max(...points.map(p=>p.yMm))];
 const chart=decalChart(surface,shape);
 const bounds=box(outer),vertices=new Map(surface.vertices.map(v=>[v.id,{point:chart?.get(v.id)??shapePoint(shape,v),depth:chart?.has(v.id)?-chart.get(v.id)!.distanceMm:shape.axes[2].reduce((s,n,i)=>s+n*([v.xMm,v.yMm,v.zMm][i]-shape.origin[i]),0)}]));
 const faces=surface.faces.filter(f=>!chart||f.vertices.every(id=>chart.has(id))).map(face=>{
  const v=face.vertices.map(id=>vertices.get(id)!),triangle=v.map(v=>v.point),depth=v.map(v=>v.depth);
  return {face,triangle,depth,box:box(triangle),det:area(triangle)};
 }).filter(f=>Math.abs(f.det)>1e-8&&boxesOverlap(f.box,bounds));
 const index=boxIndex(faces.map(f=>f.box)),result:Marking['fragments']=[];let work=0;
 for(const f of faces){
  if(f.det<=0||scope&&!scope.has(f.face.id))continue;
  let clipped=rings.map(r=>{let p=r;for(let i=0;i<3&&p.length;i++)p=halfPlane(p,side(f.triangle[i],f.triangle[(i+1)%3]));return p;}).filter(r=>r.length>=3&&Math.abs(area(r))>1e-8);
  const depth=(p:Point,t:typeof f)=>triangleWeights([p.xMm,p.yMm],t.triangle.map(v=>[v.xMm,v.yMm])).reduce((s,w,i)=>s+w*t.depth[i],0);
  for(const n of index.query(f.box)){
   const other=faces[n];if(other===f||Math.max(...other.depth)<Math.min(...f.depth)-1e-6)continue;
   let occluder=halfPlane(other.triangle,p=>depth(p,other)-depth(p,f)-1e-6);
   if(occluder.length<3||Math.abs(area(occluder))<1e-8)continue;
   if(area(occluder)<0)occluder=occluder.reverse();
   work+=clipped.reduce((s,r)=>s+r.length*occluder.length,0);if(work>budget)return;
   clipped=clipped.flatMap(r=>subtractConvex(r,occluder));if(!clipped.length)break;
  }
  if(clipped.length)result.push({faceId:f.face.id,rings:clipped.map(r=>r.map(p=>{
   const weights=triangleWeights([p.xMm,p.yMm],f.triangle.map(p=>[p.xMm,p.yMm])),positive=weights.map(w=>Math.max(0,Math.min(1,w))),sum=positive.reduce((n,w)=>n+w,0);
   return positive.map(w=>w/sum) as [number,number,number];
  }))});
 }
 return result;
}
