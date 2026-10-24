import {expect,it} from 'vitest';
import {randomUUID} from 'node:crypto';
import type {Surface} from '../../packages/schema/index';
import {refineSurface} from '../../packages/surface/refine';
import {composeMaterialStation} from '../../packages/surface/design-cuts';

it('retains a resolvable tiny shoulder intersection without moving it across an adjacent parent',()=>{
 const vertices=[[-330.9002685546875,1428.370361328125,-60.119903564453125],[-338.68035888671875,1441.8458251953125,-58.07136917114258],[-239.99977111816406,1478.0001220703125,-63.84419250488281],[-248.2620391845703,1492.310302734375,-61.66870880126953]].map(([xMm,yMm,zMm])=>({id:randomUUID(),xMm,yMm,zMm}));
 const faces=[[0,1,2],[1,3,2]].map(ids=>({id:randomUUID(),vertices:ids.map(i=>vertices[i].id) as [string,string,string],region:'arm-left'}));
 const source:Surface={id:randomUUID(),source:'obj',topologyVersion:1,vertices,faces},before=structuredClone(source);
 const result=refineSurface(source,[{faceId:faces[0].id,a:[0,.00000231942108486205,.9999976805789151],b:[.000002517938211474916,0,.9999974820617885],owner:'shoulder'}]);
 expect(source).toEqual(before);
 const output=new Map(result.surface.vertices.map(p=>[p.id,p]));
 for(const v of source.vertices)expect(output.get(v.id)).toEqual(v);
 for(const [parent,children]of result.children){
  const face=faces.find(f=>f.id===parent)!,corners=face.vertices.map(id=>output.get(id)!);let area=0;
  for(const child of children){
   const [a,b,c]=child.triangle;area+=((b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]))/1e6;
   child.triangle.forEach((p,i)=>{
    const w=composeMaterialStation(p,[[1,0,0],[0,1,0],[0,0,1]]),v=output.get(child.face.vertices[i])!;
    for(const axis of ['xMm','yMm','zMm'] as const)expect(Math.abs(v[axis]-w.reduce((sum,n,k)=>sum+n*corners[k][axis],0))).toBeLessThan(1e-9);
   });
  }
  expect(area).toBeCloseTo(1,12);
 }
 expect(result.owned.get('shoulder')).toHaveLength(1);
});
