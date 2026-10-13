import {it,expect} from 'vitest';
import {resolve} from 'node:path';
import type {Marking,Surface} from '../packages/schema/index';
import {project} from './fixtures';
import {prepareDesignSurface} from '../apps/desktop/main/design-cuts';
import minimal from './fixtures/design-near-contact-union.json';
const surface:Surface={id:'surface',source:'obj',topologyVersion:1,vertices:[{id:'a',xMm:0,yMm:0,zMm:0},{id:'b',xMm:100,yMm:0,zMm:0},{id:'c',xMm:0,yMm:100,zMm:0}],faces:[{id:'face',vertices:['a','b','c'],region:'panel'}]};
const marking=(rings:number[][][],color:string,id='m'):Marking=>({id,name:'Overlay',source:'manual',sourceHash:'a'.repeat(64),surfaceId:surface.id,topologyVersion:1,surfaceHash:'b'.repeat(64),view:'front',offsetXmm:0,offsetYmm:0,color,fragments:[{faceId:'face',rings:rings.map(r=>r.map(([u,v])=>[1-(u+v)/1000,u/1000,v/1000]))}],paths:[]});
const signed=(r:number[][])=>r.reduce((s,a,i)=>{const b=r[(i+1)%r.length];return s+a[0]*b[1]-a[1]*b[0];},0)/2;
async function areas(markings:Marking[]){const p=project();p.surface=surface;p.markings=markings;p.pieces=[];const before=structuredClone(p),w=await prepareDesignSurface(resolve('target/release/fpcad-worker.exe'),p,true,false),result=new Map<string,number>();for(const m of w.provenance.values()){const [a,b,c]=m.barycentric,area=Math.abs((b[1]-a[1])*(c[2]-a[2])-(b[2]-a[2])*(c[1]-a[1]))*5000;result.set(m.color,(result.get(m.color)??0)+area);}expect(p).toEqual(before);expect([...result.values()].reduce((s,a)=>s+a,0)).toBeCloseTo(5000,6);return result;}
it('uses parity for a same-direction nested hole and preserves overlapping layer unions',async()=>{
 const outer=[[100,100],[400,100],[400,400],[100,400]],hole=[[200,200],[300,200],[300,300],[200,300]],top=[[250,150],[450,150],[450,350],[250,350]],result=await areas([marking([outer,hole],'#ee1122'),marking([top],'#2233ee','top')]);expect(result.get('#ee1122')).toBeCloseTo(550,6);expect(result.get('#2233ee')).toBeCloseTo(400,6);expect(result.get('#eceae5')).toBeCloseTo(4050,6);
});
it('retries a near-touch Boolean on a shared face lattice without inventing occupied area',async()=>{
 const result=await areas(minimal.subjects.map((ring,i)=>marking([ring],i?'#2233ee':'#ee1122',String(i))));expect(result.get('#ee1122')).toBeCloseTo(signed(minimal.subjects[0])/100,6);expect(result.get('#2233ee')).toBeCloseTo(signed(minimal.subjects[1])/100,6);expect(result.get('#eceae5')).toBeCloseTo((500000-minimal.signed)/100,6);
});
