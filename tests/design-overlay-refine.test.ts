import {it,expect} from 'vitest';
import {resolve} from 'node:path';
import fixture from './fixtures/design-overlay-crossing.json';
import second from './fixtures/design-overlay-crossing-second.json';
import type {Surface,Marking} from '../packages/schema/index';
import {project} from './fixtures';
import {prepareDesignSurface} from '../apps/desktop/main/design-cuts';
import {validateSurface} from '../apps/desktop/main/surface';
it('triangulates adjacent visible colour contours without a numerical wedge breaking a physical edge',async()=>{
 for(const input of [fixture,second]){const p=project();p.pieces=[];p.surface=input.surface as Surface;
 const owners=new Map<string,number[][][]>();for(const cut of input.cuts){const rings=owners.get(cut.owner)??[];if(!rings.length||JSON.stringify(rings.at(-1)!.at(-1))!==JSON.stringify(cut.a))rings.push([cut.a]);rings.at(-1)!.push(cut.b);owners.set(cut.owner,rings);}
 p.markings=[...owners].map(([id,rings],i)=>({id,name:'Visible overlay',source:'manual',sourceHash:'a'.repeat(64),surfaceId:p.surface!.id,topologyVersion:p.surface!.topologyVersion,surfaceHash:'b'.repeat(64),view:'front',offsetXmm:0,offsetYmm:0,color:['#ef7766','#55aaee','#887766','#444488'][i],fragments:[{faceId:p.surface!.faces[0].id,rings:rings.map(r=>r.slice(0,-1).map(w=>w as [number,number,number]))}],paths:[]} as Marking));
 const before=structuredClone(p),working=await prepareDesignSurface(resolve('target/release/fpcad-worker.exe'),p,true,false,resolve('dist/assets'));expect(p).toEqual(before);expect(()=>validateSurface(working.surface)).not.toThrow();
 const sum=[...working.provenance.values()].reduce((s,t)=>{const [a,b,c]=t.barycentric;return s+Math.abs((b[1]-a[1])*(c[2]-a[2])-(b[2]-a[2])*(c[1]-a[1]));},0);expect(sum).toBeCloseTo(1,8);
 }
});
