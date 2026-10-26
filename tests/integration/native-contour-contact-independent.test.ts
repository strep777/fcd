import {expect,it} from 'vitest';
import {readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {resolve} from 'node:path';
import {project,rectangle} from '../fixtures';
import {analyze} from '../../apps/desktop/main/worker';

const fixture=JSON.parse(readFileSync('tests/fixtures/arm-short-corner-native23.json','utf8').replace(/^\uFEFF/,'')) as {cases:{traceIndex:number;boundary:[number,number][]}[]};
const worker=resolve(process.env.FPCAD_CONTACT_WORKER??'target/release/fpcad-worker.exe');
const area=(ring:[number,number][])=>{const o=ring[0];return Math.abs(ring.reduce((s,a,i)=>{const b=ring[(i+1)%ring.length];return s+(a[0]-o[0])*(b[1]-o[1])-(b[0]-o[0])*(a[1]-o[1]);},0))/2;};
it.each(fixture.cases.flatMap(row=>[0,10].map(allowance=>({...row,allowance}))))('actual 23-point native contour $traceIndex retains its short corner with $allowance mm allowance',async row=>{
 const input=rectangle(1,1);input.name='Original native short corner';input.allowanceMm=row.allowance;input.join='round';input.nodes=row.boundary.map(([xMm,yMm])=>({id:randomUUID(),xMm,yMm}));
 const p={...project(),pieces:[input]},before=structuredClone(p);expect(input.nodes).toHaveLength(23);const closing=Math.hypot(input.nodes[22].xMm-input.nodes[0].xMm,input.nodes[22].yMm-input.nodes[0].yMm);expect(closing).toBeGreaterThanOrEqual(1e-6);expect(closing).toBeLessThan(2e-6);
 const [geometry]=await analyze(worker,p);expect(geometry.issues.filter(i=>i.severity==='error')).toEqual([]);const seam=geometry.seam;expect(seam).toHaveLength(23);if(!seam)throw Error('Native manufacturing omitted the original seam');
 // Native manufacturing translates to a local origin and back. Bound only
 // arithmetic roundoff; bitwise equality is required for the input project.
 const roundoff=16*Number.EPSILON*Math.max(1,...row.boundary.flat().map(Math.abs));seam.forEach((v,i)=>{expect(Math.abs(v.xMm-row.boundary[i][0])).toBeLessThanOrEqual(roundoff);expect(Math.abs(v.yMm-row.boundary[i][1])).toBeLessThanOrEqual(roundoff);});
 expect(geometry.areaMm2).toBeCloseTo(area(row.boundary),8);expect(geometry.cut.length).toBeGreaterThanOrEqual(3);expect(p).toEqual(before);
});
