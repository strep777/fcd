import {it,expect} from 'vitest';
import {randomUUID} from 'node:crypto';
import {resolve} from 'node:path';
import type {Surface} from '../../packages/schema/index';
import {project} from '../fixtures';
import {planarGrid,meshArea} from '../fixtures/planar-seams';
import {cutPreview} from '../../apps/desktop/main/cut-preview';
import {bindingIssues} from '../../apps/desktop/main/surface';
import {analyze} from '../../apps/desktop/main/worker';
import {edgeKey} from '../../packages/surface/refine';

const worker=resolve('target/release/fpcad-worker.exe'),assets=resolve('dist/assets');
function nativeIds(source:Surface){
 const ids=new Map(source.vertices.map(v=>[v.id,randomUUID()]));
 return {...source,vertices:source.vertices.map(v=>({...v,id:ids.get(v.id)!})),faces:source.faces.map(f=>({...f,id:randomUUID(),vertices:f.vertices.map(id=>ids.get(id)!) as [string,string,string]})),cutConstraints:source.cutConstraints?.map(e=>({...e,a:ids.get(e.a)!,b:ids.get(e.b)!}))};
}
async function verifyPhysicalPanels(source:Surface,panelCount:number,manufacturingSeams=0){
 const p=project();p.pieces=[];p.surface=nativeIds(source);const before=structuredClone(p),candidate=await cutPreview(worker,p.surface,p,{method:'arap',automaticCuts:true,colorBoundaryCuts:true},assets);
 expect(p).toEqual(before);expect(candidate.run.pieces,JSON.stringify(candidate.run.designCutReport)).toHaveLength(panelCount);expect(candidate.run.designCutReport!.manufacturingSeams).toBe(manufacturingSeams);
 const ready={...p,pieces:candidate.run.pieces,bindings:candidate.run.bindings,markings:candidate.markings};
 expect(bindingIssues(ready).filter(i=>i.severity==='error')).toEqual([]);const geometry=await analyze(worker,ready);expect(geometry.flatMap(g=>g.issues.filter(i=>i.severity==='error'))).toEqual([]);
 expect(geometry.reduce((s,g)=>s+g.areaMm2,0)).toBeCloseTo(meshArea(p.surface),5);
 const owners=new Map(candidate.run.bindings.flatMap(b=>b.report.faceIds.map(id=>[id,b.pieceId] as const)));
 expect(owners.size).toBe(p.surface.faces.length);for(const e of p.surface.cutConstraints??[]){const incident=p.surface.faces.filter(f=>f.vertices.some((a,i)=>edgeKey(a,f.vertices[(i+1)%3])===edgeKey(e.a,e.b)));if(incident.length===2)expect(owners.get(incident[0].id)).not.toBe(owners.get(incident[1].id));}
 const trims=candidate.run.bindings.map(b=>b.trim!);expect(trims.every(t=>t.triangles.length>0)).toBe(true);expect(candidate.run.bindings.every(b=>b.report.distortionMax<1e-6)).toBe(true);
 let trimArea=0;for(const binding of candidate.run.bindings){const trim=binding.trim!,points=new Map(trim.vertices.map(v=>[v.id,v])),piece=candidate.run.pieces.find(p=>p.id===binding.pieceId)!;expect(trim.holes).toHaveLength(piece.holes?.length??0);for(let i=0;i<trim.holes.length;i++){expect(trim.holes[i]).toHaveLength(piece.holes![i].length);trim.holes[i].forEach((id,j)=>{const uv=points.get(id)!,node=piece.holes![i][j];expect(Math.hypot(uv.xMm-node.xMm,uv.yMm-node.yMm)).toBeLessThan(1e-8);});}for(const t of trim.triangles){const [a,b,c]=t.vertices.map(id=>points.get(id)!);trimArea+=Math.abs((b.xMm-a.xMm)*(c.yMm-a.yMm)-(b.yMm-a.yMm)*(c.xMm-a.xMm))/2;}}
 expect(trimArea).toBeCloseTo(meshArea(p.surface),5);
 for(const piece of candidate.run.pieces)for(const ring of [piece.nodes,...piece.holes??[]])for(let i=0;i<ring.length;i++)for(let j=i+1;j<ring.length;j++)expect(Math.hypot(ring[i].xMm-ring[j].xMm,ring[i].yMm-ring[j].yMm)).toBeGreaterThan(1e-8);
 expect(candidate.run.cutEdges?.map(e=>edgeKey(...e)).sort()).toEqual(p.surface.cutConstraints!.map(e=>edgeKey(e.a,e.b)).sort());
 return candidate;
}
it.each([
 ['boundary slit',[['v0_2','v1_2']]],
 ['interior short line',[['v1_2','v2_2']]],
] as const)('a %s yields two simple manufacturable sheets with all original area and user cuts',async(name,edges)=>{
 const source=planarGrid();source.cutConstraints=edges.map(([a,b])=>({a,b,locked:true}));const result=await verifyPhysicalPanels(source,2);expect(result.run.designCutReport!.topologySeams).toBeGreaterThan(0);
});
it('completes a slit near a planar hole without sending manufacturing repair into needle panels',async()=>{
 const source=planarGrid([0,200,300,400,500,600,800],true);source.cutConstraints=[{a:'v0_3',b:'v1_3',locked:true}];await verifyPhysicalPanels(source,2);
});
it.each([
 ['hole-to-interior slit',[['v2_3','v1_3']]],
 ['existing hole-to-outer bridge',[['v2_3','v1_3'],['v1_3','v0_3']]],
] as const)('makes a %s into manufacturing-safe planar panels while retaining area',async(name,edges)=>{
 // Two seams touching the same hole vertex still need one physical repair:
 // the retained hole boundary must become a simple manufacturing contour.
 const source=planarGrid([0,200,300,400,500,600,800],true);source.cutConstraints=edges.map(([a,b])=>({a,b,locked:true}));await verifyPhysicalPanels(source,3,1);
});
