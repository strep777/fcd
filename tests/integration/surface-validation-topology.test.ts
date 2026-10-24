import {expect,it} from 'vitest';
import {randomUUID} from 'node:crypto';
import {validateSurface} from '../../apps/desktop/main/surface';
import type {Surface} from '../../packages/schema';

function mesh(points:number[][],triangles:number[][]):Surface{
 const vertices=points.map(([xMm,yMm,zMm])=>({id:randomUUID(),xMm,yMm,zMm}));
 return {id:randomUUID(),source:'obj',topologyVersion:1,vertices,faces:triangles.map(indices=>({id:randomUUID(),region:'test',vertices:indices.map(index=>vertices[index].id) as [string,string,string]}))};
}
const square=()=>mesh([[0,0,0],[100,0,0],[100,100,0],[0,100,0]],[[0,1,2],[0,2,3]]);
const tetra=()=>mesh([[0,0,0],[100,0,0],[0,100,0],[0,0,100]],[[0,2,1],[0,1,3],[0,3,2],[1,2,3]]);
const assembly={algorithm:'manifold-union-3.5.4' as const,sourceHash:'source',components:1 as const,volumeMm3:1,toleranceMm:0,inputFaces:4,measurements:[]};
function permutations<T>(values:T[]):T[][]{return values.length?values.flatMap((value,index)=>permutations(values.filter((_,i)=>i!==index)).map(rest=>[value,...rest])):[[]];}

it('accepts the same closed topology under all vertex storage orders without changing coordinates or identities',()=>{
 const source=tetra();source.assembly=assembly;
 for(const vertices of permutations(source.vertices)){
  const input={...source,vertices,faces:[...source.faces].reverse()},before=structuredClone(input);
  expect(()=>validateSurface(input)).not.toThrow();expect(input).toEqual(before);
 }
});

it('preserves distinct orientation, third-face, missing-vertex, degenerate and duplicate-identity failures',()=>{
 let input=square();input.faces[1].vertices.reverse();expect(()=>validateSurface(input)).toThrow('MESH_ORIENTATION');
 input=square();input.faces.push({...input.faces[0],id:randomUUID(),vertices:[...input.faces[0].vertices].reverse() as [string,string,string]});expect(()=>validateSurface(input)).toThrow('NONMANIFOLD_MESH');
 input=square();input.faces[0].vertices[0]=randomUUID();expect(()=>validateSurface(input)).toThrow('INVALID_MESH');
 input=square();input.vertices[2]={...input.vertices[2],xMm:50,yMm:0};expect(()=>validateSurface(input)).toThrow('DEGENERATE_MESH');
 input=square();input.vertices[1].id=input.vertices[0].id;expect(()=>validateSurface(input)).toThrow('INVALID_MESH');
 input=square();input.faces[1].id=input.faces[0].id;expect(()=>validateSurface(input)).toThrow('INVALID_MESH');
});

it('retains closed-assembly and connected-component validation',()=>{
 const open=tetra();open.assembly=assembly;open.faces.pop();expect(()=>validateSurface(open)).toThrow('NONMANIFOLD_MESH');
 const a=tetra(),b=tetra(),disconnected={...a,assembly,vertices:[...a.vertices,...b.vertices.map(v=>({...v,xMm:v.xMm+300}))],faces:[...a.faces,...b.faces]};
 expect(()=>validateSurface(disconnected)).toThrow('DISCONNECTED_TEMPLATE');
});

it('checks cut edges in either direction and rejects reversed duplicates or nonexistent edges',()=>{
 const input=square(),[a,b,c,d]=input.vertices.map(vertex=>vertex.id),lineId=randomUUID();
 input.cutLines=[{id:lineId,name:'diagonal',kind:'pen',enabled:true,closed:false,symmetric:false,controlPoints:[],tension:.5,edges:[{a:c,b:a}]}];
 input.cutBaseConstraints=[{a:c,b:a,locked:true}];input.cutConstraints=[{a:a,b:c,locked:true}];expect(()=>validateSurface(input)).not.toThrow();
 expect(()=>validateSurface({...input,cutConstraints:[{a,b:c,locked:true},{a:c,b:a,locked:true}]})).toThrow('INVALID_MESH');
 expect(()=>validateSurface({...input,cutBaseConstraints:[{a:b,b:d,locked:true}]})).toThrow('INVALID_CUT');
 expect(()=>validateSurface({...input,cutLines:[{...input.cutLines![0],edges:[{a,b:c},{a:c,b:a}]}]})).toThrow('INVALID_CUT');
 expect(()=>validateSurface({...input,cutLines:[{...input.cutLines![0],edges:[{a,b:randomUUID()}]}]})).toThrow('INVALID_CUT');
});

it('keeps edge identities exact at the 200000-vertex limit, beyond 32-bit pair keys',()=>{
 const input=square(),corners=input.vertices;
 input.vertices=Array.from({length:199996},(_,index)=>({id:`00000000-0000-4000-8000-${index.toString(16).padStart(12,'0')}`,xMm:0,yMm:0,zMm:0}));input.vertices.push(...corners);
 input.cutConstraints=[{a:corners[2].id,b:corners[0].id,locked:true}];
 expect(()=>validateSurface(input)).not.toThrow();
 const reversed={...input,vertices:[...input.vertices].reverse()};expect(()=>validateSurface(reversed)).not.toThrow();
 expect(()=>validateSurface({...input,cutConstraints:[{a:corners[1].id,b:corners[3].id,locked:true}]})).toThrow('INVALID_MESH');
});
