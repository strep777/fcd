import {it,expect} from 'vitest';
import {randomUUID} from 'node:crypto';
import {resolve} from 'node:path';
import {project,rectangle} from '../fixtures';
import {generateSpecies,speciesDefaults} from '../../apps/desktop/main/species';
import {assembleSpecies} from '../../apps/desktop/main/species-assembly';
import {parseObj,bindingIssues} from '../../apps/desktop/main/surface';
import {projectMarking,markingIssues} from '../../apps/desktop/main/markings';
import {cutPreview} from '../../apps/desktop/main/cut-preview';
import {Repository} from '../../apps/desktop/main/repository';
import {workflowBytes,readWorkflow} from '../../apps/desktop/main/workflow-exchange';
import {workflowNodes} from '../../packages/workflow/nodes';
import {cutAssembly,cutAssemblyMarkings} from '../../packages/surface/cut-assembly';
const worker=resolve('target/release/fpcad-worker.exe'),assets=resolve('dist/assets');
type Vec3=[number,number,number];
type Vec2=[number,number];
const subtract=(a:number[],b:number[])=>a.map((v,i)=>v-b[i]);
const dot=(a:number[],b:number[])=>a.reduce((sum,v,i)=>sum+v*b[i],0);
const cross=(a:number[],b:number[]):Vec3=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
const twiceArea=(ring:Vec2[])=>ring.reduce((sum,a,i)=>{const b=ring[(i+1)%ring.length];return sum+a[0]*b[1]-a[1]*b[0];},0);
/** Independent convex clipping in the original face's two barycentric axes. */
function intersection(a:Vec2[],b:Vec2[]){
 let ring=a;
 for(let i=0;i<b.length&&ring.length;i++){
  const start=b[i],end=b[(i+1)%b.length],side=(p:Vec2)=>(end[0]-start[0])*(p[1]-start[1])-(end[1]-start[1])*(p[0]-start[0]),output:Vec2[]=[];
  let previous=ring.at(-1)!,before=side(previous);
  for(const point of ring){const after=side(point);if((before>=0)!==(after>=0)){const t=before/(before-after);output.push([previous[0]+t*(point[0]-previous[0]),previous[1]+t*(point[1]-previous[1])]);}if(after>=0)output.push(point);previous=point;before=after;}
  ring=output;
 }
 return ring;
}
function verifyAssemblyCoverage(surface:NonNullable<ReturnType<typeof project>['surface']>,run:Awaited<ReturnType<typeof cutPreview>>['run']){
 const vertices=new Map(surface.vertices.map(v=>[v.id,[v.xMm,v.yMm,v.zMm] as Vec3])),faces=new Map(surface.faces.map(f=>[f.id,f]));
 const trimByFace=new Map<string,Vec2[][]>(),expected=new Map<string,{points:Vec3[];used:boolean}[]>();let expectedCount=0;
 for(const binding of run.bindings)for(const triangle of binding.trim!.triangles){
  const face=faces.get(triangle.faceId);expect(face,triangle.faceId).toBeDefined();
  const source=face!.vertices.map(id=>vertices.get(id)!);
  for(const weights of triangle.barycentric){expect(weights.every(w=>Number.isFinite(w)&&w>=-1e-10&&w<=1+1e-10)).toBe(true);expect(weights.reduce((a,b)=>a+b,0)).toBeCloseTo(1,10);}
  const local=triangle.barycentric.map(w=>[w[1],w[2]] as Vec2);expect(twiceArea(local),triangle.faceId).toBeGreaterThan(0);
  trimByFace.set(triangle.faceId,[...(trimByFace.get(triangle.faceId)??[]),local]);
  const key=binding.pieceId+':'+triangle.faceId,points=triangle.barycentric.map(w=>[0,1,2].map(axis=>w.reduce((sum,n,i)=>sum+n*source[i][axis],0)) as Vec3);
  expected.set(key,[...(expected.get(key)??[]),{points,used:false}]);expectedCount++;
 }
 // Refinement can create many triangles for one original face. Full positive
 // area plus zero pairwise interior intersection certifies no gap or overlap.
 expect(trimByFace.size).toBe(surface.faces.length);
 for(const face of surface.faces){const triangles=trimByFace.get(face.id)!;expect(triangles.reduce((sum,t)=>sum+twiceArea(t),0),face.id).toBeCloseTo(1,9);for(let i=0;i<triangles.length;i++)for(let j=i+1;j<triangles.length;j++)expect(Math.abs(twiceArea(intersection(triangles[i],triangles[j]))),face.id).toBeLessThanOrEqual(1e-9);}
 const assembly=cutAssembly(surface,run),physicalCoverage=new Map<string,number>();expect(assembly).toHaveLength(expectedCount);
 for(const triangle of assembly){
  const source=faces.get(triangle.faceId)!.vertices.map(id=>vertices.get(id)!),ab=subtract(source[1],source[0]),ac=subtract(source[2],source[0]),normal=cross(ab,ac),normalSquared=dot(normal,normal);
  for(const point of triangle.points){const ap=subtract(point,source[0]);expect(Math.abs(dot(ap,normal))/Math.sqrt(normalSquared),triangle.faceId).toBeLessThanOrEqual(1e-6);const u=dot(cross(ap,ac),normal)/normalSquared,v=dot(cross(ab,ap),normal)/normalSquared;expect([1-u-v,u,v].every(w=>Number.isFinite(w)&&w>=-1e-9&&w<=1+1e-9),triangle.faceId).toBe(true);}
  const ratio=dot(cross(subtract(triangle.points[1],triangle.points[0]),subtract(triangle.points[2],triangle.points[0])),normal)/normalSquared;expect(ratio,triangle.faceId).toBeGreaterThan(0);physicalCoverage.set(triangle.faceId,(physicalCoverage.get(triangle.faceId)??0)+ratio);
  const candidates=expected.get(triangle.pieceId+':'+triangle.faceId)??[],match=candidates.find(candidate=>!candidate.used&&candidate.points.every(point=>triangle.points.some(actual=>Math.hypot(...subtract(point,actual))<=1e-7)));expect(match,'assembly triangle must correspond to one persisted trim triangle').toBeDefined();match!.used=true;
 }
 for(const face of surface.faces)expect(physicalCoverage.get(face.id),face.id).toBeCloseTo(1,9);
 expect([...expected.values()].flat().every(triangle=>triangle.used)).toBe(true);
}
// Default design cutting performs bounded sequential chart solves. The real
// 8534-face fixture took 220 s without contention; match its production budget.
it('whole curved canine cuts retain every marking and hole through archive and independent workflow restoration',async()=>{
 const p=project();p.pieces=[];p.surface=await assembleSpecies(generateSpecies(speciesDefaults('canine')));expect(p.surface.faces.length).toBeGreaterThan(8000);
 const source=rectangle(180,220);source.allowanceMm=0;source.color='#ef6588';source.nodes.forEach(n=>{n.xMm-=90;n.yMm+=900});source.holes=[[[ -30,960],[-30,1010],[30,1010],[30,960]].map(([xMm,yMm])=>({id:randomUUID(),xMm,yMm}))];
 p.patternLibrary=[{piece:source,referenceId:randomUUID(),view:'front',category:'body'}];p.markings=[await projectMarking(worker,p,source.id,'front',0,0)];const original=structuredClone(p.markings);expect(original[0].fragments.length).toBeGreaterThan(20);
 const candidate=await cutPreview(worker,p.surface,p,{method:'arap',automaticCuts:true,normalAngleDeg:60,maxFacesPerPatch:400,optimizeCuts:true,searchPasses:3,maxPieces:500},assets);
 expect(candidate.run.pieces.length).toBeLessThanOrEqual(500);expect(candidate.run.bindings.every(b=>!!b.trim)).toBe(true);expect(new Set(candidate.run.bindings.flatMap(b=>b.report.faceIds)).size).toBe(p.surface.faces.length);expect(candidate.markings.map(m=>m.fragments)).toEqual(original.map(m=>m.fragments));expect(candidate.markings[0].paths.length).toBeGreaterThan(0);expect(candidate.run.pieces.every(p=>p.color==='#eceae5')).toBe(true);
 const overlays=cutAssemblyMarkings(p.surface,candidate.run,candidate.markings);expect(overlays).toHaveLength(original[0].fragments.length);expect(overlays.every(o=>o.color===source.color)).toBe(true);expect(overlays.some(o=>o.rings.length>1)).toBe(true);verifyAssemblyCoverage(p.surface,candidate.run);
 const repo=new Repository(':memory:'),fresh=new Repository(':memory:');try{repo.open(p,null);repo.commit({type:'unwrap.candidate',run:candidate.run,markings:candidate.markings},randomUUID(),'preview');repo.commit({type:'unwrap.accept'},randomUUID(),'accept');const ready=repo.snapshot()!;expect(ready.cuttingLibrary).toHaveLength(1);expect(bindingIssues(ready).filter(i=>i.severity==='error')).toEqual([]);expect(markingIssues(ready)).toEqual([]);const bytes=workflowBytes(ready);expect(new TextDecoder().decode(bytes)).not.toContain('sqlite-resource:');fresh.create('fresh');fresh.open(readWorkflow(bytes),null);expect(fresh.snapshot()).toEqual(ready);expect(workflowNodes(fresh.snapshot()!)).toEqual(workflowNodes(ready));expect(cutAssemblyMarkings(ready.cuttingLibrary![0].surface,ready.cuttingLibrary![0].run,ready.cuttingLibrary![0].markings)).toEqual(overlays);}finally{repo.close();fresh.close();}
},600000);
it('1500 mm legal whole pattern and long marking use the safest local precision without a size failure',async()=>{
 const p=project();p.pieces=[];p.surface=parseObj('v 0 0 0\nv 1500 0 0\nv 1500 400 0\nv 0 400 0\nf 1 2 3\nf 1 3 4');const source=rectangle(1400,200);source.allowanceMm=0;source.nodes.forEach(n=>{n.xMm+=50;n.yMm+=100});p.patternLibrary=[{piece:source,referenceId:randomUUID(),view:'front',category:'long source'}];p.markings=[await projectMarking(worker,p,source.id,'front',0,0)];const result=await cutPreview(worker,p.surface,p,{automaticCuts:false},assets);expect(result.run.pieces).toHaveLength(1);expect(result.markings[0].fragments).toEqual(p.markings[0].fragments);const area=result.markings[0].paths.flatMap(p=>p.rings).reduce((s,r)=>s+r.reduce((sum,a,i)=>{const b=r[(i+1)%r.length];return sum+a.xMm*b.yMm-b.xMm*a.yMm},0)/2,0);expect(area).toBeCloseTo(280000,3);
},120000);
