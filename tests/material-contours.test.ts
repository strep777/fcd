import {it,expect} from 'vitest';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {project} from './fixtures';
import {prepareDesignSurface} from '../apps/desktop/main/design-cuts';
import type {Surface,Marking} from '../packages/schema/index';
import type {Bary} from '../packages/surface/refine';
import {materialContourLoops} from '../packages/surface/material-contours';
import {type MaterialTile} from '../packages/surface/material-tiles';
const bary=([x,y]:number[]):Bary=>[1-(x+y)/20,x/20,y/20];
const signed=(r:Bary[])=>r.reduce((s,a,i)=>{const b=r[(i+1)%r.length];return s+a[1]*b[2]-a[2]*b[1];},0)/2;
it('decomposes two kissing islands with exactly the same signed area',()=>{
 const ring=[[5,5],[8,5],[5,8],[5,5],[2,5],[5,2]].map(bary),before=structuredClone(ring),loops=materialContourLoops([ring]);expect(ring).toEqual(before);expect(loops).toHaveLength(2);expect(loops.every(r=>signed(r)>0)).toBe(true);expect(loops.reduce((s,r)=>s+signed(r),0)).toBeCloseTo(signed(ring),14);
});
it('retains a negative hole loop sharing a vertex with its outer contour',()=>{
 const ring=[[0,0],[8,0],[8,8],[0,8],[0,0],[1,2],[2,1]].map(bary),loops=materialContourLoops([ring]);expect(loops).toHaveLength(2);expect(loops.filter(r=>signed(r)<0)).toHaveLength(1);expect(loops.reduce((s,r)=>s+signed(r),0)).toBeCloseTo(signed(ring),14);
});
it('removes an exact zero-area two-point retrace without removing material',()=>{
 const ring=[[1,1],[8,1],[8,8],[1,8],[1,1],[19,1],[1,1]].map(bary),loops=materialContourLoops([ring]);expect(loops).toHaveLength(1);expect(loops[0]).toHaveLength(4);expect(signed(loops[0])).toBeCloseTo(signed(ring),14);
});
it('normalizes captured kissing color contours before building the base domain',async()=>{
 const fixture=JSON.parse(await readFile(resolve('tests/fixtures/design-kissing-material.json'),'utf8')) as {surface:Surface;tiles:MaterialTile[]},p=project();p.pieces=[];p.surface=fixture.surface;
 p.markings=fixture.tiles.filter(t=>t.color!=='#eceae5').map((tile,i)=>({id:String(i),name:'Captured overlay',source:'manual',sourceHash:'a'.repeat(64),surfaceId:p.surface!.id,topologyVersion:p.surface!.topologyVersion,surfaceHash:'b'.repeat(64),view:'front',offsetXmm:0,offsetYmm:0,color:tile.color,fragments:[{faceId:tile.faceId,rings:tile.rings}],paths:[]} as Marking));
 const before=structuredClone(p),working=await prepareDesignSurface(resolve('target/release/fpcad-worker.exe'),p,true,false),sum=[...working.provenance.values()].reduce((s,m)=>s+Math.abs(signed(m.barycentric))*2,0);expect(p).toEqual(before);expect(sum).toBeCloseTo(1,8);expect(new Set([...working.provenance.values()].map(m=>m.color)).size).toBe(5);
});
