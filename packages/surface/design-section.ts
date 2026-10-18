import type {Surface} from '../schema/index';
import {refineSurface,edgeKey,type Child} from './refine';
import {planeSegments} from './cut-geometry';
import {designComponents} from './design-partition';

/** A trial sewing section crosses triangle interiors. Choose a plane with
 * vertex clearance, then reject poor subdivisions instead of manufacturing
 * microscopic panels or moving the original surface to hide them. */
export function sectionDesignDomain(mesh:Surface,faces:Surface['faces'],newId:()=>string){
 if(faces.length<8)return;
 const vertices=new Map(mesh.vertices.map(v=>[v.id,v])),points=(f:Surface['faces'][number])=>f.vertices.map(id=>vertices.get(id)!),axes=['xMm','yMm','zMm'] as const;
 const rows=faces.map(face=>{const p=points(face),u=axes.map(a=>p[1][a]-p[0][a]),v=axes.map(a=>p[2][a]-p[0][a]),normal=[u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0]].map(v=>v/2);return{face,p:axes.map(a=>p.reduce((s,v)=>s+v[a],0)/3),normal,area:Math.hypot(...normal)};}),total=rows.reduce((s,r)=>s+r.area,0),candidates:{axis:0|1|2;position:number;score:number}[]=[];
 // Interior angular defects cannot be flattened by repeatedly shrinking a
 // disk around the same vertex. Put that vertex on the new boundary.
 const edgeCounts=new Map<string,number>(),angles=new Map<string,number>();
 for(const face of faces){const p=points(face);face.vertices.forEach((id,i)=>{const a=p[i],b=p[(i+1)%3],c=p[(i+2)%3],u=axes.map(k=>b[k]-a[k]),v=axes.map(k=>c[k]-a[k]),cos=u.reduce((sum,n,k)=>sum+n*v[k],0)/(Math.hypot(...u)*Math.hypot(...v));angles.set(id,(angles.get(id)??0)+Math.acos(Math.max(-1,Math.min(1,cos))));const edge=edgeKey(id,face.vertices[(i+1)%3]);edgeCounts.set(edge,(edgeCounts.get(edge)??0)+1);});}
 const boundary=new Set([...edgeCounts].filter(([,count])=>count===1).flatMap(([edge])=>edge.split(':'))),defects=[...angles].filter(([id])=>!boundary.has(id)).map(([id,angle])=>({id,defect:Math.abs(2*Math.PI-angle)})).filter(r=>r.defect>.02).sort((a,b)=>b.defect-a.defect).slice(0,16),totalDefect=defects.reduce((sum,r)=>sum+r.defect,0);
 // All plane candidates use the same face graph. Rebuilding string-keyed
 // edge maps for both halves of every candidate dominated section planning.
 const incident=new Map<string,number[]>(),adjacent=faces.map(()=>[] as number[]);
 faces.forEach((f,i)=>f.vertices.forEach((a,j)=>{const key=edgeKey(a,f.vertices[(j+1)%3]),list=incident.get(key)??[];list.push(i);incident.set(key,list);}));
 for(const list of incident.values())if(list.length===2&&faces[list[0]].region===faces[list[1]].region){adjacent[list[0]].push(list[1]);adjacent[list[1]].push(list[0]);}
 const visited=new Uint32Array(faces.length);let generation=0;
 const componentCount=(axis:number,position:number)=>{generation++;let count=0;for(let i=0;i<faces.length;i++){if(visited[i]===generation)continue;if(++count>4)return count;const side=rows[i].p[axis]>=position,queue=[i];visited[i]=generation;while(queue.length){for(const next of adjacent[queue.pop()!])if(visited[next]!==generation&&(rows[next].p[axis]>=position)===side){visited[next]=generation;queue.push(next);}}}return count;};
 for(const axis of [0,1,2] as const){
  const values=[...new Set(faces.flatMap(f=>f.vertices.map(id=>vertices.get(id)![axes[axis]])))].sort((a,b)=>a-b),extent=values.at(-1)!-values[0];if(extent<1e-6)continue;
  const gaps=values.slice(1).map((v,i)=>({position:(v+values[i])/2,clearance:v-values[i]})).sort((a,b)=>b.clearance-a.clearance).slice(0,32);gaps.push(...defects.map(d=>({position:vertices.get(d.id)![axes[axis]],clearance:0})));
  for(const gap of gaps){
   const halves=[rows.filter(r=>r.p[axis]<gap.position),rows.filter(r=>r.p[axis]>=gap.position)],areas=halves.map(h=>h.reduce((s,r)=>s+r.area,0));if(Math.min(...areas)<total*.2)continue;
   const parts=componentCount(axis,gap.position);if(parts>4)continue;
   const concentration=halves.reduce((s,h)=>s+Math.hypot(...[0,1,2].map(k=>h.reduce((s,r)=>s+r.normal[k],0))),0),balance=Math.abs(areas[0]/total-.5);
   candidates.push({axis,position:gap.position,score:1-concentration/total+.05*balance+.03*(parts-2)-.01*gap.clearance/extent-.3*defects.filter(d=>Math.abs(vertices.get(d.id)![axes[axis]]-gap.position)<1e-7).reduce((sum,d)=>sum+d.defect,0)/(totalDefect||1)});
  }
 }
 candidates.sort((a,b)=>a.score-b.score);
 const quality=(record:Child,v:Map<string,Surface['vertices'][number]>)=>{const [a,b,c]=record.face.vertices.map(id=>v.get(id)!),u=[b.xMm-a.xMm,b.yMm-a.yMm,b.zMm-a.zMm],w=[c.xMm-a.xMm,c.yMm-a.yMm,c.zMm-a.zMm],length=Math.max(Math.hypot(...u),Math.hypot(...w),Math.hypot(c.xMm-b.xMm,c.yMm-b.yMm,c.zMm-b.zMm));return Math.hypot(u[1]*w[2]-u[2]*w[1],u[2]*w[0]-u[0]*w[2],u[0]*w[1]-u[1]*w[0])/length**2;};
 for(const plane of candidates.slice(0,9))try{
  const cuts=planeSegments({...mesh,faces},(['x','y','z'] as const)[plane.axis],plane.position,'design-section'),refined=refineSurface(mesh,cuts,newId),v=new Map(refined.surface.vertices.map(p=>[p.id,p])),protectedEdges=new Set([...(refined.owned.get('design-section')??[]),...(refined.surface.cutConstraints??[])].map(e=>edgeKey(e.a,e.b)));
  // The two same-side children form a convex quadrilateral. Select its better
  // diagonal, preserving the section and every parent barycentric station.
  for(const children of refined.children.values())if(children.length===3)for(let i=0;i<children.length;i++)for(let j=i+1;j<children.length;j++){
   const a=children[i],b=children[j],shared=a.face.vertices.filter(id=>b.face.vertices.includes(id));if(shared.length!==2||protectedEdges.has(edgeKey(shared[0],shared[1])))continue;
   const x=a.face.vertices.find(id=>!shared.includes(id))!,y=b.face.vertices.find(id=>!shared.includes(id))!,coords=new Map([...a.face.vertices.map((id,k)=>[id,a.triangle[k]] as const),...b.face.vertices.map((id,k)=>[id,b.triangle[k]] as const)]),cross=(ids:string[])=>{const [p,q,r]=ids.map(id=>coords.get(id)!);return(q[0]-p[0])*(r[1]-p[1])-(q[1]-p[1])*(r[0]-p[0]);};
   const winding=Math.sign(cross(a.face.vertices));let ids=[[x,y,shared[0]],[y,x,shared[1]]];if(Math.sign(cross(ids[0]))!==winding)ids=ids.map(t=>[t[0],t[2],t[1]]);if(ids.some(t=>Math.sign(cross(t))!==winding))continue;
   const replacement=ids.map((ids,k)=>({face:{...(k?b:a).face,vertices:ids as [string,string,string]},triangle:ids.map(id=>coords.get(id)!)}));
   if(Math.min(...replacement.map(r=>quality(r,v)))>Math.min(quality(a,v),quality(b,v))*1.01){children[i]=replacement[0];children[j]=replacement[1];}
  }
  let acceptable=true;for(const [parent,children] of refined.children){const original=mesh.faces.find(f=>f.id===parent)!,q=quality({face:original,triangle:[]},vertices);if(children.some(c=>quality(c,v)<Math.min(.015,q*.2)))acceptable=false;}
  if(!acceptable)continue;
  refined.surface.faces=mesh.faces.flatMap(f=>refined.children.get(f.id)?.map(c=>c.face)??[f]);
  const childFaces=faces.flatMap(f=>refined.children.get(f.id)?.map(c=>c.face)??[f]),sides=childFaces.map(f=>({face:f,value:f.vertices.reduce((sum,id)=>sum+v.get(id)![axes[plane.axis]]-plane.position,0)/3})),parts=[sides.filter(r=>r.value<0),sides.filter(r=>r.value>=0)].flatMap(rows=>designComponents(rows.map(r=>r.face)));
  if(parts.length<2||parts.length>4||parts.some(p=>!p.length))continue;
  return{...refined,parts,plane};
 }catch{/* An unusable proposal leaves the mesh and other charts unchanged. */}
}
