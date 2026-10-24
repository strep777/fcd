import {describe,it,expect,vi} from 'vitest';
import {randomUUID} from 'node:crypto';
import {Repository,hash} from '../../apps/desktop/main/repository';
import {project} from '../fixtures';

function assetProject(){const p=project();p.references=[{id:randomUUID(),name:'Original image',view:'front',width:1,height:1,png:'data:image/png;base64,AA=='}];return p;}
function rows(repo:Repository){return Object.fromEntries(['sessions','settings','resources','commands','events','recovery','requests'].map(table=>[table,repo.db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()]));}
function recovery(repo:Repository,revision:number){return repo.db.prepare('SELECT state,checksum FROM recovery WHERE session_id=? AND revision=?').get(repo.sessionId!,revision)!;}

describe('transaction-local recovery serialization',()=>{
 it('opens a validated project without reading it back and stores a complete independent recovery point',()=>{
  const repo=new Repository(':memory:'),input=assetProject(),read=vi.spyOn(repo,'snapshot');try{
   const opened=repo.open(input,'C:/saved.fpcad');expect(read).not.toHaveBeenCalled();read.mockRestore();
   const point=recovery(repo,0);expect(point.state).toBe(repo.row()!.state);expect(point.checksum).toBe(hash(String(point.state)));expect(repo.status().savedRevision).toBe(0);
   const expected=repo.snapshot();input.name='Changed caller input';opened.name='Changed return value';opened.references![0].png='data:image/png;base64,AQ==';repo.checkpoint();expect(repo.snapshot()).toEqual(expected);expect(recovery(repo,0)).toEqual(point);
  }finally{read.mockRestore();repo.close();}
 });

 it('uses the committed state for acceptance recovery and restores with only the required current-state read',()=>{
  const repo=new Repository(':memory:');repo.open(assetProject(),null);const requestId=randomUUID(),read=vi.spyOn(repo,'snapshot');try{
   repo.commit({type:'project.rename',name:'Committed'},requestId,'rename',checkpoint=>checkpoint());expect(read).toHaveBeenCalledTimes(1);read.mockClear();
   const committed=recovery(repo,1);expect(committed.state).toBe(repo.row()!.state);expect(committed.state).toBe(repo.db.prepare('SELECT response FROM requests WHERE session_id=? AND request_id=?').get(repo.sessionId!,requestId)!.response);
   repo.restore(0);expect(read).toHaveBeenCalledTimes(1);read.mockRestore();const restored=repo.snapshot()!,point=recovery(repo,2),command=repo.db.prepare('SELECT after_state FROM commands WHERE session_id=? ORDER BY sequence DESC LIMIT 1').get(repo.sessionId!)!;
   expect(restored.name).not.toBe('Committed');expect(point.state).toBe(repo.row()!.state);expect(point.state).toBe(command.after_state);expect(point.checksum).toBe(hash(String(point.state)));repo.historyMove(false);expect(repo.snapshot()!.name).toBe('Committed');repo.historyMove(true);expect(repo.snapshot()!.name).toBe(restored.name);
  }finally{read.mockRestore();repo.close();}
 });

 it.each(['open','restore','commit'] as const)('rolls back every persistent write when %s recovery fails',operation=>{
  const repo=new Repository(':memory:');repo.open(assetProject(),null);repo.commit({type:'project.rename',name:'Current'},randomUUID(),'current');const before=rows(repo),requestId=randomUUID();repo.db.exec("CREATE TRIGGER fail_checkpoint BEFORE INSERT ON recovery BEGIN SELECT RAISE(ABORT,'RECOVERY_WRITE_FAILED'); END;");try{
   const action=()=>operation==='open'?repo.open({...assetProject(),name:'New project'},null):operation==='restore'?repo.restore(0):repo.commit({type:'project.rename',name:'Uncommitted'},requestId,'uncommitted',checkpoint=>checkpoint());expect(action).toThrow('RECOVERY_WRITE_FAILED');expect(rows(repo)).toEqual(before);expect(repo.replay(requestId,'uncommitted')).toBe(false);
  }finally{repo.close();}
 });

 it('rolls back a transaction that fails after its recovery callback has written',()=>{
  const repo=new Repository(':memory:');repo.open(assetProject(),null);const before=rows(repo);try{expect(()=>repo.commit({type:'project.rename',name:'Uncommitted'},randomUUID(),'failed',checkpoint=>{checkpoint();throw Error('FOLLOW_UP_FAILED');})).toThrow('FOLLOW_UP_FAILED');expect(rows(repo)).toEqual(before);}finally{repo.close();}
 });

 it('rejects corrupted deduplicated resources when opening another project without changing any records',()=>{
  const repo=new Repository(':memory:'),input=assetProject();repo.open(input,null);repo.db.prepare('UPDATE resources SET json=?').run(JSON.stringify('damaged image'));const before=rows(repo);try{expect(()=>repo.open({...input,id:randomUUID(),name:'Another project'},null)).toThrow('RESOURCE_INTEGRITY');expect(rows(repo)).toEqual(before);}finally{repo.close();}
 });

 it.each(['checkpoint','within transaction'] as const)('validates current stored resources for an external %s',operation=>{
  const repo=new Repository(':memory:');repo.open(assetProject(),null);repo.db.prepare('UPDATE resources SET json=?').run(JSON.stringify('damaged image'));const before=rows(repo);try{expect(()=>operation==='checkpoint'?repo.checkpoint():repo.transaction(()=>repo.checkpointWithinTransaction())).toThrow('RESOURCE_INTEGRITY');expect(rows(repo)).toEqual(before);}finally{repo.close();}
 });

 it('cannot reuse a commit checkpoint callback after that transaction has completed',()=>{
  const repo=new Repository(':memory:');repo.open(assetProject(),null);let checkpoint!:()=>void;repo.commit({type:'project.rename',name:'Committed'},randomUUID(),'rename',value=>{checkpoint=value;value();});const before=rows(repo);try{expect(()=>checkpoint()).toThrow('CHECKPOINT_TRANSACTION_CLOSED');expect(rows(repo)).toEqual(before);}finally{repo.close();}
 });
});
