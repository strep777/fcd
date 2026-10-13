import {beforeAll,expect,it} from 'vitest';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {randomUUID} from 'node:crypto';
import type {Surface} from '../../packages/schema/index';
import type {MaterialTile} from '../../packages/surface/material-tiles';
import {triangulateMaterialTiles} from '../../packages/surface/material-tiles';
type XY=[number,number];
let triangulate:(rings:XY[][])=>number[][];
beforeAll(async()=>{const load=(await import(pathToFileURL(resolve('dist/assets/manifold.mjs')).href)).default,wasm=await load({locateFile:()=>resolve('dist/assets/manifold.wasm')});wasm.setup();triangulate=r=>wasm.triangulate(r,1e-9,false);});
const model=():Surface=>({id:'station-model',topologyVersion:1,source:'obj',vertices:[{id:'a',xMm:0,yMm:0,zMm:0},{id:'b',xMm:100,yMm:0,zMm:0},{id:'c',xMm:0,yMm:100,zMm:0}],faces:[{id:'f',vertices:['a','b','c'],region:'body'}]});
const tile=(color:string,points:XY[],faceId='f'):MaterialTile=>({faceId,color,rings:[points.map(([x,y])=>faceId==='f'?[1-(x+y)/100,x/100,y/100]:[1-y/100,(x+y-100)/100,1-x/100])]});
function inspect(partition:ReturnType<typeof triangulateMaterialTiles>,square=false){const vertices=new Map(partition.surface.vertices.map(v=>[v.id,v])),edges=new Map<string,number>(),areas=new Map<string,number>();
 for(const f of partition.surface.faces){const [a,b,c]=f.vertices.map(id=>vertices.get(id)!),area=((b.xMm-a.xMm)*(c.yMm-a.yMm)-(b.yMm-a.yMm)*(c.xMm-a.xMm))/2;expect(area).toBeGreaterThan(0);const color=partition.provenance.get(f.id)!.color;areas.set(color,(areas.get(color)??0)+area);for(let i=0;i<3;i++){const key=[f.vertices[i],f.vertices[(i+1)%3]].sort().join('|');edges.set(key,(edges.get(key)??0)+1);}}
 for(const [key,count]of edges){expect(count).toBeLessThanOrEqual(2);if(count===1){const [a,b]=key.split('|').map(id=>vertices.get(id)!);const outer=(a.xMm===0&&b.xMm===0)||(a.yMm===0&&b.yMm===0)||(!square&&Math.abs(a.xMm+a.yMm-100)<1e-10&&Math.abs(b.xMm+b.yMm-100)<1e-10)||(square&&a.xMm===100&&b.xMm===100)||(square&&a.yMm===100&&b.yMm===100);expect(outer,`unmatched interior mesh edge ${key}`).toBe(true);}}
 return{vertices,areas,area:[...areas.values()].reduce((a,b)=>a+b,0)};
}
const shared=():XY[]=>[[30,0],[30+2e-7,10],[30,35],[30-3e-7,50],[30,70]];
const threeOwners=()=>{const edge=shared();return[tile('left',[[0,0],...edge,[0,100]]),tile('lower',[[30,0],[100,0],[65,35],[30,35],...edge.slice(0,2).reverse()]),tile('upper',[[30,35],[65,35],[30,70],edge[3]])];};

it('does not turn roundoff stations on an analytic straight interface into extra triangles',()=>{
 const source=model(),input=threeOwners(),snapshot=JSON.stringify({source,input}),partition=triangulateMaterialTiles(source,input,triangulate,randomUUID),checked=inspect(partition);
 // Ideal domain: left pentagon includes the three-owner station (3 triangles),
 // lower quadrilateral (2), upper triangle (1). Extra vertices carry no detail.
 expect(partition.surface.faces).toHaveLength(6);expect(checked.area).toBeCloseTo(5000,9);expect(partition.canonicalization.maxShiftMm).toBeLessThanOrEqual(1e-6);
 const junction=[...checked.vertices.values()].find(v=>Math.hypot(v.xMm-30,v.yMm-35)<=1e-6)!;expect(junction).toBeDefined();expect(new Set(partition.surface.faces.filter(f=>f.vertices.includes(junction.id)).map(f=>partition.provenance.get(f.id)!.color))).toEqual(new Set(['left','lower','upper']));
 expect(JSON.stringify({source,input})).toBe(snapshot);
});

it('retains a real small corner and its material area while dropping roundoff stations',()=>{
 const edge:XY[]=[[30,0],[30+2e-7,10],[30,20],[30.002,30],[30,40],[30-3e-7,50],[30,70]],partition=triangulateMaterialTiles(model(),[tile('left',[[0,0],...edge,[0,100]]),tile('right',[...[...edge].reverse(),[100,0]])],triangulate,randomUUID),checked=inspect(partition);
 expect([...checked.vertices.values()].some(v=>Math.hypot(v.xMm-30.002,v.yMm-30)<1e-10)).toBe(true);expect(checked.areas.get('left')).toBeCloseTo(2550.02,8);expect(checked.areas.get('right')).toBeCloseTo(2449.98,8);expect(checked.area).toBeCloseTo(5000,9);
 const actual=[...checked.areas].reduce((sum,[color,area])=>sum+Math.abs(area-partition.canonicalization.perColor.find(c=>c.color===color)!.beforeMm2),0);expect(partition.canonicalization.areaErrorMm2).toBeCloseTo(actual,9);
});

it('keeps a station on a neighbouring original face as one topological edge network',()=>{
 const source=model();source.vertices.push({id:'d',xMm:100,yMm:100,zMm:0});source.faces.push({id:'g',vertices:['b','d','c'],region:'body'});
 const partition=triangulateMaterialTiles(source,[...threeOwners(),tile('left',[[30,70],[30,100],[0,100]],'g'),tile('right',[[30,70],[100,0],[100,100],[30,100]],'g')],triangulate,randomUUID),checked=inspect(partition,true);
 expect(checked.area).toBeCloseTo(10000,9);const junction=[...checked.vertices.values()].find(v=>Math.hypot(v.xMm-30,v.yMm-70)<1e-10)!;expect(junction).toBeDefined();expect(new Set(partition.surface.faces.filter(f=>f.vertices.includes(junction.id)).map(f=>partition.provenance.get(f.id)!.faceId))).toEqual(new Set(['f','g']));
});
