import {expect,it} from 'vitest';
import {randomUUID} from 'node:crypto';
import type {Surface} from '../../packages/schema/index';
import {orientedPlaneSegments} from '../../packages/surface/cut-geometry';
import {refineSurface} from '../../packages/surface/refine';

// A prescribed 2 x 2 mm cloth square, triangulated around a vertex on or
// microscopically beside the section. Every physical child should remain a
// useful half-triangle; an almost duplicated section point creates a sliver.
it.each([0,5e-8,-5e-8,9.9e-8,-9.9e-8])('a section through a vertex at %s mm stays one continuous physical cut without sliver faces',offset=>{
 const mesh:Surface={id:'near-plane-cloth',source:'obj',topologyVersion:1,
  vertices:[[-1,-1],[1,-1],[1,1],[-1,1],[offset,0]].map(([xMm,yMm],i)=>({id:'v'+i,xMm,yMm,zMm:0})),
  faces:[[4,0,1],[4,1,2],[4,2,3],[4,3,0]].map((indices,i)=>({id:'f'+i,region:'cloth',vertices:indices.map(i=>'v'+i) as [string,string,string]}))};
 const before=structuredClone(mesh),physicalCuts:string[][]=[];
 for(const sign of [1,-1]){
  const cuts=orientedPlaneSegments(mesh,[sign,0,0],0,'straight opening'),refined=refineSurface(mesh,cuts,randomUUID),points=new Map(refined.surface.vertices.map(p=>[p.id,p]));
  const edges=[...refined.owned.values()].flat(),graph=new Map<string,Set<string>>();
  for(const edge of edges)for(const [a,b] of [[edge.a,edge.b],[edge.b,edge.a]]){const row=graph.get(a)??new Set<string>();row.add(b);graph.set(a,row);}
  expect(edges).toHaveLength(2);expect([...graph.values()].map(row=>row.size).sort()).toEqual([1,1,2]);
  const visited=new Set<string>(),pending=[edges[0].a];while(pending.length){const id=pending.pop()!;if(visited.has(id))continue;visited.add(id);pending.push(...graph.get(id)!);}
  expect(visited.size).toBe(graph.size);
  const ends=[...graph].filter(([,row])=>row.size===1).map(([id])=>points.get(id)!);expect(ends.map(p=>p.yMm).sort()).toEqual([-1,1]);
  for(const id of graph.keys()){const p=points.get(id)!;expect(Math.abs(p.xMm)).toBeLessThan(1e-7);expect(p.zMm).toBe(0);}
  const lengths=edges.map(e=>{const a=points.get(e.a)!,b=points.get(e.b)!;return Math.hypot(a.xMm-b.xMm,a.yMm-b.yMm,a.zMm-b.zMm);});
  expect(lengths.reduce((sum,n)=>sum+n,0)).toBeCloseTo(2,12);expect(Math.min(...lengths)).toBeGreaterThan(.99);
  const areas=refined.surface.faces.map(face=>{const [a,b,c]=face.vertices.map(id=>points.get(id)!);return Math.abs((b.xMm-a.xMm)*(c.yMm-a.yMm)-(b.yMm-a.yMm)*(c.xMm-a.xMm))/2;});
  expect(areas).toHaveLength(6);expect(Math.min(...areas)).toBeGreaterThan(.49);expect(areas.reduce((sum,n)=>sum+n,0)).toBeCloseTo(4,12);
  physicalCuts.push(edges.map(e=>[e.a,e.b].map(id=>{const p=points.get(id)!;return [p.xMm,p.yMm,p.zMm].join(',');}).sort().join('|')).sort());
 }
 expect(physicalCuts[0]).toEqual(physicalCuts[1]);expect(mesh).toEqual(before);
});
