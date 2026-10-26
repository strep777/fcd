import type {Surface} from '../schema/index';
import {edgeKey} from './refine';

/** Exact planar cloth facets, independent of diagonals drawn inside them.
 * Used only after a complete chart has failed. Smooth surfaces with many
 * distinct tangent planes keep the ordinary continuous section search. */
export function physicalFacets(mesh:Surface,faces:Surface['faces'],limit=32){
 const vertices=new Map(mesh.vertices.map(v=>[v.id,v]));
 const rows=faces.map(face=>{const p=face.vertices.map(id=>vertices.get(id)!),u=[p[1].xMm-p[0].xMm,p[1].yMm-p[0].yMm,p[1].zMm-p[0].zMm],v=[p[2].xMm-p[0].xMm,p[2].yMm-p[0].yMm,p[2].zMm-p[0].zMm],n=[u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0]],length=Math.hypot(...n);return{face,normal:n.map(n=>n/length)};});
 const locked=new Set((mesh.cutConstraints??[]).filter(e=>e.locked).map(e=>edgeKey(e.a,e.b))),edges=new Map<string,number[]>(),adj=faces.map(()=>[] as number[]);
 faces.forEach((face,i)=>face.vertices.forEach((a,j)=>{const key=edgeKey(a,face.vertices[(j+1)%3]),list=edges.get(key)??[];list.push(i);edges.set(key,list);}));
 for(const [key,list] of edges)if(list.length===2&&!locked.has(key)){const [a,b]=list,cosine=rows[a].normal.reduce((s,n,i)=>s+n*rows[b].normal[i],0);if(cosine<1-1e-12&&cosine>Math.cos(Math.PI/6))return;if(faces[a].region===faces[b].region&&cosine>1-1e-12){adj[a].push(b);adj[b].push(a);}}
 const seen=new Set<number>(),parts:Surface['faces'][]=[];
 for(let i=0;i<faces.length;i++)if(!seen.has(i)){const queue=[i],part:Surface['faces']=[];seen.add(i);while(queue.length){const at=queue.pop()!;part.push(faces[at]);for(const next of adj[at])if(!seen.has(next)){seen.add(next);queue.push(next);}}parts.push(part);if(parts.length>limit)return;}
 if(parts.length<2)return;
 // Verify the complete plane, not just neighbouring normals: a succession of
 // tiny bends must never be treated as one flat material surface.
 for(const part of parts){const row=rows[faces.indexOf(part[0])],origin=vertices.get(part[0].vertices[0])!;if(part.some(f=>f.vertices.some(id=>{const v=vertices.get(id)!;return Math.abs((v.xMm-origin.xMm)*row.normal[0]+(v.yMm-origin.yMm)*row.normal[1]+(v.zMm-origin.zMm)*row.normal[2])>1e-8;})))return;}
 const bounds=(part:Surface['faces'])=>part.reduce((box,f)=>{for(const id of f.vertices){const v=vertices.get(id)!;[v.xMm,v.yMm,v.zMm].forEach((n,i)=>{box[i*2]=Math.min(box[i*2],n);box[i*2+1]=Math.max(box[i*2+1],n);});}return box;},[Infinity,-Infinity,Infinity,-Infinity,Infinity,-Infinity]);
 return parts.map(part=>({part,bounds:bounds(part)})).sort((a,b)=>{for(let i=0;i<a.bounds.length;i++)if(a.bounds[i]!==b.bounds[i])return a.bounds[i]-b.bounds[i];return 0;}).map(row=>row.part);
}
