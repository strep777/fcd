import {it,expect} from 'vitest';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import type Module from 'manifold-3d';
import type {Surface} from '../packages/schema/index';
import type {Bary} from '../packages/surface/refine';
import {triangulateMaterialTiles} from '../packages/surface/material-tiles';
import {openMaterialMesh} from '../packages/surface/design-cuts';
const bary=([u,v]:number[]):Bary=>[1-u-v,u,v];
it('inserts a face-interior station opposite a long edge and keeps each connected material domain intact',async()=>{
 const load=(await import(pathToFileURL(resolve('dist/assets/manifold.mjs')).href)).default as typeof Module,wasm=await load({locateFile:()=>resolve('dist/assets/manifold.wasm')});wasm.setup();
 const surface:Surface={id:'s',source:'obj',topologyVersion:1,vertices:[{id:'a',xMm:0,yMm:0,zMm:0},{id:'b',xMm:200,yMm:0,zMm:0},{id:'c',xMm:0,yMm:200,zMm:0}],faces:[{id:'f',vertices:['a','b','c'],region:'panel'}]},tiles=[{faceId:'f',color:'#ffffff',rings:[[[0,0],[.5,0],[0,.5]].map(bary)]},{faceId:'f',color:'#ee1122',rings:[[[.5,0],[1,0],[.25,.25]].map(bary)]},{faceId:'f',color:'#ffffff',rings:[[[1,0],[0,1],[0,.5],[.25,.25]].map(bary)]}],before=structuredClone(tiles),triangulated=triangulateMaterialTiles(surface,tiles,r=>wasm.triangulate(r,1e-9,false)),working=openMaterialMesh(triangulated.surface,triangulated.provenance,undefined,false);expect(tiles).toEqual(before);expect(working.materialDomains).toBe(2);expect(triangulated.canonicalization.areaErrorMm2).toBeLessThan(1e-8);
});
