import type {Surface,SurfaceReport} from '../schema/index';
import {edgeKey} from './refine';
import {designQualityFailure} from './design-partition';

/** Remove unnecessary trial seams after successful flattening. Only charts
 * sharing an uncut mesh edge and a material domain may merge. Every proposal
 * is solved and measured again; rejected unions never change either chart. */
export async function mergeDesignCharts(mesh:Surface,input:SurfaceReport[],solve:(faces:Surface['faces'])=>Promise<SurfaceReport|undefined>,rejectedGeometry=new Set<string>()){
 if(input.length<2)return input;
 const vertices=new Map(mesh.vertices.map(v=>[v.id,v])),faces=new Map(mesh.faces.map(f=>[f.id,f])),edges=new Map<string,{a:string;b:string;faces:string[]}>();
 for(const f of mesh.faces)for(let i=0;i<3;i++){const a=f.vertices[i],b=f.vertices[(i+1)%3],key=edgeKey(a,b),row=edges.get(key)??{a,b,faces:[]};row.faces.push(f.id);edges.set(key,row);}
 const charts=new Map(input.map((r,i)=>[i,r])),rejected=new Set<string>();let next=input.length,attempts=0;
 while(charts.size>1&&attempts<2000){
  const owners=new Map([...charts].flatMap(([i,r])=>r.faceIds.map(id=>[id,i] as const))),links=new Map<string,{a:number;b:number;length:number}>();
  for(const e of edges.values()){
   if(e.faces.length!==2||faces.get(e.faces[0])!.region!==faces.get(e.faces[1])!.region)continue;
   const a=owners.get(e.faces[0]),b=owners.get(e.faces[1]);if(a===undefined||b===undefined||a===b)continue;
   const key=Math.min(a,b)+':'+Math.max(a,b);if(rejected.has(key))continue;
   const p=vertices.get(e.a)!,q=vertices.get(e.b)!,row=links.get(key)??{a,b,length:0};row.length+=Math.hypot(p.xMm-q.xMm,p.yMm-q.yMm,p.zMm-q.zMm);links.set(key,row);
  }
  // Prefer removing long common boundaries, which removes the most sewing
  // work. Newly accepted unions receive a new identity for later neighbours.
  const candidates=[...links].sort((a,b)=>b[1].length-a[1].length);let merged=false;
  for(const [key,link]of candidates){
   if(++attempts>2000)break;
   const a=charts.get(link.a)!,b=charts.get(link.b)!,ids=new Set([...a.faceIds,...b.faceIds]);
   const union=[...ids].map(id=>faces.get(id)!),geometryKey=union.map(f=>f.id+':'+f.region+':'+f.vertices.map(id=>{const v=vertices.get(id)!;return [id,v.xMm,v.yMm,v.zMm].join(',');}).join(';')).sort().join('|');
   if(rejectedGeometry.has(geometryKey)){rejected.add(key);continue;}
   const report=await solve(union);
   if(!report||designQualityFailure(report)||report.faceIds.length!==ids.size||report.faceIds.some(id=>!ids.has(id))){rejected.add(key);rejectedGeometry.add(geometryKey);continue;}
   charts.delete(link.a);charts.delete(link.b);charts.set(next++,report);merged=true;break;
  }
  if(!merged)break;
 }
 return [...charts.values()];
}
