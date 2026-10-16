import {expect,it} from 'vitest';
import {resolve} from 'node:path';
import {randomUUID} from 'node:crypto';
import {project} from '../fixtures';
import {parseObj,unwrapSurface,bindingIssues,cutColorHash} from '../../apps/desktop/main/surface';
import {surfaceMarking,staleMarkingIds,clip} from '../../apps/desktop/main/markings';
import {brushSurfaceMarking} from '../../apps/desktop/main/surface-marking-edit';
import {cutPreview} from '../../apps/desktop/main/cut-preview';
import {Repository} from '../../apps/desktop/main/repository';
import {pack,unpack} from '../../apps/desktop/main/archive';
import type {Marking} from '../../packages/schema/index';

const worker=resolve('target/release/fpcad-worker.exe');
const frame={origin:[0,0,0] as [number,number,number],axes:[[1,0,0],[0,1,0],[0,0,1]] as [[number,number,number],[number,number,number],[number,number,number]]};
const paint={frame,color:'#e19b37',name:'Independent brush stroke'};
async function panel(disconnected=false){
 const p=project();p.pieces=[];p.markings=[];
 p.surface=parseObj(disconnected?
  'v 0 0 0\nv 100 0 0\nv 100 100 0\nv 0 100 0\ng left\nf 1 2 3\nf 1 3 4\nv 200 0 0\nv 300 0 0\nv 300 100 0\nv 200 100 0\ng right\nf 5 6 7\nf 5 7 8':
  'v 0 0 0\nv 100 0 0\nv 200 0 0\nv 0 100 0\nv 100 100 0\nv 200 100 0\ng left\nf 1 2 5\nf 1 5 4\ng right\nf 2 3 5\nf 3 6 5');
 const run=await unwrapSurface(worker,p.surface,p);p.pieces=run.pieces;p.bindings=run.bindings;return p;
}
const area=(m:Marking)=>m.paths.reduce((total,p)=>total+p.rings.reduce((sum,r)=>sum+r.reduce((s,a,i)=>{const b=r[(i+1)%r.length];return s+a.xMm*b.yMm-b.xMm*a.yMm;},0)/2,0),0);

it('a fresh brush paints across two parts with no selected or existing marking',async()=>{
 const p=await panel(),before=structuredClone(p);
 const stroke=await brushSurfaceMarking(worker,p,undefined,{mode:'add',radiusMm:8,points:[{xMm:80,yMm:50},{xMm:120,yMm:50}],paint});
 expect(p).toEqual(before);expect(stroke.source).toBe('surface');expect(stroke.color).toBe(paint.color);expect(stroke.name).toBe(paint.name);expect(stroke.paths).toHaveLength(2);
 expect(new Set(stroke.fragments.map(f=>p.surface!.faces.find(face=>face.id===f.faceId)?.region))).toEqual(new Set(['left','right']));
 expect(Math.abs(area(stroke)-(40*16+Math.PI*64))).toBeLessThan(2*Math.PI*8*.05);
});

it('round and square fresh dabs retain distinct measured footprints',async()=>{
 const p=await panel(),request={mode:'add',radiusMm:10,points:[{xMm:50,yMm:50}],paint};
 const round=await brushSurfaceMarking(worker,p,undefined,{...request,brushShape:'round'}),square=await brushSurfaceMarking(worker,p,undefined,{...request,brushShape:'square'});
 expect(Math.abs(area(round)-Math.PI*100)).toBeLessThan(2*Math.PI*10*.05);expect(area(square)).toBeCloseTo(400,2);
 const nodes=square.surfaceShape!.nodes;for(const [x,y] of[[40,40],[60,40],[60,60],[40,60]])expect(nodes.some(p=>Math.hypot(p.xMm-x,p.yMm-y)<1e-5)).toBe(true);
 expect(round.surfaceShape!.nodes.every(p=>Math.abs(Math.hypot(p.xMm-50,p.yMm-50)-10)<1e-4)).toBe(true);
});

it('diagonal square sweeps retain the full measured hexagon in both diagonal directions',async()=>{
 const p=await panel(),before=structuredClone(p);
 for(const direction of [1,-1]){
  const y=(value:number)=>direction===1?value:100-value;
  const stroke=await brushSurfaceMarking(worker,p,undefined,{mode:'add',radiusMm:10,brushShape:'square',points:[{xMm:40,yMm:y(35)},{xMm:70,yMm:y(65)}],paint});
  // The Minkowski sweep of a 20-mm square over (30, +/-30) adds two
  // 20-by-30 side strips. A round connecting band omits its oblique corners.
  expect(area(stroke)).toBeCloseTo(20*20+20*(30+30),2);expect(stroke.paths).toHaveLength(1);
  for(const [x,v]of [[30,25],[50,25],[80,55],[80,75],[60,75],[30,45]])
   expect(stroke.surfaceShape!.nodes.some(n=>Math.hypot(n.xMm-x,n.yMm-y(v))<1e-4),`square sweep must retain measured corner (${x},${y(v)})`).toBe(true);
  expect(stroke.surfaceShape!.nodes).toHaveLength(6);expect(p).toEqual(before);
 }
});

it('one fresh stroke retains disconnected projected islands and leaves older paint intact through undo, redo and persistence',async()=>{
 const p=await panel(true),old=await surfaceMarking(worker,p,{...frame,nodes:[{xMm:20,yMm:75},{xMm:40,yMm:75},{xMm:40,yMm:95},{xMm:20,yMm:95}]},'#156b97','Older paint');
 old.locked=true;p.markings=[old];const before=structuredClone(p);
 const stroke=await brushSurfaceMarking(worker,p,undefined,{mode:'add',radiusMm:5,brushShape:'square',points:[{xMm:50,yMm:50},{xMm:250,yMm:50}],paint});
 expect(p).toEqual(before);expect(stroke.id).not.toBe(old.id);expect(stroke.paths).toHaveLength(2);expect(stroke.fragments).toHaveLength(4);expect(area(stroke)).toBeCloseTo(1100,2);
 const repo=new Repository(':memory:');try{
  repo.open(p,null);repo.commit({type:'marking.put',marking:stroke},randomUUID(),'fresh brush');const committed=repo.snapshot()!;
  expect(committed.markings).toEqual([old,stroke]);expect(staleMarkingIds(committed).size).toBe(0);expect(unpack(pack(committed).bytes).markings).toEqual([old,stroke]);
  repo.historyMove(false);expect(repo.snapshot()!.markings).toEqual([old]);repo.historyMove(true);expect(repo.snapshot()!.markings).toEqual([old,stroke]);
 }finally{repo.close();}
});

it('invalid fresh strokes fail before changing any persisted state, and discarded calculations stay uncommitted',async()=>{
 const p=await panel(),repo=new Repository(':memory:');try{
  repo.open(p,null);const before=repo.snapshot(),history=repo.status();
  for(const stroke of[
   {mode:'erase',radiusMm:5,points:[{xMm:50,yMm:50}],paint},
   {mode:'add',radiusMm:5,points:[{xMm:50,yMm:50}]},
   {mode:'add',radiusMm:-1,points:[{xMm:50,yMm:50}],paint},
   {mode:'add',radiusMm:5,points:[],paint},
   {mode:'add',radiusMm:5,points:[{xMm:500,yMm:500}],paint}
  ])await expect(brushSurfaceMarking(worker,p,undefined,stroke)).rejects.toThrow();
  await brushSurfaceMarking(worker,p,undefined,{mode:'add',radiusMm:5,points:[{xMm:50,yMm:50}],paint});
  expect(p).toEqual(before);expect(repo.snapshot()).toEqual(before);expect(repo.status()).toEqual(history);
 }finally{repo.close();}
});

it('fresh paint on accepted color trims stays inside each cut piece and leaves the old color hash stale',async()=>{
 const p=await panel();
 p.markings=[await surfaceMarking(worker,p,{...frame,nodes:[{xMm:60,yMm:30},{xMm:140,yMm:30},{xMm:140,yMm:70},{xMm:60,yMm:70}]},'#156b97','Original color cut')];
 const candidate=await cutPreview(worker,p.surface!,p,{partitionStrategy:'mesh',automaticCuts:false,colorBoundaryCuts:true,normalAngleDeg:180},resolve('dist/assets'));
 const repo=new Repository(':memory:');try{
  repo.open(p,null);repo.commit({type:'unwrap.candidate',run:candidate.run,markings:candidate.markings},randomUUID(),'color trim candidate');repo.commit({type:'unwrap.accept'},randomUUID(),'accept color trims');
  const accepted=repo.snapshot()!,before=structuredClone(accepted),colorHash=cutColorHash(accepted);
  expect(bindingIssues(accepted)).toEqual([]);expect(accepted.bindings!.every(binding=>!!binding.trim&&binding.colorHash===colorHash)).toBe(true);
  const stroke=await brushSurfaceMarking(worker,accepted,undefined,{mode:'add',radiusMm:8,brushShape:'square',points:[{xMm:45,yMm:50},{xMm:155,yMm:50}],paint});
  expect(accepted).toEqual(before);expect(stroke.id).not.toBe(accepted.markings![0].id);expect(stroke.source).toBe('surface');
  // The real trim partition includes the old color insert and the surrounding
  // material. Each mapped path must stay in its own fractional face domain;
  // summing the pieces must count the 126 by 16 mm stroke exactly once.
  expect(stroke.paths.length).toBeGreaterThan(2);expect(area(stroke)).toBeCloseTo(126*16,1);
  for(const path of stroke.paths){
   const piece=accepted.pieces.find(piece=>piece.id===path.pieceId)!;expect(piece).toBeDefined();
   const subjects=path.rings.map(ring=>ring.map(point=>[point.xMm,point.yMm] as [number,number]));
   const domain=[piece.nodes,...piece.holes??[]].map(ring=>ring.map(point=>[point.xMm,point.yMm] as [number,number]));
   const outside=(await clip(worker,[{subjects,subtract:domain}],9))[0];
   const outsideArea=Math.abs(outside.reduce((total,ring)=>total+ring.reduce((sum,a,i)=>{const b=ring[(i+1)%ring.length];return sum+a[0]*b[1]-b[0]*a[1];},0)/2,0));
   expect(outsideArea,`paint must not escape accepted trim ${piece.id}`).toBeLessThan(.01);
  }
  repo.commit({type:'marking.put',marking:stroke},randomUUID(),'free brush on trimmed cut');const saved=repo.snapshot()!;
  expect(saved.markings).toEqual([...before.markings!,stroke]);expect(saved.bindings).toEqual(before.bindings);
  expect(saved.bindings!.every(binding=>binding.colorHash===colorHash)).toBe(true);expect(cutColorHash(saved)).not.toBe(colorHash);
  expect(bindingIssues(saved).some(issue=>issue.messageKey==='STALE_BINDING')).toBe(true);
 }finally{repo.close();}
});
