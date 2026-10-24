import {expect,it} from 'vitest';
import {randomUUID} from 'node:crypto';
import {resolve} from 'node:path';
import {project} from '../fixtures';
import {parseObj,bindingIssues} from '../../apps/desktop/main/surface';
import {editSurfaceCuts,cutComponents} from '../../apps/desktop/main/cut-tools';
import {cutPreview} from '../../apps/desktop/main/cut-preview';
import {analyze} from '../../apps/desktop/main/worker';
import {Repository} from '../../apps/desktop/main/repository';
import type {Surface,SurfaceRun,Project,CutProjection} from '../../packages/schema/index';

const worker=resolve('target/release/fpcad-worker.exe'),assets=resolve('dist/assets');
const projection:CutProjection={origin:[0,0,0],axes:[[1,0,0],[0,1,0],[0,0,1]]};
const point=(xMm:number,yMm:number)=>({id:randomUUID(),xMm,yMm,zMm:0});
function planar(allowanceMm=0):Project{const p=project();p.pieces=[];p.defaultAllowanceMm=allowanceMm;p.surface=parseObj('v 0 0 0\nv 100 0 0\nv 100 100 0\nv 0 100 0\ng body\nf 1 2 3\nf 1 3 4');return p;}
const ringArea=(r:{xMm:number;yMm:number}[])=>Math.abs(r.reduce((sum,a,i)=>{const b=r[(i+1)%r.length];return sum+a.xMm*b.yMm-a.yMm*b.xMm;},0)/2);
function area3(r:number[][]){const [a,b,c]=r,u=b.map((n,i)=>n-a[i]),v=c.map((n,i)=>n-a[i]);return Math.hypot(u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0])/2;}
function verifyConservation(surface:Surface,run:SurfaceRun){
 const vertices=new Map(surface.vertices.map(v=>[v.id,v])),faces=new Map(surface.faces.map(f=>[f.id,f])),covered=new Map<string,number>();let flatArea=0,physicalArea=0;
 for(const binding of run.bindings){
  expect(binding.trim).toBeDefined();const trim=binding.trim!,uv=new Map(trim.vertices.map(v=>[v.id,v]));
  for(const t of trim.triangles){
   const face=faces.get(t.faceId);expect(face).toBeDefined();const original=face!.vertices.map(id=>vertices.get(id)!);
   const world=t.barycentric.map(w=>{expect(w.reduce((sum,n)=>sum+n,0)).toBeCloseTo(1,9);for(const n of w)expect(n).toBeGreaterThanOrEqual(0);return ['xMm','yMm','zMm'].map(axis=>w.reduce((sum,n,i)=>sum+n*original[i][axis as 'xMm'|'yMm'|'zMm'],0));});
   const chart=t.vertices.map(id=>uv.get(id)!);expect(chart.every(Boolean)).toBe(true);const flat=ringArea(chart),physical=area3(world);expect(flat).toBeCloseTo(physical,5);flatArea+=flat;physicalArea+=physical;covered.set(t.faceId,(covered.get(t.faceId)??0)+physical);
   for(let i=0;i<3;i++)expect(Math.hypot(chart[i].xMm-chart[(i+1)%3].xMm,chart[i].yMm-chart[(i+1)%3].yMm)).toBeCloseTo(Math.hypot(...world[i].map((n,a)=>n-world[(i+1)%3][a])),6);
  }
 }
 for(const f of surface.faces){const expected=area3(f.vertices.map(id=>{const v=vertices.get(id)!;return [v.xMm,v.yMm,v.zMm];}));expect(covered.get(f.id)).toBeCloseTo(expected,5);}
 expect(physicalArea).toBeCloseTo(10000,3);expect(flatArea).toBeCloseTo(10000,3);expect(run.pieces.reduce((sum,p)=>sum+ringArea(p.nodes)-(p.holes??[]).reduce((n,h)=>n+ringArea(h),0),0)).toBeCloseTo(10000,3);
 return {flatArea,physicalArea};
}
it('an off-grid bent closed pen seam crosses the original diagonal and defines two exact planar pieces',async()=>{
 const p=planar(),before=structuredClone(p),controlPoints=[point(37,0),point(61,43),point(44,100),point(0,100),point(0,0)];
 const edited=await editSurfaceCuts(worker,p,{type:'surface.curve',name:'Off-grid closed pen',kind:'pen',controlPoints,projection,tension:1,closed:true,symmetric:false}),saved={...p,...edited};
 expect(p).toEqual(before);expect(saved.surface!.cutLines![0].kind).toBe('pen');expect(saved.surface!.cutLines![0].closed).toBe(true);expect(saved.surface!.cutLines![0].section).toBeUndefined();expect(saved.surface!.cutLines![0].controlPoints).toEqual(controlPoints);expect(cutComponents(saved.surface!.cutLines![0].edges)).toHaveLength(1);
 expect(saved.surface!.vertices.length).toBeGreaterThan(4);const crossing=saved.surface!.vertices.find(v=>Math.abs(v.xMm-v.yMm)<1e-7&&v.xMm>40&&v.xMm<70);expect(crossing).toBeDefined();expect(crossing!.xMm).toBeCloseTo(61-17*18/74,7);
 const savedBefore=structuredClone(saved),candidate=await cutPreview(worker,saved.surface!,saved,{automaticCuts:true,colorBoundaryCuts:true},assets);expect(saved).toEqual(savedBefore);expect(candidate.run.options!.partitionStrategy).toBe('design');expect(candidate.run.pieces).toHaveLength(2);expect(candidate.run.designCutReport).toEqual({materialDomains:2,userSeams:1,topologySeams:0,distortionSeams:0,manufacturingSeams:0});
 const areas=candidate.run.pieces.map(p=>ringArea(p.nodes)).sort((a,b)=>a-b);expect(areas[0]).toBeCloseTo(4900.5,3);expect(areas[1]).toBeCloseTo(5099.5,3);verifyConservation(saved.surface!,candidate.run);
 const ready={...saved,pieces:candidate.run.pieces,bindings:candidate.run.bindings,markings:candidate.markings},geometry=await analyze(worker,ready);expect(bindingIssues(ready)).toEqual([]);expect(geometry.flatMap(g=>g.issues.filter(i=>i.severity==='error'))).toEqual([]);expect(geometry.map(g=>g.areaMm2).sort((a,b)=>a-b)).toEqual(expect.arrayContaining(areas.map(a=>expect.closeTo(a,3))));
},120000);
it.each([0,100])('a %i mm project allowance applies to the generated candidate and real manufacturing geometry',async allowanceMm=>{
 const p=planar(allowanceMm),edited=await editSurfaceCuts(worker,p,{type:'surface.curve',name:'Oblique closed pen',kind:'pen',controlPoints:[point(37,0),point(44,100),point(0,100),point(0,0)],projection,tension:1,closed:true,symmetric:false}),saved={...p,...edited};
 const candidate=await cutPreview(worker,saved.surface!,saved,{automaticCuts:true},assets);expect(candidate.run.pieces).toHaveLength(2);expect(candidate.run.pieces.every(p=>p.allowanceMm===allowanceMm&&p.allowanceSource==='project')).toBe(true);verifyConservation(saved.surface!,candidate.run);
 const geometry=await analyze(worker,{...saved,pieces:candidate.run.pieces,bindings:candidate.run.bindings,markings:candidate.markings});expect(geometry.flatMap(g=>g.issues.filter(i=>i.severity==='error'))).toEqual([]);
 expect(candidate.run.cutPreview).toEqual(geometry.map(g=>({id:g.id,cut:g.cut,cutHoles:g.cutHoles})));
 for(const g of geometry){
  const seam=g.seam!,cut=g.cut;
  if(allowanceMm===0)expect(ringArea(cut)).toBeCloseTo(ringArea(seam),5);
  else{expect(ringArea(cut)).toBeGreaterThan(ringArea(seam));for(const axis of ['xMm','yMm'] as const){expect(Math.max(...cut.map(p=>p[axis]))-Math.max(...seam.map(p=>p[axis]))).toBeCloseTo(100,0);expect(Math.min(...seam.map(p=>p[axis]))-Math.min(...cut.map(p=>p[axis]))).toBeCloseTo(100,0);}}
 }
 const repo=new Repository(':memory:');try{
  repo.open(saved,null);repo.commit({type:'unwrap.candidate',run:candidate.run,markings:candidate.markings},randomUUID(),'candidate');const historical=structuredClone(repo.snapshot()!.cuttingLibrary);
  repo.commit({type:'project.allowance',widthMm:allowanceMm===0?100:0},randomUUID(),'allowance');repo.checkpoint();const before=repo.snapshot(),status=repo.status(),requestId=randomUUID();expect(()=>repo.commit({type:'unwrap.accept'},requestId,'accept')).toThrow('STALE_RESULT');expect(repo.snapshot()).toEqual(before);expect(repo.status()).toEqual(status);expect(repo.replay(requestId,'accept')).toBe(false);expect(repo.snapshot()!.cuttingLibrary).toEqual(historical);
  repo.historyMove(false);repo.commit({type:'unwrap.accept'},randomUUID(),'accepted');expect(repo.snapshot()!.cuttingLibrary).toHaveLength(1);expect(repo.snapshot()!.pieces.every(p=>p.allowanceMm===allowanceMm)).toBe(true);
 }finally{repo.close();}
},120000);
