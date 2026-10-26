import type {Surface,SurfaceReport} from '../schema/index';
import {edgeKey} from './refine';

/** Unroll physical edge vectors without depending on triangulation density.
 * Cycles are accepted only when every already placed corner closes isometrically.
 * Native validity, overlap and strain checks still certify the proposed chart. */
export function intrinsicTreeSeed(mesh:Surface,points:ReadonlyMap<string,Surface['vertices'][number]>=new Map(mesh.vertices.map(v=>[v.id,v]))):SurfaceReport['uv']|undefined{
 if(!mesh.faces.length||mesh.faces.length>50000)return;
 const edges=new Map<string,number[]>(),adj=mesh.faces.map(()=>[] as number[]);
 const xyz=(id:string)=>{const v=points.get(id)!;return [v.xMm,v.yMm,v.zMm];},sub=(a:number[],b:number[])=>a.map((v,i)=>v-b[i]),dot=(a:number[],b:number[])=>a.reduce((sum,v,i)=>sum+v*b[i],0),cross=(u:number[],v:number[])=>[u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0]];
 for(const [i,f]of mesh.faces.entries())for(let j=0;j<3;j++){const key=edgeKey(f.vertices[j],f.vertices[(j+1)%3]),rows=edges.get(key)??[];rows.push(i);edges.set(key,rows);}
 let links=0;for(const rows of edges.values()){if(rows.length>2)return;if(rows.length===2){adj[rows[0]].push(rows[1]);adj[rows[1]].push(rows[0]);links++;}}
 const used=new Set(mesh.faces.flatMap(f=>f.vertices));if(links<mesh.faces.length-1)return;
 let seed=0,best=-1;mesh.faces.forEach((f,i)=>{const [a,b,c]=f.vertices.map(xyz),area=Math.hypot(...cross(sub(b,a),sub(c,a)));if(area>best){best=area;seed=i;}});
 const uv=new Map<string,[number,number]>(),start=mesh.faces[seed].vertices,[a,b]=start.map(xyz);uv.set(start[0],[0,0]);uv.set(start[1],[Math.hypot(...sub(b,a)),0]);
 const visited=new Set<number>([seed]),queue=[seed];
 for(let index=0;index<queue.length;index++){
  const face=mesh.faces[queue[index]],missing=face.vertices.filter(id=>!uv.has(id));if(missing.length>1)return;
  const k=missing.length?face.vertices.indexOf(missing[0]):0,aid=face.vertices[(k+1)%3],bid=face.vertices[(k+2)%3],cid=face.vertices[k],p=uv.get(aid)!,q=uv.get(bid)!;
  const edge=sub(xyz(bid),xyz(aid)),offset=sub(xyz(cid),xyz(aid)),length=Math.hypot(...edge),distance=Math.hypot(q[0]-p[0],q[1]-p[1]);if(!(length>0&&distance>0))return;
  const along=dot(offset,edge)/length,height=Math.hypot(...cross(edge,offset))/length,dx=(q[0]-p[0])/distance,dy=(q[1]-p[1])/distance;
  const placed:[number,number]=[p[0]+along*dx-height*dy,p[1]+along*dy+height*dx],existing=uv.get(cid);
  if(existing&&Math.hypot(placed[0]-existing[0],placed[1]-existing[1])>Math.max(1e-8,length*1e-9))return;
  if(!existing)uv.set(cid,placed);
  for(const other of adj[queue[index]])if(!visited.has(other)){visited.add(other);queue.push(other);}
 }
 if(visited.size!==mesh.faces.length||uv.size!==used.size)return;
 return [...uv].every(([,p])=>p.every(Number.isFinite))?[...uv].map(([vertexId,[xMm,yMm]])=>({vertexId,xMm,yMm})):undefined;
}
