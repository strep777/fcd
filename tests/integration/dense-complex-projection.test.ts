import {expect,it} from 'vitest';
import {randomUUID} from 'node:crypto';
import {resolve} from 'node:path';
import {mkdirSync,writeFileSync} from 'node:fs';
import {project,rectangle} from '../fixtures';
import {gridMesh} from '../large-mesh-fixture';
import {area,clip,projectMarking} from '../../apps/desktop/main/markings';
import {analyze,withWorkerSession} from '../../apps/desktop/main/worker';
import {Repository} from '../../apps/desktop/main/repository';
import type {Marking,Project} from '../../packages/schema/index';

const worker=resolve('target/release/fpcad-worker.exe');
function fixture(){
 const p=project();p.pieces=[];p.surface=gridMesh(160,160);p.surface.faces.forEach(f=>f.region='dense front');
 const source=rectangle();source.allowanceMm=0;source.nodes=Array.from({length:1024},(_,i)=>{const t=i*Math.PI/512,r=650*(.82+.16*Math.cos(6*t));return {id:randomUUID(),xMm:800+r*Math.cos(t),yMm:800+r*Math.sin(t)};});
 source.holes=[-250,0,250].map(x=>Array.from({length:128},(_,i)=>{const t=-i*Math.PI/64;return {id:randomUUID(),xMm:800+x+65*Math.cos(t),yMm:800+65*Math.sin(t)};}));
 p.patternLibrary=[{piece:source,referenceId:randomUUID(),view:'front',category:'manual complex'}];return p;
}
function decoded(p:Project,m:Marking){
 const vertices=new Map(p.surface!.vertices.map(v=>[v.id,v])),faces=new Map(p.surface!.faces.map(f=>[f.id,f]));
 return m.fragments.flatMap(fragment=>{const triangle=faces.get(fragment.faceId)!.vertices.map(id=>vertices.get(id)!);return fragment.rings.map(r=>r.map(w=>[w.reduce((s,n,i)=>s+n*triangle[i].xMm,0),w.reduce((s,n,i)=>s+n*triangle[i].yMm,0)] as [number,number]));});
}

it('dense complex concave pigments retain area, three holes and one island across spatial blocks',async()=>{
 const p=fixture(),before=structuredClone(p),source=p.patternLibrary![0].piece;
 await withWorkerSession(worker,async()=>{
  const expected=(await analyze(worker,{...p,pieces:[source]}))[0].areaMm2,m=await projectMarking(worker,p,source.id,'front',0,0),rings=decoded(p,m),union=(await clip(worker,[{subjects:rings,union:true}],12))[0];
  const origin:[number,number]=[source.nodes[0].xMm,source.nodes[0].yMm],common=(await clip(worker,[{subjects:rings,union:true,origin}],12))[0],manufactured=(await clip(worker,[{subjects:rings,union:true}],4))[0];mkdirSync('test-results/2026-10-28-imported-cut',{recursive:true});writeFileSync('test-results/2026-10-28-imported-cut/dense-complex-projection.json',JSON.stringify({expectedArea:expected,fragmentArea:rings.reduce((s,r)=>s+area(r),0),union12:union.map(r=>({area:area(r),points:r.length})),commonOrigin12:common.map(r=>({area:area(r),points:r.length})),commonOriginRings:common,union4:manufactured.map(r=>({area:area(r),points:r.length}))},null,2));
  expect(m.fragments.length).toBeGreaterThan(10000);
  expect(Math.abs(rings.reduce((s,r)=>s+area(r),0)-expected)).toBeLessThan(.1);
  expect(common.filter(r=>area(r)>0)).toHaveLength(1);expect(common.filter(r=>area(r)<0)).toHaveLength(3);
  expect(Math.abs(manufactured.reduce((s,r)=>s+area(r),0)-expected)).toBeLessThan(.1);
  expect(Math.abs(union.reduce((s,r)=>s+area(r),0)-expected)).toBeLessThan(.1);
 });expect(p).toEqual(before);
},120000);

it('scoped dense projection respects a foreground occluder and cancellation retains repository state',async()=>{
 const p=fixture(),source=p.patternLibrary![0].piece,originalFaces=new Set(p.surface!.faces.map(f=>f.id));
 const occluder=[[800,0,20],[1600,0,20],[1600,1600,20],[800,1600,20]].map(([xMm,yMm,zMm])=>({id:randomUUID(),xMm,yMm,zMm}));
 p.surface!.vertices.push(...occluder);for(const ids of [[0,1,2],[0,2,3]])p.surface!.faces.push({id:randomUUID(),region:'foreground',vertices:ids.map(i=>occluder[i].id) as [string,string,string]});
 const before=structuredClone(p);
 await withWorkerSession(worker,async()=>{
  const expected=(await analyze(worker,{...p,pieces:[source]}))[0].areaMm2/2,m=await projectMarking(worker,p,source.id,'front',0,0,false,false,undefined,originalFaces),rings=decoded(p,m);
  expect(m.fragments.every(f=>originalFaces.has(f.faceId))).toBe(true);expect(Math.abs(rings.reduce((s,r)=>s+area(r),0)-expected)).toBeLessThan(.1);
  expect(Math.max(...rings.flat().map(p=>p[0]))).toBeLessThanOrEqual(800.0001);
 });expect(p).toEqual(before);
 const repo=new Repository(':memory:');try{
  repo.open(p,null);const state=repo.snapshot()!,history=repo.status(),controller=new AbortController(),timer=setTimeout(()=>controller.abort(),10);
  try{await expect(withWorkerSession(worker,async()=>{const m=await projectMarking(worker,state,source.id,'front',0,0,false,false,undefined,originalFaces,controller.signal);repo.commit({type:'marking.put',marking:m},randomUUID(),'cancelled dense projection');},controller.signal)).rejects.toMatchObject({code:'CANCELLED'});}finally{clearTimeout(timer);}
  expect(repo.snapshot()).toEqual(state);expect(repo.status()).toEqual(history);
 }finally{repo.close();}
},120000);
