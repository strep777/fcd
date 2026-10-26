import type {Surface} from '../schema/index';

/** Coalescing two trial panels must not turn a T junction into an arbitrary
 * elbow. This uses physical positions and surface normals, never edge IDs or
 * the direction of the triangulation. Material corners and authored cuts are
 * intentional boundaries and remain outside this automatic seam preference. */
export function seamContinuityGuard(mesh:Surface,owners:ReadonlyMap<string,number>,material:(region:string)=>string,canJoin?:(a:string,b:string)=>boolean){
 const vertices=new Map(mesh.vertices.map(v=>[v.id,v]));
 const station=(id:string)=>{const p=vertices.get(id)!;return [p.xMm,p.yMm,p.zMm].map(n=>Math.round(n*1e7)).join(',');};
 type Edge={a:string;b:string;faces:Surface['faces'];points:number[][]};
 const edges=new Map<string,Edge>(),normals=new Map<string,number[]>();
 for(const f of mesh.faces){
  const p=f.vertices.map(id=>{const v=vertices.get(id)!;return [v.xMm,v.yMm,v.zMm];}),u=p[1].map((n,i)=>n-p[0][i]),v=p[2].map((n,i)=>n-p[0][i]),cross=[u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0]],length=Math.hypot(...cross);
  normals.set(f.id,cross.map(n=>n/length));
  for(let i=0;i<3;i++){const a=station(f.vertices[i]),b=station(f.vertices[(i+1)%3]),key=[a,b].sort().join('|'),edge=edges.get(key)??{a,b,faces:[],points:[p[i],p[(i+1)%3]]};edge.faces.push(f);edges.set(key,edge);}
 }
 const boundary=[...edges.values()].filter(e=>e.faces.length!==2||owners.get(e.faces[0].id)!==owners.get(e.faces[1].id)),incident=new Map<string,Edge[]>(),shared=new Map<string,Edge[]>();
 for(const e of boundary){for(const id of [e.a,e.b]){const list=incident.get(id)??[];list.push(e);incident.set(id,list);}if(e.faces.length===2){const a=owners.get(e.faces[0].id),b=owners.get(e.faces[1].id);if(a!==undefined&&b!==undefined){const key=[a,b].sort((x,y)=>x-y).join(':'),list=shared.get(key)??[];list.push(e);shared.set(key,list);}}}
 const structural=(e:Edge)=>e.faces.length===2&&material(e.faces[0].region)===material(e.faces[1].region)&&(!canJoin||canJoin(e.faces[0].id,e.faces[1].id));
 return (a:number,b:number)=>{
  const removed=new Set(shared.get([a,b].sort((x,y)=>x-y).join(':')));
  for(const id of new Set([...removed].flatMap(e=>[e.a,e.b]))){
   const kept=(incident.get(id)??[]).filter(e=>!removed.has(e));if(kept.length!==2||!kept.every(structural))continue;
   const directions=kept.map(e=>{const i=e.a===id?0:1;return e.points[1-i].map((n,j)=>n-e.points[i][j]);}),dot=directions[0].reduce((s,n,i)=>s+n*directions[1][i],0)/(Math.hypot(...directions[0])*Math.hypot(...directions[1]));
   if(dot<=Math.cos(135*Math.PI/180))continue;
   const ns=kept.flatMap(e=>e.faces.map(f=>normals.get(f.id)!));
   // A physical hard fold may require a corner in its sewing line. Smooth
   // cloth has no such reason to retain an elbow left by two trial planes.
   if(ns.every(n=>ns.every(m=>n.reduce((s,v,i)=>s+v*m[i],0)>=Math.cos(Math.PI/6))))return false;
  }
  return true;
 };
}
