import type {Surface,SurfaceReport} from '../schema/index';
import {edgeKey} from './refine';

/** The 5% P95 threshold remains a review warning. Every face still has hard
 * bounds on area, edge stretch and combined distortion. */
export const designQualityFailure=(report:Pick<SurfaceReport,'distortionMax'|'areaErrorMax'|'edgeErrorMax'|'seamErrorMax'|'seamLengthErrorMm'>)=>report.distortionMax>.15||report.areaErrorMax>.15||report.edgeErrorMax>.1||(report.seamErrorMax??0)>.0005||(report.seamLengthErrorMm??0)>.25;

/** Sum absolute length errors, so opposite signs cannot conceal a local
 * mismatch. Each of two sewn panels contributes at most 0.25 mm. */
export function measureBoundaryStrain(mesh:Surface,report:SurfaceReport,points=new Map(mesh.vertices.map(v=>[v.id,v]))):SurfaceReport{
 const ids=new Set(report.faceIds),edges=new Map<string,{a:string;b:string;count:number}>(),uv=new Map(report.uv.map(p=>[p.vertexId,p]));
 for(const f of mesh.faces)if(ids.has(f.id))for(let i=0;i<3;i++){const a=f.vertices[i],b=f.vertices[(i+1)%3],key=edgeKey(a,b),e=edges.get(key)??{a,b,count:0};e.count++;edges.set(key,e);}
 let seamErrorMax=0,seamLengthErrorMm=0;
 for(const e of edges.values())if(e.count===1){const a=points.get(e.a)!,b=points.get(e.b)!,p=uv.get(e.a)!,q=uv.get(e.b)!,length=Math.hypot(a.xMm-b.xMm,a.yMm-b.yMm,a.zMm-b.zMm),error=Math.abs(Math.hypot(p.xMm-q.xMm,p.yMm-q.yMm)-length);seamErrorMax=Math.max(seamErrorMax,error/length);seamLengthErrorMm+=error;}
 return {...report,seamErrorMax,seamLengthErrorMm};
}

/** Physical face components; region labels here are visible material domains. */
export function designComponents(faces:Surface['faces']){
 const edges=new Map<string,number[]>(),adj=faces.map(()=>[] as number[]);
 faces.forEach((f,i)=>f.vertices.forEach((a,j)=>{const key=edgeKey(a,f.vertices[(j+1)%3]),list=edges.get(key)??[];list.push(i);edges.set(key,list);}));
 for(const list of edges.values())if(list.length===2&&faces[list[0]].region===faces[list[1]].region){adj[list[0]].push(list[1]);adj[list[1]].push(list[0]);}
 const seen=new Set<number>(),groups:Surface['faces'][]=[];
 for(let i=0;i<faces.length;i++){if(seen.has(i))continue;const group:Surface['faces']=[],queue=[i];seen.add(i);while(queue.length){const n=queue.pop()!;group.push(faces[n]);for(const j of adj[n])if(!seen.has(j)){seen.add(j);queue.push(j);}}groups.push(group);}
 return groups;
}

/** Introduced only after a measured failure. Unlike face-index BFS, the split
 * groups nearby faces using physical positions, normals and connectivity. */
export function splitDesignDomain(mesh:Surface,faces:Surface['faces']){
 if(faces.length<2)return [];
 const vertices=new Map(mesh.vertices.map(v=>[v.id,v])),centres=faces.map(f=>{const points=f.vertices.map(id=>vertices.get(id)!),[a,b,c]=points,u=[b.xMm-a.xMm,b.yMm-a.yMm,b.zMm-a.zMm],v=[c.xMm-a.xMm,c.yMm-a.yMm,c.zMm-a.zMm];return {face:f,normal:[u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0]].map(n=>n/2),area:Math.hypot(u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0])/2,p:[0,1,2].map(axis=>points.reduce((s,p)=>s+[p.xMm,p.yMm,p.zMm][axis],0)/3)};}),total=centres.reduce((s,c)=>s+c.area,0),axes=[0,1,2].map(axis=>({axis,min:Math.min(...centres.map(c=>c.p[axis])),max:Math.max(...centres.map(c=>c.p[axis]))})).sort((a,b)=>b.max-b.min-(a.max-a.min));
 // An internal numerical ear is not a useful manufacturing panel. Absorb
 // a submicron-only child through a shared edge; every source face remains.
 const absorb=(input:Surface['faces'][])=>{const parts=input.map(rows=>[...rows]);for(let pass=0;pass<input.length;pass++){let changed=false;for(let i=0;i<parts.length;i++){const rows=parts[i];if(!rows.length)continue;const tiny=rows.every(f=>{const [a,b,c]=f.vertices.map(id=>vertices.get(id)!),u=[b.xMm-a.xMm,b.yMm-a.yMm,b.zMm-a.zMm],v=[c.xMm-a.xMm,c.yMm-a.yMm,c.zMm-a.zMm],twice=Math.hypot(u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0]),longest=Math.max(Math.hypot(...u),Math.hypot(...v),Math.hypot(c.xMm-b.xMm,c.yMm-b.yMm,c.zMm-b.zMm));return twice/longest<1e-6;});if(!tiny)continue;const edges=new Set(rows.flatMap(f=>f.vertices.map((a,j)=>edgeKey(a,f.vertices[(j+1)%3]))));let target=-1,score=0;parts.forEach((other,j)=>{if(i===j||!other.length)return;let shared=0;for(const f of other)f.vertices.forEach((a,k)=>{const b=f.vertices[(k+1)%3];if(edges.has(edgeKey(a,b))){const pa=vertices.get(a)!,pb=vertices.get(b)!;shared+=Math.hypot(pa.xMm-pb.xMm,pa.yMm-pb.yMm,pa.zMm-pb.zMm);}});if(shared>score){score=shared;target=j;}});if(target>=0){parts[target].push(...rows);parts[i]=[];changed=true;}}if(!changed)break;}return parts.filter(rows=>rows.length);};
 const measure=new Map(centres.map(c=>[c.face.id,c]));let best:Surface['faces'][]=[],bestScore=Infinity,bestBalanced=false;
 // Entity IDs are random persistence keys. A symmetric physical split must
 // not choose different faces merely because an earlier cut allocated new IDs.
 const physicalOrder=(a:typeof centres[number],b:typeof centres[number])=>{
  for(let i=0;i<3;i++){const d=a.p[i]-b.p[i];if(d)return d;}
  const corners=(row:typeof a)=>row.face.vertices.map(id=>{const v=vertices.get(id)!;return[v.xMm,v.yMm,v.zMm];}).sort((p,q)=>p[0]-q[0]||p[1]-q[1]||p[2]-q[2]).flat();
  const p=corners(a),q=corners(b);for(let i=0;i<p.length;i++)if(p[i]!==q[i])return p[i]-q[i];return 0;
 };
 for(const {axis,min,max}of axes){const sorted=[...centres].sort((a,b)=>a.p[axis]-b.p[axis]||physicalOrder(a,b));let areaMiddle=1,sum=0;for(let i=0;i<sorted.length-1;i++){sum+=sorted[i].area;areaMiddle=i+1;if(sum>=total/2)break;}const spatial=Math.max(1,Math.min(sorted.length-1,sorted.findIndex(c=>c.p[axis]>=(min+max)/2))),splits=new Set([spatial,areaMiddle,Math.ceil(sorted.length/2)]);for(const middle of splits){const halves=[sorted.slice(0,middle),sorted.slice(middle)],parts=absorb(halves.flatMap(rows=>designComponents(rows.map(r=>r.face)))),balance=Math.abs(halves[0].reduce((s,c)=>s+c.area,0)-total/2)/total;const concentration=parts.reduce((sum,part)=>sum+Math.hypot(...[0,1,2].map(axis=>part.reduce((n,f)=>n+measure.get(f.id)!.normal[axis],0))),0),score=1-concentration/total+.05*balance+.03*(parts.length-2);const balanced=parts.every(part=>part.reduce((sum,f)=>sum+measure.get(f.id)!.area,0)<=total*.85);if(parts.length>=2&&(!best.length||balanced&&!bestBalanced||balanced===bestBalanced&&(parts.length<best.length||parts.length===best.length&&score<bestScore))){best=parts;bestScore=score;bestBalanced=balanced;}}}
 return best;
}

/** Count actual paths in the final seam graph, joining consecutive edges and
 * counting a closed loop once. Repeated solver attempts do not add seams. */
export function seamPathCount(edges:[string,string][]){
 const links=new Map<string,Set<string>>();for(const [a,b]of edges){if(a===b)continue;for(const [x,y]of [[a,b],[b,a]]){const row=links.get(x)??new Set<string>();row.add(y);links.set(x,row);}}
 const visited=new Set<string>();let count=0;const walk=(a:string,b:string)=>{count++;visited.add(edgeKey(a,b));let previous=a,current=b;while(links.get(current)!.size===2){const next=[...links.get(current)!].find(id=>id!==previous)!;if(visited.has(edgeKey(current,next)))break;visited.add(edgeKey(current,next));previous=current;current=next;}};
 for(const [a,neighbours]of links)if(neighbours.size!==2)for(const b of neighbours)if(!visited.has(edgeKey(a,b)))walk(a,b);
 for(const [a,neighbours]of links)for(const b of neighbours)if(!visited.has(edgeKey(a,b)))walk(a,b);return count;
}
