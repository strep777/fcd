import {it,expect} from 'vitest';
import {resolve} from 'node:path';
import {randomUUID} from 'node:crypto';
import {resizeSurface,surfaceDimensions} from '../../packages/surface/resize';
import {sourceSurfaceShape} from '../../packages/surface/source-drop';
import {parseObj} from '../../apps/desktop/main/surface';
import {surfaceMarking} from '../../apps/desktop/main/markings';
import {generateSpecies,speciesDefaults} from '../../apps/desktop/main/species';
import {project,rectangle} from '../fixtures';

it('resizes an arbitrary imported mesh to exact XYZ dimensions about its centre without body assumptions',()=>{
 const mesh=parseObj('v 10 20 30\nv 110 20 30\nv 10 220 30\nv 10 20 80\nf 1 3 2\nf 1 2 4\nf 1 4 3\nf 2 3 4'),resized=resizeSurface(mesh,{dimensionsMm:{width:240,height:90,depth:175}});
 expect(surfaceDimensions(resized)).toEqual({width:240,height:90,depth:175});expect(resized.id).toBe(mesh.id);expect(resized.faces).toEqual(mesh.faces);expect(resized.topologyVersion).toBe(mesh.topologyVersion+1);
 const center=(key:'xMm'|'yMm'|'zMm')=>(Math.min(...resized.vertices.map(v=>v[key]))+Math.max(...resized.vertices.map(v=>v[key])))/2;
 expect([center('xMm'),center('yMm'),center('zMm')]).toEqual([60,120,55]);expect(mesh.vertices[0]).toMatchObject({xMm:10,yMm:20,zMm:30});
 const uniform=resizeSurface(mesh,{scale:2.5});expect(surfaceDimensions(uniform)).toEqual({width:250,height:500,depth:125});
 for(const scale of [0,-1,Infinity,NaN])expect(()=>resizeSurface(mesh,{scale})).toThrow('MODEL_SIZE_INVALID');
 expect(()=>resizeSurface(mesh,{dimensionsMm:{width:0,height:100,depth:50}})).toThrow('MODEL_SIZE_INVALID');
 expect(()=>resizeSurface(mesh,{scale:2,dimensionsMm:{width:200,height:400,depth:100}})).toThrow('MODEL_SIZE_INVALID');
});

it('keeps planar axes planar, moves cut controls with the mesh and invalidates scaled template measurements',()=>{
 const planar=parseObj('v 0 0 0\nv 100 0 0\nv 0 100 0\nf 1 2 3');expect(surfaceDimensions(resizeSurface(planar,{dimensionsMm:{width:50,height:250,depth:0}}))).toEqual({width:50,height:250,depth:0});
 expect(()=>resizeSurface(planar,{dimensionsMm:{width:50,height:250,depth:10}})).toThrow('MODEL_SIZE_INVALID');
 const mesh=generateSpecies(speciesDefaults('canine'));mesh.cutLines=[{id:randomUUID(),name:'guide',kind:'pen',enabled:true,closed:false,symmetric:false,tension:.5,controlPoints:[mesh.vertices[0],mesh.vertices[1]],edges:[]}];
 const resized=resizeSurface(mesh,{scale:1.25});expect(resized.template).toBeUndefined();expect(resized.parameters).toBeUndefined();expect(resized.cutLines![0].controlPoints).toEqual(resized.vertices.slice(0,2));
});

it('applied template dimensions change real geometry and recorded measurements',()=>{
 const params=speciesDefaults('canine'),mesh=generateSpecies(params),updated=generateSpecies({...params,heightMm:params.heightMm+100,chestGirthMm:params.chestGirthMm+120},mesh);
 expect(updated.vertices.some((v,i)=>Math.abs(v.yMm-mesh.vertices[i].yMm)>1)).toBe(true);
 expect(updated.template!.measurements.find(m=>m.name==='height')!.actualMm).toBeCloseTo(params.heightMm+100,5);
 expect(updated.template!.measurements.find(m=>m.name==='chestGirth')!.actualMm).toBeCloseTo(params.chestGirthMm+120,5);
 expect(updated.id).toBe(mesh.id);expect(updated.topologyVersion).toBe(mesh.topologyVersion+1);
});

it('source drop rejects excessive or invalid contours before constructing an attachment',()=>{
 const source=rectangle(),frame={origin:[0,0,0] as [number,number,number],axes:[[1,0,0],[0,1,0],[0,0,1]] as [[number,number,number],[number,number,number],[number,number,number]]},hit={xMm:0,yMm:0,zMm:0};
 expect(()=>sourceSurfaceShape({...source,closed:false},hit,frame)).toThrow('INVALID_GEOMETRY');
 expect(()=>sourceSurfaceShape({...source,nodes:Array.from({length:2001},(_,i)=>({...source.nodes[0],id:randomUUID(),xMm:i}))},hit,frame)).toThrow('RESOURCE_LIMIT');
 expect(()=>sourceSurfaceShape({...source,holes:[[source.nodes[0],source.nodes[1]]]},hit,frame)).toThrow('INVALID_GEOMETRY');
});

it('a dropped library contour creates actual visible surface fragments while preserving holes, orientation and physical size',async()=>{
 const p=project();p.pieces=[];p.surface=parseObj('v 0 0 0\nv 0 100 0\nv 0 100 100\nv 0 0 100\nf 1 2 3\nf 1 3 4');
 const source=rectangle(60,40);source.nodes=source.nodes.map(n=>({...n,xMm:n.xMm+900,yMm:n.yMm-300}));source.holes=[[[920,-290],[920,-270],[940,-270],[940,-290]].map(([xMm,yMm])=>({id:randomUUID(),xMm,yMm}))];
 const frame={origin:[0,0,0] as [number,number,number],axes:[[0,1,0],[0,0,1],[1,0,0]] as [[number,number,number],[number,number,number],[number,number,number]]},shape=sourceSurfaceShape(source,{xMm:0,yMm:50,zMm:50},frame);
 expect(shape.nodes).toEqual([{xMm:-30,yMm:-20},{xMm:30,yMm:-20},{xMm:30,yMm:20},{xMm:-30,yMm:20}]);expect(shape.holes![0]).toEqual([{xMm:-10,yMm:-10},{xMm:-10,yMm:10},{xMm:10,yMm:10},{xMm:10,yMm:-10}]);
 const marking=await surfaceMarking(resolve('target/release/fpcad-worker.exe'),p,shape,source.color,source.name);
 expect(marking.fragments.length).toBeGreaterThan(0);expect(marking.surfaceShape).toEqual(shape);expect(marking.paths).toEqual([]);
 const vv=new Map(p.surface.vertices.map(v=>[v.id,v]));let area=0;
 for(const fragment of marking.fragments){const face=p.surface.faces.find(f=>f.id===fragment.faceId)!;for(const ring of fragment.rings){const positions=ring.map(w=>({x:w.reduce((s,n,i)=>s+n*vv.get(face.vertices[i])!.yMm,0),y:w.reduce((s,n,i)=>s+n*vv.get(face.vertices[i])!.zMm,0)}));area+=positions.reduce((s,a,i)=>{const b=positions[(i+1)%positions.length];return s+a.x*b.y-b.x*a.y;},0)/2;for(const point of positions){expect(point.x).toBeGreaterThanOrEqual(20-1e-4);expect(point.x).toBeLessThanOrEqual(80+1e-4);expect(point.y).toBeGreaterThanOrEqual(30-1e-4);expect(point.y).toBeLessThanOrEqual(70+1e-4);}}}
 expect(Math.abs(area)).toBeCloseTo(2000,2);expect(source.nodes[0]).toMatchObject({xMm:900,yMm:-300});
});
