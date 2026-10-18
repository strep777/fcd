import type {CutProjection,Surface} from '../schema/index';
import {shapePoint,type Point,type World} from './attached-edit';
import {triangleWeights} from './triangles';
import type {SurfaceOutline} from './marking-outline';
import {boxIndex,type Box} from './spatial';

/** Resolve a persistent contour coordinate on the same front-facing triangles
 * used by projection. Editing remains in that frame; its handles are in 3D. */
export function surfaceFramePoint(surface:Surface,frame:CutProjection,regions?:string[],faceScope?:Set<string>){
 const vertices=new Map(surface.vertices.map(v=>[v.id,{world:v,point:shapePoint(frame,v),depth:frame.axes[2].reduce((s,n,i)=>s+n*([v.xMm,v.yMm,v.zMm][i]-frame.origin[i]),0)}]));
 const triangles=surface.faces.filter(f=>(!regions||regions.includes(f.region))&&(!faceScope||faceScope.has(f.id))).map(f=>f.vertices.map(id=>vertices.get(id)!)).filter(t=>{const [a,b,c]=t.map(v=>v.point);return (b.xMm-a.xMm)*(c.yMm-a.yMm)-(b.yMm-a.yMm)*(c.xMm-a.xMm)>1e-9;});
 // Keep the broad phase at least as permissive as the barycentric test:
 // points a few ulps outside an edge must not lose their visible handle.
 const index=boxIndex(triangles.map(t=>{const x=t.map(v=>v.point.xMm),y=t.map(v=>v.point.yMm),a=Math.min(...x),b=Math.min(...y),c=Math.max(...x),d=Math.max(...y),dx=(c-a)*2e-7,dy=(d-b)*2e-7;return [a-dx,b-dy,c+dx,d+dy] as Box;}));
 return (p:Point,boundary:SurfaceOutline[]=[]):World|undefined=>{
  let best=-Infinity,result:World|undefined;
  for(const i of index.query([p.xMm,p.yMm,p.xMm,p.yMm])){const t=triangles[i],w=triangleWeights([p.xMm,p.yMm],t.map(v=>[v.point.xMm,v.point.yMm]));if(w.some(n=>!Number.isFinite(n)||n< -1e-7||n>1+1e-7))continue;const depth=w.reduce((s,n,i)=>s+n*t[i].depth,0);if(depth<=best)continue;best=depth;result={xMm:w.reduce((s,n,i)=>s+n*t[i].world.xMm,0),yMm:w.reduce((s,n,i)=>s+n*t[i].world.yMm,0),zMm:w.reduce((s,n,i)=>s+n*t[i].world.zMm,0)};}
  if(result)return result;
  // A source loop can extend beyond the silhouette. Display those editable
  // knots at the nearest actual clipped boundary, never on an empty plane.
  let nearest=Infinity;for(const edge of boundary){const a=shapePoint(frame,edge.a),b=shapePoint(frame,edge.b),dx=b.xMm-a.xMm,dy=b.yMm-a.yMm,t=Math.max(0,Math.min(1,((p.xMm-a.xMm)*dx+(p.yMm-a.yMm)*dy)/(dx*dx+dy*dy||1))),d=Math.hypot(p.xMm-a.xMm-t*dx,p.yMm-a.yMm-t*dy);if(d>=nearest)continue;nearest=d;result={xMm:edge.a.xMm+t*(edge.b.xMm-edge.a.xMm),yMm:edge.a.yMm+t*(edge.b.yMm-edge.a.yMm),zMm:edge.a.zMm+t*(edge.b.zMm-edge.a.zMm)};}
  return result;
 };
}
