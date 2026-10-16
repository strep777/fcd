import type {SurfaceBrush} from '../schema/index';
import type {Point} from './attached-edit';

/** The same swept footprint is used by the live brush and the saved stroke. */
export function brushFootprint(points:Point[],radius:number,shape:SurfaceBrush['brushShape']='round'):Point[][]{
 const count=Math.max(16,Math.min(128,Math.ceil(Math.PI/Math.acos(Math.max(-1,1-.05/radius)))));
 const corners:Point[]=shape==='square'?[[-radius,-radius],[radius,-radius],[radius,radius],[-radius,radius]].map(([xMm,yMm])=>({xMm,yMm})):Array.from({length:count},(_,i)=>({xMm:radius*Math.cos(i*2*Math.PI/count),yMm:radius*Math.sin(i*2*Math.PI/count)}));
 const area=(r:Point[])=>r.reduce((s,p,i)=>{const q=r[(i+1)%r.length];return s+p.xMm*q.yMm-q.xMm*p.yMm;},0)/2;
 const result:Point[][]=[],at=(p:Point,c:Point)=>({xMm:p.xMm+c.xMm,yMm:p.yMm+c.yMm});
 const add=(ring:Point[])=>{const a=area(ring);if(Math.abs(a)>1e-8)result.push(a<0?ring.reverse():ring);};
 for(let i=0;i<points.length;i++){
  const p=points[i];add(corners.map(c=>at(p,c)));if(!i)continue;
  const a=points[i-1],dx=p.xMm-a.xMm,dy=p.yMm-a.yMm,length=Math.hypot(dx,dy);if(length<=1e-9)continue;
  if(shape==='square'){
   // Sweep all four perimeter edges so diagonal moves preserve square corners.
   for(let j=0;j<corners.length;j++){const c=corners[j],d=corners[(j+1)%corners.length];add([at(a,c),at(p,c),at(p,d),at(a,d)]);}
  }else{const c={xMm:-dy*radius/length,yMm:dx*radius/length},d={xMm:-c.xMm,yMm:-c.yMm};add([at(a,c),at(a,d),at(p,d),at(p,c)]);}
 }
 return result;
}
