import type {Surface,Marking} from '../schema/index';
import {refineSurface,edgeKey,type Bary,type FaceCut,type Child} from './refine';
import {completePlanarSeams} from './complete-planar-seams';
import {garmentSections} from './garment-sections';
import {geometricOpeningCuts} from './geometric-opening';
export type MaterialFace={faceId:string;barycentric:[Bary,Bary,Bary];color:string};
/** Compose a refined station with its original material triangle. Plane/edge
 * arithmetic can put an exact boundary station a few ulps outside [0, 1].
 * Canonicalize only roundoff, never a genuinely outside material coordinate. */
export function composeMaterialStation([u,v]:[number,number],parent:[Bary,Bary,Bary]):Bary{
 const unit=(raw:number[]):Bary=>{const tolerance=64*Number.EPSILON,sum=raw.reduce((s,n)=>s+n,0);if(raw.some(n=>!Number.isFinite(n)||n< -tolerance||n>1+tolerance)||Math.abs(sum-1)>tolerance)throw Error('INVALID_CUT');const bounded=raw.map(n=>Math.max(0,Math.min(1,n))),total=bounded.reduce((s,n)=>s+n,0);return bounded.map(n=>n/total) as Bary;};
 const weights=unit([1-(u+v)/1000,u/1000,v/1000]);
 return unit([0,1,2].map(k=>weights.reduce((sum,n,i)=>sum+n*parent[i][k],0)));
}
/** Reject unsafe stations before changing any provenance. */
export function refineMaterialProvenance(provenance:Map<string,MaterialFace>,children:Map<string,Child[]>){
 const next=new Map(provenance);
 for(const [parent,rows] of children){const source=provenance.get(parent);if(!source)throw Error('STALE_BINDING');
  next.delete(parent);
  for(const child of rows){let barycentric:MaterialFace['barycentric'];try{barycentric=child.triangle.map(point=>composeMaterialStation(point,source.barycentric)) as MaterialFace['barycentric'];}catch(error){if(error instanceof Error&&error.message==='INVALID_CUT')return;throw error;}next.set(child.face.id,{...source,barycentric});}
 }
 return next;
}
const contains=(p:number[],ring:Bary[])=>{let inside=false;for(let i=0,j=ring.length-1;i<ring.length;j=i++){const a=ring[i],b=ring[j];if((a[2]>p[1])!==(b[2]>p[1])&&p[0]<(b[1]-a[1])*(p[1]-a[2])/(b[2]-a[2])+a[1])inside=!inside;}return inside;};
/** Material boundaries subdivide triangles before flattening. Anatomical labels
 * remain metadata on the source; they do not introduce physical sewing edges. */
export function materialCutMesh(source:Surface,markings:Marking[],newId=()=>crypto.randomUUID(),allowTopologyCuts=true,baseColor='#eceae5'){
 const layers=new Map<string,{color:string;rings:Bary[][]}[]>(),cuts:FaceCut[]=[];
 for(const marking of markings.filter(m=>m.fabrication!=='detail'))for(const fragment of marking.fragments){const rows=layers.get(fragment.faceId)??[];rows.push({color:marking.color,rings:fragment.rings});layers.set(fragment.faceId,rows);for(const ring of fragment.rings)for(let i=0;i<ring.length;i++)cuts.push({faceId:fragment.faceId,a:ring[i],b:ring[(i+1)%ring.length],owner:marking.id});}
 const refined=refineSurface(source,cuts,newId),provenance=new Map<string,MaterialFace>();
 for(const original of source.faces){const rows=layers.get(original.id)??[],children=refined.children.get(original.id)??[{face:original,triangle:[[0,0],[1000,0],[0,1000]] as [number,number][]}];
  for(const child of children){const barycentric=child.triangle.map(p=>{const raw=[1-(p[0]+p[1])/1000,p[0]/1000,p[1]/1000];if(raw.some(w=>w< -1e-7||w>1+1e-7))throw Error('INVALID_CUT');const w=raw.map(n=>Math.max(0,Math.min(1,n))),sum=w.reduce((s,n)=>s+n,0);return w.map(n=>n/sum) as Bary;}) as [Bary,Bary,Bary],centroid=[barycentric.reduce((s,b)=>s+b[1],0)/3,barycentric.reduce((s,b)=>s+b[2],0)/3];let color=baseColor;for(const row of rows)if(row.rings.reduce((value,ring)=>value!==contains(centroid,ring),false))color=row.color;provenance.set(child.face.id,{faceId:original.id,barycentric,color});}
 }
 return openMaterialMesh(refined.surface,provenance,newId,allowTopologyCuts);
}
export function openMaterialMesh(source:Surface,provenance:Map<string,MaterialFace>,newId=()=>crypto.randomUUID(),allowTopologyCuts=true){
 // Visible material boundaries already define the sewing domains. Overlaying
 // every template shoulder/hip/front-back section onto each small colour
 // island multiplies pieces before any flattening has justified those cuts.
 // Keep the structural starting layout for a single-material body; multi-
 // material domains get additional sections only after a measured solve fails.
 if(allowTopologyCuts&&new Set([...provenance.values()].map(p=>p.color)).size<=1){const sections=garmentSections(source,newId);if(sections){const updated=refineMaterialProvenance(provenance,sections.children);if(updated){source=sections.surface;provenance=updated;}}}
 const mesh={...source,assembly:undefined,textures:undefined,textureFaces:undefined,cutLines:undefined,cutBaseConstraints:undefined,faces:source.faces.map(f=>({...f,region:'design:'+provenance.get(f.id)!.color}))};
 const completion=allowTopologyCuts?completePlanarSeams(mesh):{surface:mesh,seams:0};
 let completed={surface:mesh as Surface,seams:0};
 if(completion.seams){
  const existing=new Set((mesh.cutConstraints??[]).map(e=>edgeKey(e.a,e.b))),guides=(completion.surface.cutConstraints??[]).filter(e=>!existing.has(edgeKey(e.a,e.b))),paths=geometricOpeningCuts(mesh,guides);
  if(paths.length)try{const refined=refineSurface(mesh,paths,newId),updated=refineMaterialProvenance(provenance,refined.children);if(updated){completed={surface:{...refined.surface,cutConstraints:[...(refined.surface.cutConstraints??[]),...[...refined.owned.values()].flat().map(e=>({...e,locked:true}))]},seams:completion.seams};provenance=updated;}}catch{/* Preserve original user seams if an extension cannot be refined. */}
 }
 const opened=openDesignSeams(completed.surface,newId),topology=necessaryTopologyCuts(opened,undefined,true);
 let surface=opened,topologySeams=completed.seams;
 if(allowTopologyCuts&&topology.edges.length){
  const paths=geometricOpeningCuts(opened,topology.edges);
  if(paths.length)try{
   const refined=refineSurface(opened,paths,newId),updated=refineMaterialProvenance(provenance,refined.children),edges=[...refined.owned.values()].flat();
   if(updated&&edges.length){surface=openDesignSeams({...refined.surface,cutConstraints:[...(refined.surface.cutConstraints??[]),...edges.map(e=>({...e,locked:true}))]},newId);provenance=updated;topologySeams+=topology.seams;}
  }catch{/* Leave an unsafe proposal unopened for the measured chart solver. */}
 }
 return {surface,provenance,topologySeams,materialDomains:topology.domains};
}

/** Duplicate only the local vertex fans separated by a physical seam. A slit
 * can open a cylinder without cutting it into several independent panels. */
export function openDesignSeams(source:Surface,newId=()=>crypto.randomUUID()):Surface{
 const locked=new Set((source.cutConstraints??[]).filter(c=>c.locked).map(c=>edgeKey(c.a,c.b))),edges=new Map<string,number[]>(),incident=new Map<string,number[]>();
 source.faces.forEach((f,i)=>f.vertices.forEach((a,j)=>{const key=edgeKey(a,f.vertices[(j+1)%3]),rows=edges.get(key)??[];rows.push(i);edges.set(key,rows);const faces=incident.get(a)??[];faces.push(i);incident.set(a,faces);}));
 const vertices=[...source.vertices],positions=new Map(vertices.map(v=>[v.id,v])),replacements=new Map<string,string>();
 for(const [id,faces]of incident){const remaining=new Set(faces);let first=true;while(remaining.size){const start=remaining.values().next().value!,queue=[start],fan:number[]=[];remaining.delete(start);while(queue.length){const next=queue.pop()!;fan.push(next);const face=source.faces[next];for(const other of face.vertices.filter(v=>v!==id)){const key=edgeKey(id,other);if(locked.has(key))continue;for(const n of edges.get(key)??[])if(remaining.has(n)&&source.faces[n].region===face.region){remaining.delete(n);queue.push(n);}}}const target=first?id:newId();first=false;if(target!==id)vertices.push({...positions.get(id)!,id:target});fan.forEach(i=>replacements.set(i+':'+id,target));}}
 return {...source,vertices,faces:source.faces.map((f,i)=>({...f,vertices:f.vertices.map(id=>replacements.get(i+':'+id)!) as [string,string,string]})),cutConstraints:undefined};
}

/** Join distinct boundary loops by shortest physical paths. Closed genus-zero
 * components receive one long opening path. Planar holes stay intact: they
 * already have an exact flat embedding and do not require disk-topology cuts. */
export function necessaryTopologyCuts(surface:Surface,distortedFaceGroups?:string[][],preserveHoles=false){
 const distortedFaces=new Set(distortedFaceGroups?.flat()??[]);
 const vertices=new Map(surface.vertices.map(v=>[v.id,v])),edgeFaces=new Map<string,{a:string;b:string;faces:number[]}>(),adjacency=surface.faces.map(()=>[] as number[]);
 surface.faces.forEach((f,i)=>f.vertices.forEach((a,j)=>{const b=f.vertices[(j+1)%3],key=edgeKey(a,b),e=edgeFaces.get(key)??{a,b,faces:[]};e.faces.push(i);edgeFaces.set(key,e);}));for(const e of edgeFaces.values())if(e.faces.length===2&&surface.faces[e.faces[0]].region===surface.faces[e.faces[1]].region){adjacency[e.faces[0]].push(e.faces[1]);adjacency[e.faces[1]].push(e.faces[0]);}
 const seen=new Set<number>(),cuts=new Map<string,{a:string;b:string}>();let seams=0,domains=0;
 for(let seed=0;seed<surface.faces.length;seed++){if(seen.has(seed))continue;domains++;const group=new Set<number>(),queue=[seed];seen.add(seed);while(queue.length){const i=queue.pop()!;group.add(i);for(const j of adjacency[i])if(!seen.has(j)){seen.add(j);queue.push(j);}}
  const selected=[...group].map(i=>surface.faces[i]),ids=new Set(selected.flatMap(f=>f.vertices)),xyz=(id:string)=>{const v=vertices.get(id)!;return [v.xMm,v.yMm,v.zMm];},[a,b,c]=selected[0].vertices.map(xyz),u=b.map((n,i)=>n-a[i]),v=c.map((n,i)=>n-a[i]),normal=[u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0]],length=Math.hypot(...normal);
  if([...ids].every(id=>Math.abs(xyz(id).reduce((s,n,i)=>s+(n-a[i])*normal[i],0))/length<=1e-8))continue;
  const edges=[...edgeFaces.values()].filter(e=>e.faces.some(i=>group.has(i))),boundary=edges.filter(e=>e.faces.filter(i=>group.has(i)).length===1),outgoing=new Map(boundary.map(e=>[e.a,e.b])),pending=new Set(outgoing.keys()),loops:string[][]=[];let valid=true;
  while(pending.size&&valid){const start=pending.values().next().value!,ring:string[]=[];let id=start;do{if(!pending.has(id)||!outgoing.has(id)){valid=false;break;}pending.delete(id);ring.push(id);id=outgoing.get(id)!;}while(id!==start);loops.push(ring);}if(!valid)continue;
  const comparePosition=(a:string,b:string)=>{const p=xyz(a),q=xyz(b);return p[0]-q[0]||p[1]-q[1]||p[2]-q[2];};
  const normals=new Map([...group].map(i=>{const [a,b,c]=surface.faces[i].vertices.map(xyz),u=b.map((n,k)=>n-a[k]),v=c.map((n,k)=>n-a[k]),n=[u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0]],length=Math.hypot(...n);return[i,n.map(n=>n/length)];}));
  // A diagonal drawn inside one flat fabric facet is only tessellation.
  // Opening paths use the physical creases and the material boundary; adding
  // coplanar midpoints then subdivides the same path instead of inventing a
  // shorter zigzag through unrelated triangle edges.
  const pathEdges=edges.filter(e=>{const local=e.faces.filter(i=>group.has(i));return local.length!==2||normals.get(local[0])!.reduce((sum,n,i)=>sum+n*normals.get(local[1])![i],0)<1-1e-10;});
  const neighbours=new Map<string,{id:string;length:number}[]>();for(const e of pathEdges){const p=xyz(e.a),q=xyz(e.b),distance=Math.hypot(...p.map((n,i)=>n-q[i]));for(const [a,b]of [[e.a,e.b],[e.b,e.a]]){const rows=neighbours.get(a)??[];rows.push({id:b,length:distance});neighbours.set(a,rows);}}
  for(const rows of neighbours.values())rows.sort((a,b)=>comparePosition(a.id,b.id));
  const corners=new Set([...neighbours].filter(([id,rows])=>{if(rows.length!==2)return true;const p=xyz(id),a=xyz(rows[0].id).map((n,i)=>n-p[i]),b=xyz(rows[1].id).map((n,i)=>n-p[i]);return a.reduce((s,n,i)=>s+n*b[i],0)/(rows[0].length*rows[1].length)>-1+1e-10;}).map(([id])=>id));
  loops.sort((a,b)=>comparePosition([...a].sort(comparePosition)[0],[...b].sort(comparePosition)[0]));
  const shortest=(starts:Set<string>,targets?:Set<string>)=>{const distance=new Map([...starts].map(id=>[id,0])),previous=new Map<string,string>(),heap=[...starts].map(id=>({id,d:0})),push=(entry:{id:string;d:number})=>{heap.push(entry);let i=heap.length-1;while(i){const p=(i-1)>>1;if(heap[p].d<=heap[i].d)break;[heap[p],heap[i]]=[heap[i],heap[p]];i=p;}},pop=()=>{const first=heap[0],last=heap.pop()!;if(heap.length){heap[0]=last;let i=0;while(i*2+1<heap.length){let j=i*2+1;if(j+1<heap.length&&heap[j+1].d<heap[j].d)j++;if(heap[i].d<=heap[j].d)break;[heap[i],heap[j]]=[heap[j],heap[i]];i=j;}}return first;};let target:string|undefined;
   while(heap.length){const current=pop();if(current.d!==distance.get(current.id))continue;if(targets?.has(current.id)){target=current.id;break;}for(const next of neighbours.get(current.id)??[]){const d=current.d+next.length;if(d>=(distance.get(next.id)??Infinity))continue;distance.set(next.id,d);previous.set(next.id,current.id);push({id:next.id,d});}}
   target??=[...distance].filter(([id])=>corners.has(id)).sort((a,b)=>Math.abs(b[1]-a[1])>1e-8?b[1]-a[1]:comparePosition(a[0],b[0]))[0]?.[0];const path:string[]=[];for(let id:string|undefined=target;id!==undefined;id=previous.get(id))path.push(id);return path.reverse();};
  const add=(path:string[])=>{if(path.length<2)return;seams++;for(let i=1;i<path.length;i++)cuts.set(edgeKey(path[i-1],path[i]),{a:path[i-1],b:path[i]});};
  if(loops.length>1&&!preserveHoles){const joined=new Set(loops[0]);for(let i=1;i<loops.length;i++){const path=shortest(joined,new Set(loops[i]));add(path);path.forEach(id=>joined.add(id));loops[i].forEach(id=>joined.add(id));}}
  else if(!loops.length&&ids.size-edges.length+group.size===2){const far=shortest(new Set([[...corners].sort(comparePosition)[0]??selected[0].vertices[0]])).at(-1)!;add(shortest(new Set([far])));}
  else if(loops.length===1&&selected.some(f=>distortedFaces.has(f.id))){const border=new Set(loops[0]),angles=new Map<string,number>();for(const face of selected)for(let i=0;i<3;i++){const p=xyz(face.vertices[i]),a=xyz(face.vertices[(i+1)%3]).map((n,j)=>n-p[j]),b=xyz(face.vertices[(i+2)%3]).map((n,j)=>n-p[j]),angle=Math.acos(Math.max(-1,Math.min(1,a.reduce((s,n,j)=>s+n*b[j],0)/(Math.hypot(...a)*Math.hypot(...b)))));angles.set(face.vertices[i],(angles.get(face.vertices[i])??0)+angle);}const target=new Set(selected.filter(f=>distortedFaces.has(f.id)).flatMap(f=>f.vertices));const interior=[...angles].filter(([id,sum])=>target.has(id)&&!border.has(id)&&Math.abs(2*Math.PI-sum)>1e-5).sort((a,b)=>Math.abs(Math.abs(2*Math.PI-b[1])-Math.abs(2*Math.PI-a[1]))>1e-9?Math.abs(2*Math.PI-b[1])-Math.abs(2*Math.PI-a[1]):comparePosition(a[0],b[0]));if(interior.length)add(shortest(new Set([interior[0][0]]),border));}
 }
 return {edges:[...cuts.values()],seams,domains};
}
