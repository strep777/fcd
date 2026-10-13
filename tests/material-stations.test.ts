import {it,expect} from 'vitest';
import {randomUUID} from 'node:crypto';
import type {Bary} from '../packages/surface/refine';
import type {Surface} from '../packages/schema/index';
import {canonicalMaterialStations} from '../packages/surface/material-stations';
const triangle=():Surface=>{const vertices=[[0,0],[20,0],[0,20]].map(([xMm,yMm])=>({id:randomUUID(),xMm,yMm,zMm:0}));return {id:randomUUID(),topologyVersion:1,source:'obj',vertices,faces:[{id:randomUUID(),vertices:vertices.map(v=>v.id) as [string,string,string],region:'body'}]};};
const bary=(x:number,y:number):Bary=>[1-(x+y)/20,x/20,y/20];
const area=(r:Bary[])=>r.reduce((sum,a,i)=>{const b=r[(i+1)%r.length];return sum+a[1]*b[2]-a[2]*b[1];},0)*200;
it('collapses submicron duplicate intersections within measured movement and area budgets',()=>{
 const source=triangle(),tiles=[{faceId:source.faces[0].id,color:'#ff0000',rings:[[bary(0,0),bary(10,0),bary(10,1.2e-8)]]}],before=structuredClone(tiles),result=canonicalMaterialStations(source,tiles);
 expect(tiles).toEqual(before);expect(result.tiles[0].rings).toEqual([]);expect(result.maxShiftMm).toBeLessThanOrEqual(1e-6);expect(result.areaErrorMm2).toBeCloseTo(6e-8,12);expect(result.areaErrorMm2).toBeLessThan(1e-6);
});
it('retains a real 0.035mm hole and island with their signed material areas',()=>{
 const source=triangle(),outer=[[1,1],[12,1],[1,12]].map(([x,y])=>bary(x,y)),hole=[[4,4],[4,4.035],[4.035,4.035],[4.035,4]].map(([x,y])=>bary(x,y)),island=[[6,6],[6.035,6],[6.035,6.035],[6,6.035]].map(([x,y])=>bary(x,y)),tiles=[{faceId:source.faces[0].id,color:'#ff0000',rings:[outer,hole]},{faceId:source.faces[0].id,color:'#0000ff',rings:[island]}],before=structuredClone(tiles),result=canonicalMaterialStations(source,tiles);
 expect(tiles).toEqual(before);expect(result.tiles[0].rings).toHaveLength(2);expect(result.tiles[1].rings).toHaveLength(1);expect(area(result.tiles[0].rings[1])).toBeCloseTo(-(.035**2),12);expect(area(result.tiles[1].rings[0])).toBeCloseTo(.035**2,12);expect(result.areaErrorMm2).toBeLessThan(1e-10);
});

it('projects almost-on-original-edge stations while measuring from the unchanged inputs',()=>{
 const source=triangle(),ring=[[1,5e-7],[10,5e-7],[5,5]].map(([x,y])=>bary(x,y)),tiles=[{faceId:source.faces[0].id,color:'#ff0000',rings:[ring]}],before=structuredClone(tiles),result=canonicalMaterialStations(source,tiles);
 expect(tiles).toEqual(before);expect(result.tiles[0].rings[0][0][2]).toBe(0);expect(result.tiles[0].rings[0][1][2]).toBe(0);expect(result.maxShiftMm).toBeCloseTo(5e-7,12);expect(result.perColor[0].errorMm2).toBeCloseTo(2.25e-6,11);
});
it('normalizes an interior triangulation ear without moving any sample beyond the physical budget',()=>{
 const source=triangle(),ring=[[1,1],[3,.8],[5,1+2e-8],[7,.8],[9,1],[5,8]].map(([x,y])=>bary(x,y)),tiles=[{faceId:source.faces[0].id,color:'#ff0000',rings:[ring]}],before=structuredClone(tiles),indices=()=>[[0,1,2],[2,3,4],[0,2,4],[0,4,5]],result=canonicalMaterialStations(source,tiles,1e-6,indices);
 expect(tiles).toEqual(before);expect(result.tiles[0].rings[0]).toHaveLength(6);expect(result.tiles[0].rings[0][2][2]).toBeCloseTo(1/20,13);expect(result.maxShiftMm).toBeLessThanOrEqual(1e-6);expect(result.areaErrorMm2).toBeLessThan(1e-6);
});

it('does not delete an unmoved small ring merely because its area is below the triangulation floor',()=>{
 const source=triangle(),ring=[[0,20],[0,19.99994],[.00012,19.99988]].map(([x,y])=>bary(x,y)),tiles=[{faceId:source.faces[0].id,color:'#ff0000',rings:[ring]}],result=canonicalMaterialStations(source,tiles);
 expect(area(ring)).toBeLessThan(1e-8);expect(result.tiles[0].rings).toHaveLength(1);expect(result.areaErrorMm2).toBeLessThan(1e-12);
});

it('shares a feasible edge station after accounting for perpendicular projection movement',()=>{
 const source=triangle(),first=bary(10,0),second=bary(10-1.9e-6,3.5e-7),tiles=[{faceId:source.faces[0].id,color:'#ff0000',rings:[[first,bary(15,0),bary(10,5)]]},{faceId:source.faces[0].id,color:'#0000ff',rings:[[second,bary(5,5),bary(5,0)]]}],before=structuredClone(tiles),result=canonicalMaterialStations(source,tiles);
 expect(tiles).toEqual(before);expect(result.tiles[0].rings[0][0]).toEqual(result.tiles[1].rings[0][0]);expect(result.maxShiftMm).toBeLessThanOrEqual(1e-6);expect(result.tiles[0].rings[0][0][2]).toBe(0);
});
