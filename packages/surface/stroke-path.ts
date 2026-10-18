type XYZ={xMm:number;yMm:number;zMm:number};
/** Error-bounded 3D polyline reduction after a stroke. Preserve original world
 * anchors and endpoints; screen zoom and camera rotation never enter the fit. */
export function simplifySurfaceStroke<T extends XYZ>(points:T[],toleranceMm=.5,closed=false):T[]{
 if(!Number.isFinite(toleranceMm)||toleranceMm<=0||points.some(p=>![p.xMm,p.yMm,p.zMm].every(Number.isFinite)))throw Error('INVALID_GEOMETRY');
 if(points.length<3)return points.slice();
 const source=closed?[...points,points[0]]:points;
 const keep=new Set([0,source.length-1]),stack:[[number,number]]|[number,number][]=[[0,source.length-1]];
 while(stack.length){const [start,end]=stack.pop()!,a=source[start],b=source[end],dx=b.xMm-a.xMm,dy=b.yMm-a.yMm,dz=b.zMm-a.zMm,length=dx*dx+dy*dy+dz*dz;let worst=toleranceMm,index=-1;
  for(let i=start+1;i<end;i++){const p=source[i],t=length?Math.max(0,Math.min(1,((p.xMm-a.xMm)*dx+(p.yMm-a.yMm)*dy+(p.zMm-a.zMm)*dz)/length)):0,d=Math.hypot(p.xMm-a.xMm-t*dx,p.yMm-a.yMm-t*dy,p.zMm-a.zMm-t*dz);if(d>worst){worst=d;index=i;}}
  if(index>=0){keep.add(index);stack.push([start,index],[index,end]);}
 }
 const result=[...keep].sort((a,b)=>a-b).filter(i=>!closed||i<points.length).map(i=>source[i]);
 return closed&&result.length<3?points.slice():result;
}
