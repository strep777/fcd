import {expect,it} from 'vitest';
import type {Binding,Surface} from '../../packages/schema/index';
import {weldClosedTrimDarts} from '../../apps/desktop/main/trim-weld';

function fixture(opening=0){
 const source:Surface={id:'surface',source:'obj',topologyVersion:1,vertices:[{id:'a',xMm:0,yMm:0,zMm:0},{id:'b',xMm:10,yMm:0,zMm:0},{id:'c',xMm:10,yMm:10,zMm:0},{id:'d',xMm:0,yMm:10,zMm:0},{id:'o',xMm:5,yMm:5,zMm:0}],faces:[['a','b','o'],['b','c','o'],['c','d','o'],['d','a','o']].map((vertices,i)=>({id:'face-'+i,vertices:vertices as [string,string,string],region:'body'}))};
 // Four non-overlapping triangles cover a square. A radial slit from a to o
 // duplicates only its boundary station; all triangles retain the same tip o.
 const trim:NonNullable<Binding['trim']>={vertices:[...source.vertices.map(v=>({id:v.id,xMm:v.xMm,yMm:v.yMm})),{id:'duplicate',xMm:opening,yMm:0}],triangles:source.faces.map((f,i)=>({faceId:f.id,vertices:(i===3?['d','duplicate','o']:[...f.vertices]) as [string,string,string],barycentric:[[1,0,0],[0,1,0],[0,0,1]]})),boundary:['a','b','c','d','duplicate','o'],holes:[]};
 return{source,trim};
}
it('welds a closed trial slit while repeated shared triangle stations terminate and preserve correspondence',()=>{
 const {source,trim}=fixture();weldClosedTrimDarts(trim,source);
 expect(trim.vertices.map(v=>v.id)).toEqual(['a','b','c','d','o']);
 expect(trim.triangles.map(t=>t.vertices)).toEqual(source.faces.map(f=>f.vertices));
 expect(new Set(trim.triangles.map(t=>[...t.vertices].sort().join(':'))).size).toBe(4);
 expect(new Set(trim.triangles.map(t=>t.faceId)).size).toBe(source.faces.length);
 const uv=new Map(trim.vertices.map(v=>[v.id,v])),vertices=new Map(source.vertices.map(v=>[v.id,v])),faces=new Map(source.faces.map(f=>[f.id,f])),edges=new Map<string,string[]>();let coveredArea=0;
 for(const t of trim.triangles){
  const [a,b,c]=t.vertices.map(id=>uv.get(id)!),area=((b.xMm-a.xMm)*(c.yMm-a.yMm)-(b.yMm-a.yMm)*(c.xMm-a.xMm))/2;expect(area).toBe(25);coveredArea+=area;
  t.vertices.forEach((id,i)=>{const q=uv.get(id)!,w=t.barycentric[i],face=faces.get(t.faceId)!;expect([q.xMm,q.yMm]).toEqual(['xMm','yMm'].map(axis=>w.reduce((sum,weight,k)=>sum+weight*vertices.get(face.vertices[k])![axis as 'xMm'|'yMm'],0)));const next=t.vertices[(i+1)%3],key=[id,next].sort().join(':'),directions=edges.get(key)??[];directions.push(id+':'+next);edges.set(key,directions);});
 }
 expect(coveredArea).toBe(100);expect([...edges.values()].filter(rows=>rows.length===1)).toHaveLength(4);expect([...edges.values()].filter(rows=>rows.length===2)).toHaveLength(4);
 expect([...edges.values()].every(rows=>rows.length<=2&&(rows.length===1||rows[0]!==rows[1]))).toBe(true);
 expect(trim.vertices.length-edges.size+trim.triangles.length).toBe(1);
 // The caller subsequently rebuilds the exported outline; the weld itself
 // must keep every existing boundary reference resolved to its new identity.
 expect(trim.boundary).toEqual(['a','b','c','d','a','o']);expect(trim.boundary.every(id=>uv.has(id))).toBe(true);
 const once=structuredClone(trim);weldClosedTrimDarts(trim,source);expect(trim).toEqual(once);
});
it('retains a genuine open dart even when its two sides share the same source station',()=>{
 const {source,trim}=fixture(2),before=structuredClone(trim);weldClosedTrimDarts(trim,source);expect(trim).toEqual(before);
});
it('does not weld touching UV stations that refer to different material positions',()=>{
 const {source,trim}=fixture();trim.triangles[3].barycentric[1]=[.5,.5,0];
 const before=structuredClone(trim);weldClosedTrimDarts(trim,source);expect(trim).toEqual(before);
});
