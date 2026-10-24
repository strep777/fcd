import {readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {expect,it} from 'vitest';
import type {Surface} from '../../packages/schema/index';
import {sectionDesignDomain} from '../../packages/surface/design-section';

it('a wrist section cannot detach a microscopic island while balancing two large halves',()=>{
 const saved=JSON.parse(readFileSync(new URL('../fixtures/wrist-section.json',import.meta.url),'utf8')) as {vertices:number[][];faces:number[][]};
 const vertices=saved.vertices.map(([xMm,yMm,zMm])=>({id:randomUUID(),xMm,yMm,zMm})),surface:Surface={id:randomUUID(),source:'obj',topologyVersion:1,vertices,faces:saved.faces.map(f=>({id:randomUUID(),vertices:f.map(i=>vertices[i].id) as [string,string,string],region:'wrist'}))},before=structuredClone(surface);
 const result=sectionDesignDomain(surface,surface.faces,randomUUID);expect(result).toBeDefined();expect(surface).toEqual(before);
 const points=new Map(result!.surface.vertices.map(p=>[p.id,p]));
 const area=(faces:Surface['faces'])=>faces.reduce((sum,f)=>{const [a,b,c]=f.vertices.map(id=>points.get(id)!),u=[b.xMm-a.xMm,b.yMm-a.yMm,b.zMm-a.zMm],v=[c.xMm-a.xMm,c.yMm-a.yMm,c.zMm-a.zMm];return sum+Math.hypot(u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0])/2;},0);
 expect(Math.min(...result!.parts.map(area))).toBeGreaterThan(500);
 const ids=result!.parts.flatMap(part=>part.map(f=>f.id));expect(new Set(ids).size).toBe(ids.length);expect(new Set(ids)).toEqual(new Set(result!.surface.faces.map(f=>f.id)));
 // Every parent is still covered exactly: rejecting a bad trial cannot drop
 // the bump or quietly omit triangles from the garment.
 for(const children of result!.children.values()){
  const ratio=children.reduce((sum,c)=>{const [a,b,d]=c.triangle;return sum+((b[0]-a[0])*(d[1]-a[1])-(b[1]-a[1])*(d[0]-a[0]))/1e6;},0);expect(ratio).toBeCloseTo(1,10);
 }
});
