import {expect,it} from 'vitest';
import {generateSpecies,speciesDefaults} from '../../apps/desktop/main/species';
import {assembleSpecies} from '../../apps/desktop/main/species-assembly';

it('DTD preserves wearer height and girths without animal appendages or padding',()=>{
 const p=speciesDefaults('canine','dtd'),s=generateSpecies(p);
 expect(s.template!.parts.some(p=>/tail|ear|claw|snout/.test(p))).toBe(false);
 expect(Math.max(...s.vertices.map(v=>v.yMm))-Math.min(...s.vertices.map(v=>v.yMm))).toBeCloseTo(p.heightMm,7);
 for(const name of ['hipGirth','waistGirth','chestGirth','neckGirth'])expect(s.template!.measurements.find(m=>m.name===name)!.residualMm).toBeCloseTo(0,7);
 const unchanged=generateSpecies({...p,hipPaddingMm:150,thighPaddingMm:150,calfPaddingMm:100});
 expect(unchanged.vertices.map(({id,...v})=>v)).toEqual(s.vertices.map(({id,...v})=>v));
});
it('integral padding expands outer thighs, keeps the inner gap and leaves knees/ankles in place',()=>{
 const p=speciesDefaults('canine','dtd'),base=generateSpecies(p),outer=generateSpecies({...p,bodyMode:'padded'});
 const ids=new Set(base.faces.filter(f=>f.region==='leg-right').flatMap(f=>f.vertices));
 const leg=base.vertices.map((v,i)=>({v,w:outer.vertices[i]})).filter(r=>ids.has(r.v.id));
 expect(leg.every(({v,w})=>v.yMm===w.yMm)).toBe(true);
 expect(Math.max(...leg.map(({v,w})=>w.xMm-v.xMm))).toBeGreaterThan(50);
 expect(leg.filter(({v})=>v.xMm<p.hipGirthMm*.1&&v.yMm<=p.legLengthMm*.86).every(({v,w})=>Math.abs(v.xMm-w.xMm)<1e-8)).toBe(true);
 expect(leg.filter(({v})=>v.yMm<p.legLengthMm*.4).every(({v,w})=>Math.abs(v.zMm-w.zMm)<1e-8)).toBe(true);
});
it.each(['dtd','padded'] as const)('%s assembles into one closed wearable body',async mode=>{
 const mesh=await assembleSpecies(generateSpecies(speciesDefaults('canine',mode)));
 expect(mesh.assembly!.components).toBe(1);
 const edges=new Map<string,number>();for(const f of mesh.faces)for(let i=0;i<3;i++){const key=[f.vertices[i],f.vertices[(i+1)%3]].sort().join(':');edges.set(key,(edges.get(key)??0)+1);}
 expect([...edges.values()].every(n=>n===2)).toBe(true);
 expect(mesh.assembly!.measurements.find(m=>m.name==='height')!.actualMm).toBeCloseTo(1800,2);
},30000);
