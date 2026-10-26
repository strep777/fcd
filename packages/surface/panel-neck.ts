import type {Surface,SurfaceReport} from '../schema/index';
import {edgeKey} from './refine';

/** A sub-2 mm bridge between substantial lobes is not a useful cloth hinge.
 * Open only an existing interior chord: neither the surface nor its coverage
 * changes. The area gate preserves ordinary tips and small boundary ears. */
export function narrowPanelSplit(mesh:Surface,report:SurfaceReport):Surface['faces'][]|undefined{
 const wanted=new Set(report.faceIds),faces=mesh.faces.filter(f=>wanted.has(f.id));
 if(faces.length<2)return;
 const vertices=new Map(mesh.vertices.map(p=>[p.id,p])),uv=new Map(report.uv.map(p=>[p.vertexId,p]));
 const edges=new Map<string,{a:string;b:string;owners:number[]}>(),adj=faces.map(()=>[] as {other:number;key:string}[]);
 const areas=faces.map(f=>{const [a,b,c]=f.vertices.map(id=>vertices.get(id)!),u=[b.xMm-a.xMm,b.yMm-a.yMm,b.zMm-a.zMm],v=[c.xMm-a.xMm,c.yMm-a.yMm,c.zMm-a.zMm];return Math.hypot(u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0])/2;});
 const total=areas.reduce((a,b)=>a+b,0);
 // Both resulting lobes must have at least 100 mm² below. This is an exact
 // impossibility check, before constructing/searching the short-edge graph.
 if(total<200)return;
 faces.forEach((f,i)=>f.vertices.forEach((a,j)=>{const b=f.vertices[(j+1)%3],key=edgeKey(a,b),row=edges.get(key)??{a,b,owners:[]};row.owners.push(i);edges.set(key,row);}));
 for(const [key,e] of edges)if(e.owners.length===2){const [a,b]=e.owners;adj[a].push({other:b,key});adj[b].push({other:a,key});}
 const boundary=new Set([...edges.values()].filter(e=>e.owners.length===1).flatMap(e=>[e.a,e.b]));
 const links=new Map<string,{id:string;key:string;length:number}[]>();
 for(const [key,e] of edges)if(e.owners.length===2){const a=vertices.get(e.a)!,b=vertices.get(e.b)!,p=uv.get(e.a),q=uv.get(e.b);if(!p||!q)continue;const length=Math.max(Math.hypot(a.xMm-b.xMm,a.yMm-b.yMm,a.zMm-b.zMm),Math.hypot(p.xMm-q.xMm,p.yMm-q.yMm));if(length>=2)continue;for(const [from,id]of [[e.a,e.b],[e.b,e.a]]){const row=links.get(from)??[];row.push({id,key,length});links.set(from,row);}}
 // A refined chord may contain interior vertices. Search the same physical
 // two-millimetre corridor through those stations, rather than requiring one
 // original triangle edge to span the entire neck.
 const candidates:{keys:string[];length:number}[]=[];
 for(const start of boundary){
  const best=new Map<string,number>([[start,0]]),pending=[{id:start,length:0,keys:[] as string[]}];
  while(pending.length){pending.sort((a,b)=>b.length-a.length);const row=pending.pop()!;if(row.length!==best.get(row.id))continue;
   if(row.id!==start&&boundary.has(row.id)){if(start<row.id)candidates.push({keys:row.keys,length:row.length});continue;}
   for(const link of links.get(row.id)??[]){const length=row.length+link.length;if(length>=2||length>=(best.get(link.id)??Infinity))continue;best.set(link.id,length);pending.push({id:link.id,length,keys:[...row.keys,link.key]});}
  }
 }
 candidates.sort((a,b)=>a.length-b.length);
 for(const {keys} of candidates){
  const blocked=new Set(keys),e=edges.get(keys[0])!;
  const seen=new Set<number>([e.owners[0]]),queue=[e.owners[0]];
  while(queue.length)for(const link of adj[queue.pop()!])if(!blocked.has(link.key)&&!seen.has(link.other)){seen.add(link.other);queue.push(link.other);}
  if(seen.has(e.owners[1]))continue;
  const area=[...seen].reduce((sum,i)=>sum+areas[i],0);
  // Preserve small material motifs as one piece. Adding a sewing edge to a
  // lobe smaller than a 10 x 10 mm fabric patch creates an even smaller scrap
  // without helping flattening. The native strain/overlap checks still apply.
  if(Math.min(area,total-area)<Math.max(total*.1,100))continue;
  return [faces.filter((_,i)=>seen.has(i)),faces.filter((_,i)=>!seen.has(i))];
 }
}
