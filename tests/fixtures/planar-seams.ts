import {randomUUID} from 'node:crypto';
import type {Surface} from '../../packages/schema/index';

export function planarGrid(coordinates=[0,20,40,60,80],hole=false):Surface{
 const vertices=coordinates.flatMap((yMm,y)=>coordinates.map((xMm,x)=>({id:`v${x}_${y}`,xMm,yMm,zMm:0}))),faces:Surface['faces']=[];
 for(let y=0;y<coordinates.length-1;y++)for(let x=0;x<coordinates.length-1;x++){
  if(hole&&x>=2&&x<4&&y>=2&&y<4)continue;
  for(const [j,vertices]of [[0,[`v${x}_${y}`,`v${x+1}_${y}`,`v${x+1}_${y+1}`]],[1,[`v${x}_${y}`,`v${x+1}_${y+1}`,`v${x}_${y+1}`]]] as [number,[string,string,string]][])faces.push({id:`f${x}_${y}_${j}`,vertices,region:'sheet'});
 }
 return {id:randomUUID(),source:'obj',topologyVersion:1,vertices,faces};
}
export function meshArea(surface:Surface){
 const vertices=new Map(surface.vertices.map(v=>[v.id,v]));
 return surface.faces.reduce((sum,f)=>{const [a,b,c]=f.vertices.map(id=>vertices.get(id)!),u=[b.xMm-a.xMm,b.yMm-a.yMm,b.zMm-a.zMm],v=[c.xMm-a.xMm,c.yMm-a.yMm,c.zMm-a.zMm];return sum+Math.hypot(u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0])/2;},0);
}
export function faceComponents(surface:Surface){
 const edges=new Map<string,number[]>(),adj=surface.faces.map(()=>[] as number[]);
 surface.faces.forEach((f,i)=>f.vertices.forEach((a,j)=>{const b=f.vertices[(j+1)%3],key=[a,b].sort().join('|'),rows=edges.get(key)??[];rows.push(i);edges.set(key,rows);}));
 for(const rows of edges.values())if(rows.length===2){adj[rows[0]].push(rows[1]);adj[rows[1]].push(rows[0]);}
 const seen=new Set<number>(),groups:number[][]=[];
 for(let i=0;i<adj.length;i++){if(seen.has(i))continue;const queue=[i],group:number[]=[];seen.add(i);while(queue.length){const n=queue.pop()!;group.push(n);for(const j of adj[n])if(!seen.has(j)){seen.add(j);queue.push(j);}}groups.push(group);}
 return groups;
}
