import {beforeAll,expect,it} from 'vitest';
import {Worker} from 'node:worker_threads';
import {build} from 'esbuild';
import {mkdtemp,mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {randomUUID} from 'node:crypto';
import type {Surface} from '../../packages/schema/index';
import type {Shape} from '../../packages/surface/attached-edit';
import {shapeWorld} from '../../packages/surface/attached-edit';
import {previewFragments} from '../../packages/surface/marking-preview';
import {surfaceFramePoint} from '../../packages/surface/edit-surface-point';
import {markingSurfaceOutline} from '../../packages/surface/marking-outline';
import {projectionFaces} from '../../packages/surface/projection-scope';
import {decalChart} from '../../packages/surface/decal-chart';
import {transformFrame} from '../../packages/surface/free-transform';

let entry:string;
beforeAll(async()=>{await mkdir('.local/tests',{recursive:true});const directory=await mkdtemp(resolve('.local/tests/transform-preview-'));entry=resolve(directory,'preview.cjs');await build({entryPoints:['apps/desktop/src/surface-transform-worker.ts'],bundle:true,platform:'node',format:'cjs',outfile:entry,logLevel:'silent'});});
function mesh(nx=12,ny=8,curved=false):Surface{
 const vertices:Surface['vertices']=[],faces:Surface['faces']=[];for(let y=0;y<=ny;y++)for(let x=0;x<=nx;x++){const u=(x/nx-.5)*120,v=(y/ny-.5)*80,t=u/70;vertices.push({id:randomUUID(),xMm:curved?70*Math.sin(t):u,yMm:v,zMm:curved?70*(Math.cos(t)-1):0});}
 for(let y=0;y<ny;y++)for(let x=0;x<nx;x++){const a=y*(nx+1)+x;for(const ids of [[a,a+1,a+nx+2],[a,a+nx+2,a+nx+1]])faces.push({id:randomUUID(),vertices:ids.map(i=>vertices[i].id) as [string,string,string],region:'PatternBody'});}return{id:randomUUID(),source:'glb',topologyVersion:1,vertices,faces};
}
function shape(surface:Surface,wrap=false):Shape{return{origin:[0,0,0],axes:[[1,0,0],[0,1,0],[0,0,1]],regions:['PatternBody'],wrap,anchorFaceId:surface.faces[Math.floor(surface.faces.length/2)].id,nodes:[{xMm:-20,yMm:-15},{xMm:20,yMm:-15},{xMm:20,yMm:15},{xMm:-20,yMm:15}],curves:[{startIndex:1,c1:{xMm:29,yMm:-10},c2:{xMm:29,yMm:10}}],holes:[[{xMm:-4,yMm:-4},{xMm:-4,yMm:4},{xMm:4,yMm:4},{xMm:4,yMm:-4}]]};}
function legacy(surface:Surface,shape:Shape,angleRad:number){const fragments=previewFragments(surface,shape)!;expect(fragments).toBeDefined();const outline=markingSurfaceOutline(surface,{surfaceId:surface.id,topologyVersion:surface.topologyVersion,fragments}),scope=projectionFaces(surface,shape,true),resolve=surfaceFramePoint(surface,shape,shape.regions,scope),handles=transformFrame(shape,angleRad).handles.map(h=>({...h,world:h.id==='rotate'?shapeWorld(shape,h.point):resolve(h.point)??shapeWorld(shape,h.point)}));return{fragments,outline,handles};}
function worker(){return new Worker(`const {parentPort,workerData}=require('node:worker_threads');global.self={postMessage:value=>parentPort.postMessage(value)};require(workerData.entry);parentPort.on('message',data=>self.onmessage({data}));`,{eval:true,workerData:{entry}});}
function send(thread:Worker,payload:unknown){return new Promise<any>((resolve,reject)=>{thread.once('message',resolve);thread.once('error',reject);thread.postMessage(payload);});}

it.each([['planar',12,8,false,false],['curved wrap',40,12,true,true],['dense imported topology',256,106,false,true]] as const)('actual preview worker equals the public unprepared path with holes/curves on %s',async(_name,nx,ny,curved,wrap)=>{
 const surface=mesh(nx,ny,curved),input=shape(surface,wrap),before=structuredClone({surface,input});if(nx===256)expect(surface.faces).toHaveLength(54272);
 const expected=legacy(surface,input,.3),chart=decalChart(surface,input),scope=projectionFaces(surface,input,true,chart);expect(expected.fragments.length).toBeGreaterThan(0);expect(previewFragments(surface,input,2000000,{chart,scope})).toEqual(expected.fragments);
 const prepared=surfaceFramePoint(surface,input,input.regions,scope,chart),old=surfaceFramePoint(surface,input,input.regions,scope);for(const h of transformFrame(input,.3).handles)expect(prepared(h.point)).toEqual(old(h.point));
 const thread=worker();try{const result=await send(thread,{surface,shape:input,angleRad:.3,token:7});expect(result).toEqual({token:7,...expected});const moved={...input,nodes:input.nodes.map(p=>({...p,xMm:p.xMm+1}))};expect(await send(thread,{shape:moved,angleRad:.3,token:8})).toEqual({token:8,...legacy(surface,moved,.3)});}finally{await thread.terminate();}expect({surface,input}).toEqual(before);
},60000);

it('worker reports a missing model without a partial preview and accepts a subsequent real model',async()=>{
 const surface=mesh(),input=shape(surface),thread=worker();try{expect(await send(thread,{shape:input,angleRad:0,token:1})).toEqual({token:1,error:'MODEL_REQUIRED'});expect(await send(thread,{surface,shape:input,angleRad:0,token:2})).toEqual({token:2,...legacy(surface,input,0)});}finally{await thread.terminate();}
});
