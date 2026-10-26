import {readFileSync} from 'node:fs';
import {expect,it} from 'vitest';
import {mapFromSurface,mapToSurface} from '../../packages/surface/mapping';
import type {Binding,Surface} from '../../packages/schema/index';

type Bary=[number,number,number];
type Fixture={surface:Surface;pieceId:string;trim:Pick<NonNullable<Binding['trim']>,'vertices'|'triangles'>;cases:{name:string;faceId:string;triangleVertices:string[]}[]};
const fixture=JSON.parse(readFileSync(new URL('../fixtures/dart-bank-mapping-roundtrip.json',import.meta.url),'utf8')) as Fixture;
const limitMm=1e-4;
const weighted=(points:number[][],weights:Bary)=>points[0].map((_,axis)=>weights.reduce((sum,weight,i)=>sum+weight*points[i][axis],0));
const distance=(a:number[],b:number[])=>Math.hypot(...a.map((n,i)=>n-b[i]));
function bindingForCase():Binding{
 // Only two original faces and their actual five trim triangles were retained.
 // The report/hash placeholders satisfy the mapping API's type; this reduction
 // is never used as an accepted manufacturing candidate or quality certificate.
 const trim=structuredClone(fixture.trim),boundary=[...trim.triangles[0].vertices];
 return {pieceId:fixture.pieceId,surfaceId:fixture.surface.id,topologyVersion:fixture.surface.topologyVersion,geometryHash:'0'.repeat(64),surfaceHash:'0'.repeat(64),trim:{...trim,boundary,holes:[]},report:{faceIds:fixture.surface.faces.map(face=>face.id),uv:trim.vertices.map(({id,...point})=>({vertexId:id,...point})),boundary,areaErrorMax:0,edgeErrorMax:0,distortionMean:0,distortionP95:0,distortionMax:0,status:'acceptable'}};
}

it.each(['captured','reversed triangles','reversed storage','rotated triangle corners'] as const)('both captured narrow dart banks retain their actual paper position (%s)',layout=>{
 const surface=structuredClone(fixture.surface),binding=bindingForCase();
 if(layout==='reversed triangles')binding.trim!.triangles.reverse();
 if(layout==='reversed storage'){surface.faces.reverse();surface.vertices.reverse();binding.trim!.vertices.reverse();binding.report.faceIds.reverse();binding.report.uv.reverse();}
 if(layout==='rotated triangle corners')for(const triangle of binding.trim!.triangles){triangle.vertices=[triangle.vertices[1],triangle.vertices[2],triangle.vertices[0]];triangle.barycentric=[triangle.barycentric[1],triangle.barycentric[2],triangle.barycentric[0]];}
 const before=structuredClone({surface,binding}),uv=new Map(fixture.trim.vertices.map(vertex=>[vertex.id,[vertex.xMm,vertex.yMm]])),world=new Map(surface.vertices.map(vertex=>[vertex.id,[vertex.xMm,vertex.yMm,vertex.zMm]]));
 // These are strict interiors, not points exactly on a cut bank where the
 // same physical station legitimately has two paper positions. The original
 // first-tolerance-hit implementation lost 211/214 mm on these real samples.
 for(const cases of [fixture.cases,[...fixture.cases].reverse()])for(const sample of cases){
  const triangle=fixture.trim.triangles.find(triangle=>triangle.faceId===sample.faceId&&triangle.vertices.every((id,i)=>id===sample.triangleVertices[i]))!,source=surface.faces.find(face=>face.id===sample.faceId)!;
  expect(triangle).toBeDefined();
  for(const local of [[1/3,1/3,1/3],[.6,.2,.2],[.2,.6,.2]] as Bary[]){
   // Expectations use the saved coordinates and an independent affine sum,
   // with no production triangle selection or barycentric solver involved.
   const expectedUv=weighted(triangle.vertices.map(id=>uv.get(id)!),local),sourceWeights=weighted(triangle.barycentric,local) as Bary,expectedWorld=weighted(source.vertices.map(id=>world.get(id)!),sourceWeights);
   const from=mapFromSurface(binding,sample.faceId,sourceWeights,surface);
   expect(from,sample.name).not.toBeNull();
   expect(distance([from!.xMm,from!.yMm],expectedUv),sample.name).toBeLessThanOrEqual(limitMm);
   const to=mapToSurface(surface,binding,{xMm:expectedUv[0],yMm:expectedUv[1]});
   expect(to,sample.name).not.toBeNull();expect(to!.faceId).toBe(sample.faceId);
   expect(to!.barycentric.every(value=>Number.isFinite(value)&&value>=0&&value<=1)).toBe(true);
   expect(Math.abs(to!.barycentric.reduce((sum,n)=>sum+n,0)-1)).toBeLessThanOrEqual(1e-15);
   expect(distance([to!.position.xMm,to!.position.yMm,to!.position.zMm],expectedWorld)).toBeLessThanOrEqual(limitMm);
   const backUv=mapFromSurface(binding,to!.faceId,to!.barycentric,surface),backWorld=mapToSurface(surface,binding,from!);
   expect(backUv).not.toBeNull();expect(backWorld).not.toBeNull();
   expect(distance([backUv!.xMm,backUv!.yMm],expectedUv)).toBeLessThanOrEqual(limitMm);
   expect(distance([backWorld!.position.xMm,backWorld!.position.yMm,backWorld!.position.zMm],expectedWorld)).toBeLessThanOrEqual(limitMm);
  }
 }
 expect({surface,binding}).toEqual(before);
});

it('the reduced real map refuses exterior, invalid and stale queries without projecting to another bank',()=>{
 const binding=bindingForCase(),surface=fixture.surface,faceId=fixture.cases[0].faceId;
 const outside={xMm:Math.max(...fixture.trim.vertices.map(vertex=>vertex.xMm))+10000,yMm:Math.max(...fixture.trim.vertices.map(vertex=>vertex.yMm))+10000};
 expect(mapToSurface(surface,binding,outside)).toBeNull();
 for(const weights of [[-.01,.51,.5],[.2,.2,.2],[Number.NaN,.5,.5]] as Bary[])expect(mapFromSurface(binding,faceId,weights,surface)).toBeNull();
 const point={xMm:fixture.trim.vertices[0].xMm,yMm:fixture.trim.vertices[0].yMm};
 expect(mapToSurface({...surface,topologyVersion:surface.topologyVersion+1},binding,point)).toBeNull();
 expect(mapFromSurface(binding,faceId,[.2,.3,.5],{...surface,topologyVersion:surface.topologyVersion+1})).toBeNull();
 expect(mapFromSurface(binding,faceId,[.2,.3,.5],{...surface,id:binding.pieceId})).toBeNull();
});

it('the original untrimmed face mapping keeps its independent affine result',()=>{
 const binding=bindingForCase(),source=fixture.surface.faces[0],surface={...fixture.surface,faces:[source]};
 delete binding.trim;
 binding.report.faceIds=[source.id];binding.report.boundary=[...source.vertices];
 binding.report.uv=source.vertices.map((vertexId,i)=>({vertexId,xMm:[0,100,0][i],yMm:[0,0,100][i]}));
 const weights:Bary=[.2,.3,.5],point=mapFromSurface(binding,source.id,weights,surface);
 expect(point).toEqual({xMm:30,yMm:50});
 const hit=mapToSurface(surface,binding,point!);expect(hit).not.toBeNull();
 const positions=new Map(surface.vertices.map(vertex=>[vertex.id,[vertex.xMm,vertex.yMm,vertex.zMm]])),expected=weighted(source.vertices.map(id=>positions.get(id)!),weights);
 expect(distance([hit!.position.xMm,hit!.position.yMm,hit!.position.zMm],expected)).toBeLessThanOrEqual(limitMm);
});
