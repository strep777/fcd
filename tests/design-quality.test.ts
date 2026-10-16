import {it,expect} from 'vitest';
import {designQualityFailure,seamPathCount,splitDesignDomain} from '../packages/surface/design-partition';
import {gridMesh} from './large-mesh-fixture';
it('retains hard local manufacturing limits while the P95 review gate remains a warning',()=>{
 const within={distortionMax:.15,areaErrorMax:.15,edgeErrorMax:.1,distortionP95:.08};
 expect(designQualityFailure(within)).toBe(false);
 for(const key of ['distortionMax','areaErrorMax','edgeErrorMax'] as const)expect(designQualityFailure({...within,[key]:within[key]+.000001})).toBe(true);
});
it('counts final seam paths once, including same-panel darts and closed loops',()=>{
 expect(seamPathCount([['a','b'],['b','c'],['b','a']])).toBe(1);
 expect(seamPathCount([['a','b'],['b','c'],['c','a']])).toBe(1);
 expect(seamPathCount([['a','b'],['b','c'],['b','d']])).toBe(3);
});
it('uses a connected physical split only when the caller identifies a failed domain',()=>{
 const mesh=gridMesh(10,10),parts=splitDesignDomain(mesh,mesh.faces);
 expect(parts).toHaveLength(2);expect(parts.flat().map(f=>f.id).sort()).toEqual(mesh.faces.map(f=>f.id).sort());
 const vertices=new Map(mesh.vertices.map(v=>[v.id,v]));for(const part of parts){const xs=part.flatMap(f=>f.vertices.map(id=>vertices.get(id)!.xMm));expect(Math.min(...xs)>=50||Math.max(...xs)<=50).toBe(true);}
});
