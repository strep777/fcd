import {beforeAll,expect,it} from 'vitest';
import {randomUUID} from 'node:crypto';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {mkdirSync,writeFileSync} from 'node:fs';
import type {Surface} from '../../packages/schema/index';
import {triangulateMaterialTiles,type MaterialTile} from '../../packages/surface/material-tiles';
import {triangleWeights,type XY} from '../../packages/surface/triangles';
import {clip} from '../../apps/desktop/main/markings';

const worker=resolve('target/release/fpcad-worker.exe'),output=resolve('test-results/current-cutting');
let triangulate:(rings:XY[][])=>number[][];
beforeAll(async()=>{const load=(await import(pathToFileURL(resolve('dist/assets/manifold.mjs')).href)).default,wasm=await load({locateFile:()=>resolve('dist/assets/manifold.wasm')});wasm.setup();triangulate=r=>wasm.triangulate(r,1e-9,false);});
const signedArea=(r:XY[])=>r.reduce((sum,a,i)=>{const b=r[(i+1)%r.length];return sum+a[0]*b[1]-b[0]*a[1];},0)/2;
const rectangle=(x:number,y:number,w:number,h:number):XY[]=>[[x,y],[x+w,y],[x+w,y+h],[x,y+h]];
function model(square=false):Surface {const vertices=(square?[[0,0],[200,0],[200,200],[0,200]]:[[0,0],[100,0],[0,100]]).map(([xMm,yMm])=>({id:randomUUID(),xMm,yMm,zMm:0}));return {id:randomUUID(),source:'obj',topologyVersion:1,vertices,faces:(square?[[0,1,2],[0,2,3]]:[[0,1,2]]).map(indices=>({id:randomUUID(),region:'shell',vertices:indices.map(i=>vertices[i].id) as [string,string,string]}))};}
async function tileDomains(source:Surface,domains:{color:string;rings:XY[][]}[]):Promise<MaterialTile[]> {
 const positions=new Map(source.vertices.map(v=>[v.id,v])),jobs=source.faces.flatMap(face=>domains.map(domain=>({face,domain,triangle:face.vertices.map(id=>{const p=positions.get(id)!;return [p.xMm,p.yMm] as XY;})}))),clipped=await clip(worker,jobs.map(j=>({subjects:j.domain.rings,clips:[j.triangle]})),9);
 return jobs.flatMap((j,i)=>clipped[i].length?[{faceId:j.face.id,color:j.domain.color,rings:clipped[i].map(r=>r.map(p=>triangleWeights(p,j.triangle)))}]:[]);
}
function inspect(source:Surface,partition:ReturnType<typeof triangulateMaterialTiles>){
 const vv=new Map(partition.surface.vertices.map(v=>[v.id,v])),originals=new Map(source.faces.map(f=>[f.id,f])),sourcePositions=new Map(source.vertices.map(v=>[v.id,v])),areas=new Map<string,number>(),coverage=new Map<string,number>(),triangles=new Map<string,XY[][]>(),edges=new Map<string,{a:string;b:string;count:number}>();
 for(const face of partition.surface.faces){const meta=partition.provenance.get(face.id)!;expect(meta).toBeDefined();const points=face.vertices.map(id=>{const p=vv.get(id)!;return [p.xMm,p.yMm] as XY;}),area=signedArea(points);expect(area).toBeGreaterThan(0);areas.set(meta.color,(areas.get(meta.color)??0)+area);triangles.set(meta.color,[...triangles.get(meta.color)??[],points]);coverage.set(meta.faceId,(coverage.get(meta.faceId)??0)+area);
  const original=originals.get(meta.faceId)!;for(let i=0;i<3;i++){const weights=meta.barycentric[i];expect(weights.reduce((a,b)=>a+b,0)).toBeCloseTo(1,10);expect(weights.every(w=>w>=-1e-10&&w<=1+1e-10)).toBe(true);const projected=[0,1].map(axis=>weights.reduce((sum,w,j)=>{const p=sourcePositions.get(original.vertices[j])!;return sum+w*[p.xMm,p.yMm][axis];},0));expect(Math.hypot(points[i][0]-projected[0],points[i][1]-projected[1])).toBeLessThan(1e-7);const a=face.vertices[i],b=face.vertices[(i+1)%3],key=[a,b].sort().join('|'),edge=edges.get(key)??{a,b,count:0};edge.count++;edges.set(key,edge);}
 }
 for(const original of source.faces){const points=original.vertices.map(id=>{const p=sourcePositions.get(id)!;return [p.xMm,p.yMm] as XY;});expect(coverage.get(original.id)).toBeCloseTo(signedArea(points),5);}
 return {vv,areas,triangles,edges};
}
const minimumAltitude=(triangles:XY[][])=>Math.min(...triangles.map(t=>Math.abs(signedArea(t))*2/Math.max(...t.map((p,i)=>Math.hypot(p[0]-t[(i+1)%3][0],p[1]-t[(i+1)%3][1])))));

it('improves an ordinary convex material quadrilateral beyond the former submicron-only threshold',async()=>{
 const source=model(),quad:XY[]=[[51.33622745538979,32.968998434798195],[32.432685002704844,42.0891466973208],[20.667621484067944,28.461521023180875],[28.69791927750021,19.095711118931646]],base=(await clip(worker,[{subjects:[[[0,0],[100,0],[0,100]]],subtract:[quad]}],9))[0],domains=[{color:'insert',rings:[quad]},{color:'base',rings:base}],tiles=await tileDomains(source,domains),before=JSON.stringify({source,tiles}),raw=triangulate([quad]).map(t=>t.map(i=>quad[i])),partition=triangulateMaterialTiles(source,tiles,triangulate,randomUUID),checked=inspect(source,partition),oldHeight=minimumAltitude(raw),newHeight=minimumAltitude(checked.triangles.get('insert')!);
 expect(oldHeight).toBeGreaterThan(9);expect(newHeight).toBeGreaterThan(oldHeight*1.05);expect(newHeight).toBeGreaterThan(10.4);expect(checked.triangles.get('insert')).toHaveLength(2);expect(checked.areas.get('insert')).toBeCloseTo(signedArea(quad),5);expect(JSON.stringify({source,tiles})).toBe(before);
 mkdirSync(output,{recursive:true});writeFileSync(resolve(output,'independent-diagonal-quality.json'),JSON.stringify({oldMinimumAltitudeMm:oldHeight,newMinimumAltitudeMm:newHeight,areaMm2:checked.areas.get('insert')},null,2));
});

it('retains a nonconvex three-hole color domain, colored hole inserts and a narrow base island across original faces',async()=>{
 const source=model(true),outer:XY[]=[[20,20],[180,20],[180,60],[80,60],[80,140],[180,140],[180,180],[20,180]],blue=rectangle(30,40,25,20),green=rectangle(30,120,25,20),narrow=rectangle(40,85,20,.002),base=(await clip(worker,[{subjects:[rectangle(0,0,200,200)],subtract:[outer]}],9))[0],domains=[{color:'yellow',rings:[outer,[...blue].reverse(),[...green].reverse(),[...narrow].reverse()]},{color:'blue',rings:[blue]},{color:'green',rings:[green]},{color:'base',rings:[...base,narrow]}],tiles=await tileDomains(source,domains),before=JSON.stringify({source,tiles}),partition=triangulateMaterialTiles(source,tiles,triangulate,randomUUID),checked=inspect(source,partition);
 for(const domain of domains)expect(checked.areas.get(domain.color),domain.color).toBeCloseTo(domain.rings.reduce((sum,r)=>sum+signedArea(r),0),5);
 expect(checked.areas.get('yellow')).toBeCloseTo(16599.96,5);expect(checked.areas.get('base')).toBeCloseTo(22400.04,5);
 const outside=await clip(worker,domains.flatMap(d=>[{subjects:checked.triangles.get(d.color)!,subtract:d.rings,union:true},{subjects:d.rings,subtract:checked.triangles.get(d.color)!}]),9);for(const rings of outside)expect(Math.abs(rings.reduce((sum,r)=>sum+signedArea(r),0))).toBeLessThan(1e-5);
 for(const edge of checked.edges.values()){expect(edge.count).toBeLessThanOrEqual(2);if(edge.count===1){const a=checked.vv.get(edge.a)!,b=checked.vv.get(edge.b)!;expect((a.xMm===0&&b.xMm===0)||(a.yMm===0&&b.yMm===0)||(a.xMm===200&&b.xMm===200)||(a.yMm===200&&b.yMm===200),'material boundaries must remain conforming shared edges').toBe(true);}}
 const owner=(point:XY)=>[...checked.triangles].flatMap(([color,triangles])=>triangles.some(t=>triangleWeights(point,t).every(w=>w>=-1e-8))?[color]:[]);
 expect(owner([40,50])).toEqual(['blue']);expect(owner([40,130])).toEqual(['green']);expect(owner([50,85.001])).toEqual(['base']);expect(owner([120,100])).toEqual(['base']);expect(owner([25,100])).toEqual(['yellow']);expect(JSON.stringify({source,tiles})).toBe(before);
 mkdirSync(output,{recursive:true});writeFileSync(resolve(output,'independent-nonconvex-materials.json'),JSON.stringify({triangles:partition.surface.faces.length,byColor:Object.fromEntries(checked.areas),canonicalization:partition.canonicalization},null,2));
});
