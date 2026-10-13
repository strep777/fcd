import {mkdir,writeFile} from 'node:fs/promises';
import {it,expect,afterAll} from 'vitest';
import {generateSpecies,speciesDefaults} from '../../apps/desktop/main/species';
import {validateSurface,unwrapSurface} from '../../apps/desktop/main/surface';
import {project} from '../fixtures';
import {resolve} from 'node:path';
import {pack,unpack} from '../../apps/desktop/main/archive';
import {assembleSpecies} from '../../apps/desktop/main/species-assembly';
const cases=(['canine','feline','rabbit','bear','deer','dragon'] as const).flatMap(species=>(['plantigrade','digitigrade'] as const).map(legType=>({species,legType})));
const reports:unknown[]=[];
afterAll(async()=>{await mkdir('test-results',{recursive:true});await writeFile('test-results/assembly.json',JSON.stringify({passed:reports.length===cases.length,reports},null,2));});
it.each(cases)('solid assembly gives $species/$legType a closed connected shell and retains every face when unfolded',async({species,legType})=>{
 const source=generateSpecies({...speciesDefaults(species),legType});let mesh;try{mesh=await assembleSpecies(source);}catch(e){throw new Error(species+'/'+legType+': '+e);}expect(mesh.assembly?.components).toBe(1);expect(mesh.id).not.toBe(source.id);const edges=new Map<string,number>();for(const f of mesh.faces)f.vertices.forEach((a,i)=>{const k=[a,f.vertices[(i+1)%3]].sort().join(':');edges.set(k,(edges.get(k)??0)+1);});expect([...edges.values()].every(n=>n===2)).toBe(true);const p={...project(),pieces:[],surface:mesh};expect(unpack(pack(p).bytes)).toEqual(p);const run=await unwrapSurface(resolve('target/release/fpcad-worker.exe'),mesh,p,{method:'arap',automaticCuts:true,iterations:10}).catch(e=>{throw new Error(species+'/'+legType+' unfold: '+e);});expect(run.bindings.flatMap(b=>b.report.faceIds).length).toBe(mesh.faces.length);reports.push({species,legType,vertices:mesh.vertices.length,faces:mesh.faces.length,assembly:mesh.assembly,pieces:run.pieces.length,optimization:run.optimization});
},60000);

it('assembly rejects detached components, supports zero tail tips, and validates stored closure',async()=>{const parameters=speciesDefaults('feline'),source=generateSpecies({...parameters,tailTipGirthMm:0}),mesh=await assembleSpecies(source);expect(mesh.assembly?.volumeMm3).toBeGreaterThan(0);expect(()=>validateSurface({...mesh,faces:mesh.faces.slice(1)})).toThrow('NONMANIFOLD_MESH');const detached=structuredClone(source),ear=new Set(detached.faces.filter(f=>f.region.startsWith('ear-left-')).flatMap(f=>f.vertices));for(const v of detached.vertices)if(ear.has(v.id))v.xMm-=3000;await expect(assembleSpecies(detached)).rejects.toThrow('DISCONNECTED_TEMPLATE');await expect(assembleSpecies(mesh)).rejects.toThrow('TEMPLATE_REQUIRED');});
