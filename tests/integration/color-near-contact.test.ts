import {it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {resolve} from 'node:path';
import {project,rectangle} from '../fixtures';
import {manufacturableColorPolygons,simplifyColorBoundary} from '../../apps/desktop/main/color-cuts';
import {safeColorOutline} from '../../apps/desktop/main/color-outline';
import {clip,type XY} from '../../apps/desktop/main/markings';
import {analyze} from '../../apps/desktop/main/worker';
const worker=resolve('target/release/fpcad-worker.exe'),fixtures=JSON.parse(readFileSync('tests/fixtures/color-near-contact.json','utf8')) as XY[][];
const area=(r:XY[])=>r.reduce((sum,p,i)=>{const q=r[(i+1)%r.length],o=r[0];return sum+(p[0]-o[0])*(q[1]-o[1])-(p[1]-o[1])*(q[0]-o[0]);},0)/2;
it.each(fixtures.map(ring=>({ring})))('opens captured near contacts with bounded seams and no material loss',async({ring})=>{
 const p=project(),base=rectangle(1,1);base.allowanceMm=0;
 const manufacturing=async(rows:{outer:XY[];holes:XY[][]}[])=>{const node=([xMm,yMm]:XY)=>({id:randomUUID(),xMm,yMm}),pieces=rows.map(r=>({...base,id:randomUUID(),nodes:r.outer.map(node),holes:r.holes.map(h=>h.map(node))}));return (await analyze(worker,{...p,pieces})).map(g=>({errors:g.issues.filter(i=>i.severity==='error').map(i=>i.messageKey)}));};
 expect((await manufacturing([{outer:ring,holes:[]}]))[0].errors).toContain('selfIntersection');
 const report={budgetSplits:0,allowanceSplits:0,topologySplits:0},result=await manufacturableColorPolygons([ring],async(subjects,clips)=>(await clip(worker,[{subjects,clips}],9))[0],r=>r,manufacturing,report);
 expect(report.topologySplits).toBeGreaterThan(0);expect(report.topologySplits).toBeLessThan(12);expect(await manufacturing(result.map(p=>safeColorOutline(p,{outer:simplifyColorBoundary(p.outer),holes:p.holes.map(h=>simplifyColorBoundary(h))})))).toEqual(result.map(()=>({errors:[]})));
 expect(result.reduce((sum,p)=>sum+area(p.outer)+p.holes.reduce((s,h)=>s+area(h),0),0)).toBeCloseTo(area(ring),5);expect(result.every(p=>p.outer.length<=2000)).toBe(true);
},30000);

it('preserves a hole whose first point touches the outer boundary and rejects orphan holes',async()=>{
 const outer:XY[]=[[0,0],[10,0],[10,10],[0,10]],hole:XY[]=[[10,10],[9,8],[8,9]],report={budgetSplits:0,allowanceSplits:0,topologySplits:0},cut=async()=>{throw Error('Unexpected partition');},manufacturing=async(rows:unknown[])=>rows.map(()=>({errors:[]}));
 const result=await manufacturableColorPolygons([outer,hole],cut,r=>r,manufacturing,report);expect(result).toHaveLength(1);expect(result[0].holes).toHaveLength(1);expect(area(result[0].outer)+area(result[0].holes[0])).toBeCloseTo(98.5,9);
 await expect(manufacturableColorPolygons([hole],cut,r=>r,manufacturing,report)).rejects.toThrow('COLOR_CUT_BOUNDARY');
});
