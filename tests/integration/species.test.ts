import {it,expect} from 'vitest';
import {generateSpecies,speciesDefaults} from '../../apps/desktop/main/species';
import {validateSurface,unwrapSurface} from '../../apps/desktop/main/surface';
import {project} from '../fixtures';
import {resolve} from 'node:path';
import {pack,unpack} from '../../apps/desktop/main/archive';
const worker=resolve('target/release/fpcad-worker.exe');
it('all six original species recipes generate anatomical components, measured 1800mm height and baseline girths',()=>{
 for(const species of ['canine','feline','rabbit','bear','deer','dragon'] as const){const params=speciesDefaults(species),mesh=generateSpecies(params);expect(()=>validateSurface(mesh)).not.toThrow();expect(mesh.template?.parts).toContain('head');expect(mesh.template?.parts).toContain('snout');expect(mesh.template?.parts).toContain('arm-left');expect(mesh.template?.parts).toContain('leg-right');expect(mesh.template?.parts).toContain('tail');if(species==='dragon')expect(mesh.template?.parts).toContain('wing-left');if(species==='deer')expect(mesh.template?.parts).toContain('hoof-left');for(const m of mesh.template!.measurements)expect(Math.abs(m.residualMm)).toBeLessThan(1e-6);const p=project();p.surface=mesh;expect(unpack(pack(p).bytes)).toEqual(p);}
});
it('measure changes retain topology IDs, posture/species changes create a new template, incompatible proportions reject',()=>{
 const params=speciesDefaults('canine'),mesh=generateSpecies(params),changed=generateSpecies({...params,chestGirthMm:1300,snoutLengthMm:160},mesh);expect(changed.id).toBe(mesh.id);expect(changed.vertices.map(v=>v.id)).toEqual(mesh.vertices.map(v=>v.id));expect(changed.topologyVersion).toBe(2);expect(changed.template?.parameters.chestGirthMm).toBe(1300);expect(mesh.template?.parameters.chestGirthMm).toBe(1100);
 const plant=generateSpecies({...params,legType:'plantigrade'},mesh);expect(plant.id).not.toBe(mesh.id);expect(plant.vertices.map(v=>v.zMm)).not.toEqual(mesh.vertices.map(v=>v.zMm));expect(()=>generateSpecies({...params,legLengthMm:1300})).toThrow();
});
it('a complete canine modular mesh can be automatically cut and unfolded, retaining every face',async()=>{
 const mesh=generateSpecies(speciesDefaults('canine')),run=await unwrapSurface(worker,mesh,{...project(),pieces:[]},{method:'arap',automaticCuts:true,normalAngleDeg:65,iterations:15});expect(run.pieces.length).toBeGreaterThan(20);expect(run.bindings.flatMap(b=>b.report.faceIds).sort()).toEqual(mesh.faces.map(f=>f.id).sort());expect(run.bindings.every(b=>Number.isFinite(b.report.distortionMean))).toBe(true);
},20000);
const unfoldCases=(['canine','feline','rabbit','bear','deer','dragon'] as const).flatMap(species=>(['plantigrade','digitigrade'] as const).map(legType=>({species,legType})));
it.each(unfoldCases)('$species/$legType unfolds within explicit piece and worker budgets',async({species,legType})=>{
 const mesh=generateSpecies({...speciesDefaults(species),legType}),run=await unwrapSurface(worker,mesh,{...project(),pieces:[]},{method:'arap',automaticCuts:true,iterations:10});expect(run.bindings.flatMap(b=>b.report.faceIds).length).toBe(mesh.faces.length);expect(run.pieces.length).toBeLessThanOrEqual(500);
},30000);
it('zero tail-tip girth forms a real pole without degenerate triangles, and incompatible total height is rejected',()=>{
 const params=speciesDefaults('feline'),mesh=generateSpecies({...params,tailTipGirthMm:0});expect(()=>validateSurface(mesh)).not.toThrow();const tailFaces=mesh.faces.filter(f=>f.region.startsWith('tail-')),edges=new Map<string,number>();for(const f of tailFaces)f.vertices.forEach((a,i)=>{const k=[a,f.vertices[(i+1)%3]].sort().join(':');edges.set(k,(edges.get(k)??0)+1);});expect([...edges.values()].every(n=>n===2)).toBe(true);expect(()=>generateSpecies({...params,legLengthMm:200,tailLengthMm:2000,tailBaseGirthMm:700,paddingMm:80})).toThrow('INCOMPATIBLE_BODY_PROPORTIONS');
});
