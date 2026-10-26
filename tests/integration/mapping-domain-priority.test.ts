import {readFileSync} from 'node:fs';
import {expect,it} from 'vitest';
import {mapToSurface,mapFromSurface} from '../../packages/surface/mapping';
import type {Binding,Surface} from '../../packages/schema/index';

function foldedPair(reverseIds=false,reverseTriangles=false){
 const ids=['00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000002'];
 if(reverseIds)ids.reverse();
 const surface:Surface={id:'folded-surface',topologyVersion:1,source:'obj',vertices:[
  {id:'a',xMm:0,yMm:0,zMm:0},{id:'b',xMm:-100,yMm:0,zMm:0},
  {id:'c',xMm:0,yMm:100,zMm:0},{id:'d',xMm:100,yMm:0,zMm:100}],
 faces:[{id:ids[0],vertices:['a','b','c'],region:'left'},{id:ids[1],vertices:['a','d','c'],region:'right'}]};
 const triangles=surface.faces.map(face=>({faceId:face.id,vertices:face.vertices,barycentric:[[1,0,0],[0,1,0],[0,0,1]] as [[number,number,number],[number,number,number],[number,number,number]]}));
 if(reverseTriangles)triangles.reverse();
 const uv=[{id:'a',xMm:0,yMm:0},{id:'b',xMm:-100,yMm:0},{id:'c',xMm:0,yMm:100},{id:'d',xMm:100,yMm:0}];
 const binding:Binding={pieceId:'folded-piece',surfaceId:surface.id,topologyVersion:1,geometryHash:'0'.repeat(64),surfaceHash:'0'.repeat(64),
  report:{faceIds:ids,uv:uv.map(({id,...point})=>({vertexId:id,...point})),boundary:['b','a','d','c'],
   areaErrorMax:1-Math.SQRT1_2,edgeErrorMax:1-Math.SQRT1_2,distortionMean:.3,distortionP95:.3,distortionMax:.3,status:'needsReview'},
  trim:{vertices:uv,triangles,boundary:['b','a','d','c'],holes:[]}};
 return {surface,binding,rightFace:ids[1]};
}

it.each([[false,false],[true,false],[false,true],[true,true]])('a strict interior point stays on the actual folded face regardless of UUID or triangle order (%s,%s)',(reverseIds,reverseTriangles)=>{
 const {surface,binding,rightFace}=foldedPair(reverseIds,reverseTriangles),point={xMm:1e-6,yMm:25};
 const result=mapToSurface(surface,binding,point);
 expect(result).not.toBeNull();
 // Prescribed analytic geometry: the right sheet is z=x, while the left is
 // z=0. The query is strictly inside the right triangle, although extrapolation
 // tolerance can also admit it on the neighboring left triangle.
 expect(result!.faceId).toBe(rightFace);
 expect(Math.abs(result!.position.xMm-point.xMm)).toBeLessThan(1e-11);
 expect(Math.abs(result!.position.yMm-point.yMm)).toBeLessThan(1e-11);
 expect(Math.abs(result!.position.zMm-point.xMm)).toBeLessThan(1e-11);
 expect(result!.barycentric.every(w=>w>=0&&w<=1)).toBe(true);
 const back=mapFromSurface(binding,result!.faceId,result!.barycentric,surface);
 expect(back).not.toBeNull();expect(Math.hypot(back!.xMm-point.xMm,back!.yMm-point.yMm)).toBeLessThan(1e-11);
});

it('the exact shared boundary has a valid inverse, while genuinely outside inputs remain outside',()=>{
 const {surface,binding}=foldedPair();
 const edge=mapToSurface(surface,binding,{xMm:0,yMm:25});expect(edge).not.toBeNull();
 expect(edge!.barycentric.every(w=>w>=0&&w<=1)).toBe(true);
 expect(mapFromSurface(binding,edge!.faceId,edge!.barycentric,surface)).toEqual({xMm:0,yMm:25});
 expect(mapToSurface(surface,binding,{xMm:-101,yMm:25})).toBeNull();
 expect(mapFromSurface(binding,surface.faces[0].id,[-.01,.51,.5],surface)).toBeNull();
});

it('every captured real-native trim interior retains a valid closed-domain 2D/3D round trip',()=>{
 const fixture=JSON.parse(readFileSync(new URL('../fixtures/padded-mapping-domain-case.json',import.meta.url),'utf8')) as {surface:Surface;binding:Binding;samples:{point:{xMm:number;yMm:number};expectedWorld:number[]}[]};
 for(const reversed of [false,true]){
  const binding=structuredClone(fixture.binding);if(reversed)binding.trim!.triangles.reverse();
  for(const sample of fixture.samples){
   const result=mapToSurface(fixture.surface,binding,sample.point);expect(result).not.toBeNull();
   expect(result!.barycentric.every(w=>Number.isFinite(w)&&w>=0&&w<=1)).toBe(true);
   expect(Math.abs(result!.barycentric.reduce((s,w)=>s+w,0)-1)).toBeLessThanOrEqual(1e-15);
   expect(Math.hypot(result!.position.xMm-sample.expectedWorld[0],result!.position.yMm-sample.expectedWorld[1],result!.position.zMm-sample.expectedWorld[2])).toBeLessThanOrEqual(1e-4);
   const back=mapFromSurface(binding,result!.faceId,result!.barycentric,fixture.surface);expect(back).not.toBeNull();
   expect(Math.hypot(back!.xMm-sample.point.xMm,back!.yMm-sample.point.yMm)).toBeLessThanOrEqual(1e-4);
  }
 }
});
