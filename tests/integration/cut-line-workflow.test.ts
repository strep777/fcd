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
// Default design cutting performs bounded sequential chart solves. The real
// 8534-face fixture took 220 s without contention; match its production budget.
it('whole curved canine cuts retain every marking and hole through archive and independent workflow restoration',async()=>{
 const p=project();p.pieces=[];p.surface=await assembleSpecies(generateSpecies(speciesDefaults('canine')));expect(p.surface.faces.length).toBeGreaterThan(8000);
 const source=rectangle(180,220);source.allowanceMm=0;source.color='#ef6588';source.nodes.forEach(n=>{n.xMm-=90;n.yMm+=900});source.holes=[[[ -30,960],[-30,1010],[30,1010],[30,960]].map(([xMm,yMm])=>({id:randomUUID(),xMm,yMm}))];
 p.patternLibrary=[{piece:source,referenceId:randomUUID(),view:'front',category:'body'}];p.markings=[await projectMarking(worker,p,source.id,'front',0,0)];const original=structuredClone(p.markings);expect(original[0].fragments.length).toBeGreaterThan(20);
 const candidate=await cutPreview(worker,p.surface,p,{method:'arap',automaticCuts:true,normalAngleDeg:60,maxFacesPerPatch:400,optimizeCuts:true,searchPasses:3,maxPieces:500},assets);
 expect(candidate.run.pieces.length).toBeLessThanOrEqual(500);expect(candidate.run.bindings.every(b=>!!b.trim)).toBe(true);expect(new Set(candidate.run.bindings.flatMap(b=>b.report.faceIds)).size).toBe(p.surface.faces.length);expect(candidate.markings.map(m=>m.fragments)).toEqual(original.map(m=>m.fragments));expect(candidate.markings[0].paths.length).toBeGreaterThan(0);expect(candidate.run.pieces.every(p=>p.color==='#eceae5')).toBe(true);
 const overlays=cutAssemblyMarkings(p.surface,candidate.run,candidate.markings);expect(overlays).toHaveLength(original[0].fragments.length);expect(overlays.every(o=>o.color===source.color)).toBe(true);expect(overlays.some(o=>o.rings.length>1)).toBe(true);expect(cutAssembly(p.surface,candidate.run)).toHaveLength(p.surface.faces.length);
 const repo=new Repository(':memory:'),fresh=new Repository(':memory:');try{repo.open(p,null);repo.commit({type:'unwrap.candidate',run:candidate.run,markings:candidate.markings},randomUUID(),'preview');repo.commit({type:'unwrap.accept'},randomUUID(),'accept');const ready=repo.snapshot()!;expect(ready.cuttingLibrary).toHaveLength(1);expect(bindingIssues(ready).filter(i=>i.severity==='error')).toEqual([]);expect(markingIssues(ready)).toEqual([]);const bytes=workflowBytes(ready);expect(new TextDecoder().decode(bytes)).not.toContain('sqlite-resource:');fresh.create('fresh');fresh.open(readWorkflow(bytes),null);expect(fresh.snapshot()).toEqual(ready);expect(workflowNodes(fresh.snapshot()!)).toEqual(workflowNodes(ready));expect(cutAssemblyMarkings(ready.cuttingLibrary![0].surface,ready.cuttingLibrary![0].run,ready.cuttingLibrary![0].markings)).toEqual(overlays);}finally{repo.close();fresh.close();}
},600000);
it('1500 mm legal whole pattern and long marking use the safest local precision without a size failure',async()=>{
 const p=project();p.pieces=[];p.surface=parseObj('v 0 0 0\nv 1500 0 0\nv 1500 400 0\nv 0 400 0\nf 1 2 3\nf 1 3 4');const source=rectangle(1400,200);source.allowanceMm=0;source.nodes.forEach(n=>{n.xMm+=50;n.yMm+=100});p.patternLibrary=[{piece:source,referenceId:randomUUID(),view:'front',category:'long source'}];p.markings=[await projectMarking(worker,p,source.id,'front',0,0)];const result=await cutPreview(worker,p.surface,p,{automaticCuts:false},assets);expect(result.run.pieces).toHaveLength(1);expect(result.markings[0].fragments).toEqual(p.markings[0].fragments);const area=result.markings[0].paths.flatMap(p=>p.rings).reduce((s,r)=>s+r.reduce((sum,a,i)=>{const b=r[(i+1)%r.length];return sum+a.xMm*b.yMm-b.xMm*a.yMm},0)/2,0);expect(area).toBeCloseTo(280000,3);
},120000);
