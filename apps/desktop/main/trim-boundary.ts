import {randomUUID} from 'node:crypto';
import {DomainError} from './repository';
import type {Binding} from '../../../packages/schema/index';
import {triangleWeights,composeWeights,type XY,type Bary} from '../../../packages/surface/triangles';

/** Clipping/triangulation can remove collinear contour samples. Reinsert them in
 * the triangle mesh so editable contour nodes always have exact surface maps. */
export function insertTrimBoundary(trim:NonNullable<Binding['trim']>,point:XY,toleranceMm=.0002):string {
 // Independent integer-grid intersections can move the same endpoint by one
 // 0.0001 mm clipping unit. Reuse the closest existing vertex within the same
 // bounded tolerance as edge insertion; an endpoint cannot split its own edge.
 let distance=toleranceMm,nearest:typeof trim.vertices[number]|undefined;
 for(const vertex of trim.vertices){const d=Math.hypot(vertex.xMm-point[0],vertex.yMm-point[1]);if(d<=distance){distance=d;nearest=vertex;}}
 if(nearest)return nearest.id;
 const vertices=new Map(trim.vertices.map(v=>[v.id,v])),id=randomUUID();
 let inserted=false;
 const triangles:typeof trim.triangles=[];
 for(const triangle of trim.triangles){
  const points=triangle.vertices.map(id=>vertices.get(id)!),xy=points.map(p=>[p.xMm,p.yMm] as XY),w=triangleWeights(point,xy);
  if(w.some(n=>!Number.isFinite(n))){triangles.push(triangle);continue;}
  let edge=-1;
  for(let i=0;i<3;i++){const a=xy[i],b=xy[(i+1)%3],dx=b[0]-a[0],dy=b[1]-a[1],length=Math.hypot(dx,dy),t=((point[0]-a[0])*dx+(point[1]-a[1])*dy)/(length*length);if(t>1e-9&&t<1-1e-9&&Math.abs(dx*(point[1]-a[1])-dy*(point[0]-a[0]))/length<=toleranceMm){edge=i;break;}}
  if(edge<0&&Math.min(...w)<-1e-9){triangles.push(triangle);continue;}
  const bounded=w.map(n=>Math.max(0,Math.min(1,n))),sum=bounded.reduce((s,n)=>s+n,0),bary=composeWeights(bounded.map(n=>n/sum) as Bary,triangle.barycentric);
  const make=(a:number,b:number)=>({...triangle,vertices:[triangle.vertices[a],triangle.vertices[b],id] as [string,string,string],barycentric:[triangle.barycentric[a],triangle.barycentric[b],bary] as [Bary,Bary,Bary]});
  if(edge>=0){triangles.push(make((edge+1)%3,(edge+2)%3),make((edge+2)%3,edge));}
  else triangles.push(make(0,1),make(1,2),make(2,0));
  inserted=true;
 }
 if(!inserted)throw new DomainError('COLOR_CUT_BOUNDARY');
 trim.vertices.push({id,xMm:point[0],yMm:point[1]});trim.triangles=triangles;return id;
}
