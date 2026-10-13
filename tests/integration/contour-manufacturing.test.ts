import {randomUUID} from 'node:crypto';
import {resolve} from 'node:path';
import {expect,it} from 'vitest';
import {analyze} from '../../apps/desktop/main/worker';
import {edgeArcPoints} from '../../packages/pattern/edit';
import type {Piece} from '../../packages/schema/index';
import legacyFixture from '../fixtures/legacy-curved-character-piece.json';
import {project} from '../fixtures';

const worker=resolve('target/release/fpcad-worker'+(process.platform==='win32'?'.exe':''));
type XY={xMm:number;yMm:number};
const ringArea=(ring:XY[])=>Math.abs(ring.reduce((sum,a,i)=>{const b=ring[(i+1)%ring.length];return sum+a.xMm*b.yMm-b.xMm*a.yMm;},0)/2);
const netArea=(outer:XY[],holes:XY[][])=>ringArea(outer)-holes.reduce((sum,h)=>sum+ringArea(h),0);

it.each([1,2.5,10])('manufactures the immutable legacy 318-cubic character at scale %s without applying the editable-node limit to samples',async scale=>{
 // Retain the real old extractor output even after the new recovery algorithm
 // stops adding smoothing cubics to straight sides. This guards saved projects.
 const move=(p:XY & {id:string})=>({...p,xMm:p.xMm*scale,yMm:p.yMm*scale});
 const fitted:Piece={...legacyFixture,nodes:legacyFixture.nodes.map(move),holes:legacyFixture.holes.map(h=>h.map(move)),curves:legacyFixture.curves.map(c=>({...c,c1:move(c.c1),c2:move(c.c2)}))};
 expect(fitted.nodes).toHaveLength(318);expect(fitted.curves).toHaveLength(318);expect(fitted.holes).toHaveLength(6);
 const sampled=fitted.nodes.flatMap(n=>edgeArcPoints(fitted,n.id).slice(0,-1));
 expect(sampled.length).toBeGreaterThan(2000);
 expect(sampled.length).toBeLessThanOrEqual(12000);
 const expectedArea=netArea(sampled,fitted.holes!),originalArea=137244*(1800/1024*scale)**2;
 expect(Math.abs(expectedArea-originalArea)/originalArea).toBeLessThan(.03);
 // Automatic reference markings have zero allowance; a narrow original hole
 // need not survive a subsequently requested positive allowance.
 const p=project();p.pieces=[fitted];
 const geometry=await analyze(worker,p);
 for(const g of geometry){
  expect(g.issues.filter(i=>i.severity==='error')).toEqual([]);
  expect(g.seam).toHaveLength(sampled.length);
  expect(g.seamHoles).toHaveLength(6);
  expect(g.cutHoles).toHaveLength(6);
  expect(Math.abs(g.areaMm2-expectedArea)/expectedArea).toBeLessThan(1e-9);
  expect(netArea(g.seam!,g.seamHoles!)).toBeCloseTo(g.areaMm2,4);
 }
 expect(Math.abs(netArea(geometry[0].cut,geometry[0].cutHoles!)-expectedArea)/expectedArea).toBeLessThan(1e-9);
},20000);
