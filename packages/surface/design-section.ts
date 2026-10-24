import type {Surface} from '../schema/index';
import {createSurfaceRefiner,edgeKey,type Child} from './refine';
import {orientedPlaneSegments} from './cut-geometry';
import {designComponents} from './design-partition';

/** A trial sewing section crosses triangle interiors. Choose a plane with
 * vertex clearance, then reject poor subdivisions instead of manufacturing
 * microscopic panels or moving the original surface to hide them. */
export function sectionDesignDomain(mesh:Surface,faces:Surface['faces'],newId:()=>string){
 if(faces.length<8)return;
 const vertices=new Map(mesh.vertices.map(v=>[v.id,v])),sourceFaces=new Map(mesh.faces.map(f=>[f.id,f])),points=(f:Surface['faces'][number])=>f.vertices.map(id=>vertices.get(id)!),axes=['xMm','yMm','zMm'] as const;
 const rows=faces.map(face=>{const p=points(face),u=axes.map(a=>p[1][a]-p[0][a]),v=axes.map(a=>p[2][a]-p[0][a]),normal=[u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0]].map(v=>v/2);return{face,p:axes.map(a=>p.reduce((s,v)=>s+v[a],0)/3),normal,area:Math.hypot(...normal)};}),total=rows.reduce((s,r)=>s+r.area,0),candidates:{axis:number;normal:[number,number,number];position:number;score:number}[]=[];
 const normals:[number,number,number][]=[[1,0,0],[0,1,0],[0,0,1]];
 const dot=(a:number[],b:number[])=>a.reduce((sum,n,i)=>sum+n*b[i],0),center=[0,1,2].map(i=>rows.reduce((sum,r)=>sum+r.area*r.p[i],0)/total),cov=[0,1,2].map(i=>[0,1,2].map(j=>rows.reduce((sum,r)=>sum+r.area*(r.p[i]-center[i])*(r.p[j]-center[j]),0)/total));
 // Area-weighted principal directions follow a posed sleeve or leg rather
 // than the world axes. A longitudinal section avoids transverse strip cuts.
 let long:number[]=[0,1,2].map(i=>i===cov.map((r,k)=>r[k]).indexOf(Math.max(...cov.map((r,k)=>r[k])))?1:0);
 for(let i=0;i<128;i++){const next=cov.map(row=>dot(row,long)),length=Math.hypot(...next);if(length<1e-12)break;long=next.map(n=>n/length);}
 const seed=Math.abs(long[0])<.8?[1,0,0]:[0,1,0],projection=dot(seed,long),u=seed.map((n,i)=>n-projection*long[i]),length=Math.hypot(...u);
 if(length>1e-8&&Math.hypot(...[0,1,2].map(i=>rows.reduce((sum,r)=>sum+r.normal[i],0)))<total*.99){const a=u.map(n=>n/length),b=[long[1]*a[2]-long[2]*a[1],long[2]*a[0]-long[0]*a[2],long[0]*a[1]-long[1]*a[0]];for(let i=0;i<6;i++){const t=i*Math.PI/6,n=a.map((v,k)=>v*Math.cos(t)+b[k]*Math.sin(t)) as [number,number,number];if(normals.every(existing=>Math.abs(dot(n,existing))<.9999))normals.push(n);}}
 const coordinate=(id:string,axis:number)=>{const v=vertices.get(id)!;return dot(normals[axis],[v.xMm,v.yMm,v.zMm]);};
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
 const componentCount=(axis:number,position:number)=>{generation++;let count=0;for(let i=0;i<faces.length;i++){if(visited[i]===generation)continue;if(++count>4)return count;const side=dot(rows[i].p,normals[axis])>=position,queue=[i];visited[i]=generation;while(queue.length){for(const next of adjacent[queue.pop()!])if(visited[next]!==generation&&(dot(rows[next].p,normals[axis])>=position)===side){visited[next]=generation;queue.push(next);}}}return count;};
 for(let axis=0;axis<normals.length;axis++){
  const values=[...new Set(faces.flatMap(f=>f.vertices.map(id=>coordinate(id,axis))))].sort((a,b)=>a-b),extent=values.at(-1)!-values[0];if(extent<1e-6)continue;
  const gaps=values.slice(1).map((v,i)=>({position:(v+values[i])/2,clearance:v-values[i]})).sort((a,b)=>b.clearance-a.clearance).slice(0,32);gaps.push(...defects.map(d=>({position:coordinate(d.id,axis),clearance:0})));
  for(const gap of gaps){
   const halves=[rows.filter(r=>dot(r.p,normals[axis])<gap.position),rows.filter(r=>dot(r.p,normals[axis])>=gap.position)],areas=halves.map(h=>h.reduce((s,r)=>s+r.area,0));if(Math.min(...areas)<total*.2)continue;
   const parts=componentCount(axis,gap.position);if(parts>4)continue;
   const concentration=halves.reduce((s,h)=>s+Math.hypot(...[0,1,2].map(k=>h.reduce((s,r)=>s+r.normal[k],0))),0),balance=Math.abs(areas[0]/total-.5);
   candidates.push({axis,normal:normals[axis],position:gap.position,score:1-concentration/total+.05*balance+.03*(parts-2)-.01*gap.clearance/extent-.3*defects.filter(d=>Math.abs(coordinate(d.id,axis)-gap.position)<1e-7).reduce((sum,d)=>sum+d.defect,0)/(totalDefect||1)});
  }
 }
 candidates.sort((a,b)=>a.score-b.score);
 const refine=candidates.length?createSurfaceRefiner(mesh):undefined;
 const quality=(record:Child,v:Map<string,Surface['vertices'][number]>)=>{const [a,b,c]=record.face.vertices.map(id=>v.get(id)!),u=[b.xMm-a.xMm,b.yMm-a.yMm,b.zMm-a.zMm],w=[c.xMm-a.xMm,c.yMm-a.yMm,c.zMm-a.zMm],length=Math.max(Math.hypot(...u),Math.hypot(...w),Math.hypot(c.xMm-b.xMm,c.yMm-b.yMm,c.zMm-b.zMm));return Math.hypot(u[1]*w[2]-u[2]*w[1],u[2]*w[0]-u[0]*w[2],u[0]*w[1]-u[1]*w[0])/length**2;};
 for(const plane of candidates.slice(0,9))try{
  const cuts=orientedPlaneSegments({...mesh,faces},plane.normal,plane.position,'design-section',undefined,vertices),refined=refine!(cuts,newId),v=new Map(refined.surface.vertices.map(p=>[p.id,p])),protectedEdges=new Set([...(refined.owned.get('design-section')??[]),...(refined.surface.cutConstraints??[])].map(e=>edgeKey(e.a,e.b)));
  // The two same-side children form a convex quadrilateral. Select its better
  // diagonal, preserving the section and every parent barycentric station.
  for(const children of refined.children.values())if(children.length===3)for(let i=0;i<children.length;i++)for(let j=i+1;j<children.length;j++){
   const a=children[i],b=children[j],shared=a.face.vertices.filter(id=>b.face.vertices.includes(id));if(shared.length!==2||protectedEdges.has(edgeKey(shared[0],shared[1])))continue;
   const x=a.face.vertices.find(id=>!shared.includes(id))!,y=b.face.vertices.find(id=>!shared.includes(id))!,coords=new Map([...a.face.vertices.map((id,k)=>[id,a.triangle[k]] as const),...b.face.vertices.map((id,k)=>[id,b.triangle[k]] as const)]),cross=(ids:string[])=>{const [p,q,r]=ids.map(id=>coords.get(id)!);return(q[0]-p[0])*(r[1]-p[1])-(q[1]-p[1])*(r[0]-p[0]);};
   const winding=Math.sign(cross(a.face.vertices));let ids=[[x,y,shared[0]],[y,x,shared[1]]];if(Math.sign(cross(ids[0]))!==winding)ids=ids.map(t=>[t[0],t[2],t[1]]);if(ids.some(t=>Math.sign(cross(t))!==winding))continue;
   const replacement=ids.map((ids,k)=>({face:{...(k?b:a).face,vertices:ids as [string,string,string]},triangle:ids.map(id=>coords.get(id)!)}));
   if(Math.min(...replacement.map(r=>quality(r,v)))>Math.min(quality(a,v),quality(b,v))*1.01){children[i]=replacement[0];children[j]=replacement[1];}
  }
  let acceptable=true;for(const [parent,children] of refined.children){const original=sourceFaces.get(parent)!,q=quality({face:original,triangle:[]},vertices);if(children.some(c=>quality(c,v)<Math.min(.015,q*.2)))acceptable=false;}
  if(!acceptable)continue;
  refined.surface.faces=mesh.faces.flatMap(f=>refined.children.get(f.id)?.map(c=>c.face)??[f]);
  // A better diagonal changes each child's corner stations while keeping its
  // face ID. Rebuild texture corners from those final parent coordinates.
  if(mesh.textureFaces)refined.surface.textureFaces=mesh.textureFaces.flatMap(t=>refined.children.get(t.faceId)?.map(c=>({
   faceId:c.face.id,textureId:t.textureId,uv:c.triangle.map(([u,v])=>{
    const w=[1-(u+v)/1000,u/1000,v/1000];
    return [w.reduce((s,n,i)=>s+n*t.uv[i][0],0),w.reduce((s,n,i)=>s+n*t.uv[i][1],0)] as [number,number];
   }) as [[number,number],[number,number],[number,number]]
  }))??[t]);
  const childFaces=faces.flatMap(f=>refined.children.get(f.id)?.map(c=>c.face)??[f]),sides=childFaces.map(f=>({face:f,value:f.vertices.reduce((sum,id)=>sum+dot(plane.normal,((p)=>[p.xMm,p.yMm,p.zMm])(v.get(id)!))-plane.position,0)/3})),parts=[sides.filter(r=>r.value<0),sides.filter(r=>r.value>=0)].flatMap(rows=>designComponents(rows.map(r=>r.face)));
  if(parts.length<2||parts.length>4||parts.some(p=>!p.length))continue;
  // A balanced pair of half-spaces can still detach a microscopic third
  // component at a curved joint. Reject that proposal and try another plane;
  // never manufacture the numerical island as a separate sewing panel.
  const partArea=(part:Surface['faces'])=>part.reduce((sum,f)=>{const [a,b,c]=f.vertices.map(id=>v.get(id)!),u=[b.xMm-a.xMm,b.yMm-a.yMm,b.zMm-a.zMm],w=[c.xMm-a.xMm,c.yMm-a.yMm,c.zMm-a.zMm];return sum+Math.hypot(u[1]*w[2]-u[2]*w[1],u[2]*w[0]-u[0]*w[2],u[0]*w[1]-u[1]*w[0])/2;},0);
  if(parts.some(part=>partArea(part)<total*.02))continue;
  return{...refined,parts,plane};
 }catch{/* An unusable proposal leaves the mesh and other charts unchanged. */}
}
