import {beforeAll,it,expect} from 'vitest';
import {randomUUID} from 'node:crypto';
import {resolve} from 'node:path';
import {project,rectangle} from '../fixtures';
import {acceptedCutProject} from '../fixtures/accepted-cut';
import {Repository} from '../../apps/desktop/main/repository';
import {parseObj} from '../../apps/desktop/main/surface';
import {projectMarking,staleMarkingIds} from '../../apps/desktop/main/markings';
import {cutPreview} from '../../apps/desktop/main/cut-preview';
import {pack,unpack} from '../../apps/desktop/main/archive';
import type {Project} from '../../packages/schema/index';
const worker=resolve('target/release/fpcad-worker.exe');
const commit=(r:Repository,c:Parameters<Repository['commit']>[0])=>r.commit(c,randomUUID(),c.type);
let sourceProject:Project,result:Awaited<ReturnType<typeof cutPreview>>;
beforeAll(async()=>{
 const p=project();p.surface=parseObj('v 0 0 0\nv 100 0 0\nv 100 100 0\nv 0 100 0\nf 1 2 3\nf 1 3 4');
 const source=rectangle(20,20);source.allowanceMm=0;p.pieces=[source];p.markings=[await projectMarking(worker,p,source.id,'front',0,0)];
 const repo=new Repository(':memory:');try{repo.open(p,null);sourceProject=repo.snapshot()!;}finally{repo.close();}
 result=await cutPreview(worker,sourceProject.surface!,sourceProject,{automaticCuts:false,colorBoundaryCuts:true,normalAngleDeg:180},resolve('dist/assets'));
});
it.each(['source','allowance','lock'] as const)('rejects a candidate after %s changes without changing history, recovery or replay records',change=>{
 const repo=new Repository(':memory:');try{
  repo.open(sourceProject,null);commit(repo,{type:'unwrap.candidate',run:structuredClone(result.run),markings:structuredClone(result.markings)});
  if(change==='source'){const piece=structuredClone(repo.snapshot()!.pieces[0]);piece.nodes=piece.nodes.map(n=>({...n,xMm:n.xMm*2}));commit(repo,{type:'piece.put',piece});expect(staleMarkingIds(repo.snapshot()!).size).toBe(1);}
  if(change==='allowance')commit(repo,{type:'project.allowance',widthMm:25});
  if(change==='lock')commit(repo,{type:'marking.lock',markingId:sourceProject.markings![0].id,locked:true});
  repo.checkpoint();const before=repo.snapshot(),status=repo.status(),requestId=randomUUID();
  expect(()=>repo.commit({type:'unwrap.accept'},requestId,'accept')).toThrow('STALE_RESULT');
  expect(repo.snapshot()).toEqual(before);expect(repo.status()).toEqual(status);expect(repo.replay(requestId,'accept')).toBe(false);
  repo.historyMove(false);commit(repo,{type:'unwrap.accept'});expect(repo.snapshot()!.cuttingLibrary).toHaveLength(1);
 }finally{repo.close();}
});
it('a persisted candidate retains its input fingerprint across rename and file roundtrip',()=>{
 const repo=new Repository(':memory:');try{
  repo.open(sourceProject,null);commit(repo,{type:'unwrap.candidate',run:structuredClone(result.run),markings:structuredClone(result.markings)});
  const pending=unpack(pack(repo.snapshot()!).bytes);expect(pending.surfaceRun!.inputHash).toMatch(/^[a-f0-9]{64}$/);
  repo.open(pending,null);commit(repo,{type:'project.rename',name:'Renamed draft'});commit(repo,{type:'unwrap.accept'});
  const accepted=repo.snapshot()!;expect(accepted.cuttingLibrary).toHaveLength(1);expect(unpack(pack(accepted).bytes)).toEqual(accepted);
 }finally{repo.close();}
});
it('legacy accepted archives still load, while unverified legacy candidates require recomputation',()=>{
 const p=acceptedCutProject(),repo=new Repository(':memory:');try{
  expect(unpack(pack(p).bytes)).toEqual(p);p.surfaceRun!.accepted=false;repo.open(p,null);
  const before=repo.snapshot(),status=repo.status();expect(()=>commit(repo,{type:'unwrap.accept'})).toThrow('STALE_RESULT');
  expect(repo.snapshot()).toEqual(before);expect(repo.status()).toEqual(status);
 }finally{repo.close();}
});
