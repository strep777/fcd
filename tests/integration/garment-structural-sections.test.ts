import {expect,it} from 'vitest';
import {randomUUID} from 'node:crypto';
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
 // Front/back alone yields two whole-body charts. These actual joint seams
 // must separate sleeves, hands, feet and head before flattening begins.
 expect(parts.length).toBeGreaterThanOrEqual(16);expect(parts.length).toBeLessThanOrEqual(30);
 const neck=source.template!.parameters.heightMm*.86;
 for(const faces of parts){const v=faces.flatMap(f=>f.vertices.map(id=>opened.vertices.find(p=>p.id===id)!));
  expect(!(v.some(p=>p.yMm>neck+40)&&v.some(p=>p.yMm<neck-40))).toBe(true);
 }
},30000);
