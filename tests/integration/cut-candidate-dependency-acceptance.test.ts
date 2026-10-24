import {expect,it} from 'vitest';
import {randomUUID} from 'node:crypto';
import type {Marking,SurfaceRun} from '../../packages/schema/index';
import {Repository} from '../../apps/desktop/main/repository';
import {bindingIssues,cutColorHash} from '../../apps/desktop/main/surface';
import {acceptedCutProject} from '../fixtures/accepted-cut';

const algorithms=['lscm-cg-1','lscm-arap-1','lscm-arap-seamed-1'] as const;
const counts=(repo:Repository)=>['commands','events','requests','recovery','resources'].map(table=>repo.db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get()!.n);

function candidate(algorithm:SurfaceRun['algorithm']){
 const source=acceptedCutProject(),surface=source.surface!,run=structuredClone(source.surfaceRun!);
 run.accepted=false;run.algorithm=algorithm;
 if(algorithm==='lscm-arap-seamed-1')for(const binding of run.bindings){
  binding.report={...binding.report,seamErrorMax:0,seamLengthErrorMm:0};
  binding.trim={vertices:surface.vertices.map(v=>({id:v.id,xMm:v.xMm,yMm:v.yMm})),triangles:surface.faces.map(f=>({faceId:f.id,vertices:f.vertices,barycentric:[[1,0,0],[0,1,0],[0,0,1]]})),boundary:surface.vertices.map(v=>v.id),holes:[]};
 }
 return {source,run};
}

function marking(source:ReturnType<typeof acceptedCutProject>):Marking{
 const surface=source.surface!;
 return {id:randomUUID(),name:'Candidate color source',color:'#aabbcc',source:'surface',sourceHash:'source',surfaceId:surface.id,topologyVersion:surface.topologyVersion,surfaceHash:source.surfaceRun!.sourceHash,view:'front',offsetXmm:0,offsetYmm:0,fragments:[{faceId:surface.faces[0].id,rings:[[[1,0,0],[0,1,0],[0,0,1]]]}],paths:[]};
}

for(const algorithm of algorithms)it.each(['surfaceHash','geometryHash','colorHash'] as const)(`rejects a persisted ${algorithm} candidate with stale %s without changing transactions or replay`,field=>{
 const {source,run}=candidate(algorithm),repo=new Repository(':memory:');
 try{
  const previews=[marking(source)];run.bindings[0].colorHash=cutColorHash({...source,markings:previews});
  const validHash=run.bindings[0][field]!;run.bindings[0][field]=(validHash[0]==='0'?'1':'0')+validHash.slice(1);
  // Opening a saved candidate validates its shape, while acceptance must also
  // validate dependencies independently of its unchanged live-input hash.
  repo.open(source,null);repo.commit({type:'unwrap.candidate',run,markings:previews},randomUUID(),'candidate');
  const persisted=repo.snapshot()!;
  const reopened=new Repository(':memory:');try{
   reopened.open(persisted,null);reopened.checkpoint();
   const before=reopened.snapshot(),status=reopened.status(),rows=counts(reopened),requestId=randomUUID();
   expect(()=>reopened.commit({type:'unwrap.accept'},requestId,'accept',()=>reopened.checkpointWithinTransaction())).toThrow('STALE_RESULT');
   expect(reopened.snapshot()).toEqual(before);expect(reopened.status()).toEqual(status);expect(counts(reopened)).toEqual(rows);expect(reopened.replay(requestId,'accept')).toBe(false);
  }finally{reopened.close();}
 }finally{repo.close();}
});

it.each(algorithms)('accepts legitimate %s color dependencies against candidate fragments rather than the previous live fragments',algorithm=>{
 const {source,run}=candidate(algorithm),original=marking(source),preview=structuredClone(original),repo=new Repository(':memory:');
 source.markings=[original];preview.fragments[0].rings=[[[1,0,0],[.5,.5,0],[.5,0,.5]]];
 run.bindings[0].colorHash=cutColorHash({...source,markings:[preview]});expect(run.bindings[0].colorHash).not.toBe(cutColorHash(source));
 try{
  repo.open(source,null);repo.commit({type:'unwrap.candidate',run,markings:[preview]},randomUUID(),'candidate');
  const before=repo.snapshot()!,requestId=randomUUID();repo.commit({type:'unwrap.accept'},requestId,'accept',()=>repo.checkpointWithinTransaction());
  const accepted=repo.snapshot()!;expect(accepted.surfaceRun!.accepted).toBe(true);expect(accepted.revision).toBe(before.revision+1);expect(accepted.cuttingLibrary).toHaveLength(before.cuttingLibrary!.length+1);expect(bindingIssues(accepted)).toEqual([]);expect(repo.replay(requestId,'accept')).toBe(true);
 }finally{repo.close();}
});

it('treats an explicit empty preview as the committed color source instead of falling back to old markings',()=>{
 const {source,run}=candidate('lscm-cg-1'),repo=new Repository(':memory:');source.markings=[marking(source)];run.bindings[0].colorHash=cutColorHash({...source,markings:[]});
 try{repo.open(source,null);repo.commit({type:'unwrap.candidate',run,markings:[]},randomUUID(),'candidate');repo.commit({type:'unwrap.accept'},randomUUID(),'accept');expect(repo.snapshot()!.markings).toEqual([]);expect(bindingIssues(repo.snapshot()!)).toEqual([]);}finally{repo.close();}
});

it('retains live color dependencies when a legitimate historical candidate has no preview markings',()=>{
 const {source,run}=candidate('lscm-arap-1'),repo=new Repository(':memory:');source.markings=[marking(source)];run.bindings[0].colorHash=cutColorHash(source);
 try{repo.open(source,null);repo.commit({type:'unwrap.candidate',run},randomUUID(),'candidate');repo.commit({type:'unwrap.accept'},randomUUID(),'accept');expect(repo.snapshot()!.markings).toHaveLength(1);expect(bindingIssues(repo.snapshot()!)).toEqual([]);}finally{repo.close();}
});
