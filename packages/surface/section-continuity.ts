import type {Surface} from '../schema/index';
import type {FaceCut} from './refine';

/** A section almost tangent to the cloth can turn a mild surface bend into
 * a sharp sewing elbow. Test the physical intersection before subdivision;
 * triangle diagonals, station IDs and intermediate collinear points cannot
 * change this decision. Real folds and junctions retain their corners. */
export function continuousSection(surface:Surface,cuts:FaceCut[],vertices=new Map(surface.vertices.map(v=>[v.id,v]))){
 const faces=new Map(surface.faces.map(f=>[f.id,f]));
 type Edge={a:number[];b:number[];ka:string;kb:string;normals:number[][]};
 const edges=new Map<string,Edge>();
 for(const cut of cuts){
  const f=faces.get(cut.faceId)!;const p=f.vertices.map(id=>{const v=vertices.get(id)!;return[v.xMm,v.yMm,v.zMm];});
  // Coincident but disconnected banks must remain distinct. A shared edge
  // station carries its topological support, while its tangent is measured
  // in physical coordinates, independent of that edge's direction.
  const key=(w:number[],p:number[])=>f.vertices.filter((_,i)=>Math.abs(w[i])>1e-9).sort().join(':')+'@'+p.map(n=>Math.round(n*1e7)).join(',');
  const at=(w:number[])=>[0,1,2].map(k=>w.reduce((s,n,i)=>s+n*p[i][k],0)),a=at(cut.a),b=at(cut.b),ka=key(cut.a,a),kb=key(cut.b,b);if(ka===kb)continue;
  const u=p[1].map((n,i)=>n-p[0][i]),v=p[2].map((n,i)=>n-p[0][i]),cross=[u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0]],length=Math.hypot(...cross),normal=cross.map(n=>n/length);
  const id=[ka,kb].sort().join('|'),e=edges.get(id)??{a,b,ka,kb,normals:[]};e.normals.push(normal);edges.set(id,e);
 }
 const incident=new Map<string,Edge[]>();for(const e of edges.values())for(const k of [e.ka,e.kb]){const list=incident.get(k)??[];list.push(e);incident.set(k,list);}
 for(const [k,list]of incident){
  if(list.length!==2)continue;
  const rays=list.map(e=>{const [a,b]=k===e.ka?[e.a,e.b]:[e.b,e.a];return b.map((n,i)=>n-a[i]);}),dot=rays[0].reduce((s,n,i)=>s+n*rays[1][i],0)/(Math.hypot(...rays[0])*Math.hypot(...rays[1]));
  if(dot<=Math.cos(135*Math.PI/180))continue;
  const normals=list.flatMap(e=>e.normals);
  if(normals.every(a=>normals.every(b=>a.reduce((s,n,i)=>s+n*b[i],0)>=Math.cos(Math.PI/6))))return false;
 }
 return true;
}
