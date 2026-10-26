import {expect,it} from 'vitest';
import {randomUUID} from 'node:crypto';
import {generateSpecies,speciesDefaults} from '../../apps/desktop/main/species';
import {assembleSpecies} from '../../apps/desktop/main/species-assembly';
import {openMaterialMesh,type MaterialFace} from '../../packages/surface/design-cuts';

it('visible sleeve materials avoid premature template sections while a single-material body keeps its structural starting layout',async()=>{
 const source=await assembleSpecies(generateSpecies(speciesDefaults('canine','padded'))),before=structuredClone(source);
 const provenance=(colored:boolean)=>new Map(source.faces.map(face=>[face.id,{faceId:face.id,color:colored&&face.region.startsWith('arm-')?'#202020':'#eeeeee',barycentric:[[1,0,0],[0,1,0],[0,0,1]]} as MaterialFace]));
 const material=provenance(true);expect(new Set([...material.values()].map(row=>row.color)).size).toBe(2);
 const multi=openMaterialMesh(source,material,randomUUID,true),single=openMaterialMesh(source,provenance(false),randomUUID,true);
 expect(source).toEqual(before);
 // The visible source boundaries already supply two sleeves and the body.
 // No extra template station or source triangle is manufactured at this step.
 expect(new Set(multi.surface.faces.map(face=>face.id))).toEqual(new Set(source.faces.map(face=>face.id)));
 expect(multi.provenance.size).toBe(source.faces.length);
 for(const face of source.faces)expect(multi.provenance.get(face.id)).toEqual(material.get(face.id));
 expect(multi.materialDomains).toBe(3);
 // The 1.2 body-only garment has upper/lower front/back and two sides of
 // each sleeve. Ankle hems stay attached to the lower body, with no foot
 // panels. Audit those physical components rather than updating a count alone.
 const points=new Map(single.surface.vertices.map(v=>[v.id,v]));
 const incident=new Map<string,number[]>();
 single.surface.faces.forEach((f,i)=>f.vertices.forEach(id=>incident.set(id,[...(incident.get(id)??[]),i])));
 const unseen=new Set(single.surface.faces.map((_,i)=>i)),components:number[][]=[];
 while(unseen.size){const first=unseen.values().next().value!,pending=[first],part:number[]=[];unseen.delete(first);while(pending.length){const i=pending.pop()!;part.push(i);for(const id of single.surface.faces[i].vertices)for(const neighbour of incident.get(id)??[])if(unseen.delete(neighbour))pending.push(neighbour);}components.push(part);}
 const params=source.template!.parameters,shoulder=params.shoulderWidthMm/2+params.upperArmGirthMm*.025;
 const hip=params.legLengthMm+(params.heightMm*.86-70-params.legLengthMm)*.08,hem=params.legLengthMm*.1;
 const kinds=components.map(part=>{const ps=part.flatMap(i=>single.surface.faces[i].vertices.map(id=>points.get(id)!));const minX=Math.min(...ps.map(p=>p.xMm)),maxX=Math.max(...ps.map(p=>p.xMm)),minY=Math.min(...ps.map(p=>p.yMm)),maxY=Math.max(...ps.map(p=>p.yMm));
  if(minX>=shoulder-1e-7)return 'right-sleeve';if(maxX<=-shoulder+1e-7)return 'left-sleeve';
  if(minY>=hip-1e-7)return 'upper-body';
  expect(maxY).toBeCloseTo(hip,7);expect(minY).toBeCloseTo(hem,7);expect(maxY,'ankle hem stays attached through the calf').toBeGreaterThanOrEqual(params.legLengthMm*.3);return 'lower-body';
 });
 expect(kinds.sort()).toEqual(['left-sleeve','left-sleeve','lower-body','lower-body','right-sleeve','right-sleeve','upper-body','upper-body']);
 expect(single.materialDomains).toBe(components.length);
 const parents=new Map(source.faces.map(f=>[f.id,f])),originalPoints=new Map(source.vertices.map(v=>[v.id,v])),coverage=new Map<string,number>();
 for(const f of single.surface.faces){const row=single.provenance.get(f.id)!,parent=parents.get(row.faceId)!;expect(parent).toBeDefined();const [a,b,c]=row.barycentric,ratio=(b[1]-a[1])*(c[2]-a[2])-(b[2]-a[2])*(c[1]-a[1]);expect(ratio).toBeGreaterThan(0);coverage.set(parent.id,(coverage.get(parent.id)??0)+ratio);
  row.barycentric.forEach((w,i)=>{const actual=points.get(f.vertices[i])!;for(const axis of ['xMm','yMm','zMm'] as const)expect(Math.abs(actual[axis]-w.reduce((sum,n,k)=>sum+n*originalPoints.get(parent.vertices[k])![axis],0))).toBeLessThan(1e-8);});
 }
 expect(coverage.size).toBe(source.faces.length);for(const ratio of coverage.values())expect(ratio).toBeCloseTo(1,9);
 expect(source.faces.some(f=>/^(head|hand|foot)(-|$)/.test(f.region))).toBe(false);
 expect(single.surface.faces.length).toBeGreaterThan(multi.surface.faces.length);
},30000);
