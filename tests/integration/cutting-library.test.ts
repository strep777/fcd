import {it,expect} from 'vitest';
import {randomUUID} from 'node:crypto';
import {resolve} from 'node:path';
import {project,rectangle} from '../fixtures';
import {Repository} from '../../apps/desktop/main/repository';
import {parseObj,bindingIssues} from '../../apps/desktop/main/surface';
import {projectMarking,markingIssues} from '../../apps/desktop/main/markings';
import {cutPreview} from '../../apps/desktop/main/cut-preview';
import {cutAssembly} from '../../packages/surface/cut-assembly';
import {insertTrimBoundary} from '../../apps/desktop/main/trim-boundary';
import {pack,unpack} from '../../apps/desktop/main/archive';
import {cutBundle,readCutBundle,workflowBytes,readWorkflow} from '../../apps/desktop/main/workflow-exchange';
import {analyze} from '../../apps/desktop/main/worker';
import type {Binding} from '../../packages/schema/index';
const worker=resolve('target/release/fpcad-worker.exe');
const obj='v 0 0 0\nv 200 0 0\nv 200 100 0\nv 0 100 0\nf 1 2 3\nf 1 3 4';
function squareTrim():NonNullable<Binding['trim']>{const ids=Array.from({length:4},()=>randomUUID()),faceId=randomUUID();return {vertices:[[0,0],[100,0],[100,100],[0,100]].map(([xMm,yMm],i)=>({id:ids[i],xMm,yMm})),triangles:[{faceId,vertices:[ids[0],ids[1],ids[2]],barycentric:[[1,0,0],[0,1,0],[0,0,1]]},{faceId:randomUUID(),vertices:[ids[0],ids[2],ids[3]],barycentric:[[1,0,0],[0,1,0],[0,0,1]]}],boundary:ids,holes:[]};}
function area(trim:NonNullable<Binding['trim']>){const points=new Map(trim.vertices.map(v=>[v.id,v]));return trim.triangles.reduce((sum,t)=>{const [a,b,c]=t.vertices.map(id=>points.get(id)!);return sum+((b.xMm-a.xMm)*(c.yMm-a.yMm)-(b.yMm-a.yMm)*(c.xMm-a.xMm))/2;},0);}
it('omitted collinear boundary samples split all shared trim edges and preserve area/barycentric maps',()=>{
 const trim=squareTrim(),id=insertTrimBoundary(trim,[50,50]);expect(trim.triangles).toHaveLength(4);expect(trim.triangles.every(t=>t.vertices.includes(id))).toBe(true);expect(area(trim)).toBeCloseTo(10000,9);
 for(const t of trim.triangles){const i=t.vertices.indexOf(id);expect(t.barycentric[i].reduce((s,n)=>s+n,0)).toBeCloseTo(1,12);}
 expect(insertTrimBoundary(trim,[50,50])).toBe(id);const edge=insertTrimBoundary(trim,[50,0]);expect(trim.triangles.some(t=>t.vertices.includes(edge))).toBe(true);expect(area(trim)).toBeCloseTo(10000,9);expect(()=>insertTrimBoundary(trim,[200,200])).toThrow('COLOR_CUT_BOUNDARY');
});
it('explicit accepted cuts create immutable, persisted versions and restore physical geometry without overwriting newer flower sources',async()=>{
 const p=project();p.pieces=[];p.surface=parseObj(obj);const source=rectangle(120,60);source.allowanceMm=0;source.color='#ff0000';source.nodes.forEach(n=>{n.xMm+=40;n.yMm+=20;});p.patternLibrary=[{piece:source,referenceId:randomUUID(),view:'front',category:'body'}];p.markings=[await projectMarking(worker,p,source.id,'front',0,0)];
 const repo=new Repository(':memory:');repo.open(p,null);const {run,markings}=await cutPreview(worker,p.surface,p,{automaticCuts:true,colorBoundaryCuts:true,normalAngleDeg:180},resolve('dist/assets'));repo.commit({type:'unwrap.candidate',run,markings},randomUUID(),'candidate');expect(repo.snapshot()!.cuttingLibrary).toBeUndefined();expect(repo.snapshot()!.pieces).toEqual([]);
 repo.commit({type:'unwrap.accept'},randomUUID(),'accept');const saved=repo.snapshot()!,entry=structuredClone(saved.cuttingLibrary![0]);expect(saved.activeCutId).toBe(entry.id);expect(entry.run.accepted).toBe(true);expect(entry.run.pieces.length).toBeGreaterThan(1);
 const raw=JSON.parse(String(repo.db.prepare('SELECT state FROM sessions WHERE id=?').get(repo.sessionId!)!.state));expect(raw.cuttingLibrary[0].surface).toBe(raw.surface);expect(raw.surface).toMatch(/^sqlite-resource:/);
 const newer=structuredClone(source);newer.nodes[0].xMm+=2;repo.commit({type:'library.region.put',region:{...p.patternLibrary[0],piece:newer}},randomUUID(),'source-change');repo.commit({type:'surface.set',surface:parseObj(obj.replaceAll('200','300'))},randomUUID(),'new-model');
 repo.commit({type:'cutting.activate',entryId:entry.id},randomUUID(),'load');const restored=repo.snapshot()!;expect(restored.surface).toEqual(entry.surface);expect(restored.pieces).toEqual(entry.run.pieces);expect(restored.patternLibrary![0].piece).toEqual(newer);expect(restored.cuttingLibrary![0]).toEqual(entry);expect(restored.markings![0].source).toBe('cut-library');expect(restored.markings![0].sourcePieceId).toBeUndefined();expect(bindingIssues(restored)).toEqual([]);expect(markingIssues(restored)).toEqual([]);
 const assembly=cutAssembly(entry.surface,entry.run);expect(assembly.length).toBeGreaterThan(2);expect(new Set(assembly.map(t=>t.color))).toEqual(new Set(['#ff0000','#eceae5']));let physicalArea=0;for(const t of assembly){const [a,b,c]=t.points;expect(t.points.every(v=>Math.abs(v[2])<1e-8)).toBe(true);physicalArea+=Math.abs((b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]))/2;}expect(Math.abs(physicalArea-20000)).toBeLessThan(.02);
 expect(unpack(pack(restored).bytes)).toEqual(restored);expect(readWorkflow(workflowBytes(restored))).toEqual(restored);const geometry=await analyze(worker,restored);expect(readCutBundle(cutBundle(restored,geometry))).toEqual(restored);
 expect(()=>repo.commit({type:'cutting.delete',entryId:entry.id},randomUUID(),'delete-active')).toThrow('CUT_LIBRARY_ACTIVE');repo.historyMove(false);expect(repo.snapshot()!.surface!.id).not.toBe(entry.surface.id);repo.historyMove(true);expect(repo.snapshot()!.surface).toEqual(entry.surface);
 const next={...restored,pieces:restored.pieces.filter(piece=>!restored.bindings!.some(b=>b.pieceId===piece.id))},second=await cutPreview(worker,restored.surface!,next,{automaticCuts:true,colorBoundaryCuts:true,normalAngleDeg:180},resolve('dist/assets'));repo.commit({type:'unwrap.candidate',run:second.run,markings:second.markings},randomUUID(),'recut');repo.commit({type:'unwrap.accept'},randomUUID(),'second');expect(repo.snapshot()!.cuttingLibrary).toHaveLength(2);expect(repo.snapshot()!.cuttingLibrary![0]).toEqual(entry);repo.commit({type:'cutting.delete',entryId:entry.id},randomUUID(),'delete-older');expect(repo.snapshot()!.cuttingLibrary).toHaveLength(1);repo.historyMove(false);expect(repo.snapshot()!.cuttingLibrary).toHaveLength(2);repo.close();
});
