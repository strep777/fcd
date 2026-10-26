import {expect,it} from 'vitest';
import {randomUUID} from 'node:crypto';
import {mkdirSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {generateSpecies,speciesDefaults} from '../../apps/desktop/main/species';
import {assembleSpecies} from '../../apps/desktop/main/species-assembly';
import {garmentSections} from '../../packages/surface/garment-sections';
import {refineMaterialProvenance,type MaterialFace,openDesignSeams} from '../../packages/surface/design-cuts';
import {designComponents} from '../../packages/surface/design-partition';

it.each(['dtd','padded'] as const)('%s structural seams actually partition the body with valid source coverage',async mode=>{
 const source=await assembleSpecies(generateSpecies(speciesDefaults('canine',mode))),before=structuredClone(source),result=garmentSections(source,randomUUID)!;
 expect(result).toBeDefined();expect(source).toEqual(before);
 const provenance=new Map(source.faces.map(f=>[f.id,{faceId:f.id,color:'#ffffff',barycentric:[[1,0,0],[0,1,0],[0,0,1]]} as MaterialFace]));
 const mapped=refineMaterialProvenance(provenance,result.children);expect(mapped).toBeDefined();
 const constraints=result.surface.cutConstraints!,keys=constraints.map(e=>[e.a,e.b].sort().join(':'));expect(new Set(keys).size).toBe(keys.length);
 const originalPoints=new Map(source.vertices.map(v=>[v.id,v])),originalFaces=new Map(source.faces.map(f=>[f.id,f])),points=new Map(result.surface.vertices.map(v=>[v.id,v])),coverage=new Map<string,number>();
 for(const f of result.surface.faces){const m=mapped!.get(f.id)!,parent=originalFaces.get(m.faceId)!;
  const [a,b,c]=m.barycentric,area=(b[1]-a[1])*(c[2]-a[2])-(b[2]-a[2])*(c[1]-a[1]);expect(area).toBeGreaterThan(0);coverage.set(parent.id,(coverage.get(parent.id)??0)+area);
  m.barycentric.forEach((w,i)=>{expect(w.every(n=>n>=0&&n<=1)).toBe(true);const p=points.get(f.vertices[i])!;
   for(const axis of ['xMm','yMm','zMm'] as const)expect(Math.abs(p[axis]-w.reduce((sum,n,k)=>sum+n*originalPoints.get(parent.vertices[k])![axis],0))).toBeLessThan(1e-8);
  });
 }
 expect(coverage.size).toBe(source.faces.length);for(const area of coverage.values())expect(area).toBeCloseTo(1,9);
 const opened=openDesignSeams({...result.surface,faces:result.surface.faces.map(f=>({...f,region:'body'}))},randomUUID),parts=designComponents(opened.faces);
 const physicalParts=parts.map(faces=>{const vertices=new Map(opened.vertices.map(v=>[v.id,v])),points=faces.flatMap(f=>f.vertices.map(id=>vertices.get(id)!));let areaMm2=0;for(const f of faces){const [a,b,c]=f.vertices.map(id=>vertices.get(id)!),u=[b.xMm-a.xMm,b.yMm-a.yMm,b.zMm-a.zMm],v=[c.xMm-a.xMm,c.yMm-a.yMm,c.zMm-a.zMm];areaMm2+=Math.hypot(u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0])/2;}return{faces:faces.length,areaMm2,sourceRegions:[...new Set(faces.map(f=>originalFaces.get(mapped!.get(f.id)!.faceId)!.region))].sort(),bounds:Object.fromEntries((['xMm','yMm','zMm'] as const).map(axis=>[axis,[Math.min(...points.map(p=>p[axis])),Math.max(...points.map(p=>p[axis]))]]))};});
 const folder=resolve(process.env.FPCAD_WEARER_SECTION_RESULTS??'test-results/wearer-structural-sections');mkdirSync(folder,{recursive:true});writeFileSync(resolve(folder,'garment-structural-'+mode+'.json'),JSON.stringify({mode,sourceFaces:source.faces.length,regions:[...new Set(source.faces.map(f=>f.region))].sort(),parts:physicalParts},null,2));
 // The open body-only shell starts with front/back upper and lower body
 // plus four sleeve charts. Its ankle hems stay connected to the calf;
 // the former DTD foot separator must not cut off 90..108 mm strips.
 if(mode==='padded'){
  expect(source.faces.some(f=>/^(head|hand|foot)(-|$)/.test(f.region))).toBe(false);expect(parts).toHaveLength(8);
  const hems=physicalParts.filter(part=>Math.abs(part.bounds.yMm[0]-90)<1e-5);expect(hems.length).toBeGreaterThan(0);for(const part of hems)expect(part.bounds.yMm[1],'an ankle hem remains attached through its calf').toBeGreaterThanOrEqual(270);
  expect(physicalParts.some(part=>part.bounds.yMm[0]>=90-1e-5&&part.bounds.yMm[1]<=108+1e-5),'no obsolete foot-plane ankle strip').toBe(false);
 }else{expect(parts.length).toBeGreaterThanOrEqual(16);expect(parts.length).toBeLessThanOrEqual(30);}
 const params=source.template!.parameters,neck=params.heightMm*.86,hip=params.legLengthMm,ax=params.shoulderWidthMm*.5;
 for(const faces of parts){const v=faces.flatMap(f=>f.vertices.map(id=>opened.vertices.find(p=>p.id===id)!));
  expect(!(v.some(p=>p.yMm>neck+40)&&v.some(p=>p.yMm<neck-40))).toBe(true);
  expect(!(v.some(p=>Math.abs(p.xMm)>ax+params.armLengthMm*.55)&&v.some(p=>Math.abs(p.xMm)<ax*.4&&p.yMm>hip)),'a sleeve chart must not include the central torso').toBe(true);
  expect(!(v.some(p=>p.yMm<hip*.05)&&v.some(p=>p.yMm>hip*.3)),'a foot chart must not include the thigh').toBe(true);
 }
},30000);
