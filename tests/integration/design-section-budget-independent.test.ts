import {afterEach,expect,it,vi} from 'vitest';
import {randomUUID} from 'node:crypto';
import {resolve} from 'node:path';
import {project} from '../fixtures';
import {surfaceRunSchema,type Surface} from '../../packages/schema/index';
import type {MaterialFace} from '../../packages/surface/design-cuts';
import * as section from '../../packages/surface/design-section';
import * as planar from '../../packages/surface/planar';
import * as projected from '../../packages/surface/projected-report';
import * as workerApi from '../../apps/desktop/main/worker';
import {DomainError} from '../../apps/desktop/main/repository';
import {unwrapDesignSurface,restoreDesignBindings} from '../../apps/desktop/main/design-cuts';

afterEach(()=>vi.restoreAllMocks());
it('later material domains retain physical interior sections after the first thirty-two repairs',async()=>{
 const vertices:Surface['vertices']=[],faces:Surface['faces']=[],colors:string[]=[],originalDomains=new Map<string,Set<string>>();
 for(let domain=0;domain<33;domain++){
  const first=vertices.length,color='#'+(0x103000+domain*500).toString(16).padStart(6,'0'),region='design:'+color;colors.push(color);
  for(let y=0;y<=8;y++)for(let x=0;x<=4;x++)vertices.push({id:randomUUID(),xMm:domain*120+x*20,yMm:y*20,zMm:0});
  const ids=new Set<string>();for(let y=0;y<8;y++)for(let x=0;x<4;x++){const a=first+y*5+x,b=a+1,c=a+5,d=c+1;for(const row of [[a,b,d],[a,d,c]]){const face={id:randomUUID(),vertices:row.map(i=>vertices[i].id) as [string,string,string],region};faces.push(face);ids.add(face.id);}}
  originalDomains.set(region,ids);
 }
 const p=project();p.pieces=[];p.defaultAllowanceMm=0;p.surface={id:randomUUID(),source:'obj',topologyVersion:1,vertices,faces};const before=structuredClone(p);
 const provenance=new Map<string,MaterialFace>(faces.map(f=>[f.id,{faceId:f.id,color:f.region.slice(7),barycentric:[[1,0,0],[0,1,0],[0,0,1]]}]));
 const working={surface:structuredClone(p.surface),provenance,topologySeams:0,materialDomains:33};
 const isOriginal=(rows:Surface['faces'])=>{const ids=originalDomains.get(rows[0]?.region);return !!ids&&rows.length===ids.size&&rows.every(f=>ids.has(f.id));};
 const nativePlanar=planar.planarReports,nativeProjection=projected.projectedReport,nativeSession=workerApi.createWorkerSession,nativeSection=section.sectionDesignDomain;
 // One rejected solve per original domain reaches the repair path. All
 // physical section selection/remeshing, solved child charts, strict binding
 // restoration and final native manufacturing analysis remain production.
 vi.spyOn(planar,'planarReports').mockImplementation((mesh,holes)=>isOriginal(mesh.faces)?{reports:[],holes:new Map(),remaining:mesh.faces}:nativePlanar(mesh,holes));
 vi.spyOn(projected,'projectedReport').mockImplementation(mesh=>isOriginal(mesh.faces)?undefined:nativeProjection(mesh));
 let rejected=0;vi.spyOn(workerApi,'createWorkerSession').mockImplementation((path,signal)=>{
  const native=nativeSession(path,signal);
  return {dispose:native.dispose,request:async(input,limits)=>{
   const job=input as {operation?:string;mesh?:{faces:Surface['faces']}};
   if(job.operation==='surface.unwrap'&&job.mesh&&isOriginal(job.mesh.faces)){rejected++;throw new DomainError('PATCH_NEEDS_CUTS');}
   return native.request(input,limits);
  }};
 });
 const repaired:string[]=[],newStations=new Map<string,number>();vi.spyOn(section,'sectionDesignDomain').mockImplementation((mesh,domain,...rest)=>{const result=nativeSection(mesh,domain,...rest);if(result){const region=domain[0].region,oldIds=new Set(mesh.vertices.map(v=>v.id));repaired.push(region);newStations.set(region,result.surface.vertices.filter(v=>!oldIds.has(v.id)).length);}return result;});
 const {run}=await unwrapDesignSurface(resolve('target/release/fpcad-worker.exe'),p,working,{partitionStrategy:'design',method:'arap',automaticCuts:true,colorBoundaryCuts:true,iterations:30,maxPieces:100});
 expect(rejected).toBe(33);expect(repaired).toHaveLength(33);expect(new Set(repaired)).toEqual(new Set(originalDomains.keys()));expect(newStations.get(repaired.at(-1)!)).toBeGreaterThan(0);
 const restored=restoreDesignBindings(p,working,run);surfaceRunSchema.parse(restored);
 const lastDomain=originalDomains.get(repaired.at(-1)!)!;
 expect(restored.bindings.flatMap(b=>b.trim!.triangles).filter(t=>lastDomain.has(t.faceId)).flatMap(t=>t.barycentric).some(w=>w.filter(n=>n>1e-8&&n<1-1e-8).length>=2)).toBe(true);
 const coverage=new Map<string,number>(),areas=new Map<string,number>();for(const binding of restored.bindings){const color=restored.pieces.find(p=>p.id===binding.pieceId)!.color;for(const t of binding.trim!.triangles){const [a,b,c]=t.barycentric,ratio=(b[1]-a[1])*(c[2]-a[2])-(b[2]-a[2])*(c[1]-a[1]);expect(ratio).toBeGreaterThan(0);coverage.set(t.faceId,(coverage.get(t.faceId)??0)+ratio);areas.set(color,(areas.get(color)??0)+ratio*200);}}
 for(const face of faces)expect(coverage.get(face.id),face.id).toBeCloseTo(1,10);for(const color of colors)expect(areas.get(color),color).toBeCloseTo(12800,7);expect(p).toEqual(before);
},30000);
