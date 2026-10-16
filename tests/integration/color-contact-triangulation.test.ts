import {it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {project,rectangle} from '../fixtures';
import {triangulatedManufacturingPartition,manufacturableColorPolygons,normalizeColorOutline,manufacturingColorOutline,simplifyColorBoundary} from '../../apps/desktop/main/color-cuts';
import {safeColorOutline} from '../../apps/desktop/main/color-outline';
import {analyze} from '../../apps/desktop/main/worker';
import type {XY} from '../../apps/desktop/main/markings';
const area=(r:XY[])=>r.reduce((sum,p,i)=>{const q=r[(i+1)%r.length],o=r[0];return sum+(p[0]-o[0])*(q[1]-o[1])-(p[1]-o[1])*(q[0]-o[0]);},0)/2;
it('triangulates and merges a stubborn real near-contact into valid finite material domains',async()=>{
 const polygon=JSON.parse(readFileSync('tests/fixtures/color-near-contact-76.json','utf8')) as {outer:XY[];holes:XY[][]},p=project(),base=rectangle(1,1),worker=resolve('target/release/fpcad-worker.exe');base.allowanceMm=10;base.join='round';
 const manufacture=async(rows:{outer:XY[];holes:XY[][]}[])=>{const node=([xMm,yMm]:XY)=>({id:randomUUID(),xMm,yMm});return (await analyze(worker,{...p,pieces:rows.map(r=>({...base,id:randomUUID(),nodes:r.outer.map(node),holes:r.holes.map(h=>h.map(node))}))})).map(g=>({errors:g.issues.filter(i=>i.severity==='error').map(i=>i.messageKey)}));};
 expect((await manufacture([polygon]))[0].errors).toContain('selfIntersection');const load=(await import(pathToFileURL(resolve('dist/assets/manifold.mjs')).href)).default,wasm=await load({locateFile:()=>resolve('dist/assets/manifold.wasm')});wasm.setup();
 const result=await triangulatedManufacturingPartition(polygon,r=>wasm.triangulate(r,1e-8,false),manufacture);expect(result.length).toBeGreaterThan(1);expect(result.length).toBeLessThan(5);expect(await manufacture(result.map(r=>safeColorOutline(r,{outer:simplifyColorBoundary(r.outer),holes:r.holes.map(h=>simplifyColorBoundary(h))})))).toEqual(result.map(()=>({errors:[]})));expect(result.reduce((sum,p)=>sum+area(p.outer)+p.holes.reduce((s,r)=>s+area(r),0),0)).toBeCloseTo(area(polygon.outer),8);
 const report={budgetSplits:0,allowanceSplits:0,topologySplits:0},rescued=await manufacturableColorPolygons([polygon.outer],async()=>[],r=>r,manufacture,report,r=>wasm.triangulate(r,1e-8,false));expect(rescued.reduce((sum,p)=>sum+area(p.outer)+p.holes.reduce((s,r)=>s+area(r),0),0)).toBeCloseTo(area(polygon.outer),8);expect(await manufacture(rescued)).toEqual(rescued.map(()=>({errors:[]})));
 base.join='miter';await expect(triangulatedManufacturingPartition(polygon,r=>wasm.triangulate(r,1e-8,false),manufacture)).rejects.toThrow('COLOR_CUT_BOUNDARY');
});

it('normalizes only sub-nanometre contour retraces while retaining holes and exact input domains',async()=>{
 const polygon=JSON.parse(readFileSync('tests/fixtures/color-contact-adjacency-76.json','utf8')) as {outer:XY[];holes:XY[][]},before=JSON.stringify(polygon),normalized=normalizeColorOutline(polygon),epsilon=1e-6;
 expect(normalized.outer.length).toBeLessThan(polygon.outer.length);expect(JSON.stringify(polygon)).toBe(before);expect(normalized.holes.length).toBe(polygon.holes.length);
 for(const point of normalized.outer)expect(Math.min(...polygon.outer.map(p=>Math.hypot(p[0]-point[0],p[1]-point[1])))).toBeLessThanOrEqual(epsilon);
 const perimeter=polygon.outer.reduce((sum,p,i)=>sum+Math.hypot(p[0]-polygon.outer[(i+1)%polygon.outer.length][0],p[1]-polygon.outer[(i+1)%polygon.outer.length][1]),0);expect(Math.abs(area(normalized.outer)-area(polygon.outer))).toBeLessThanOrEqual(perimeter*epsilon);
 const p=project(),base=rectangle(1,1);base.allowanceMm=10;base.join='round';const node=([xMm,yMm]:XY)=>({id:randomUUID(),xMm,yMm}),ready=manufacturingColorOutline(polygon),geometry=await analyze(resolve('target/release/fpcad-worker.exe'),{...p,pieces:[{...base,nodes:ready.outer.map(node),holes:ready.holes.map(r=>r.map(node))}]});expect(geometry.flatMap(g=>g.issues.filter(i=>i.severity==='error'))).toEqual([]);
 const hole:XY[]=[[1,1],[1,1.00015],[1.00015,1.00015],[1.00015,1]],withHole={outer:[[0,0],[10,0],[10,10],[0,10]] as XY[],holes:[hole]};expect(normalizeColorOutline(withHole).holes).toEqual([hole]);const island:XY[]=[[0,0],[1,0],[1,.0000008],[0,.0000008]];expect(normalizeColorOutline({outer:island,holes:[]}).outer).toEqual(island);
});

it('native manufacturing retains reliable tiny triangles without an absolute physical-area floor',async()=>{
 const radius=Math.sqrt(1.2e-6/(2.5*Math.sin(2*Math.PI/5))),outer=Array.from({length:5},(_,i)=>[radius*Math.cos(i*2*Math.PI/5),radius*Math.sin(i*2*Math.PI/5)] as XY),polygon={outer,holes:[] as XY[][]},indices=[[0,1,2],[0,2,3],[0,3,4]],p=project(),base=rectangle(1,1);base.allowanceMm=0;
 const manufacture=async(rows:{outer:XY[];holes:XY[][]}[])=>{const node=([xMm,yMm]:XY)=>({id:randomUUID(),xMm,yMm});return (await analyze(resolve('target/release/fpcad-worker.exe'),{...p,pieces:rows.map(r=>({...base,id:randomUUID(),nodes:r.outer.map(node),holes:r.holes.map(h=>h.map(node))}))})).map(g=>({errors:g.issues.filter(i=>i.severity==='error').map(i=>i.messageKey)}));};
 const cells=indices.map(ids=>({outer:ids.map(i=>outer[i]),holes:[] as XY[][]})),before=JSON.stringify(polygon);
 expect(cells.every(r=>area(r.outer)>0&&area(r.outer)<1e-6)).toBe(true);
 // Coordinate-error-aware validity must accept these reliable positive cells,
 // including reversed winding and normal layout offsets. No material is dropped.
 for(const offset of [0,1000])for(const reversed of [false,true]){
  const shifted=cells.map(r=>({outer:r.outer.map(([x,y])=>[x+offset,y+offset] as XY),holes:[]}));if(reversed)shifted.forEach(r=>r.outer.reverse());
  expect(await manufacture(shifted)).toEqual(cells.map(()=>({errors:[]})));
 }
 const result=await triangulatedManufacturingPartition(polygon,()=>indices,manufacture);
 expect(result).toHaveLength(1);expect(area(result[0].outer)).toBeCloseTo(area(outer),12);expect(await manufacture(result)).toEqual([{errors:[]}]);expect(JSON.stringify(polygon)).toBe(before);
});

it('merges an entire adjacent neighbourhood when the caller explicitly rejects every intermediate pair',async()=>{
 const minimumArea=1e-6,radius=Math.sqrt(1.2e-6/(2.5*Math.sin(2*Math.PI/5))),outer=Array.from({length:5},(_,i)=>[radius*Math.cos(i*2*Math.PI/5),radius*Math.sin(i*2*Math.PI/5)] as XY),polygon={outer,holes:[] as XY[][]},indices=[[0,1,2],[0,2,3],[0,3,4]],before=JSON.stringify(polygon),checked:number[]=[];
 // This is an explicit caller policy for testing the neighbourhood fallback,
 // not a native geometric validity rule. Pairwise merging alone cannot pass.
 const manufacture=async(rows:{outer:XY[];holes:XY[][]}[])=>rows.map(r=>{checked.push(r.outer.length);return {errors:area(r.outer)+r.holes.reduce((s,h)=>s+area(h),0)<minimumArea?['callerMinimumMaterialArea']:[]};});
 expect(await manufacture([polygon])).toEqual([{errors:[]}]);expect((await manufacture(indices.map(ids=>({outer:ids.map(i=>outer[i]),holes:[]})))).every(c=>c.errors.length===1)).toBe(true);
 expect(area([outer[0],outer[1],outer[2],outer[3]])).toBeLessThan(minimumArea);expect(area([outer[0],outer[2],outer[3],outer[4]])).toBeLessThan(minimumArea);
 const result=await triangulatedManufacturingPartition(polygon,()=>indices,manufacture);
 expect(checked).toContain(4);expect(result).toHaveLength(1);expect(result[0].outer).toHaveLength(5);expect(area(result[0].outer)).toBeCloseTo(area(outer),12);expect(await manufacture(result)).toEqual([{errors:[]}]);expect(JSON.stringify(polygon)).toBe(before);
});

it('uses the regular triangulation floor for a captured floating-point zero-area cell',async()=>{
 const polygon=JSON.parse(readFileSync('tests/fixtures/color-contact-degenerate-76.json','utf8')) as {outer:XY[];holes:XY[][]},before=JSON.stringify(polygon),p=project(),base=rectangle(1,1);base.allowanceMm=10;base.join='round';
 const manufacture=async(rows:{outer:XY[];holes:XY[][]}[])=>{const node=([xMm,yMm]:XY)=>({id:randomUUID(),xMm,yMm});return (await analyze(resolve('target/release/fpcad-worker.exe'),{...p,pieces:rows.map(r=>({...base,id:randomUUID(),nodes:r.outer.map(node),holes:r.holes.map(h=>h.map(node))}))})).map(g=>({errors:g.issues.filter(i=>i.severity==='error').map(i=>i.messageKey)}));};
 const load=(await import(pathToFileURL(resolve('dist/assets/manifold.mjs')).href)).default,wasm=await load({locateFile:()=>resolve('dist/assets/manifold.wasm')});wasm.setup();const points=[polygon.outer,...polygon.holes].flat(),cells:XY[][]=wasm.triangulate([polygon.outer,...polygon.holes],1e-8,false).map((ids:number[])=>ids.map(i=>points[i]));expect(cells.some(r=>Math.abs(area(r))>0&&Math.abs(area(r))<1e-8)).toBe(true);
 const result=await triangulatedManufacturingPartition(polygon,r=>wasm.triangulate(r,1e-8,false),manufacture);expect(result).toHaveLength(2);expect(await manufacture(result.map(manufacturingColorOutline))).toEqual([{errors:[]},{errors:[]}]);expect(Math.abs(result.reduce((s,r)=>s+area(r.outer)+r.holes.reduce((a,h)=>a+area(h),0),0)-area(polygon.outer))).toBeLessThan(1e-6);expect(JSON.stringify(polygon)).toBe(before);
});


