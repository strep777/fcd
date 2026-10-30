import {expect,it} from 'vitest';
import {randomUUID} from 'node:crypto';
import {generateSpecies,speciesDefaults} from '../../apps/desktop/main/species';
import {assembleSpecies} from '../../apps/desktop/main/species-assembly';
import {openMaterialMesh,type MaterialFace} from '../../packages/surface/design-cuts';

it('visible sleeve materials avoid premature template sections while single-material cloth keeps only a continuous longitudinal front/back opening',async()=>{
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
 // A single-cloth padded garment keeps its collar, sleeve and ankle
 // openings; only the continuous front/back side opening is introduced.
 const points=new Map(single.surface.vertices.map(v=>[v.id,v]));
 const incident=new Map<string,number[]>();
 single.surface.faces.forEach((f,i)=>f.vertices.forEach(id=>incident.set(id,[...(incident.get(id)??[]),i])));
 const unseen=new Set(single.surface.faces.map((_,i)=>i)),components:number[][]=[];
 while(unseen.size){const first=unseen.values().next().value!,pending=[first],part:number[]=[];unseen.delete(first);while(pending.length){const i=pending.pop()!;part.push(i);for(const id of single.surface.faces[i].vertices)for(const neighbour of incident.get(id)??[])if(unseen.delete(neighbour))pending.push(neighbour);}components.push(part);}
 const sourceMinY=Math.min(...source.vertices.map(v=>v.yMm)),sourceMaxY=Math.max(...source.vertices.map(v=>v.yMm));
 expect(components.length).toBeGreaterThanOrEqual(1);expect(components.length).toBeLessThanOrEqual(2);
 for(const part of components){
  const ps=part.flatMap(i=>single.surface.faces[i].vertices.map(id=>points.get(id)!));
  expect(Math.min(...ps.map(p=>p.yMm)),'the ankle hem remains connected to the whole cloth domain').toBeCloseTo(sourceMinY,7);
  expect(Math.max(...ps.map(p=>p.yMm)),'the cloth remains continuous from the ankle to the collar').toBeCloseTo(sourceMaxY,7);
  const minZ=Math.min(...ps.map(p=>p.zMm)),maxZ=Math.max(...ps.map(p=>p.zMm));
  expect(minZ < -1e-7 && maxZ > 1e-7,'a front/back cloth layer must not cross its longitudinal opening').toBe(false);
 }
 const originalIds=new Set(source.vertices.map(v=>v.id)),newPoints=single.surface.vertices.filter(v=>!originalIds.has(v.id));
 expect(newPoints.length).toBeGreaterThan(0);
 for(const point of newPoints)expect(Math.abs(point.zMm),'new side-opening stations must lie on the longitudinal plane, without shoulder/hip/ankle rings').toBeLessThan(1e-7);
 expect(single.materialDomains).toBe(components.length);
 const parents=new Map(source.faces.map(f=>[f.id,f])),originalPoints=new Map(source.vertices.map(v=>[v.id,v])),coverage=new Map<string,number>();
 for(const f of single.surface.faces){const row=single.provenance.get(f.id)!,parent=parents.get(row.faceId)!;expect(parent).toBeDefined();const [a,b,c]=row.barycentric,ratio=(b[1]-a[1])*(c[2]-a[2])-(b[2]-a[2])*(c[1]-a[1]);expect(ratio).toBeGreaterThan(0);coverage.set(parent.id,(coverage.get(parent.id)??0)+ratio);
  row.barycentric.forEach((w,i)=>{const actual=points.get(f.vertices[i])!;for(const axis of ['xMm','yMm','zMm'] as const)expect(Math.abs(actual[axis]-w.reduce((sum,n,k)=>sum+n*originalPoints.get(parent.vertices[k])![axis],0))).toBeLessThan(1e-8);});
 }
 expect(coverage.size).toBe(source.faces.length);for(const ratio of coverage.values())expect(ratio).toBeCloseTo(1,9);
 expect(source.faces.some(f=>/^(head|hand|foot)(-|$)/.test(f.region))).toBe(false);
 expect(single.surface.faces.length).toBeGreaterThan(multi.surface.faces.length);
},30000);
