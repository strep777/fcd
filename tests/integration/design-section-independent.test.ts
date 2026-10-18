import {afterEach,expect,it,vi} from 'vitest';
import {randomUUID} from 'node:crypto';
import {resolve} from 'node:path';
import {project} from '../fixtures';
import type {Surface} from '../../packages/schema/index';
import type {MaterialFace} from '../../packages/surface/design-cuts';
import * as section from '../../packages/surface/design-section';
import * as planar from '../../packages/surface/planar';
import * as projected from '../../packages/surface/projected-report';
import * as workerApi from '../../apps/desktop/main/worker';
import {DomainError} from '../../apps/desktop/main/repository';
import {bindingIssues,validateSurface} from '../../apps/desktop/main/surface';
import {unwrapDesignSurface,restoreDesignBindings} from '../../apps/desktop/main/design-cuts';

const worker=resolve('target/release/fpcad-worker.exe');
afterEach(()=>vi.restoreAllMocks());
function grid(divisions=1):Surface{
 const vertices:Surface['vertices']=[],faces:Surface['faces']=[];
 for(let y=0;y<=8*divisions;y++)for(let x=0;x<=4*divisions;x++)vertices.push({id:randomUUID(),xMm:x*20/divisions,yMm:y*20/divisions,zMm:0});
 for(let y=0;y<8*divisions;y++)for(let x=0;x<4*divisions;x++){
  if(x>=divisions&&x<2*divisions&&y>=5*divisions&&y<6*divisions)continue; // An independently prescribed 20 x 20 mm hole.
  const a=y*(4*divisions+1)+x,b=a+1,c=a+4*divisions+1,d=c+1;
  for(const ids of [[a,b,d],[a,d,c]])faces.push({id:randomUUID(),vertices:ids.map(i=>vertices[i].id) as [string,string,string],region:y<4*divisions?'design:#bb8822':'design:#2244bb'});
 }
 return {id:randomUUID(),source:'obj',topologyVersion:1,vertices,faces};
}
function quality(mesh:Surface,face:Surface['faces'][number]){
 const vertices=new Map(mesh.vertices.map(v=>[v.id,v])),[a,b,c]=face.vertices.map(id=>vertices.get(id)!),u=[b.xMm-a.xMm,b.yMm-a.yMm,b.zMm-a.zMm],v=[c.xMm-a.xMm,c.yMm-a.yMm,c.zMm-a.zMm];
 return Math.hypot(u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0])/Math.max(Math.hypot(...u),Math.hypot(...v),Math.hypot(c.xMm-b.xMm,c.yMm-b.yMm,c.zMm-b.zMm))**2;
}
it('a section refines the adjoining material edge without a T junction, lost parent area, or new skinny triangle',()=>{
 const mesh=grid(),before=structuredClone(mesh),target=mesh.faces.filter(f=>f.region==='design:#bb8822'),result=section.sectionDesignDomain(mesh,target,randomUUID);
 expect(result).toBeDefined();expect(mesh).toEqual(before);validateSurface(result!.surface);
 const neighbors=mesh.faces.filter(f=>f.region==='design:#2244bb'&&result!.children.has(f.id));expect(neighbors.length).toBeGreaterThan(0);
 const final=new Set(result!.surface.faces.map(f=>f.id));
 for(const [parent,children] of result!.children){
  expect(final.has(parent)).toBe(false);expect(children.length).toBeGreaterThan(1);
  const original=mesh.faces.find(f=>f.id===parent)!;
  expect(children.reduce((sum,c)=>{const[a,b,d]=c.triangle;return sum+((b[0]-a[0])*(d[1]-a[1])-(b[1]-a[1])*(d[0]-a[0]))/1e6;},0)).toBeCloseTo(1,10);
  for(const child of children){expect(final.has(child.face.id)).toBe(true);expect(child.face.region).toBe(original.region);expect(quality(result!.surface,child.face)).toBeGreaterThanOrEqual(.1);}
 }
 const oldVertices=new Set(mesh.vertices.map(v=>v.id)),newOnInterface=result!.surface.vertices.filter(v=>!oldVertices.has(v.id)&&Math.abs(v.yMm-80)<1e-8);expect(newOnInterface.length).toBeGreaterThan(0);
 for(const vertex of newOnInterface){const incident=result!.surface.faces.filter(f=>f.vertices.includes(vertex.id));expect(new Set(incident.map(f=>f.region)).size).toBe(2);}
});
it('failed plane refinements leave every input face, coordinate, material and saved seam unchanged',()=>{
 const mesh=grid();mesh.cutConstraints=[{a:mesh.vertices[0].id,b:mesh.vertices[1].id,locked:true}];const before=structuredClone(mesh);let attempts=0;
 expect(section.sectionDesignDomain(mesh,mesh.faces.filter(f=>f.region==='design:#bb8822'),()=>{attempts++;throw Error('Injected allocation failure');})).toBeUndefined();
 expect(attempts).toBeGreaterThan(0);expect(mesh).toEqual(before);
});
it('opens the interior pyramid apex on the section boundary instead of isolating a smaller curved disk',()=>{
 const mesh=grid(2);for(const v of mesh.vertices)v.zMm=Math.max(0,20*(1-Math.max(Math.abs(v.xMm-40)/40,Math.abs(v.yMm-40)/40)));
 const apex=mesh.vertices.find(v=>v.xMm===40&&v.yMm===40)!,before=structuredClone(mesh),result=section.sectionDesignDomain(mesh,mesh.faces.filter(f=>f.region==='design:#bb8822'),randomUUID);
 expect(result).toBeDefined();expect(mesh).toEqual(before);validateSurface(result!.surface);
 const axis=(['xMm','yMm','zMm'] as const)[result!.plane.axis];expect(Math.abs(apex[axis]-result!.plane.position)).toBeLessThan(1e-9);
 expect(result!.owned.get('design-section')!.some(e=>e.a===apex.id||e.b===apex.id)).toBe(true);
 for(const part of result!.parts.filter(p=>p.some(f=>f.vertices.includes(apex.id)))){
  const edges=new Map<string,number>();for(const f of part)f.vertices.forEach((a,i)=>{const key=[a,f.vertices[(i+1)%3]].sort().join(':');edges.set(key,(edges.get(key)??0)+1);});
  expect([...edges].some(([edge,count])=>count===1&&edge.split(':').includes(apex.id))).toBe(true);
 }
 for(const [parent,rows] of result!.children){expect(rows.reduce((sum,c)=>{const[a,b,d]=c.triangle;return sum+((b[0]-a[0])*(d[1]-a[1])-(b[1]-a[1])*(d[0]-a[0]))/1e6;},0),parent).toBeCloseTo(1,10);for(const row of rows)expect(quality(result!.surface,row.face)).toBeGreaterThanOrEqual(.05);}
});
it('re-solves an already solved adjoining holed chart and composes every material station back to its original face',async()=>{
 const p=project();p.pieces=[];p.defaultAllowanceMm=0;p.surface=grid();const before=structuredClone(p);
 const finer={...grid(2),id:p.surface.id,topologyVersion:2},sourceVertices=new Map(p.surface.vertices.map(v=>[v.id,v])),fineVertices=new Map(finer.vertices.map(v=>[v.id,v])),provenance=new Map<string,MaterialFace>();
 for(const face of finer.faces){
  const points=face.vertices.map(id=>fineVertices.get(id)!);
  for(const original of p.surface.faces){if(original.region!==face.region)continue;const[a,b,c]=original.vertices.map(id=>sourceVertices.get(id)!),den=(b.xMm-a.xMm)*(c.yMm-a.yMm)-(b.yMm-a.yMm)*(c.xMm-a.xMm),weights=points.map(p=>{const v=((p.xMm-a.xMm)*(c.yMm-a.yMm)-(p.yMm-a.yMm)*(c.xMm-a.xMm))/den,w=((b.xMm-a.xMm)*(p.yMm-a.yMm)-(b.yMm-a.yMm)*(p.xMm-a.xMm))/den;return[1-v-w,v,w];});if(weights.every(w=>w.every(n=>n>=-1e-10&&n<=1+1e-10))){provenance.set(face.id,{faceId:original.id,color:face.region.slice(7),barycentric:weights as MaterialFace['barycentric']});break;}}
 }
 expect(provenance.size).toBe(finer.faces.length);
 const working={surface:finer,provenance,topologySeams:0,materialDomains:2},target=new Set(finer.faces.filter(f=>f.region==='design:#bb8822').map(f=>f.id)),neighbor=new Set(finer.faces.filter(f=>f.region==='design:#2244bb').map(f=>f.id)),previousStations=new Set(finer.faces.map(f=>f.id));
 const exactTarget=(faces:Surface['faces'])=>faces.length===target.size&&faces.every(f=>target.has(f.id));
 const nativePlanar=planar.planarReports,nativeProjection=projected.projectedReport,nativeSession=workerApi.createWorkerSession,nativeSection=section.sectionDesignDomain,neighborCalls:string[][]=[];
 // Inject one solver rejection to reach the production repair path. Geometry,
 // section selection, remeshing, provenance, hole reports and final native
 // manufacturing validation remain production implementations.
 vi.spyOn(planar,'planarReports').mockImplementation((mesh,allowHoles)=>{if(exactTarget(mesh.faces))return {reports:[],holes:new Map(),remaining:mesh.faces};if(mesh.faces.every(f=>f.region==='design:#2244bb'))neighborCalls.push(mesh.faces.map(f=>f.id));return nativePlanar(mesh,allowHoles);});
 vi.spyOn(projected,'projectedReport').mockImplementation(mesh=>exactTarget(mesh.faces)?undefined:nativeProjection(mesh));
 let solverRejections=0;vi.spyOn(workerApi,'createWorkerSession').mockImplementation((path,signal)=>{
  const native=nativeSession(path,signal);
  return {dispose:native.dispose,request:async(input,limits)=>{
   const job=input as {operation?:string;mesh?:{faces:Surface['faces']}};
   if(job.operation==='surface.unwrap'&&job.mesh&&exactTarget(job.mesh.faces)&&solverRejections===0){solverRejections++;throw new DomainError('PATCH_NEEDS_CUTS');}
   return native.request(input,limits);
  }};
 });
 const sections:NonNullable<ReturnType<typeof section.sectionDesignDomain>>[]=[];vi.spyOn(section,'sectionDesignDomain').mockImplementation((...args)=>{const result=nativeSection(...args);if(result)sections.push(result);return result;});
 const {run}=await unwrapDesignSurface(worker,p,working,{partitionStrategy:'design',method:'arap',automaticCuts:true,colorBoundaryCuts:true,iterations:30});
 expect(solverRejections).toBe(1);expect(sections.length).toBe(1);expect(neighborCalls.length).toBeGreaterThanOrEqual(2);expect(neighborCalls[0].every(id=>neighbor.has(id))).toBe(true);expect(neighborCalls.slice(1).some(ids=>ids.some(id=>!neighbor.has(id)))).toBe(true);
 expect([...sections[0].children.keys()].some(id=>previousStations.has(id))).toBe(true);
 const removed=new Set(sections.flatMap(r=>[...r.children.keys()]));for(const binding of run.bindings)expect(binding.report.faceIds.some(id=>removed.has(id))).toBe(false);
 expect(new Set(run.bindings.flatMap(b=>b.report.faceIds))).toEqual(new Set(working.surface.faces.map(f=>f.id)));expect(working.provenance.size).toBe(working.surface.faces.length);
 const restored=restoreDesignBindings(p,working,run),coverage=new Map<string,number>(),colorAreas=new Map<string,number>();
 for(const binding of restored.bindings){const piece=restored.pieces.find(piece=>piece.id===binding.pieceId)!;for(const t of binding.trim!.triangles){const[a,b,c]=t.barycentric,ratio=(b[1]-a[1])*(c[2]-a[2])-(b[2]-a[2])*(c[1]-a[1]);expect(ratio).toBeGreaterThan(0);coverage.set(t.faceId,(coverage.get(t.faceId)??0)+ratio);colorAreas.set(piece.color,(colorAreas.get(piece.color)??0)+ratio*200);for(const w of t.barycentric){expect(w.every(n=>Number.isFinite(n)&&n>=-1e-9&&n<=1+1e-9)).toBe(true);expect(w.reduce((s,n)=>s+n,0)).toBeCloseTo(1,10);}}}
 for(const face of p.surface.faces)expect(coverage.get(face.id),face.id).toBeCloseTo(1,9);
 expect(colorAreas.get('#bb8822')).toBeCloseTo(6400,7);expect(colorAreas.get('#2244bb')).toBeCloseTo(6000,7);
 const holed=restored.pieces.filter(piece=>piece.color==='#2244bb');expect(holed).toHaveLength(1);expect(holed[0].holes).toHaveLength(1);expect(restored.bindings.find(b=>b.pieceId===holed[0].id)!.trim!.holes).toHaveLength(1);expect(bindingIssues({...p,pieces:restored.pieces,bindings:restored.bindings})).toEqual([]);expect(p).toEqual(before);
},30000);
