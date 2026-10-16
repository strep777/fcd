import {it,expect} from 'vitest';
import {project,rectangle} from '../fixtures';
import {analyze} from '../../apps/desktop/main/worker';
import {nest,validateNesting,placedPoint,normalizeManualNesting} from '../../apps/desktop/main/nesting';
import {svgExport,dxfExport} from '../../apps/desktop/main/export';
import {pack,unpack} from '../../apps/desktop/main/archive';
import {resolve} from 'node:path';
const worker=resolve('target/release/fpcad-worker.exe');
it('nesting counts every mirrored instance, separates materials, preserves grain and is deterministic',async()=>{
 const p=project();p.pieces[0].cutQty=4;p.pieces[0].mirror=true;p.pieces.push({...rectangle(30,40),material:'白色毛皮',cutQty:2,furRad:0});const g=await analyze(worker,p),options={widthMm:300,lengthLimitMm:5000,gapMm:5,marginMm:10,alignGrain:true};
 const n=nest(p,g,options);expect(n).toEqual(nest(p,g,options));expect(n.unplaced).toEqual([]);expect(n.sheets).toHaveLength(2);expect(n.sheets.flatMap(s=>s.placements)).toHaveLength(6);expect(n.sheets.flatMap(s=>s.placements).filter(p=>p.mirror)).toHaveLength(2);expect(()=>validateNesting(p,g,n)).not.toThrow();
 p.nesting=n;expect(unpack(pack(p).bytes)).toEqual(p);expect(svgExport(p,g,[],true)).toContain('MIRROR');expect(dxfExport(p,g,[],true)).toContain('LWPOLYLINE');
});
it('nesting fails closed for partial, stale, overlapping, missing, duplicate, or wrong-direction placements',async()=>{
 const p=project();p.pieces[0].cutQty=2;const g=await analyze(worker,p),opts={widthMm:300,lengthLimitMm:2000,gapMm:5,marginMm:10,alignGrain:true};
 const partial=nest(p,g,{...opts,widthMm:50});expect(partial.unplaced).toHaveLength(2);expect(()=>validateNesting(p,g,partial)).toThrow('UNPLACED_PIECES');
 const n=nest(p,g,opts);const collision=structuredClone(n);collision.sheets[0].placements[1].xMm=collision.sheets[0].placements[0].xMm;collision.sheets[0].placements[1].yMm=collision.sheets[0].placements[0].yMm;expect(()=>validateNesting(p,g,collision)).toThrow('NESTING_COLLISION');
 const missing=structuredClone(n);missing.sheets[0].placements.pop();expect(()=>validateNesting(p,g,missing)).toThrow('UNPLACED_PIECES');
 const duplicate=structuredClone(n);duplicate.sheets[0].placements[1].instance=1;expect(()=>validateNesting(p,g,duplicate)).toThrow('INVALID_NESTING');
 const wrong=structuredClone(n);wrong.sheets[0].placements[0].angleRad=Math.PI;expect(()=>validateNesting(p,g,wrong)).toThrow('GRAIN_VIOLATION');
 p.nesting=n;p.pieces[0].cutQty=3;expect(()=>svgExport(p,g,[],true)).toThrow('STALE_NESTING');
});

it('manual placements recompute rotation bounds, prevent overlap, and preserve locks during recompute',async()=>{
 const p=project();p.pieces[0].cutQty=2;const g=await analyze(worker,p),opts={widthMm:500,lengthLimitMm:2000,gapMm:5,marginMm:10,alignGrain:false};
 const n=nest(p,g,opts),a=n.sheets[0].placements[0];a.xMm=270;a.yMm=100;a.angleRad=Math.PI/2;a.locked=true;a.widthMm=1;a.heightMm=1;
 const edited=normalizeManualNesting(p,g,n),locked=edited.sheets[0].placements[0];expect(locked.widthMm).toBeCloseTo(220);expect(locked.heightMm).toBeCloseTo(120);
 p.nesting=edited;const next=nest(p,g,opts);expect(next.sheets[0].placements[0]).toEqual(locked);expect(next.sheets[0].placements[1].yMm).toBeGreaterThanOrEqual(locked.yMm+locked.heightMm+5);expect(()=>validateNesting(p,g,next)).not.toThrow();
 const overlap=structuredClone(edited);Object.assign(overlap.sheets[0].placements[1],{xMm:270,yMm:100});expect(()=>normalizeManualNesting(p,g,overlap)).toThrow('NESTING_COLLISION');
 expect(()=>nest(p,g,{...opts,widthMm:300})).toThrow('NESTING_BOUNDS');expect(()=>nest(p,g,{...opts,alignGrain:true})).toThrow('GRAIN_VIOLATION');
 p.pieces[0].name='Updated';expect(()=>nest(p,g,opts)).toThrow('STALE_NESTING');expect(nest(p,g,{...opts,preserveLocks:false}).sheets[0].placements.every(v=>!v.locked)).toBe(true);
});
it('partial locked layouts can be recomputed after increasing the length budget',async()=>{
 const p=project();p.pieces[0].cutQty=3;const g=await analyze(worker,p),opts={widthMm:200,lengthLimitMm:2000,gapMm:5,marginMm:10,alignGrain:true};
 p.nesting=nest(p,g,opts);p.nesting.sheets[0].placements[0].locked=true;
 p.nesting=nest(p,g,{...opts,lengthLimitMm:300});expect(p.nesting.unplaced.length).toBeGreaterThan(0);
 const recovered=nest(p,g,opts);expect(recovered.unplaced).toEqual([]);expect(recovered.sheets[0].placements[0].locked).toBe(true);
});


it('contour nesting uses concave pockets and never worsens the rectangle baseline',async()=>{
 const p=project(),a=rectangle(100,100),b=rectangle(60,60);a.allowanceMm=0;b.allowanceMm=0;a.nodes=[[0,0],[100,0],[100,30],[30,30],[30,100],[0,100]].map(([xMm,yMm],i)=>({id:crypto.randomUUID(),xMm,yMm}));p.pieces=[a,b];
 const g=await analyze(worker,p),opts={widthMm:120,lengthLimitMm:1000,gapMm:5,marginMm:10,alignGrain:false,rotationsRad:[0],candidateBudget:2000};
 const baseline=nest(p,g,opts),optimized=nest(p,g,{...opts,mode:'contour'});expect(optimized.algorithm).toBe('contour-bottom-left-1');expect(optimized.unplaced).toEqual([]);expect(optimized.sheets[0].lengthMm).toBeLessThan(baseline.sheets[0].lengthMm);expect(()=>validateNesting(p,g,optimized)).not.toThrow();expect(optimized).toEqual(nest(p,g,{...opts,mode:'contour'}));
 const bad=structuredClone(optimized);bad.sheets[0].placements[1].xMm=20;bad.sheets[0].placements[1].yMm=20;expect(()=>normalizeManualNesting(p,g,bad)).toThrow('NESTING_COLLISION');
});
it('locked contours may keep overlapping bounding rectangles while retaining exact outline clearance',async()=>{
 const p=project(),a=rectangle(100,100),b=rectangle(60,60);a.allowanceMm=0;b.allowanceMm=0;a.nodes=[[0,0],[100,0],[100,30],[30,30],[30,100],[0,100]].map(([xMm,yMm])=>({id:crypto.randomUUID(),xMm,yMm}));p.pieces=[a,b];const g=await analyze(worker,p),options={widthMm:120,lengthLimitMm:1000,gapMm:5,marginMm:10,alignGrain:false,rotationsRad:[0],mode:'contour' as const};p.nesting=nest(p,g,options);p.nesting.sheets[0].placements.forEach(p=>p.locked=true);const before=structuredClone(p.nesting.sheets[0].placements),next=nest(p,g,options);expect(next.sheets[0].placements).toEqual(before);expect(()=>validateNesting(p,g,next)).not.toThrow();
});
