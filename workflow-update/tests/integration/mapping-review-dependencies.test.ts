import {expect,it} from 'vitest';
import {randomUUID} from 'node:crypto';
import {resolve} from 'node:path';
import {project,rectangle} from '../fixtures';
import {parseObj,unwrapSurface} from '../../apps/desktop/main/surface';
import {inferMarking} from '../../apps/desktop/main/marking-completion';
import {markingFingerprint,markingIssues,projectMarking,staleMarkingIds} from '../../apps/desktop/main/markings';
import {Repository} from '../../apps/desktop/main/repository';
const worker=resolve('target/release/fpcad-worker.exe');
const commit=(repo:Repository,command:Parameters<Repository['commit']>[0])=>repo.commit(command,randomUUID(),'review dependencies');
async function inferredAutomatic(){
 const p=project();p.pieces=[];p.surface=parseObj('v 0 0 0\nv 100 0 0\nv 200 0 0\nv 0 100 0\nv 100 100 0\nv 200 100 0\ng head\nf 1 2 5\nf 1 5 4\ng body\nf 2 3 5\nf 3 6 5');
 const run=await unwrapSurface(worker,p.surface,p);p.pieces=run.pieces;p.bindings=run.bindings;
 const piece=rectangle(100,100);piece.allowanceMm=0;p.patternLibrary=[{piece,referenceId:randomUUID(),view:'front',category:'head',anatomy:{part:'head',side:'center',confidence:1,method:'manual'}}];
 const parent=await projectMarking(worker,p,piece.id,'front',0,0,false,true);parent.placement!.reviewed=true;p.markings=[parent];
 const child=await inferMarking(worker,p,parent.id,'symmetry',100,100);child.inference!.reviewed=true;p.markings.push(child);return p;
}
it('withdrawing and renewing automatic review keeps inferred geometry valid and final approval undoable',async()=>{
 const p=await inferredAutomatic(),repo=new Repository(':memory:');try{
  repo.open(p,null);const parent=p.markings![0],child=p.markings![1];expect(markingIssues(p)).toEqual([]);
  commit(repo,{type:'marking.placement.review',markingIds:[parent.id],reviewed:false});const withdrawn=repo.snapshot()!;
  expect(staleMarkingIds(withdrawn).size).toBe(0);expect(markingIssues(withdrawn).every(issue=>issue.messageKey==='AUTOMATIC_PLACEMENT_REVIEW')).toBe(true);
  expect(withdrawn.markings![1].fragments).toEqual(child.fragments);expect(withdrawn.markings![1].paths).toEqual(child.paths);
  expect(withdrawn.markings![1].inference!.sourceFingerprint).toBe(markingFingerprint(withdrawn.markings![0]));
  commit(repo,{type:'markings.lockAll',locked:true});expect(staleMarkingIds(repo.snapshot()!).size).toBe(0);expect(markingIssues(repo.snapshot()!)).toEqual([]);
  repo.historyMove(false);expect(repo.snapshot()!.markings).toEqual(withdrawn.markings);repo.historyMove(false);expect(repo.snapshot()!.markings).toEqual(p.markings);
  repo.historyMove(true);commit(repo,{type:'marking.placement.review',markingIds:[parent.id],reviewed:true});expect(markingIssues(repo.snapshot()!)).toEqual([]);
 }finally{repo.close();}
});
it('review metadata does not bless an inference already stale from a different source fingerprint',async()=>{
 const p=await inferredAutomatic();p.markings![1].inference!.sourceFingerprint='0'.repeat(64);const repo=new Repository(':memory:');try{
  repo.open(p,null);commit(repo,{type:'marking.placement.review',markingIds:[p.markings![0].id],reviewed:false});
  const after=repo.snapshot()!;expect(after.markings![1].inference!.sourceFingerprint).toBe('0'.repeat(64));expect(staleMarkingIds(after).has(p.markings![1].id)).toBe(true);
  expect(()=>commit(repo,{type:'markings.lockAll',locked:true})).toThrow('STALE_MARKING');expect(repo.snapshot()).toEqual(after);
 }finally{repo.close();}
});
