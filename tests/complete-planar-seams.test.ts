import {expect,it} from 'vitest';
import {completePlanarSeams} from '../packages/surface/complete-planar-seams';
import {materialCutMesh,openDesignSeams} from '../packages/surface/design-cuts';
import {edgeKey} from '../packages/surface/refine';
import {planarGrid,meshArea,faceComponents} from './fixtures/planar-seams';

it.each([
 ['a boundary slit',[['v0_2','v1_2']],1],
 ['an interior short line',[['v1_2','v2_2']],2],
] as const)('completes %s into physical planar panels without changing source geometry',(name,edges,seams)=>{
 const source=planarGrid();source.cutConstraints=edges.map(([a,b])=>({a,b,locked:true}));const before=structuredClone(source),completed=completePlanarSeams(source),opened=openDesignSeams(completed.surface);
 expect(completed.seams).toBe(seams);expect(source).toEqual(before);expect(completed.surface.vertices).toEqual(source.vertices);expect(completed.surface.faces).toEqual(source.faces);
 expect(completed.surface.cutConstraints).toEqual(expect.arrayContaining(source.cutConstraints));expect(meshArea(opened)).toBe(meshArea(source));expect(faceComponents(opened)).toHaveLength(2);
 const again=completePlanarSeams(completed.surface);expect(again.seams).toBe(0);expect(again.surface).toBe(completed.surface);
});
it('retains unlocked hints and leaves an existing boundary-to-boundary seam alone',()=>{
 const source=planarGrid();source.cutConstraints=[0,1,2,3].map(x=>({a:`v${x}_2`,b:`v${x+1}_2`,locked:true}));source.cutConstraints.push({a:'v1_1',b:'v2_1',locked:false});
 const result=completePlanarSeams(source);expect(result.surface).toBe(source);expect(result.seams).toBe(0);
});
it('leaves a genuinely curved dart and unconstrained planar sheet unchanged',()=>{
 const source=planarGrid();expect(completePlanarSeams(source).surface).toBe(source);source.cutConstraints=[{a:'v0_2',b:'v1_2',locked:true}];source.vertices.find(v=>v.id==='v2_2')!.zMm=8;
 const before=structuredClone(source),result=completePlanarSeams(source);expect(result.surface).toBe(source);expect(result.seams).toBe(0);expect(source).toEqual(before);
});
it('does not complete user slits when automatic topology cuts are disabled',()=>{
 const source=planarGrid();source.cutConstraints=[{a:'v0_2',b:'v1_2',locked:true}];const before=structuredClone(source),result=materialCutMesh(source,[],()=>crypto.randomUUID(),false),uncompleted=openDesignSeams(source);
 expect(source).toEqual(before);expect(result.topologySeams).toBe(0);expect(result.surface.vertices).toHaveLength(uncompleted.vertices.length);expect(faceComponents(result.surface)).toHaveLength(1);
});
it('never erases original cuts or adds non-mesh shortcuts while completing nearby slits',()=>{
 const source=planarGrid();source.cutConstraints=[{a:'v0_1',b:'v1_1',locked:true},{a:'v0_3',b:'v1_3',locked:true}];const original=new Set(source.cutConstraints.map(e=>edgeKey(e.a,e.b))),meshEdges=new Set(source.faces.flatMap(f=>f.vertices.map((a,i)=>edgeKey(a,f.vertices[(i+1)%3])))),result=completePlanarSeams(source);
 expect(result.seams).toBe(2);for(const key of original)expect(result.surface.cutConstraints!.some(e=>edgeKey(e.a,e.b)===key)).toBe(true);for(const e of result.surface.cutConstraints!)expect(meshEdges.has(edgeKey(e.a,e.b))).toBe(true);expect(meshArea(openDesignSeams(result.surface))).toBe(meshArea(source));
});
it('does not finish a planar slit at a hole, which would leave coincident manufacturing banks',()=>{
 const source=planarGrid([0,20,30,40,50,60,80],true);source.cutConstraints=[{a:'v0_3',b:'v1_3',locked:true}];const result=completePlanarSeams(source),opened=openDesignSeams(result.surface);
 expect(meshArea(opened)).toBe(meshArea(source));expect(faceComponents(opened)).toHaveLength(2);
});
it.each([
 ['a hole-to-interior slit',[['v2_3','v1_3']],2],
 ['an existing hole-to-outer bridge',[['v2_3','v1_3'],['v1_3','v0_3']],1],
] as const)('extends %s to form separating paths rather than leaving coincident banks',(name,edges,seams)=>{
 const source=planarGrid([0,20,30,40,50,60,80],true);source.cutConstraints=edges.map(([a,b])=>({a,b,locked:true}));const before=structuredClone(source),result=completePlanarSeams(source),opened=openDesignSeams(result.surface);
 expect(result.seams).toBe(seams);expect(source).toEqual(before);expect(meshArea(opened)).toBe(meshArea(source));expect(faceComponents(opened)).toHaveLength(2);expect(result.surface.cutConstraints).toEqual(expect.arrayContaining(source.cutConstraints));
 const again=completePlanarSeams(result.surface);expect(again.seams).toBe(0);expect(again.surface).toBe(result.surface);
});
it('does not add seams to an annulus already separated by two complete outer-to-hole paths',()=>{
 const source=planarGrid([0,20,30,40,50,60,80],true);source.cutConstraints=[['v0_3','v1_3'],['v1_3','v2_3'],['v4_3','v5_3'],['v5_3','v6_3']].map(([a,b])=>({a,b,locked:true}));
 expect(faceComponents(openDesignSeams(source))).toHaveLength(2);const result=completePlanarSeams(source);expect(result.seams).toBe(0);expect(result.surface).toBe(source);
});
