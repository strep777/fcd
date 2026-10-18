import {it,expect} from 'vitest';
import {randomUUID} from 'node:crypto';
import {Repository,hash} from '../../apps/desktop/main/repository';
import {cutCandidateInputHash} from '../../apps/desktop/main/cut-candidate';
import {projectSchema} from '../../packages/schema/index';
import {acceptedCutProject} from '../fixtures/accepted-cut';

// Persistence-only fixture: no native solve is substituted or required. Hash
// the schema-normalized live inputs, as a genuine persisted candidate does.
function setup(){
 const candidate=projectSchema.parse(acceptedCutProject());
 candidate.surfaceRun!.accepted=false;
 candidate.surfaceRun!.inputHash=cutCandidateInputHash(candidate);
 const repo=new Repository(':memory:');repo.open(candidate,null);return repo;
}
function rows(repo:Repository){
 const tables=['sessions','settings','resources','commands','events','recovery','requests'] as const;
 return Object.fromEntries(tables.map(table=>[table,repo.db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()]));
}

it.each(['insert','prune'] as const)('surface acceptance rolls back every persistent change when recovery %s fails, then retries the same request exactly once',failure=>{
 const repo=setup();try{
  // A full ten-point history makes pruning delete a real old row, rather than
  // merely testing a DELETE statement which has no work to perform.
  if(failure==='prune')for(let i=0;i<9;i++){
   repo.commit({type:'project.rename',name:'Candidate '+i},randomUUID(),'rename-'+i);
   repo.checkpoint();
  }
  const before=repo.snapshot()!,beforeStatus=repo.status(),beforeRows=rows(repo),historical=structuredClone(before.cuttingLibrary!),requestId=randomUUID(),fingerprint='accept-checkpoint-'+failure;
  const acceptedRevision=before.revision+1;
  if(failure==='prune')expect(beforeStatus.recovery).toHaveLength(10);
  repo.db.exec(`CREATE TRIGGER fail_accept_recovery BEFORE ${failure==='insert'?'INSERT':'DELETE'} ON recovery BEGIN SELECT RAISE(ABORT,'INJECTED_RECOVERY_${failure.toUpperCase()}'); END;`);
  let checkpoints=0;
  const accept=()=>repo.commit({type:'unwrap.accept'},requestId,fingerprint,()=>{checkpoints++;repo.checkpointWithinTransaction();});

  expect(()=>accept()).toThrow('INJECTED_RECOVERY_'+failure.toUpperCase());
  expect(checkpoints,'the injected failure must occur in the recovery callback after acceptance writes').toBe(1);
  expect(repo.snapshot()).toEqual(before);
  expect(repo.status()).toEqual(beforeStatus);
  expect(rows(repo),'project, archive resources, history, replay and recovery pruning must roll back together').toEqual(beforeRows);
  expect(repo.replay(requestId,fingerprint)).toBe(false);
  expect(repo.snapshot()!.surfaceRun!.accepted).toBe(false);

  repo.db.exec('DROP TRIGGER fail_accept_recovery');
  repo.assertRevision(before.id,before.revision);
  const accepted=accept();
  expect(checkpoints).toBe(2);
  expect(accepted.revision).toBe(acceptedRevision);
  expect(accepted.surfaceRun!.accepted).toBe(true);
  expect(accepted.cuttingLibrary).toHaveLength(historical.length+1);
  expect(accepted.cuttingLibrary!.slice(0,historical.length),'previous cut-library snapshots remain immutable').toEqual(historical);
  expect(accepted.activeCutId).toBe(accepted.cuttingLibrary!.at(-1)!.id);
  expect(repo.snapshot()).toEqual(accepted);
  expect(repo.status().history[0]).toEqual({revision:acceptedRevision,type:'unwrap.accept'});
  expect(repo.db.prepare('SELECT COUNT(*) AS n FROM commands WHERE session_id=? AND type=?').get(repo.sessionId!,'unwrap.accept')?.n).toBe(1);
  expect(repo.db.prepare('SELECT COUNT(*) AS n FROM requests WHERE session_id=? AND request_id=?').get(repo.sessionId!,requestId)?.n).toBe(1);

  const point=repo.db.prepare('SELECT state,checksum FROM recovery WHERE session_id=? AND revision=?').get(repo.sessionId!,acceptedRevision)!;
  const request=repo.db.prepare('SELECT response FROM requests WHERE session_id=? AND request_id=?').get(repo.sessionId!,requestId)!;
  expect(point).toBeDefined();expect(point.checksum).toBe(hash(String(point.state)));
  expect(JSON.parse(String(point.state)),'the committed recovery point describes the same accepted state as replay').toEqual(JSON.parse(String(request.response)));
  expect(repo.status().recovery[0]).toBe(acceptedRevision);
  if(failure==='prune'){expect(repo.status().recovery).toHaveLength(10);expect(repo.status().recovery).not.toContain(0);}

  const afterRows=rows(repo);
  expect(repo.replay(requestId,fingerprint)).toBe(true);
  expect(()=>repo.replay(requestId,'different-input')).toThrow('REQUEST_ID_REUSED');
  expect(rows(repo),'successful replay lookup does not accept twice or add another recovery point').toEqual(afterRows);
  expect(checkpoints).toBe(2);
  repo.historyMove(false);
  expect(repo.snapshot()!.surfaceRun!.accepted).toBe(false);
  expect(repo.snapshot()!.cuttingLibrary).toEqual(historical);
  repo.historyMove(true);
  expect(repo.snapshot()!.surfaceRun!.accepted).toBe(true);
  expect(repo.snapshot()!.cuttingLibrary).toEqual(accepted.cuttingLibrary);
  expect(repo.snapshot()!.activeCutId).toBe(accepted.activeCutId);
 }finally{repo.close();}
});
