import type {Surface} from '../schema/index';
import {edgeKey} from './refine';

/** A slit in an exactly planar sheet has coincident banks and cannot form a
 * simple manufacturing outline. Continue its interior ends to the sheet edge;
 * keep all original cuts and leave curved darts untouched. */
export function completePlanarSeams(surface:Surface){
 const locked=new Set((surface.cutConstraints??[]).filter(e=>e.locked).map(e=>edgeKey(e.a,e.b)));
 if(!locked.size)return {surface,seams:0};
 const vertices=new Map(surface.vertices.map(v=>[v.id,v])),edges=new Map<string,{a:string;b:string;faces:number[]}>(),adj=surface.faces.map(()=>[] as number[]);
 surface.faces.forEach((f,i)=>f.vertices.forEach((a,j)=>{const b=f.vertices[(j+1)%3],key=edgeKey(a,b),e=edges.get(key)??{a,b,faces:[]};e.faces.push(i);edges.set(key,e);}));
 // Existing through-cuts already define separate panels. Completing those
 // again at a material boundary would introduce unwanted extra seams.
 for(const e of edges.values())if(e.faces.length===2&&!locked.has(edgeKey(e.a,e.b))&&surface.faces[e.faces[0]].region===surface.faces[e.faces[1]].region){adj[e.faces[0]].push(e.faces[1]);adj[e.faces[1]].push(e.faces[0]);}
 const seen=new Set<number>(),added=new Map<string,{a:string;b:string;locked:true}>();let seams=0;
 const xyz=(id:string)=>{const p=vertices.get(id)!;return [p.xMm,p.yMm,p.zMm];};
 for(let seed=0;seed<surface.faces.length;seed++){
  if(seen.has(seed))continue;const group=new Set<number>(),queue=[seed];seen.add(seed);
  while(queue.length){const i=queue.pop()!;group.add(i);for(const j of adj[i])if(!seen.has(j)){seen.add(j);queue.push(j);}}
  const ids=new Set([...group].flatMap(i=>surface.faces[i].vertices));let origin:number[]=[],normal:number[]=[],largest=0;
  for(const i of group){const [a,b,c]=surface.faces[i].vertices.map(xyz),u=b.map((n,j)=>n-a[j]),v=c.map((n,j)=>n-a[j]),n=[u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0]],area=Math.hypot(...n);if(area>largest){largest=area;origin=a;normal=n.map(v=>v/area);}}
  if(!largest||[...ids].some(id=>Math.abs(xyz(id).reduce((s,n,j)=>s+(n-origin[j])*normal[j],0))>1e-8))continue;
  const local=[...edges.values()].filter(e=>e.faces.some(i=>group.has(i))),boundary=local.filter(e=>e.faces.filter(i=>group.has(i)).length===1),border=new Set(boundary.flatMap(e=>[e.a,e.b])),outgoing=new Map<string,string>();
  for(const e of boundary){const f=surface.faces[e.faces.find(i=>group.has(i))!],a=f.vertices.indexOf(e.a);if(f.vertices[(a+1)%3]===e.b)outgoing.set(e.a,e.b);else outgoing.set(e.b,e.a);}
  const unvisited=new Set(outgoing.keys()),loops:string[][]=[];while(unvisited.size){const start=unvisited.values().next().value!,loop:string[]=[];let id=start;while(unvisited.has(id)){unvisited.delete(id);loop.push(id);id=outgoing.get(id)!;}if(id===start)loops.push(loop);}
  const area=(ring:string[])=>Math.abs(ring.reduce((sum,id,i)=>{const a=xyz(id).map((n,j)=>n-origin[j]),b=xyz(ring[(i+1)%ring.length]).map((n,j)=>n-origin[j]);return sum+(a[1]*b[2]-a[2]*b[1])*normal[0]+(a[2]*b[0]-a[0]*b[2])*normal[1]+(a[0]*b[1]-a[1]*b[0])*normal[2];},0));
  // Joining a slit to a hole would leave coincident banks in a flat annulus.
  // Use the outer loop; do not cross or run along a hole on the way there.
  const outer=new Set(loops.sort((a,b)=>area(b)-area(a))[0]??[]),degree=new Map<string,number>(),graph=new Map<string,{id:string;length:number}[]>();
  for(const e of local){const key=edgeKey(e.a,e.b);if(locked.has(key)){for(const id of [e.a,e.b])degree.set(id,(degree.get(id)??0)+1);continue;}const a=xyz(e.a),b=xyz(e.b),length=Math.hypot(...a.map((n,j)=>n-b[j]));for(const [from,id]of [[e.a,e.b],[e.b,e.a]]){const rows=graph.get(from)??[];rows.push({id,length});graph.set(from,rows);}}
  for(const [start,count]of degree){
   if(count!==1||outer.has(start))continue;
   const distance=new Map([[start,0]]),previous=new Map<string,string>(),pending=new Set([start]);let target:string|undefined;
   while(pending.size){let current=pending.values().next().value!;for(const id of pending)if(distance.get(id)!<distance.get(current)!)current=id;pending.delete(current);if(outer.has(current)){target=current;break;}for(const next of graph.get(current)??[]){if((degree.has(next.id)||border.has(next.id))&&!outer.has(next.id))continue;const d=distance.get(current)!+next.length;if(d>=(distance.get(next.id)??Infinity))continue;distance.set(next.id,d);previous.set(next.id,current);pending.add(next.id);}}
   if(!target)continue;const path:string[]=[];for(let id:string|undefined=target;id!==undefined;id=previous.get(id))path.push(id);
   if(path.length<2)continue;seams++;for(let i=1;i<path.length;i++){const a=path[i-1],b=path[i];added.set(edgeKey(a,b),{a,b,locked:true});}
  }
 }
 return {surface:added.size?{...surface,cutConstraints:[...(surface.cutConstraints??[]),...added.values()]}:surface,seams};
}
