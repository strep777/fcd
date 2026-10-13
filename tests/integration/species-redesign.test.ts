import {it,expect} from 'vitest';
import {generateSpecies,speciesDefaults} from '../../apps/desktop/main/species';
import {assembleSpecies} from '../../apps/desktop/main/species-assembly';
import {smoothSections} from '../../apps/desktop/main/species-loft';
import {validateSurface} from '../../apps/desktop/main/surface';
import {fitSpecies} from '../../apps/desktop/main/body-edit';
import type {Surface} from '../../packages/schema/index';
const species=['canine','feline','rabbit','bear','deer','dragon'] as const;
function points(mesh:Surface,part:string){const ids=new Set(mesh.faces.filter(f=>f.region===part||f.region.startsWith(part+'-')).flatMap(f=>f.vertices));return mesh.vertices.filter(v=>ids.has(v.id));}
function closed(mesh:Surface,part?:string){const edges=new Map<string,{count:number;direction:number}>();for(const f of mesh.faces.filter(f=>!part||f.region===part||f.region.startsWith(part+'-')))for(let i=0;i<3;i++){const a=f.vertices[i],b=f.vertices[(i+1)%3],key=[a,b].sort().join(':');const e=edges.get(key)??{count:0,direction:0};e.count++;e.direction+=a<b?1:-1;edges.set(key,e);}return [...edges.values()].every(e=>e.count===2&&e.direction===0);}
it('smooth measured lofts retain anchors and bounded monotonic radii',()=>{
 const sections=[{center:[0,0,0] as [number,number,number],girth:10},{center:[0,10,0] as [number,number,number],girth:100},{center:[0,12,0] as [number,number,number],girth:0}],loft=smoothSections(sections,8);
 expect(loft[0]).toEqual({...sections[0],ratio:1});expect(loft[8]).toEqual({...sections[1],ratio:1});expect(loft.at(-1)).toEqual(sections.at(-1));
 expect(loft.every(s=>s.girth>=0&&s.girth<=100)).toBe(true);expect(loft.every((s,i)=>!i||s.center[1]>=loft[i-1].center[1])).toBe(true);
});
it.each(species)('%s uses sealed curved parts, lowered arms, broad thighs and a tapering curved tail',name=>{
 const params=speciesDefaults(name),mesh=generateSpecies(params);expect(()=>validateSurface(mesh)).not.toThrow();
 for(const part of mesh.template!.parts)expect(closed(mesh,part),part).toBe(true);
 const arm=points(mesh,'arm-right'),near=arm.filter(v=>v.xMm<params.shoulderWidthMm*.6),far=arm.filter(v=>v.xMm>params.shoulderWidthMm/2+params.armLengthMm*.95);
 const meanY=(p:typeof near)=>p.reduce((sum,v)=>sum+v.yMm,0)/p.length;
 expect(meanY(near)-meanY(far)).toBeGreaterThan(params.armLengthMm*.35);
 const leg=points(mesh,'leg-right'),upper=leg.filter(v=>v.yMm>params.legLengthMm*.6&&v.yMm<params.legLengthMm*.9),calf=leg.filter(v=>v.yMm<params.legLengthMm*.30&&v.yMm>params.legLengthMm*.2);
 expect(Math.max(...upper.map(v=>v.xMm))-Math.min(...upper.map(v=>v.xMm))).toBeGreaterThan(Math.max(...calf.map(v=>v.xMm))-Math.min(...calf.map(v=>v.xMm)));
 const tail=points(mesh,'tail');expect(Math.max(...tail.map(v=>v.yMm))-Math.min(...tail.map(v=>v.yMm))).toBeGreaterThan(params.tailLengthMm*.12);
 if(name==='dragon')expect(Math.max(...points(mesh,'wing-right').map(v=>v.xMm))).toBeLessThan(params.shoulderWidthMm);
});
it.each(species)('%s assembles as one usable exterior with truthful height and torso measurements',async name=>{
 const params=speciesDefaults(name),mesh=await assembleSpecies(generateSpecies(params));expect(()=>validateSurface(mesh)).not.toThrow();expect(closed(mesh)).toBe(true);expect(mesh.assembly!.components).toBe(1);expect(mesh.faces.length).toBeLessThanOrEqual(12000);
 expect(Math.abs(mesh.assembly!.measurements.find(m=>m.name==='height')!.residualMm)).toBeLessThanOrEqual(1);
 for(const part of ['head','torso','arm-left','arm-right','leg-left','leg-right'])expect(points(mesh,part).length,part).toBeGreaterThan(0);
 for(const m of mesh.assembly!.measurements){expect(m.residualMm).toBeCloseTo(m.actualMm-m.targetMm,8);expect(Math.abs(m.residualMm),m.name).toBeLessThanOrEqual(Math.max(2,m.targetMm*.005));}
});
it('an assembled template retains its parameters and measured fitting targets after regeneration',async()=>{
 const initial=await assembleSpecies(generateSpecies(speciesDefaults('canine')));
 const fitted=fitSpecies(generateSpecies(initial.template!.parameters),{chestGirth:1300,headWidth:330});
 const next=await assembleSpecies(fitted);expect(closed(next)).toBe(true);expect(next.template!.fit!.targets).toEqual({chestGirth:1300,headWidth:330});
 expect(next.template!.measurements.find(m=>m.name==='headWidth')!.actualMm).toBeCloseTo(330,6);expect(next.assembly!.measurements.find(m=>m.name==='chestGirth')!.actualMm).toBeCloseTo(1300,2);
 expect(initial.template!.parameters.chestGirthMm).toBe(1100);expect(next.template!.parameters.chestGirthMm).toBeCloseTo(1300,6);
});
