import type {Marking,Surface} from '../schema/index';
import {shapePoint,type Shape,type Point} from './attached-edit';
import {surfaceSpline} from './spline';
import {sampleShapeContour} from './shape-contour';
import {triangleWeights} from './triangles';
/** Interactive tangent projection. Saved geometry is still computed by the exact
 * worker, with full visibility subtraction and manufacturing path remapping. */
export function previewFragments(surface:Surface,shape:Shape,budget=250000):Marking['fragments']|undefined{
 const outer=sampleShapeContour(shape),rings=[outer,...shape.holes??[]],all=rings.flat(),bounds={minX:Math.min(...all.map(p=>p.xMm)),maxX:Math.max(...all.map(p=>p.xMm)),minY:Math.min(...all.map(p=>p.yMm)),maxY:Math.max(...all.map(p=>p.yMm))},vertices=new Map(surface.vertices.map(v=>[v.id,shapePoint(shape,v)])),result:Marking['fragments']=[];
 let work=0;for(const face of surface.faces){const triangle=face.vertices.map(id=>vertices.get(id)!),[a,b,c]=triangle,det=(b.xMm-a.xMm)*(c.yMm-a.yMm)-(b.yMm-a.yMm)*(c.xMm-a.xMm);if(det<1e-8||Math.max(...triangle.map(p=>p.xMm))<bounds.minX||Math.min(...triangle.map(p=>p.xMm))>bounds.maxX||Math.max(...triangle.map(p=>p.yMm))<bounds.minY||Math.min(...triangle.map(p=>p.yMm))>bounds.maxY)continue;
  const clipped:Point[][]=[];for(const ring of rings){if((work+=ring.length*3)>budget)return;let points=ring;for(let i=0;i<3&&points.length;i++){const a=triangle[i],b=triangle[(i+1)%3],value=(p:Point)=>(b.xMm-a.xMm)*(p.yMm-a.yMm)-(b.yMm-a.yMm)*(p.xMm-a.xMm),next:Point[]=[];for(let j=0;j<points.length;j++){const p=points[j],q=points[(j+1)%points.length],vp=value(p),vq=value(q);if(vp>=0)next.push(p);if((vp>=0)!==(vq>=0)){const t=vp/(vp-vq);next.push({xMm:p.xMm+t*(q.xMm-p.xMm),yMm:p.yMm+t*(q.yMm-p.yMm)});}}points=next;}if(points.length>=3)clipped.push(points);}
  if(clipped.length)result.push({faceId:face.id,rings:clipped.map(r=>r.map(p=>{const weights=triangleWeights([p.xMm,p.yMm],triangle.map(p=>[p.xMm,p.yMm])),positive=weights.map(w=>Math.max(0,Math.min(1,w))),sum=positive.reduce((n,w)=>n+w,0);return positive.map(w=>w/sum) as [number,number,number];}))});
 }return result;
}
