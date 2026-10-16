import {it,expect} from 'vitest';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {randomUUID} from 'node:crypto';
import type {Surface,Marking} from '../packages/schema/index';
import {prepareDesignSurface} from '../apps/desktop/main/design-cuts';
import {project} from './fixtures';
import {assemblyArea} from '../packages/surface/cut-assembly';
it('unions near-touching visible colors before complementing the material face',async()=>{
 const fixture=JSON.parse(await readFile(resolve('tests/fixtures/design-touching-colors.json'),'utf8')) as {surface:Surface;markings:Marking[]},p=project();p.pieces=[];p.surface=fixture.surface;
 p.markings=fixture.markings;
 const before=structuredClone(p),working=await prepareDesignSurface(resolve('target/release/fpcad-worker.exe'),p,true,true),vv=new Map(working.surface.vertices.map(v=>[v.id,[v.xMm,v.yMm,v.zMm]])),source=assemblyArea(p.surface.vertices.map(v=>[v.xMm,v.yMm,v.zMm])),areas=new Map<string,number>();
 for(const face of working.surface.faces){const color=working.provenance.get(face.id)!.color;areas.set(color,(areas.get(color)??0)+assemblyArea(face.vertices.map(id=>vv.get(id)!)));}
 expect(p).toEqual(before);expect([...areas.values()].reduce((sum,n)=>sum+n,0)).toBeCloseTo(source,6);expect(areas.get('#eceae5')).toBeCloseTo(source*(1-.687602609649638-.21554885047655903-.0015997136327972528),6);expect(areas.get('#fefaf8')).toBeCloseTo(source*.687602609649638,6);expect(areas.get('#fcb8a4')).toBeCloseTo(source*(.21554885047655903+.0015997136327972528),6);expect(working.materialDomains).toBeGreaterThan(2);
});
