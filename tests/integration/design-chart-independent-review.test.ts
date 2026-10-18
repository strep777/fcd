import {expect,it} from 'vitest';
import {randomUUID} from 'node:crypto';
import {mkdirSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import type {Project,SurfaceRun} from '../../packages/schema/index';
import {project,rectangle} from '../fixtures';
import {parseObj,bindingIssues} from '../../apps/desktop/main/surface';
import {surfaceMarking,projectMarking} from '../../apps/desktop/main/markings';
import {cutPreview} from '../../apps/desktop/main/cut-preview';
import {analyze} from '../../apps/desktop/main/worker';
import {mergeDesignCharts} from '../../packages/surface/merge-design-charts';
import {projectedReport} from '../../packages/surface/projected-report';

const worker=resolve('target/release/fpcad-worker.exe'),assets=resolve('dist/assets'),output=resolve('test-results/current-cutting');
const frame={origin:[0,0,0] as [number,number,number],axes:[[1,0,0],[0,1,0],[0,0,1]] as [[number,number,number],[number,number,number],[number,number,number]]};
const cachePanel=()=>parseObj('v 0 0 0\nv 100 0 0\nv 100 100 0\nv 0 100 0\nf 1 2 3\nf 1 3 4');
const separateCharts=(mesh:ReturnType<typeof cachePanel>)=>mesh.faces.map(face=>projectedReport({...mesh,faces:[face]})!);

it('reuses a rejected union across repair calls and face-order changes without mutating either chart',async()=>{
 const mesh=cachePanel(),input=separateCharts(mesh),saved=structuredClone({mesh,input}),rejected=new Set<string>();let calls=0;
 const first=await mergeDesignCharts(mesh,input,async()=>{calls++;return undefined;},rejected);expect(calls).toBe(1);expect(rejected.size).toBe(1);expect(first).toEqual(input);
 const second=await mergeDesignCharts({...mesh,faces:[...mesh.faces].reverse()},[...input].reverse(),async()=>{calls++;throw Error('Unchanged rejected geometry must not be retried');},rejected);
 expect(calls).toBe(1);expect(second.flatMap(r=>r.faceIds).sort()).toEqual(mesh.faces.map(f=>f.id).sort());expect({mesh,input}).toEqual(saved);
});

it.each(['coordinates','face identity','vertex identity','material region','triangle topology'] as const)('invalidates a cross-repair rejected union when %s changes',async change=>{
 const original=cachePanel(),rejected=new Set<string>();await mergeDesignCharts(original,separateCharts(original),async()=>undefined,rejected);expect(rejected.size).toBe(1);
 const changed=structuredClone(original);
 if(change==='coordinates')changed.vertices[1].xMm+=5;
 if(change==='face identity')changed.faces[0].id=randomUUID();
 if(change==='vertex identity'){const old=changed.vertices[0].id,next=randomUUID();changed.vertices[0].id=next;changed.faces.forEach(f=>{f.vertices=f.vertices.map(id=>id===old?next:id) as [string,string,string];});}
 if(change==='material region')changed.faces.forEach(f=>{f.region='repair-material-domain';});
 if(change==='triangle topology'){const v=changed.vertices.map(v=>v.id);changed.faces[0].vertices=[v[0],v[1],v[3]];changed.faces[1].vertices=[v[1],v[2],v[3]];}
 const before=structuredClone(changed);let calls=0;const merged=await mergeDesignCharts(changed,separateCharts(changed),async faces=>{calls++;return projectedReport({...changed,faces});},rejected);
 expect(calls).toBe(1);expect(merged).toHaveLength(1);expect(merged[0].faceIds.slice().sort()).toEqual(changed.faces.map(f=>f.id).sort());expect(changed).toEqual(before);expect(rejected.size).toBe(1);
});
function inspect(p:Project,run:SurfaceRun){
 const source=p.surface!,positions=new Map(source.vertices.map(v=>[v.id,v])),faces=new Map(source.faces.map(f=>[f.id,f])),coverage=new Map<string,number>(),colorAreas=new Map<string,number>(),panels=[];
 for(const b of run.bindings){
  const piece=run.pieces.find(p=>p.id===b.pieceId)!,world=[];
  expect(b.report.areaErrorMax).toBeLessThanOrEqual(.15);expect(b.report.edgeErrorMax).toBeLessThanOrEqual(.1);expect(b.report.distortionMax).toBeLessThanOrEqual(.15);
  for(const t of b.trim!.triangles){const original=faces.get(t.faceId)!;expect(original).toBeDefined();const [a,c,d]=t.barycentric,ratio=Math.abs((c[1]-a[1])*(d[2]-a[2])-(c[2]-a[2])*(d[1]-a[1]));coverage.set(t.faceId,(coverage.get(t.faceId)??0)+ratio);
   const xyz=t.barycentric.map(weights=>{expect(weights.every(w=>Number.isFinite(w)&&w>=-1e-7&&w<=1+1e-7)).toBe(true);expect(weights.reduce((s,w)=>s+w,0)).toBeCloseTo(1,8);return [0,1,2].map(axis=>weights.reduce((s,w,i)=>{const v=positions.get(original.vertices[i])!;return s+w*[v.xMm,v.yMm,v.zMm][axis];},0));});
   world.push(...xyz);const u=xyz[1].map((v,i)=>v-xyz[0][i]),v=xyz[2].map((v,i)=>v-xyz[0][i]),area=Math.hypot(u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0])/2;colorAreas.set(piece.color,(colorAreas.get(piece.color)??0)+area);
  }
  panels.push({color:piece.color,triangles:b.trim!.triangles.length,minX:Math.min(...world.map(p=>p[0])),maxX:Math.max(...world.map(p=>p[0]))});
 }
 for(const face of source.faces)expect(coverage.get(face.id),face.id).toBeCloseTo(1,7);
 expect(bindingIssues({...p,pieces:run.pieces,bindings:run.bindings})).toEqual([]);
 return {panels,colorAreas:Object.fromEntries(colorAreas),report:run.designCutReport,optimization:run.optimization};
}

it.each([false,true])('coalescing preserves an inset material and saved user seam (seam=%s)',async seam=>{
 const p=project();p.pieces=[];p.defaultAllowanceMm=0;p.surface=parseObj('v -100 0 0\nv 0 0 0\nv 100 0 0\nv -100 100 0\nv 0 100 0\nv 100 100 0\nf 1 2 5\nf 1 5 4\nf 2 3 6\nf 2 6 5');
 if(seam){const [a,b]=[p.surface.vertices[1],p.surface.vertices[4]];p.surface.cutConstraints=[{a:a.id,b:b.id,locked:true}];p.surface.cutLines=[{id:randomUUID(),name:'Saved user seam',kind:'pen',enabled:true,closed:false,symmetric:false,tension:0,controlPoints:[{...a},{...b}],projection:frame,surfaceAnchored:true,edges:[{a:a.id,b:b.id}]}];}
 p.markings=[await surfaceMarking(worker,p,{...frame,nodes:[[-50,20],[50,20],[50,80],[-50,80]].map(([xMm,yMm])=>({xMm,yMm}))},'#e5bb32','Inset across seam')];const before=structuredClone(p),candidate=await cutPreview(worker,p.surface,p,{partitionStrategy:'design',method:'arap',automaticCuts:true,colorBoundaryCuts:true},assets),checked=inspect(p,candidate.run);
 expect(p).toEqual(before);expect(candidate.run.pieces).toHaveLength(seam?4:2);expect(checked.colorAreas['#e5bb32']).toBeCloseTo(6000,5);expect(checked.colorAreas['#eceae5']).toBeCloseTo(14000,5);
 if(seam){expect(checked.panels.every(p=>p.maxX<=1e-6||p.minX>=-1e-6)).toBe(true);expect(candidate.run.designCutReport!.userSeams).toBe(1);expect(candidate.run.cutEdges).toEqual([[p.surface.cutConstraints![0].a,p.surface.cutConstraints![0].b]]);}
 const ready={...p,pieces:candidate.run.pieces,bindings:candidate.run.bindings,markings:candidate.markings};expect((await analyze(worker,ready)).flatMap(g=>g.issues.filter(i=>i.severity==='error'))).toEqual([]);
 mkdirSync(output,{recursive:true});writeFileSync(resolve(output,`independent-coalescing-seam-${seam}.json`),JSON.stringify(checked,null,2));
},30000);

it('manufacturing repair leaves an unrelated flat material in one chart and preserves every original face',async()=>{
 const p=project();p.pieces=[];p.defaultAllowanceMm=10;p.surface=parseObj('v 0 0 0\nv 200 0 0\nv 200 200 0\nv 0 200 0\nv 300 0 0\nv 400 0 0\nv 400 100 0\nv 300 100 0\nf 1 2 3\nf 1 3 4\nf 5 6 7\nf 5 7 8');
 const source=rectangle(80,80);source.allowanceMm=0;source.nodes.forEach(n=>{n.xMm+=60;n.yMm+=60;});source.holes=[[[95,95],[95,105],[105,105],[105,95]].map(([xMm,yMm])=>({id:randomUUID(),xMm,yMm}))];p.patternLibrary=[{piece:source,referenceId:randomUUID(),view:'front',category:'inset'}];
 p.markings=[await projectMarking(worker,p,source.id,'front',0,0),await surfaceMarking(worker,p,{...frame,nodes:[[300,0],[400,0],[400,100],[300,100]].map(([xMm,yMm])=>({xMm,yMm}))},'#4444cc','Untouched flat material')];
 const before=structuredClone(p),candidate=await cutPreview(worker,p.surface,p,{partitionStrategy:'design',automaticCuts:false,colorBoundaryCuts:true},assets),checked=inspect(p,candidate.run);
 expect(p).toEqual(before);expect(candidate.run.designCutReport!.manufacturingSeams).toBeGreaterThan(0);expect(candidate.run.optimization!.repairPasses).toBeGreaterThan(0);expect(candidate.run.optimization!.repairPasses).toBeLessThan(6);
 const blue=checked.panels.filter(p=>p.color==='#4444cc');expect(blue).toHaveLength(1);expect(blue[0].triangles).toBe(2);expect(checked.colorAreas['#4444cc']).toBeCloseTo(10000,5);expect(checked.colorAreas[source.color]).toBeCloseTo(6300,5);expect(checked.colorAreas['#eceae5']).toBeCloseTo(33700,5);expect(candidate.run.pieces.every(p=>p.allowanceMm===10)).toBe(true);
 expect((await analyze(worker,{...p,pieces:candidate.run.pieces})).flatMap(g=>g.issues.filter(i=>i.severity==='error'))).toEqual([]);mkdirSync(output,{recursive:true});writeFileSync(resolve(output,'independent-coalescing-manufacturing-cache.json'),JSON.stringify(checked,null,2));
},30000);
