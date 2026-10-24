import {expect,it} from 'vitest';
import {randomUUID} from 'node:crypto';
import {Repository,hash} from '../../apps/desktop/main/repository';
import {acceptedCutProject} from '../fixtures/accepted-cut';
import {pieceGeometryHash} from '../../apps/desktop/main/surface';

const counts=(repo:Repository)=>Object.fromEntries(['commands','events','requests','recovery','resources'].map(table=>[table,repo.db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get()!.n]));

function candidate(withHole=false){
 const source=acceptedCutProject(),surface=source.surface!;
 if(withHole){
  const outer=surface.vertices.map(v=>v.id),inner=[[30,30],[70,30],[70,70],[30,70]].map(([xMm,yMm])=>({id:randomUUID(),xMm,yMm,zMm:0}));surface.vertices.push(...inner);
  surface.faces=outer.flatMap((a,i)=>{const b=outer[(i+1)%4],c=inner[(i+1)%4].id,d=inner[i].id;return [{id:randomUUID(),vertices:[a,b,c] as [string,string,string],region:'sheet'},{id:randomUUID(),vertices:[a,c,d] as [string,string,string],region:'sheet'}];});
  source.pieces[0].holes=[[inner[0],inner[3],inner[2],inner[1]].map(v=>({id:randomUUID(),xMm:v.xMm,yMm:v.yMm}))];
  const binding=source.bindings![0],digest=hash(JSON.stringify(surface));binding.geometryHash=pieceGeometryHash(source.pieces[0]);binding.surfaceHash=digest;binding.report={...binding.report,faceIds:surface.faces.map(f=>f.id),uv:surface.vertices.map(v=>({vertexId:v.id,xMm:v.xMm,yMm:v.yMm})),boundary:outer};
  source.surfaceRun={...source.surfaceRun!,sourceHash:digest,pieces:source.pieces,bindings:source.bindings!};
 }
 const run=structuredClone(source.surfaceRun!);
 run.accepted=false;run.algorithm='lscm-arap-seamed-1';
 for(const binding of run.bindings){const piece=run.pieces.find(p=>p.id===binding.pieceId)!,station=(p:{xMm:number;yMm:number})=>surface.vertices.find(v=>v.xMm===p.xMm&&v.yMm===p.yMm)!.id;binding.trim={vertices:surface.vertices.map(v=>({id:v.id,xMm:v.xMm,yMm:v.yMm})),triangles:surface.faces.map(face=>({faceId:face.id,vertices:face.vertices,barycentric:[[1,0,0],[0,1,0],[0,0,1]] as [[number,number,number],[number,number,number],[number,number,number]]})),boundary:piece.nodes.map(station),holes:(piece.holes??[]).map(r=>r.map(station))};binding.report={...binding.report,seamErrorMax:0,seamLengthErrorMm:0};}
 return {source,run};
}

// Real Repository acceptance guard, without a callback that throws a simulated
// error or a replacement for the geometry worker.
it.each(['relative','absolute','missing'] as const)('rejects a failed seamed candidate (%s) without changing committed state, history or replay authority',failure=>{
 const repo=new Repository(':memory:');try{
  const {source,run}=candidate();repo.open(source,null);
  if(failure==='relative')run.bindings[0].report.seamErrorMax=.00050001;
  if(failure==='absolute')run.bindings[0].report.seamLengthErrorMm=.25000001;
  if(failure==='missing')for(const binding of run.bindings){delete binding.report.seamErrorMax;delete binding.report.seamLengthErrorMm;}
  repo.commit({type:'unwrap.candidate',run,markings:[]},randomUUID(),'candidate');repo.checkpoint();
  const before=repo.snapshot()!,status=repo.status(),rows=counts(repo),requestId=randomUUID();
  expect(()=>repo.commit({type:'unwrap.accept'},requestId,'accept')).toThrow('UNWRAP_DISTORTION');
  expect(repo.snapshot()).toEqual(before);expect(repo.status()).toEqual(status);expect(counts(repo)).toEqual(rows);expect(repo.replay(requestId,'accept')).toBe(false);
  expect(repo.snapshot()!.cuttingLibrary).toEqual(before.cuttingLibrary);expect(repo.snapshot()!.surfaceRun!.accepted).toBe(false);
 }finally{repo.close();}
});

it('recomputes actual stretched trim boundaries instead of accepting forged zero-error reports',()=>{
 const repo=new Repository(':memory:');try{
  const {source,run}=candidate();repo.open(source,null);
  for(const binding of run.bindings)for(const vertex of binding.trim!.vertices)vertex.xMm*=1.02;
  expect(run.bindings.every(b=>b.report.seamErrorMax===0&&b.report.seamLengthErrorMm===0)).toBe(true);
  repo.commit({type:'unwrap.candidate',run,markings:[]},randomUUID(),'stretched-candidate');repo.checkpoint();
  const before=repo.snapshot()!,status=repo.status(),rows=counts(repo),requestId=randomUUID();
  expect(()=>repo.commit({type:'unwrap.accept'},requestId,'accept')).toThrow('UNWRAP_DISTORTION');
  expect(repo.snapshot()).toEqual(before);expect(repo.status()).toEqual(status);expect(counts(repo)).toEqual(rows);expect(repo.replay(requestId,'accept')).toBe(false);
 }finally{repo.close();}
});

it('a failed request creates no replay entry and the same request can accept repaired measured data exactly once',()=>{
 const repo=new Repository(':memory:');try{
  const {source,run}=candidate(),good=structuredClone(run);repo.open(source,null);
  for(const binding of run.bindings)for(const vertex of binding.trim!.vertices)vertex.yMm*=1.02;
  repo.commit({type:'unwrap.candidate',run,markings:[]},randomUUID(),'bad-candidate');repo.checkpoint();
  const before=repo.snapshot()!,status=repo.status(),rows=counts(repo),requestId=randomUUID();
  expect(()=>repo.commit({type:'unwrap.accept'},requestId,'accept')).toThrow('UNWRAP_DISTORTION');
  expect(repo.snapshot()).toEqual(before);expect(repo.status()).toEqual(status);expect(counts(repo)).toEqual(rows);expect(repo.replay(requestId,'accept')).toBe(false);
  repo.commit({type:'unwrap.candidate',run:good,markings:[]},randomUUID(),'repaired-candidate');const repaired=repo.snapshot()!;
  repo.commit({type:'unwrap.accept'},requestId,'accept',()=>repo.checkpointWithinTransaction());const accepted=repo.snapshot()!;
  expect(accepted.revision).toBe(repaired.revision+1);expect(accepted.surfaceRun!.accepted).toBe(true);expect(accepted.cuttingLibrary).toHaveLength(before.cuttingLibrary!.length+1);expect(repo.replay(requestId,'accept')).toBe(true);
  repo.historyMove(false);expect(repo.snapshot()!.surfaceRun!.accepted).toBe(false);expect(repo.snapshot()!.cuttingLibrary).toEqual(repaired.cuttingLibrary);
  repo.historyMove(true);expect(repo.snapshot()!.cuttingLibrary).toEqual(accepted.cuttingLibrary);
 }finally{repo.close();}
});

it('rejects a stretched exported sewing outline even when trim, reports and the refreshed geometry hash look valid',()=>{
 const repo=new Repository(':memory:');try{
  const {source,run}=candidate();repo.open(source,null);
  for(const piece of run.pieces)for(const node of piece.nodes)node.xMm*=1.02;
  for(const binding of run.bindings)binding.geometryHash=pieceGeometryHash(run.pieces.find(p=>p.id===binding.pieceId)!);
  repo.commit({type:'unwrap.candidate',run,markings:[]},randomUUID(),'stretched-outline');repo.checkpoint();
  const before=repo.snapshot()!,status=repo.status(),rows=counts(repo),requestId=randomUUID();
  expect(()=>repo.commit({type:'unwrap.accept'},requestId,'accept')).toThrow('UNWRAP_DISTORTION');
  expect(repo.snapshot()).toEqual(before);expect(repo.status()).toEqual(status);expect(counts(repo)).toEqual(rows);expect(repo.replay(requestId,'accept')).toBe(false);
 }finally{repo.close();}
});

it('accepts correctly paired hole stations, then rejects a displaced hole without modifying the outer loop',()=>{
 const repo=new Repository(':memory:');try{
  const {source,run}=candidate(true);repo.open(source,null);repo.commit({type:'unwrap.candidate',run,markings:[]},randomUUID(),'valid-hole');
  repo.commit({type:'unwrap.accept'},randomUUID(),'accept-valid-hole');expect(repo.snapshot()!.surfaceRun!.accepted).toBe(true);repo.historyMove(false);
  const bad=structuredClone(run),outer=structuredClone(bad.pieces[0].nodes);bad.pieces[0].holes![0][0].xMm+=.002;
  for(const binding of bad.bindings)binding.geometryHash=pieceGeometryHash(bad.pieces.find(p=>p.id===binding.pieceId)!);
  expect(bad.pieces[0].nodes).toEqual(outer);repo.commit({type:'unwrap.candidate',run:bad,markings:[]},randomUUID(),'displaced-hole');repo.checkpoint();
  const before=repo.snapshot()!,status=repo.status(),rows=counts(repo),requestId=randomUUID();expect(()=>repo.commit({type:'unwrap.accept'},requestId,'accept')).toThrow('UNWRAP_DISTORTION');
  expect(repo.snapshot()).toEqual(before);expect(repo.status()).toEqual(status);expect(counts(repo)).toEqual(rows);expect(repo.replay(requestId,'accept')).toBe(false);
 }finally{repo.close();}
});

it('accepts a measured exact planar seamed candidate once, checkpoints it and restores it through undo/redo',()=>{
 const repo=new Repository(':memory:');try{
  const {source,run}=candidate();repo.open(source,null);repo.commit({type:'unwrap.candidate',run,markings:[]},randomUUID(),'candidate');
  const before=repo.snapshot()!,requestId=randomUUID();repo.commit({type:'unwrap.accept'},requestId,'accept',()=>repo.checkpointWithinTransaction());
  const accepted=repo.snapshot()!;expect(accepted.revision).toBe(before.revision+1);expect(accepted.surfaceRun!.accepted).toBe(true);expect(accepted.cuttingLibrary).toHaveLength(source.cuttingLibrary!.length+1);expect(repo.replay(requestId,'accept')).toBe(true);
  repo.historyMove(false);expect(repo.snapshot()!.surfaceRun!.accepted).toBe(false);expect(repo.snapshot()!.cuttingLibrary).toEqual(before.cuttingLibrary);
  repo.historyMove(true);const restored=repo.snapshot()!;expect(restored.surfaceRun!.accepted).toBe(true);expect(restored.cuttingLibrary).toEqual(accepted.cuttingLibrary);expect(restored.bindings).toEqual(accepted.bindings);
 }finally{repo.close();}
});
