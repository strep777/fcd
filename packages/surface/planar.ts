import type {Surface,SurfaceReport} from '../schema/index';
import {surfaceReportSchema} from '../schema/index';
/** Remove redundant boundary samples within a global 0.0001 mm deviation bound,
 * while retaining signed area. A short distance alone can erase a thin panel. */
export function simplifyReportBoundary(report:SurfaceReport){
 const tolerance=.0001,points=new Map(report.uv.map(p=>[p.vertexId,p])),ids=report.boundary;if(ids.length<=3)return report;
 const distance=(id:string,a:string,b:string)=>{const p=points.get(id)!,u=points.get(a)!,v=points.get(b)!,dx=v.xMm-u.xMm,dy=v.yMm-u.yMm,length=dx*dx+dy*dy,t=length?Math.max(0,Math.min(1,((p.xMm-u.xMm)*dx+(p.yMm-u.yMm)*dy)/length)):0;return Math.hypot(p.xMm-u.xMm-t*dx,p.yMm-u.yMm-t*dy);};
 const anchor=ids.reduce((best,id,i)=>distance(id,ids[0],ids[0])>distance(ids[best],ids[0],ids[0])?i:best,1);
 const simplify=(path:string[])=>{const keep=new Set([0,path.length-1]),stack=[[0,path.length-1]];while(stack.length){const [a,b]=stack.pop()!;let max=tolerance,best=-1;for(let i=a+1;i<b;i++){const d=distance(path[i],path[a],path[b]);if(d>max){max=d;best=i;}}if(best>=0){keep.add(best);stack.push([a,best],[best,b]);}}return path.filter((_,i)=>keep.has(i));};
 const first=simplify(ids.slice(0,anchor+1)),second=simplify([...ids.slice(anchor),ids[0]]),boundary=[...first.slice(0,-1),...second.slice(0,-1)];
 const area=(ring:string[])=>{const o=points.get(ring[0])!;return ring.reduce((sum,id,i)=>{const a=points.get(id)!,b=points.get(ring[(i+1)%ring.length])!;return sum+(a.xMm-o.xMm)*(b.yMm-o.yMm)-(a.yMm-o.yMm)*(b.xMm-o.xMm);},0)/2;},before=area(ids),after=area(boundary);
 return boundary.length>=3&&boundary.length<ids.length&&before*after>0&&Math.abs(after-before)<=Math.abs(before)*1e-6?{...report,boundary,boundaryToleranceMm:tolerance}:report;
}
/** An exact isometry for connected, oriented planar disks; curved patches stay with the solver. */
export function planarReports(mesh:Surface,allowHoles=false){
 const vertices=new Map(mesh.vertices.map(v=>[v.id,v])),edgeFaces=new Map<string,number[]>(),adjacency=mesh.faces.map(()=>[] as number[]);
 for(const [i,f] of mesh.faces.entries())for(let j=0;j<3;j++){const key=[f.vertices[j],f.vertices[(j+1)%3]].sort().join(':'),list=edgeFaces.get(key)??[];list.push(i);edgeFaces.set(key,list);}
 for(const list of edgeFaces.values())if(list.length===2&&mesh.faces[list[0]].region===mesh.faces[list[1]].region){adjacency[list[0]].push(list[1]);adjacency[list[1]].push(list[0]);}
 const cross=(a:number[],b:number[])=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]],dot=(a:number[],b:number[])=>a.reduce((n,x,i)=>n+x*b[i],0),xyz=(id:string)=>{const p=vertices.get(id)!;return [p.xMm,p.yMm,p.zMm];},sub=(a:number[],b:number[])=>a.map((n,i)=>n-b[i]),unit=(v:number[])=>{const l=Math.hypot(...v);return v.map(n=>n/l);};
 const seen=new Set<number>(),reports:SurfaceReport[]=[],remaining:Surface['faces']=[],holes=new Map<string,string[][]>();
 for(let i=0;i<mesh.faces.length;i++){if(seen.has(i))continue;const group:number[]=[],queue=[i];seen.add(i);while(queue.length){const next=queue.pop()!;group.push(next);for(const neighbor of adjacency[next])if(!seen.has(neighbor)){seen.add(neighbor);queue.push(neighbor);}}
  const faces=group.map(i=>mesh.faces[i]),used=new Set(faces.flatMap(f=>f.vertices));let seed=faces[0],area=-Infinity;for(const f of faces){const [a,b,c]=f.vertices.map(xyz),m=Math.hypot(...cross(sub(b,a),sub(c,a)));if(m>area){area=m;seed=f;}}
  const [origin,b,c]=seed.vertices.map(xyz),normal=unit(cross(sub(b,origin),sub(c,origin))),u=unit(sub(b,origin)),v=cross(normal,u);
  if([...used].some(id=>Math.abs(dot(sub(xyz(id),origin),normal))>1e-8)){remaining.push(...faces);continue;}
  const edges=new Map<string,{a:string;b:string;count:number}>();for(const f of faces)for(let j=0;j<3;j++){const a=f.vertices[j],b=f.vertices[(j+1)%3],key=[a,b].sort().join(':'),edge=edges.get(key)??{a,b,count:0};edge.count++;edges.set(key,edge);}
  const outgoing=new Map<string,string>(),incoming=new Set<string>();let valid=true;for(const e of edges.values())if(e.count===1){if(outgoing.has(e.a)||incoming.has(e.b)){valid=false;break;}outgoing.set(e.a,e.b);incoming.add(e.b);}
  const pending=new Set(outgoing.keys()),loops:string[][]=[];while(valid&&pending.size){const start=pending.values().next().value!,ring:string[]=[];let id=start;do{if(!pending.has(id)||!outgoing.has(id)){valid=false;break;}pending.delete(id);ring.push(id);id=outgoing.get(id)!;}while(id!==start);loops.push(ring);}
  const projected=new Map([...used].map(id=>{const d=sub(xyz(id),origin);return [id,[dot(d,u),dot(d,v)]];})),signed=(ring:string[])=>ring.reduce((sum,id,i)=>{const a=projected.get(id)!,b=projected.get(ring[(i+1)%ring.length])!,o=projected.get(ring[0])!;return sum+(a[0]-o[0])*(b[1]-o[1])-(b[0]-o[0])*(a[1]-o[1]);},0)/2,outers=loops.filter(r=>signed(r)>0),inner=loops.filter(r=>signed(r)<0),boundary=outers[0];
  if(!valid||outers.length!==1||!boundary||loops.some(r=>r.length<3||r.length>2000)||(!allowHoles&&loops.length!==1)||inner.length>32||used.size+faces.length!==edges.size+2-loops.length){remaining.push(...faces);continue;}
  const report=simplifyReportBoundary(surfaceReportSchema.parse({planarExact:true,faceIds:faces.map(f=>f.id),uv:[...used].map(vertexId=>({vertexId,xMm:projected.get(vertexId)![0],yMm:projected.get(vertexId)![1]})),boundary,areaErrorMax:0,edgeErrorMax:0,distortionMean:0,distortionP95:0,distortionMax:0,faceDistortion:faces.map(f=>({faceId:f.id,areaError:0,edgeError:0,angleError:0,distortion:0})),status:'acceptable'}));reports.push(report);if(inner.length)holes.set([...report.faceIds].sort().join(':'),inner);
 }
 return {reports,remaining,holes};
}
