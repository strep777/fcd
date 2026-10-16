import {it,expect} from 'vitest';
import {resolve} from 'node:path';
import {gridMesh} from '../large-mesh-fixture';
import {project,rectangle} from '../fixtures';
import {projectMarking} from '../../apps/desktop/main/markings';
import {previewLod,meshBounds,screenWeights} from '../../packages/surface/preview';
import {validateSurface,unwrapSurface,parseObj} from '../../apps/desktop/main/surface';
import {exportGlb,parseGlb} from '../../apps/desktop/main/glb';
import {automaticCutMesh} from '../../apps/desktop/main/automatic-cuts';
import {pack,unpack} from '../../apps/desktop/main/archive';
import {surfaceSchema} from '../../packages/schema/index';
const worker=resolve('target/release/fpcad-worker.exe');
it('200000 original faces survive LOD, archive and uint32 GLB roundtrip',async()=>{
 const mesh=gridMesh(400,250),before=JSON.stringify(mesh);validateSurface(mesh);const lod=previewLod(mesh);expect(lod.faces.length).toBeLessThanOrEqual(12000);expect(lod.errorMm).toBeGreaterThan(0);expect(JSON.stringify(mesh)).toBe(before);expect(meshBounds(mesh.vertices)).toMatchObject({cx:2000,cy:1250,cz:0});
 const original=new Set(mesh.faces.map(f=>f.id));for(const group of lod.sourceFaces.values())for(const id of group)expect(original.has(id)).toBe(true);
 const p={...project(),pieces:[],surface:mesh};expect(unpack(pack(p).bytes).surface).toEqual(mesh);
 const round=await parseGlb(await exportGlb(mesh));expect(round.faces.length).toBe(200000);expect(round.vertices.length).toBe(mesh.vertices.length);expect(meshBounds(round.vertices).extent).toBeCloseTo(4000,2);
 expect(()=>surfaceSchema.parse({...mesh,faces:[...mesh.faces,mesh.faces[0]]})).toThrow();
},120000);
it('50000-face exact LSCM candidate retains every face and physical area without modifying the input',async()=>{
 const mesh=gridMesh(),p={...project(),pieces:[],surface:mesh},run=await unwrapSurface(worker,mesh,p,{method:'lscm'});expect(run.bindings).toHaveLength(50);expect(new Set(run.bindings.flatMap(b=>b.report.faceIds)).size).toBe(50000);expect(Math.max(...run.bindings.map(b=>b.report.edgeErrorMax))).toBeLessThan(.00001);expect(p.pieces).toEqual([]);
 const area=run.pieces.reduce((sum,p)=>sum+Math.abs(p.nodes.reduce((s,a,i)=>{const b=p.nodes[(i+1)%p.nodes.length];return s+a.xMm*b.yMm-a.yMm*b.xMm;},0))/2,0);expect(area).toBeCloseTo(2500000,1);
 const source=rectangle(2500,1000);source.allowanceMm=0;const marked=await projectMarking(worker,{...p,pieces:[...run.pieces,source],bindings:run.bindings},source.id,'front',0,0);expect(marked.fragments.length).toBe(50000);expect(marked.paths.length).toBe(50);const projectedArea=marked.paths.reduce((sum,path)=>sum+path.rings.reduce((sum,r)=>sum+r.reduce((s,a,i)=>{const b=r[(i+1)%r.length];return s+a.xMm*b.yMm-a.yMm*b.xMm;},0)/2,0),0);expect(projectedArea).toBeCloseTo(2500000,0);
 await expect(unwrapSurface(worker,gridMesh(251,100),p)).rejects.toThrow('UNWRAP_LIMIT');
},120000);
it('incremental automatic cuts preserve locked seams, disk patches and all original face IDs',()=>{
 const mesh=gridMesh(30,20);mesh.faces.forEach(f=>f.region='one');const a=mesh.vertices[15].id,b=mesh.vertices[46].id;mesh.cutConstraints=[{a,b,locked:true}];const cut=automaticCutMesh(mesh,{maxFacesPerPatch:100,maxPieces:500,normalAngleDeg:180});expect(cut.mesh.faces.map(f=>f.id)).toEqual(mesh.faces.map(f=>f.id));expect(cut.cutEdges.some(e=>e.includes(a)&&e.includes(b))).toBe(true);const groups=new Map<string,SurfaceGroup>();type SurfaceGroup={faces:number;vertices:Set<string>;edges:Map<string,number>};for(const f of cut.mesh.faces){const g=groups.get(f.region)??{faces:0,vertices:new Set(),edges:new Map()};g.faces++;f.vertices.forEach((a,i)=>{g.vertices.add(a);const k=[a,f.vertices[(i+1)%3]].sort().join(':');g.edges.set(k,(g.edges.get(k)??0)+1);});groups.set(f.region,g);}for(const g of groups.values()){expect(g.faces).toBeLessThanOrEqual(100);expect(g.vertices.size-g.edges.size+g.faces).toBe(1);}
});
it('screen picking rejects outside and degenerate triangles and returns edge-inclusive weights',()=>{
 const p=(x:number,y:number)=>({x,y,z:0,inverseDepth:1});expect(screenWeights({x:2,y:2},[p(0,0),p(10,0),p(0,10)])).toEqual([.6,.2,.2]);expect(screenWeights({x:5,y:5},[p(0,0),p(10,0),p(0,10)])).toEqual([0,.5,.5]);expect(screenWeights({x:8,y:8},[p(0,0),p(10,0),p(0,10)])).toBeNull();expect(screenWeights({x:0,y:0},[p(0,0),p(0,0),p(0,0)])).toBeNull();
});
