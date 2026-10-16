import {it,expect} from 'vitest';
import {resolve} from 'node:path';
import {boundedMarkingRings} from '../../apps/desktop/main/marking-path-budget';
import {clip,area as projectedArea,type XY} from '../../apps/desktop/main/markings';
const worker=resolve('target/release/fpcad-worker.exe');
const bounded=(rings:XY[][])=>boundedMarkingRings(rings,9,jobs=>clip(worker,jobs,9));
const area=(r:XY[])=>r.reduce((s,p,i)=>{const q=r[(i+1)%r.length];return s+p[0]*q[1]-p[1]*q[0];},0)/2;
it('compacts derived collinear samples without removing a narrow island or hole',async()=>{
 const outer:XY[]=[...Array.from({length:2500},(_,i)=>[i/25,0] as XY),[100,0],[100,100],[0,100]],hole:XY[]=[[20,.00005],[20,.00015],[50,.00015],[50,.00005]],island:XY[]=[[120,0],[150,0],[150,.00005],[120,.00005]],before=[outer,hole,island],snapshot=structuredClone(before),result=await bounded(before);
 expect(before).toEqual(snapshot);expect(result.every(r=>r.length<=2000)).toBe(true);expect(result).toContainEqual(hole);expect(result).toContainEqual(island);expect(result.reduce((s,r)=>s+area(r),0)).toBeCloseTo(before.reduce((s,r)=>s+area(r),0),9);
});
it('partitions true sharp detail without losing area or creating a manufacturing seam',async()=>{
 const star=Array.from({length:2200},(_,i)=>{const a=i*2*Math.PI/2200,r=i%2?60:80;return [100+r*Math.cos(a),100+r*Math.sin(a)] as XY;}),result=await bounded([star]);
 expect(result.length).toBeGreaterThan(1);expect(result.every(r=>r.length<=2000)).toBe(true);expect(result.reduce((s,r)=>s+area(r),0)).toBeCloseTo(area(star),5);
 const united=(await clip(worker,[{subjects:result,union:true}],9))[0];expect(united).toHaveLength(1);expect(area(united[0])).toBeCloseTo(area(star),5);
},30000);
it('preserves ordinary paths byte for byte',async()=>{const rings:XY[][]=[[[0,0],[100,0],[100,100],[0,100]]];expect(await bounded(rings)).toBe(rings);});

it('keeps a separate island inside a shallow outer notch after budget compaction',async()=>{
 const outer:XY[]=[...Array.from({length:2500},(_,i)=>[10*i/2500,0] as XY),[10,0],[10,10],[6,10],[6,9.9995],[4,9.9995],[4,10],[0,10]],island:XY[]=[[4.5,9.9996],[5.5,9.9996],[5.5,9.9999],[4.5,9.9999]],stableArea=(r:XY[])=>r.reduce((s,p,i)=>{const q=r[(i+1)%r.length],o=r[0];return s+(p[0]-o[0])*(q[1]-o[1])-(q[0]-o[0])*(p[1]-o[1]);},0)/2;
 for(const [angle,tx,ty] of [[0,0,0],[.35,500000,-400000]]){
  const transform=(r:XY[])=>r.map(([x,y])=>[tx+x*Math.cos(angle)-y*Math.sin(angle),ty+x*Math.sin(angle)+y*Math.cos(angle)] as XY),input=[transform(outer),transform(island)],snapshot=structuredClone(input),before=(await clip(worker,[{subjects:input,union:true}],9))[0],result=await bounded(input),after=(await clip(worker,[{subjects:result,union:true}],9))[0];
  expect(input).toEqual(snapshot);expect(before).toHaveLength(2);expect(result.every(r=>r.length<=2000)).toBe(true);
  expect(after,'a .0003 mm island separated by a real gap must remain disconnected').toHaveLength(2);
  expect(Math.abs(after.reduce((s,r)=>s+stableArea(r),0)-before.reduce((s,r)=>s+stableArea(r),0))).toBeLessThan(1e-7);
 }
},30000);

it('measures a thin positive-area island independently of its UV layout translation',()=>{
 const base:XY[]=[[0,0],[.003,0],[.003,.001],[0,.001]],moved=base.map(([x,y])=>[x+500000,y-400000] as XY);
 expect(projectedArea(base)).toBeGreaterThan(1e-6);expect(Math.abs(projectedArea(moved)-projectedArea(base))).toBeLessThan(1e-12);
});
