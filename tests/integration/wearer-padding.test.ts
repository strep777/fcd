import {expect,it} from 'vitest';
import {generateSpecies,speciesDefaults} from '../../apps/desktop/main/species';
import {assembleSpecies} from '../../apps/desktop/main/species-assembly';
import {validateSurface} from '../../apps/desktop/main/surface';
import {refineSurface,type Bary} from '../../packages/surface/refine';
import {surfaceSchema,type Surface} from '../../packages/schema/index';
import {Repository} from '../../apps/desktop/main/repository';
import {pack,unpack} from '../../apps/desktop/main/archive';
import {project} from '../fixtures';
import {mkdirSync,mkdtempSync,readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {gunzipSync} from 'node:zlib';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';

// Independent boundary oracle: inspect physical mesh edges, not assembly flags.
function boundary(mesh:Surface){
 const edges=new Map<string,{a:string;b:string;count:number}>();
 for(const f of mesh.faces)for(let i=0;i<3;i++){
  const a=f.vertices[i],b=f.vertices[(i+1)%3],key=[a,b].sort().join(':');const row=edges.get(key)??{a,b,count:0};row.count++;edges.set(key,row);
 }
 const exposed=[...edges.values()].filter(edge=>edge.count===1),links=new Map<string,string[]>();
 for(const {a,b}of exposed){links.set(a,[...links.get(a)??[],b]);links.set(b,[...links.get(b)??[],a]);}
 const seen=new Set<string>(),loops:string[][]=[];
 for(const start of links.keys())if(!seen.has(start)){
  const queue=[start],loop:string[]=[];while(queue.length){const id=queue.pop()!;if(seen.has(id))continue;seen.add(id);loop.push(id);queue.push(...links.get(id)!);}loops.push(loop);
 }
 return {exposed,links,loops,simple:[...links.values()].every(row=>row.length===2),manifold:[...edges.values()].every(row=>row.count<=2)};
}

it('DTD preserves wearer height and girths without animal appendages or padding',()=>{
 const p=speciesDefaults('canine','dtd'),s=generateSpecies(p);
 expect(s.template!.parts.some(p=>/tail|ear|claw|snout/.test(p))).toBe(false);
 expect(Math.max(...s.vertices.map(v=>v.yMm))-Math.min(...s.vertices.map(v=>v.yMm))).toBeCloseTo(p.heightMm,7);
 for(const name of ['hipGirth','waistGirth','chestGirth','neckGirth'])expect(s.template!.measurements.find(m=>m.name===name)!.residualMm).toBeCloseTo(0,7);
 const unchanged=generateSpecies({...p,hipPaddingMm:150,thighPaddingMm:150,calfPaddingMm:100});
 expect(unchanged.vertices.map(({id,...v})=>v)).toEqual(s.vertices.map(({id,...v})=>v));
});
it('integral padding expands outer thighs, keeps the inner thigh gap and gives the lower leg a continuous padded tube',()=>{
 const p=speciesDefaults('canine','padded'),base=generateSpecies({...p,hipPaddingMm:0,thighPaddingMm:0,calfPaddingMm:0}),outer=generateSpecies(p);
 const ids=new Set(base.faces.filter(f=>f.region==='leg-right').flatMap(f=>f.vertices));
 const leg=base.vertices.map((v,i)=>({v,w:outer.vertices[i]})).filter(r=>ids.has(r.v.id));
 expect(leg.every(({v,w})=>v.yMm===w.yMm)).toBe(true);
 expect(Math.max(...leg.map(({v,w})=>w.xMm-v.xMm))).toBeGreaterThan(50);
 const innerThigh=leg.filter(({v})=>v.xMm<p.hipGirthMm*.1&&v.yMm>=432&&v.yMm<=p.legLengthMm*.86);expect(innerThigh.length).toBeGreaterThan(0);expect(innerThigh.every(({v,w})=>Math.abs(v.xMm-w.xMm)<1e-8)).toBe(true);
 const lower=leg.filter(({v})=>v.yMm>=90&&v.yMm<=270&&Math.hypot(v.xMm-100,v.zMm)>1e-8);expect(lower.length).toBeGreaterThan(0);
 // The fixed 1800 mm wearer has leg centres x=+/-100. Below y=270,
 // padding adds 16.5 mm radially in x and 30 mm in z, without a second
 // ankle waist. This measures positions, not the assembly's girth claims.
 for(const {v,w}of lower){const radius=Math.hypot(v.xMm-100,v.zMm);expect(w.xMm-v.xMm).toBeCloseTo(16.5*(v.xMm-100)/radius,8);expect(w.zMm-v.zMm).toBeCloseTo(30*v.zMm/radius,8);}
 expect(base.template!.parts.some(part=>/^(head|hand|foot)(-|$)/.test(part))).toBe(false);expect(outer.faces.some(face=>/^(head|hand|foot)(-|$)/.test(face.region))).toBe(false);
});
it('calf-only padding reaches the ankle hem at constant depth and decreases continuously toward the knee',()=>{
 const p={...speciesDefaults('canine','padded'),hipPaddingMm:0,thighPaddingMm:0,calfPaddingMm:0},base=generateSpecies(p),padded=generateSpecies({...p,calfPaddingMm:30}),ids=new Set(base.faces.filter(f=>f.region==='leg-right').flatMap(f=>f.vertices)),rows=new Map<number,{x:number;z:number}>();
 base.vertices.forEach((v,i)=>{if(!ids.has(v.id))return;const w=padded.vertices[i];expect(w.yMm).toBe(v.yMm);const row=rows.get(v.yMm)??{x:0,z:0};row.x=Math.max(row.x,Math.abs(w.xMm-v.xMm));row.z=Math.max(row.z,Math.abs(w.zMm-v.zMm));rows.set(v.yMm,row);});
 const ordered=[...rows].sort((a,b)=>a[0]-b[0]),lower=ordered.filter(([y])=>y>=90&&y<=270),taper=ordered.filter(([y])=>y>=270&&y<=432);expect(lower.length).toBeGreaterThan(2);expect(taper.length).toBeGreaterThan(2);
 for(const [,row]of lower){expect(row.x).toBeCloseTo(16.5,8);expect(row.z).toBeCloseTo(30,8);}
 for(let i=1;i<taper.length;i++){expect(taper[i][1].x).toBeLessThanOrEqual(taper[i-1][1].x);expect(taper[i][1].z).toBeLessThanOrEqual(taper[i-1][1].z);}
 expect(taper.at(-1)![1].z).toBeLessThan(taper[0][1].z);for(const [y,row]of ordered)if(y>=432){expect(row.x).toBeCloseTo(0,8);expect(row.z).toBeCloseTo(0,8);}
});
it.each(['dtd','padded'] as const)('%s assembles into one body with only its intended garment openings',async mode=>{
 const params=speciesDefaults('canine',mode),mesh=await assembleSpecies(generateSpecies(params));
 expect(mesh.assembly!.components).toBe(1);
 const edges=boundary(mesh);expect(edges.manifold).toBe(true);expect(edges.simple).toBe(true);expect(edges.loops).toHaveLength(mode==='padded'?5:0);
 expect(()=>validateSurface(mesh)).not.toThrow();
 const height=mesh.assembly!.measurements.find(m=>m.name==='height')!,expectedHeight=mode==='padded'?params.heightMm*.86+25-params.legLengthMm*.10:params.heightMm;
 expect(height.targetMm).toBeCloseTo(expectedHeight,7);expect(height.actualMm).toBeCloseTo(expectedHeight,2);
 expect(Math.max(...mesh.vertices.map(v=>v.yMm))-Math.min(...mesh.vertices.map(v=>v.yMm))).toBeCloseTo(expectedHeight,2);
 if(mode==='padded'){
  expect(mesh.template!.parts.some(part=>/head|hand|foot|tail|ear|claw|snout/.test(part))).toBe(false);
  expect(mesh.faces.some(face=>/head|hand|foot/.test(face.region))).toBe(false);
  expect([params.hipPaddingMm,params.thighPaddingMm,params.calfPaddingMm]).toEqual([55,115,30]);
  expect(mesh.assembly!.garmentOpenings).toBe(5);expect(Math.min(...mesh.vertices.map(v=>v.yMm))).toBeCloseTo(90,3);expect(Math.max(...mesh.vertices.map(v=>v.yMm))).toBeCloseTo(1573,3);
  const points=new Map(mesh.vertices.map(v=>[v.id,v])),collar=params.heightMm*.86+25,shoulder=params.heightMm*.86-70,ax=params.shoulderWidthMm*.5;
  const locations=edges.loops.map(loop=>{
   const vertices=loop.map(id=>points.get(id)!);if(vertices.every(v=>Math.abs(v.yMm-collar)<.001))return 'collar';
   if(vertices.every(v=>Math.abs(v.yMm-90)<.001))return vertices.every(v=>v.xMm<0)?'left ankle':vertices.every(v=>v.xMm>0)?'right ankle':'unexpected';
   for(const side of [-1,1]){const cx=side*(ax+params.armLengthMm*Math.sqrt(.75)),cy=shoulder-params.armLengthMm*.5;
    if(vertices.every(v=>Math.abs(side*Math.sqrt(.75)*(v.xMm-cx)-.5*(v.yMm-cy))<.001))return side<0?'left cuff':'right cuff';
   }return 'unexpected';
  });expect(locations.sort()).toEqual(['collar','left ankle','left cuff','right ankle','right cuff']);
 }else{
  expect(mesh.assembly!.garmentOpenings).toBeUndefined();expect(edges.exposed).toHaveLength(0);
 }
},30000);

it('rejects an extra hole or a branched boundary instead of treating damage as a garment opening',async()=>{
 const source=await assembleSpecies(generateSpecies(speciesDefaults('canine','padded'))),before=structuredClone(source),original=boundary(source);
 const interior=source.faces.find(face=>face.vertices.every(id=>!original.links.has(id)))!;expect(interior).toBeDefined();
 const hole={...source,faces:source.faces.filter(face=>face.id!==interior.id)},holeBoundary=boundary(hole);
 expect(holeBoundary.simple).toBe(true);expect(holeBoundary.loops).toHaveLength(6);expect(()=>validateSurface(hole)).toThrow('NONMANIFOLD_MESH');
 const touching=source.faces.find(face=>face.vertices.filter(id=>original.links.has(id)).length===1)!;expect(touching).toBeDefined();
 const branched={...source,faces:source.faces.filter(face=>face.id!==touching.id)};
 expect(boundary(branched).simple).toBe(false);expect(()=>validateSurface(branched)).toThrow('NONMANIFOLD_MESH');expect(source).toEqual(before);
},30000);

it('keeps legacy closed bodies valid and requires an explicit padded opening contract for open assemblies',async()=>{
 const padded=await assembleSpecies(generateSpecies(speciesDefaults('canine','padded'))),legacy={...padded,assembly:{...padded.assembly!}};delete legacy.assembly.garmentOpenings;
 expect(surfaceSchema.safeParse(legacy).success).toBe(true);expect(()=>validateSurface(legacy)).toThrow('NONMANIFOLD_MESH');
 const dtd=await assembleSpecies(generateSpecies(speciesDefaults('canine','dtd')));
 expect(()=>validateSurface(dtd)).not.toThrow();expect(()=>validateSurface({...dtd,assembly:{...dtd.assembly!,garmentOpenings:3}})).toThrow('NONMANIFOLD_MESH');
 expect(()=>validateSurface({...padded,assembly:{...padded.assembly!,garmentOpenings:3}})).toThrow('NONMANIFOLD_MESH');
 expect(surfaceSchema.safeParse({...padded,assembly:{...padded.assembly!,garmentOpenings:4}}).success).toBe(false);
},30000);

it('retains five physical openings through boundary refinement, archive exchange and repository restart',async()=>{
 const source=await assembleSpecies(generateSpecies(speciesDefaults('canine','padded'))),before=structuredClone(source),original=boundary(source),edge=original.exposed[0];
 const face=source.faces.find(f=>f.vertices.includes(edge.a)&&f.vertices.includes(edge.b))!,mid=[0,0,0] as Bary,opposite=[0,0,0] as Bary;
 mid[face.vertices.indexOf(edge.a)]=.5;mid[face.vertices.indexOf(edge.b)]=.5;opposite[face.vertices.findIndex(id=>id!==edge.a&&id!==edge.b)]=1;
 const refined=refineSurface(source,[{faceId:face.id,a:mid,b:opposite,owner:'opening refinement'}]).surface,edges=boundary(refined);
 expect(source).toEqual(before);expect(edges.loops).toHaveLength(5);expect(edges.simple).toBe(true);expect(edges.exposed).toHaveLength(original.exposed.length+1);expect(()=>validateSurface(refined)).not.toThrow();
 const retained=new Map(refined.vertices.map(v=>[v.id,v]));for(const vertex of source.vertices)expect(retained.get(vertex.id)).toEqual(vertex);
 const p={...project(),pieces:[],surface:refined};expect(unpack(pack(p).bytes)).toEqual(p);
 const root=resolve('.local/tests');mkdirSync(root,{recursive:true});const path=resolve(mkdtempSync(resolve(root,'wearer-openings-')),'project.sqlite');
 const repository=new Repository(path);try{repository.open(p,null);}finally{repository.close();}
 const reopened=new Repository(path);try{const restored=reopened.snapshot()!;expect(restored).toEqual(p);expect(boundary(restored.surface!).loops).toHaveLength(5);expect(()=>validateSurface(restored.surface!)).not.toThrow();}finally{reopened.close();}
},30000);

it('retains an unmodified historical three-opening padded mesh through schema, archive and repository replay',async()=>{
 const provenance=JSON.parse(readFileSync(new URL('../fixtures/padded-three-openings-legacy.provenance.json',import.meta.url),'utf8')),compressed=readFileSync(new URL('../fixtures/padded-three-openings-legacy.surface.json.gz',import.meta.url)),bytes=gunzipSync(compressed);
 expect(createHash('sha256').update(bytes).digest('hex')).toBe(provenance.originalSurfaceSha256);expect(bytes.length).toBe(provenance.originalSurfaceBytes);
 const source=JSON.parse(bytes.toString('utf8')) as Surface,before=structuredClone(source),edges=boundary(source);expect(source.assembly!.garmentOpenings).toBe(3);expect(edges.loops).toHaveLength(3);expect(edges.simple).toBe(true);expect(edges.manifold).toBe(true);expect(Math.min(...source.vertices.map(v=>v.yMm))).toBeCloseTo(0,3);expect(source.faces.some(f=>f.region==='foot-left')).toBe(true);expect(source.faces.some(f=>f.region==='foot-right')).toBe(true);
 expect(surfaceSchema.parse(source)).toEqual(source);expect(()=>validateSurface(source)).not.toThrow();const p={...project(),pieces:[],surface:source};expect(unpack(pack(p).bytes)).toEqual(p);
 const {assertBodyModelScope}=await import(pathToFileURL(resolve('tests/fixtures/character-functional-oracle.mjs')).href);expect(()=>assertBodyModelScope(source,'padded')).toThrow();
 const root=resolve('.local/tests');mkdirSync(root,{recursive:true});const path=resolve(mkdtempSync(resolve(root,'legacy-padded-three-openings-')),'project.sqlite'),repository=new Repository(path);try{repository.open(p,null);}finally{repository.close();}
 const reopened=new Repository(path);try{const restored=reopened.snapshot()!;expect(restored).toEqual(p);expect(boundary(restored.surface!).loops).toHaveLength(3);expect(()=>validateSurface(restored.surface!)).not.toThrow();}finally{reopened.close();}expect(source).toEqual(before);
});
