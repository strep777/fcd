import {it,expect} from 'vitest';
import {resolve} from 'node:path';
import type {Marking,Surface} from '../packages/schema/index';
import {project} from './fixtures';
import {prepareDesignSurface,visibleDesignMarkings} from '../apps/desktop/main/design-cuts';
const surface:Surface={id:'s',source:'obj',topologyVersion:1,vertices:[{id:'a',xMm:0,yMm:0,zMm:0},{id:'b',xMm:100,yMm:0,zMm:0},{id:'c',xMm:0,yMm:100,zMm:0}],faces:[{id:'f',vertices:['a','b','c'],region:'panel'}]},worker=resolve('target/release/fpcad-worker.exe');
const square=(lo:number,hi:number)=>[[lo,lo],[hi,lo],[hi,hi],[lo,hi]],bary=(r:number[][])=>r.map(([u,v])=>[1-(u+v)/1000,u/1000,v/1000] as [number,number,number]);
function marking(fragments:number[][][][],color='#cc3344'):Marking{return {id:crypto.randomUUID(),name:'Parity audit',source:'manual',sourceHash:'a'.repeat(64),surfaceId:surface.id,topologyVersion:1,surfaceHash:'b'.repeat(64),view:'front',offsetXmm:0,offsetYmm:0,color,paths:[],fragments:fragments.map(rings=>({faceId:'f',rings:rings.map(bary)}))};}
async function audit(markings:Marking[]){const p=project();p.surface=structuredClone(surface);p.pieces=[];p.markings=markings;const before=structuredClone(p),working=await prepareDesignSurface(worker,p,true,false),areas=new Map<string,number>();for(const m of working.provenance.values()){const [a,b,c]=m.barycentric,area=Math.abs((b[1]-a[1])*(c[2]-a[2])-(b[2]-a[2])*(c[1]-a[1]))*5000;areas.set(m.color,(areas.get(m.color)??0)+area);}expect(p).toEqual(before);expect([...areas.values()].reduce((s,a)=>s+a,0)).toBeCloseTo(5000,6);return {areas,working,p};}
it.each([false,true])('keeps a nested painted island inside a same-direction hole under parity (reverse=%s)',async reverse=>{
 const rings=[square(50,450),square(150,350),square(200,300)].map(r=>reverse?r.reverse():r),r=await audit([marking([rings])]);expect(r.areas.get('#cc3344')).toBeCloseTo(1300,6);expect(r.areas.get('#eceae5')).toBeCloseTo(3700,6);
});
it('XORs rings within a fragment but unions independently painted overlapping fragments',async()=>{
 const a=[[100,100],[300,100],[300,300],[100,300]],b=[[200,100],[400,100],[400,300],[200,300]],xor=await audit([marking([[a,b]])]),fragments=await audit([marking([[a],[b]])]),layers=await audit([marking([[a]]),marking([[b]])]);expect(xor.areas.get('#cc3344')).toBeCloseTo(400,6);expect(fragments.areas.get('#cc3344')).toBeCloseTo(600,6);expect(layers.areas.get('#cc3344')).toBeCloseTo(600,6);
});
it('a top fragment hole exposes the underlying material instead of subtracting that lower color',async()=>{
 const r=await audit([marking([[square(50,450)]],'#cc3344'),marking([[square(100,400),square(150,350)]],'#3344cc')]);expect(r.areas.get('#cc3344')).toBeCloseTo(1100,6);expect(r.areas.get('#3344cc')).toBeCloseTo(500,6);
 const visible=await visibleDesignMarkings(worker,r.p);expect(visible).toHaveLength(2);expect(visible.every(m=>m.fragments.length===1)).toBe(true);
});
