import type {Surface,SurfaceReport} from '../schema/index';

type Edge={a:string;b:string;left:[string,string];right:[string,string];length:number};
/** Join a connected portion of an existing trial seam. The unjoined portion
 * remains a dart: no face, material, physical station or user seam is removed.
 * These are proposals only; the caller must solve and check the whole union. */
export function partialChartJoins(mesh:Surface,a:SurfaceReport,b:SurfaceReport,allowed:(a:string,b:string)=>boolean,newId=()=>crypto.randomUUID()){
 const vertices=new Map(mesh.vertices.map(v=>[v.id,v])),leftFaces=new Set(a.faceIds),rightFaces=new Set(b.faceIds),selected=mesh.faces.filter(f=>leftFaces.has(f.id)||rightFaces.has(f.id));
 const position=(id:string)=>{const v=vertices.get(id)!;return[v.xMm,v.yMm,v.zMm].join(',');};
 const compare=(a:string,b:string)=>{const p=a.split(',').map(Number),q=b.split(',').map(Number);return p[0]-q[0]||p[1]-q[1]||p[2]-q[2];};
 const occurrences=new Map<string,{face:Surface['faces'][number];ids:[string,string];points:[string,string]}[]>();
 for(const f of selected)for(let i=0;i<3;i++){const ids:[string,string]=[f.vertices[i],f.vertices[(i+1)%3]],points=ids.map(position) as [string,string],key=[...points].sort().join('|'),rows=occurrences.get(key)??[];rows.push({face:f,ids,points});occurrences.set(key,rows);}
 const shared:Edge[]=[];
 for(const rows of occurrences.values()){
  if(rows.length!==2)continue;
  const l=rows.find(r=>leftFaces.has(r.face.id)),r=rows.find(r=>rightFaces.has(r.face.id));
  if(!l||!r||!allowed(l.face.id,r.face.id))continue;
  const p=vertices.get(l.ids[0])!,q=vertices.get(l.ids[1])!,order=r.points[0]===l.points[0]?r.ids:[r.ids[1],r.ids[0]] as [string,string];
  shared.push({a:l.points[0],b:l.points[1],left:l.ids,right:order,length:Math.hypot(p.xMm-q.xMm,p.yMm-q.yMm,p.zMm-q.zMm)});
 }
 const incident=new Map<string,Edge[]>();for(const e of shared)for(const p of[e.a,e.b])incident.set(p,[...incident.get(p)??[],e]);
 // Branching seam networks need a separate topology decision. Never infer a
 // partial weld from an arbitrary order through such a junction.
 if(shared.length<2||[...incident.values()].some(rows=>rows.length>2))return [];
 const remaining=new Set(shared),paths:Edge[][]=[];
 while(remaining.size){
  const component=[...remaining][0],reachable=new Set<string>(),work=[component.a];while(work.length){const p=work.pop()!;if(reachable.has(p))continue;reachable.add(p);for(const e of incident.get(p)??[])work.push(e.a===p?e.b:e.a);}
  let at=[...reachable].filter(p=>incident.get(p)!.length===1).sort(compare)[0]??[...reachable].sort(compare)[0];const path:Edge[]=[];
  while(true){const edge=(incident.get(at)??[]).filter(e=>remaining.has(e)).sort((x,y)=>compare(x.a===at?x.b:x.a,y.a===at?y.b:y.a))[0];if(!edge)break;remaining.delete(edge);path.push(edge);at=edge.a===at?edge.b:edge.a;}
  paths.push(path);
 }
 const results:{faces:Surface['faces'];vertices:Surface['vertices'];right:SurfaceReport}[]=[],signatures=new Set<string>();
 const leftIds=new Set(selected.filter(f=>leftFaces.has(f.id)).flatMap(f=>f.vertices));
 // A midpoint inserted into an unchanged straight seam is not a new dart
 // station. Choose among physical bends, retaining every constituent edge,
 // so coplanar refinement cannot change the joined length or paper panels.
 const straight=(a:Edge,b:Edge)=>{
  const at=[a.a,a.b].find(p=>p===b.a||p===b.b);if(!at)return false;
  const p=(a.a===at?a.b:a.a).split(',').map(Number),q=at.split(',').map(Number),r=(b.a===at?b.b:b.a).split(',').map(Number),u=q.map((n,i)=>n-p[i]),v=r.map((n,i)=>n-q[i]);
  return u.reduce((s,n,i)=>s+n*v[i],0)>0&&Math.hypot(u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0])<=1e-10*a.length*b.length;
 };
 for(const path of paths.sort((a,b)=>b.reduce((s,e)=>s+e.length,0)-a.reduce((s,e)=>s+e.length,0))){
 const runs:Edge[][]=[];for(const edge of path){const previous=runs.at(-1);if(previous&&straight(previous.at(-1)!,edge))previous.push(edge);else runs.push([edge]);}
 // With several separate common seams, joining one whole chain still leaves
 // the other chains as openings. Cutting that chain again is unnecessary.
 // A curved seam can need a longer dart than three quarters of its length.
 // Also try retaining just the terminal straight physical run. Its stations
 // are independent of coplanar triangle subdivisions; the same two-mm hinge,
 // source-lock, overlap, strain and manufacturing checks still apply.
 for(const fraction of paths.length>1?[1,.75,.5,.25,0]:[.75,.5,.25,0])for(const reverse of [false,true]){
  const ordered=reverse?[...runs].reverse():runs,total=path.reduce((s,e)=>s+e.length,0),joined:Edge[]=[];let length=0;
  for(const run of ordered){const span=run.reduce((s,e)=>s+e.length,0);if(length+span>total*fraction&&joined.length)break;joined.push(...run);length+=span;}
  if(joined.length===shared.length||length<2)continue;
  const replacements=new Map<string,string>();let ambiguous=false;
  for(const e of joined)for(let i=0;i<2;i++){const previous=replacements.get(e.right[i]);if(previous&&previous!==e.left[i])ambiguous=true;replacements.set(e.right[i],e.left[i]);}
  if(ambiguous)continue;
  const signature=[...replacements].sort().map(([a,b])=>a+':'+b).join('|');if(signatures.has(signature))continue;signatures.add(signature);
  const added:Surface['vertices']=[];
  // Face-ID subdivision can leave the two charts sharing vertex IDs before
  // this operation. Duplicate every unjoined shared station on the right so
  // it stays on the dart boundary rather than closing incidentally.
  for(const id of new Set(selected.filter(f=>rightFaces.has(f.id)).flatMap(f=>f.vertices)))if(leftIds.has(id)&&!replacements.has(id)){const copy={...vertices.get(id)!,id:newId()};added.push(copy);replacements.set(id,copy.id);}
  const faces=selected.map(f=>rightFaces.has(f.id)?{...f,vertices:f.vertices.map(id=>replacements.get(id)??id) as [string,string,string]}:{...f});
  const right={...b,uv:b.uv.map(p=>({...p,vertexId:replacements.get(p.vertexId)??p.vertexId}))};
  results.push({faces,vertices:[...mesh.vertices,...added],right});
 }
 }
 return results;
}
