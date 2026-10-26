import {randomUUID} from 'node:crypto';
import {resolve} from 'node:path';
import {expect,it} from 'vitest';
import type {Surface,SurfaceReport,Binding} from '../../packages/schema/index';
import {request} from '../../apps/desktop/main/worker';
import {nativeSurfaceResponseSchema} from '../../packages/surface/native-report';
import {mergeDesignCharts} from '../../packages/surface/merge-design-charts';
import {mapFromSurface,mapToSurface} from '../../packages/surface/mapping';

const worker=resolve('target/release/fpcad-worker.exe');
const key=(a:string,b:string)=>[a,b].sort().join(':');
function combined(){
 const vertices:Surface['vertices']=[],faces:Surface['faces']=[];
 const vertex=(xMm:number,yMm:number)=>{const v={id:randomUUID(),xMm,yMm,zMm:0};vertices.push(v);return v.id;};
 const face=(ids:string[])=>{const f={id:randomUUID(),region:'same-cloth',vertices:ids as [string,string,string]};faces.push(f);return f;};
 const inner=[[30,30],[70,30],[50,70]].map(([x,y])=>vertex(x,y)),outer=[[0,0],[100,0],[50,100]].map(([x,y])=>vertex(x,y)),centre=face(inner),annulus:Surface['faces']=[];
 for(let i=0;i<3;i++){const j=(i+1)%3;annulus.push(face([outer[i],outer[j],inner[j]]),face([outer[i],inner[j],inner[i]]));}
 const square=(offset:number,shared:boolean)=>{
  const a=vertex(offset,0),b=vertex(offset+100,0),c=vertex(offset+100,100),d=vertex(offset,100);
  return [face([a,b,c]),face(shared?[a,c,d]:[vertex(offset,0),vertex(offset+100,100),d])];
 };
 const trial=square(200,true),imported=square(400,false),source:Surface={id:randomUUID(),source:'obj',topologyVersion:1,vertices,faces,cutConstraints:[{a:inner[0],b:inner[1],locked:true}]},mesh=structuredClone(source);
 const duplicate=(group:Surface['faces'])=>{
  const lookup=new Map(mesh.vertices.map(v=>[v.id,v])),replacements=new Map<string,string>();
  for(const f of group)for(const id of f.vertices)if(!replacements.has(id)){const copy={...lookup.get(id)!,id:randomUUID()};mesh.vertices.push(copy);replacements.set(id,copy.id);}
  const ids=new Set(group.map(f=>f.id));mesh.faces=mesh.faces.map(f=>ids.has(f.id)?{...f,vertices:f.vertices.map(id=>replacements.get(id)!) as [string,string,string]}:f);return replacements;
 };
 const annulusCopies=duplicate(annulus);duplicate([trial[1]]);
 // The independent fixture oracle uses the explicit original vertex topology.
 // It never treats coincident imported positions as evidence of a source edge.
 const sourceEdges=new Map<string,string[]>();for(const f of source.faces)for(let i=0;i<3;i++){const k=key(f.vertices[i],f.vertices[(i+1)%3]),owners=sourceEdges.get(k)??[];owners.push(f.id);sourceEdges.set(k,owners);}
 const locked=new Set(source.cutConstraints!.map(e=>key(e.a,e.b))),allowed=new Set<string>();for(const [edge,owners]of sourceEdges)if(owners.length===2&&!locked.has(edge))allowed.add(key(owners[0],owners[1]));
 const canJoin=(a:string,b:string)=>allowed.has(key(a,b));
 const groups=[[centre.id],annulus.map(f=>f.id),...trial.map(f=>[f.id]),...imported.map(f=>[f.id])];
 return{source,mesh,groups,centre,annulus,trial,imported,inner,annulusCopies,canJoin};
}
async function native(mesh:Surface,faces:Surface['faces'],seed?:SurfaceReport['uv'],method:'lscm'|'arap-seamed'='lscm'){
 const used=new Set(faces.flatMap(f=>f.vertices)),uv=seed??mesh.vertices.filter(v=>used.has(v.id)).map(v=>({vertexId:v.id,xMm:v.xMm,yMm:v.yMm}));
 const response=nativeSurfaceResponseSchema.parse(await request(worker,{protocolVersion:1,operation:'surface.unwrap',mesh:{vertices:mesh.vertices.filter(v=>used.has(v.id)),faces,method,iterations:100,repair_cuts:false,initial_uv:uv}}));
 expect(response.patches).toHaveLength(1);return response.patches[0];
}
function physical(mesh:Surface,reports:SurfaceReport[]){
 const points=new Map(mesh.vertices.map(v=>[v.id,v]));expect(reports.flatMap(r=>r.faceIds).sort()).toEqual(mesh.faces.map(f=>f.id).sort());
 for(const report of reports){
  const uv=new Map(report.uv.map(v=>[v.vertexId,v]));expect(uv.size).toBe(report.uv.length);expect(report.areaErrorMax).toBeLessThanOrEqual(.15);expect(report.edgeErrorMax).toBeLessThanOrEqual(.1);expect(report.distortionMax).toBeLessThanOrEqual(.15);
  const binding:Binding={pieceId:randomUUID(),surfaceId:mesh.id,topologyVersion:mesh.topologyVersion,geometryHash:'',surfaceHash:'',report};
  for(const f of mesh.faces.filter(f=>report.faceIds.includes(f.id))){
   const p=f.vertices.map(id=>points.get(id)!),q=f.vertices.map(id=>uv.get(id)!);
   const world=(p[1].xMm-p[0].xMm)*(p[2].yMm-p[0].yMm)-(p[1].yMm-p[0].yMm)*(p[2].xMm-p[0].xMm),flat=(q[1].xMm-q[0].xMm)*(q[2].yMm-q[0].yMm)-(q[1].yMm-q[0].yMm)*(q[2].xMm-q[0].xMm);
   expect(flat).toBeGreaterThan(0);expect(Math.abs(flat/world-1)).toBeLessThanOrEqual(1e-9);
   for(let i=0;i<3;i++){const j=(i+1)%3;expect(Math.abs(Math.hypot(q[i].xMm-q[j].xMm,q[i].yMm-q[j].yMm)-Math.hypot(p[i].xMm-p[j].xMm,p[i].yMm-p[j].yMm))).toBeLessThanOrEqual(1e-9);}
   const weights:[number,number,number]=[.2,.3,.5],point=mapFromSurface(binding,f.id,weights,mesh);expect(point).not.toBeNull();const hit=mapToSurface(mesh,binding,point!);expect(hit).not.toBeNull();expect(hit!.faceId).toBe(f.id);hit!.barycentric.forEach((w,i)=>expect(w).toBeCloseTo(weights[i],12));
  }
 }
}

it.each(['original','reverse chart order','reverse face storage'] as const)('local helper rejects indirect locked-edge welding while merging an unrelated trial and preserving imported source seams (%s)',async order=>{
 const f=combined(),{mesh}=f,sourceBefore=structuredClone(f.source),meshBefore=structuredClone(mesh);
 if(order==='reverse face storage')mesh.faces.reverse();
 let charts:SurfaceReport[]=[];for(const ids of f.groups)charts.push(await native(mesh,mesh.faces.filter(face=>ids.includes(face.id))));
 if(order==='reverse chart order')charts.reverse();const chartsBefore=structuredClone(charts),calls:string[][]=[];
 // Both other centre edges are permitted. Welding their endpoints would also
 // close the third, locked edge, despite that pair never being a legal link.
 expect(f.canJoin(f.centre.id,f.annulus[1].id)).toBe(false);expect(f.canJoin(f.centre.id,f.annulus[3].id)).toBe(true);expect(f.canJoin(f.centre.id,f.annulus[5].id)).toBe(true);
 const unsafeBack=new Map(f.inner.map(id=>[f.annulusCopies.get(id)!,id])),dangerousFaces=mesh.faces.filter(face=>[f.centre.id,...f.annulus.map(v=>v.id)].includes(face.id)).map(face=>({...face,vertices:face.vertices.map(id=>unsafeBack.get(id)??id) as [string,string,string]}));
 // Geometric validity alone cannot protect this seam: the prohibited union
 // is an exact native-certified planar disk. This is a test-only diagnostic.
 const unsafe=await native(mesh,dangerousFaces);expect(unsafe.faceIds).toHaveLength(7);
 const result=await mergeDesignCharts(mesh,charts,async(faces,seed)=>{calls.push(faces.map(v=>v.id));expect(seed).toBeDefined();return native(mesh,faces,seed,'arap-seamed');},new Set(),()=>true,true,f.canJoin);
 expect(result).toHaveLength(5);expect(calls).toHaveLength(1);expect(new Set(calls[0])).toEqual(new Set(f.trial.map(v=>v.id)));physical(mesh,result);
 const protectedIds=new Set([f.centre.id,...f.annulus.map(v=>v.id),...f.imported.map(v=>v.id)]);
 expect(mesh.faces.filter(v=>protectedIds.has(v.id)).sort((a,b)=>a.id.localeCompare(b.id))).toEqual(meshBefore.faces.filter(v=>protectedIds.has(v.id)).sort((a,b)=>a.id.localeCompare(b.id)));
 expect(result.filter(r=>r.faceIds.some(id=>f.imported.some(v=>v.id===id))).map(r=>r.faceIds.length)).toEqual([1,1]);
 expect(mesh.cutConstraints).toEqual(meshBefore.cutConstraints);expect(mesh.vertices).toEqual(meshBefore.vertices);expect(charts).toEqual(chartsBefore);expect(f.source).toEqual(sourceBefore);
},120000);
