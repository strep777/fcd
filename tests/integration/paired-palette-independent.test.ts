import {expect,it} from 'vitest';
import {randomUUID} from 'node:crypto';
import {resolve} from 'node:path';
import {pairedPalette} from '../../packages/reference/paired-palette';
import {openMaterialMesh,type MaterialFace} from '../../packages/surface/design-cuts';
import type {Surface} from '../../packages/schema/index';
import {unwrapSurface} from '../../apps/desktop/main/surface';
import {analyze} from '../../apps/desktop/main/worker';
import {project} from '../fixtures';

const rows=(palette:Map<string,string>)=>[...palette].sort(([a],[b])=>a.localeCompare(b));
const worker=resolve(process.env.FPCAD_MATERIAL_WORKER??'target/release/fpcad-worker.exe');
it.each([
 ['blue','#04a3f0','#02a6f4','#02a6f4'],
 ['yellow','#f9e33c','#f7e13c','#f9e33c'],
 ['white','#ede7ea','#dcd0d7','#ede7ea'],
 ['dark','#09080b','#080608','#09080b'],
] as const)('single %s pigment under close view lighting keeps one explicit material colour',(_,front,back,expected)=>{
 const a=[front,front],b=[back,back],before=structuredClone({a,b}),palette=pairedPalette(a,b);expect(palette.get(front)).toBe(expected);expect(palette.get(back)).toBe(expected);expect({a,b}).toEqual(before);expect(rows(pairedPalette(b,a))).toEqual(rows(palette));
});
it.each([
 {name:'blue/cyan material step',front:['#04a3f0'],back:['#04d4f0']},
 {name:'different brightness beyond lighting budget',front:['#2864c8'],back:['#193e7d']},
 {name:'dark pigment farther than eight RGB units',front:['#000000'],back:['#080100']},
 {name:'missing back',front:['#04a3f0'],back:[]},
 {name:'missing front',front:[],back:['#02a6f4']},
 {name:'unmatched families',front:['#04a3f0'],back:['#f7e13c']},
 {name:'two front blue-family candidates',front:['#04a3f0','#04d4f0'],back:['#02a6f4']},
 {name:'two back blue-family candidates',front:['#04a3f0'],back:['#02a6f4','#04d4f0']},
])('$name cannot be automatically combined',({front,back})=>{expect(pairedPalette(front,back).size).toBe(0);});
it('the dark eight-unit contact limit accepts eight but not a larger diagonal RGB difference',()=>{
 expect(pairedPalette(['#000000'],['#080000']).get('#000000')).toBe('#080000');expect(pairedPalette(['#000000'],['#080100']).size).toBe(0);
});
it('a multi-candidate blue family does not prevent an independent unambiguous white match',()=>{
 const palette=pairedPalette(['#04a3f0','#04d4f0','#ede7ea'],['#02a6f4','#dcd0d7']);expect(rows(palette)).toEqual([['#dcd0d7','#ede7ea'],['#ede7ea','#ede7ea']]);
});
it('sample order and front/back argument order do not change an equal-brightness material representative',()=>{
 const front=['#04a3f0','#ede7ea','#04a3f0'],back=['#05a2f0','#dcd0d7'],expected=rows(pairedPalette(front,back));expect(rows(pairedPalette([...front].reverse(),[...back].reverse()))).toEqual(expected);expect(rows(pairedPalette(back,front))).toEqual(expected);
});
function twoViewSheet(front:string,back:string){
 const vertices:Surface['vertices']=[],faces:Surface['faces']=[];for(const yMm of [0,100])for(const xMm of [0,100,200])vertices.push({id:randomUUID(),xMm,yMm,zMm:0});
 for(let side=0;side<2;side++)for(const indices of [[side,side+1,side+4],[side,side+4,side+3]])faces.push({id:randomUUID(),region:'cloth',vertices:indices.map(i=>vertices[i].id) as [string,string,string]});
 const surface:Surface={id:randomUUID(),source:'obj',topologyVersion:1,vertices,faces},palette=pairedPalette([front],[back]),material=new Map(faces.map((f,i)=>[f.id,{faceId:f.id,color:palette.get(i<2?front:back)??(i<2?front:back),barycentric:[[1,0,0],[0,1,0],[0,0,1]]} as MaterialFace]));return{surface,material};
}
it.each([true,false])('two adjacent view pigments become exactly the intended physical material panels (same material=%s)',async same=>{
 const f=twoViewSheet('#04a3f0',same?'#02a6f4':'#04d4f0'),before=structuredClone(f),working=openMaterialMesh(f.surface,f.material,randomUUID,true),p=project();p.pieces=[];p.defaultAllowanceMm=0;p.surface=f.surface;
 expect(working.materialDomains).toBe(same?1:2);const run=await unwrapSurface(worker,working.surface,p,{partitionStrategy:'design',automaticCuts:true,colorBoundaryCuts:true,method:'arap'});expect(run.pieces).toHaveLength(same?1:2);expect(run.bindings.flatMap(b=>b.report.faceIds).sort()).toEqual(f.surface.faces.map(f=>f.id).sort());const geometry=await analyze(worker,{...p,pieces:run.pieces});expect(geometry.flatMap(g=>g.issues.filter(i=>i.severity==='error'))).toEqual([]);expect(geometry.reduce((n,g)=>n+g.areaMm2,0)).toBeCloseTo(20000,8);expect(f).toEqual(before);
});
