import {it,expect} from 'vitest';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {randomUUID} from 'node:crypto';
import {project,rectangle} from './fixtures';
import {analyze} from '../apps/desktop/main/worker';
import {designManufacturingOutline} from '../apps/desktop/main/design-outline';
type XY=[number,number];
const signed=(r:XY[])=>r.reduce((s,a,i)=>{const b=r[(i+1)%r.length],o=r[0];return s+(a[0]-o[0])*(b[1]-o[1])-(a[1]-o[1])*(b[0]-o[0]);},0)/2;
it('normalizes a captured numerical retrace while retaining the exact input and area budget',async()=>{
 const contour=JSON.parse(await readFile(resolve('tests/fixtures/design-manufacturing-retrace.json'),'utf8')) as {outer:XY[];holes:XY[][]},before=structuredClone(contour),worker=resolve('target/release/fpcad-worker.exe'),piece={...rectangle(),nodes:contour.outer.map(([xMm,yMm])=>({id:randomUUID(),xMm,yMm}))},p=project();
 expect((await analyze(worker,{...p,pieces:[piece]}))[0].issues.some(i=>i.messageKey==='selfIntersection')).toBe(true);
 const outline=designManufacturingOutline(contour),valid={...piece,nodes:outline.outer.map(([xMm,yMm])=>({id:randomUUID(),xMm,yMm}))};
 expect(contour).toEqual(before);expect(outline.outer.length).toBeLessThan(contour.outer.length);expect(outline.holes).toHaveLength(contour.holes.length);expect((await analyze(worker,{...p,pieces:[valid]}))[0].issues.filter(i=>i.severity==='error')).toEqual([]);
 const perimeter=contour.outer.reduce((sum,a,i)=>{const b=contour.outer[(i+1)%contour.outer.length];return sum+Math.hypot(a[0]-b[0],a[1]-b[1]);},0);expect(Math.abs(signed(outline.outer)-signed(contour.outer))).toBeLessThanOrEqual(perimeter*1e-6);
});
it('retains genuine small holes and a thin material island',()=>{
 const contour={outer:[[0,0],[10,0],[10,10],[0,10]] as XY[],holes:[[[4,4],[4,4.035],[4.035,4.035],[4.035,4]] as XY[]]},result=designManufacturingOutline(contour);expect(result).toEqual(contour);
 const island={outer:[[1,1],[8,1],[8,1.000035],[1,1.000035]] as XY[],holes:[]};expect(designManufacturingOutline(island)).toEqual(island);
});
