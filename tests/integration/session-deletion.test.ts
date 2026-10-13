import {it,expect,vi} from 'vitest';
import {randomUUID} from 'node:crypto';
import {mkdirSync,mkdtempSync,readFileSync,writeFileSync,statSync,existsSync} from 'node:fs';
import {join} from 'node:path';
import {Repository,hash} from '../../apps/desktop/main/repository';
import {parseObj} from '../../apps/desktop/main/surface';
import {project} from '../fixtures';
const png=(value:string)=>'data:image/png;base64,'+Buffer.from(value).toString('base64');
const reference=(value:string)=>({id:randomUUID(),name:'Image',view:'front' as const,width:1,height:1,png:png(value)});
const disk=()=>{mkdirSync('.local/tests',{recursive:true});const dir=mkdtempSync('.local/tests/session-deletion-');return {dir,path:join(dir,'workspace.sqlite')};};
const tables=['sessions','commands','events','recovery','requests','resources','settings'];
function rows(repo:Repository){return Object.fromEntries([...tables,...(repo.db.prepare("SELECT 1 FROM sqlite_master WHERE name='jobs'").get()?['jobs']:[])].map(table=>[table,repo.db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()]));}
function jobs(repo:Repository){repo.db.exec('CREATE TABLE jobs(id TEXT PRIMARY KEY,session_id TEXT REFERENCES sessions(id),request_id TEXT,fingerprint TEXT,record TEXT NOT NULL,UNIQUE(session_id,request_id));');}
function storeResource(repo:Repository,value:unknown){const json=JSON.stringify(value),digest=hash(json);repo.db.prepare('INSERT INTO resources VALUES(?,?)').run(digest,json);return 'sqlite-resource:'+digest;}

it('disk deletion removes all owned rows, reclaims bytes, retains shared assets and never touches an external saved file',()=>{
 const {dir,path}=disk(),external=join(dir,'user-saved.fpcad'),saved=Buffer.from('User-saved archive remains outside local deletion');writeFileSync(external,saved);
 let repo=new Repository(path);const a=project(),shared=reference('shared original image'),secret='DELETED_SESSION_SECRET_'+randomUUID();a.name=secret;a.references=[shared,reference('x'.repeat(900000))];a.surface=parseObj('v 0 0 0\nv 100 0 0\nv 0 100 0\nf 1 2 3');repo.open(a,external);const deleted=repo.sessionId!;repo.commit({type:'project.rename',name:secret+' changed'},randomUUID(),'rename');repo.checkpoint();jobs(repo);repo.db.prepare('INSERT INTO jobs VALUES(?,?,?,?,?)').run(randomUUID(),deleted,randomUUID(),'job',JSON.stringify({status:'succeeded',localResult:secret}));
 const b=project();b.references=[structuredClone(shared)];b.surface=structuredClone(a.surface);repo.open(b,null);const surviving=repo.sessionId!,before=repo.snapshot();repo.db.prepare('INSERT INTO settings VALUES(?,?)').run('theme','dark');repo.db.exec('PRAGMA wal_checkpoint(TRUNCATE)');const beforeBytes=statSync(path).size;
 expect(repo.db.prepare('PRAGMA secure_delete').get()?.secure_delete).toBe(1);expect(repo.deleteSession(deleted)).toBe(true);expect(repo.maintenanceWarning).toBeUndefined();expect(repo.sessionId).toBe(surviving);expect(repo.snapshot()).toEqual(before);expect(repo.db.prepare('SELECT COUNT(*) AS n FROM resources').get()?.n).toBe(2);
 for(const table of ['commands','events','recovery','requests','jobs'])expect(repo.db.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE session_id=?`).get(deleted)?.n).toBe(0);
 expect(repo.db.prepare('SELECT * FROM sessions WHERE id=?').get(deleted)).toBeUndefined();expect(readFileSync(external)).toEqual(saved);expect(statSync(path).size).toBeLessThan(beforeBytes/2);expect(readFileSync(path).includes(Buffer.from(secret))).toBe(false);if(existsSync(path+'-wal'))expect(statSync(path+'-wal').size).toBe(0);repo.close();
 repo=new Repository(path);try{expect(repo.recent().map(p=>p.sessionId)).toEqual([surviving]);expect(repo.snapshot()).toEqual(before);expect(repo.deleteSession(deleted)).toBe(false);expect(repo.deleteSession(surviving)).toBe(true);expect(repo.sessionId).toBeNull();expect(repo.snapshot()).toBeNull();expect(repo.recent()).toEqual([]);for(const table of ['sessions','commands','events','recovery','requests','jobs','resources'])expect(repo.db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get()?.n).toBe(0);expect(repo.db.prepare("SELECT value FROM settings WHERE key='theme'").get()?.value).toBe('dark');expect(readFileSync(external)).toEqual(saved);}finally{repo.close();}
 repo=new Repository(path);try{expect(repo.sessionId).toBeNull();expect(repo.recent()).toEqual([]);expect(repo.db.prepare('SELECT COUNT(*) AS n FROM resources').get()?.n).toBe(0);}finally{repo.close();}
});

it('keeps a resource referenced only by another session’s undo history, and undo still restores it after reopening',()=>{
 const {path}=disk(),image=reference('undo-only original'),p=project();p.references=[image];let repo=new Repository(path);repo.open(p,null);const victim=repo.sessionId!;const keep=project();keep.references=[structuredClone(image)];repo.open(keep,null);const surviving=repo.sessionId!;repo.commit({type:'reference.delete',referenceId:image.id},randomUUID(),'remove');repo.db.prepare('DELETE FROM recovery WHERE session_id=?').run(surviving);repo.db.prepare('DELETE FROM requests WHERE session_id=?').run(surviving);expect(repo.snapshot()!.references).toEqual([]);expect(repo.deleteSession(victim)).toBe(true);expect(repo.db.prepare('SELECT COUNT(*) AS n FROM resources').get()?.n).toBe(1);repo.close();
 repo=new Repository(path);try{repo.historyMove(false);expect(repo.snapshot()!.references).toEqual([image]);expect(repo.deleteSession(surviving)).toBe(true);expect(repo.db.prepare('SELECT COUNT(*) AS n FROM resources').get()?.n).toBe(0);}finally{repo.close();}
});

it.each(['recovery','requests','jobs'] as const)('keeps resources rooted only in a surviving %s record',table=>{
 const {path}=disk(),repo=new Repository(path),image=reference(table+' only'),p=project();p.references=[image];try{repo.open(p,null);const victim=repo.sessionId!;repo.create('Survivor');const surviving=repo.sessionId!,state=JSON.stringify({...repo.snapshot(),references:[{...image,png:'sqlite-resource:'+hash(JSON.stringify(image.png))}]});
  if(table==='recovery')repo.db.prepare('INSERT INTO recovery VALUES(?,?,?,?)').run(surviving,99,state,hash(state));
  if(table==='requests')repo.db.prepare('INSERT INTO requests VALUES(?,?,?,?)').run(surviving,randomUUID(),'retained request',state);
  if(table==='jobs'){jobs(repo);repo.db.prepare('INSERT INTO jobs VALUES(?,?,?,?,?)').run(randomUUID(),surviving,randomUUID(),'retained job',JSON.stringify({candidate:JSON.parse(state)}));}
  expect(repo.deleteSession(victim)).toBe(true);expect(repo.snapshot()!.references).toBeUndefined();expect(repo.db.prepare('SELECT json FROM resources WHERE digest=?').get(hash(JSON.stringify(image.png)))?.json).toBe(JSON.stringify(image.png));expect(repo.deleteSession(surviving)).toBe(true);expect(repo.db.prepare('SELECT COUNT(*) AS n FROM resources').get()?.n).toBe(0);
 }finally{repo.close();}
});

it('follows nested resource references and collects unreachable assets while preserving shared descendants',()=>{
 const repo=new Repository(':memory:');try{repo.create('Victim');const victim=repo.sessionId!;repo.create('Survivor');const surviving=repo.sessionId!;jobs(repo);const child=storeResource(repo,{pixels:'shared descendant'}),parent=storeResource(repo,{assets:[{source:child}]}),orphan=storeResource(repo,{pixels:'deleted orphan'});repo.db.prepare('INSERT INTO jobs VALUES(?,?,?,?,?)').run(randomUUID(),surviving,randomUUID(),'root',JSON.stringify({candidate:parent}));expect(repo.deleteSession(victim)).toBe(true);expect(repo.db.prepare('SELECT digest FROM resources').all().map(r=>r.digest).sort()).toEqual([child.slice(16),parent.slice(16)].sort());expect(repo.db.prepare('SELECT 1 FROM resources WHERE digest=?').get(orphan.slice(16))).toBeUndefined();expect(repo.deleteSession(surviving)).toBe(true);expect(repo.db.prepare('SELECT COUNT(*) AS n FROM resources').get()?.n).toBe(0);}finally{repo.close();}
});

it.each(['state','schema','history','history-schema','recovery','recovery-schema','requests','requests-schema','jobs','resource'] as const)('rolls back conservatively when surviving %s data is damaged',kind=>{
 const {path}=disk(),repo=new Repository(path);try{const p=project();p.references=[reference('victim asset')];repo.open(p,null);const victim=repo.sessionId!;const keep=project();keep.references=[reference('surviving asset')];repo.open(keep,null);const surviving=repo.sessionId!;repo.commit({type:'project.rename',name:'Surviving'},randomUUID(),'history');jobs(repo);
  if(kind==='state'||kind==='schema')repo.db.prepare('UPDATE sessions SET state=? WHERE id=?').run(kind==='state'?'broken JSON':'{}',surviving);
  if(kind==='history'||kind==='history-schema')repo.db.prepare('UPDATE commands SET before_state=? WHERE session_id=?').run(kind==='history'?'broken JSON':'{}',surviving);
  if(kind==='recovery'||kind==='recovery-schema')repo.db.prepare('UPDATE recovery SET state=? WHERE session_id=?').run(kind==='recovery'?'broken JSON':'{}',surviving);
  if(kind==='requests'||kind==='requests-schema')repo.db.prepare('UPDATE requests SET response=? WHERE session_id=?').run(kind==='requests'?'broken JSON':'{}',surviving);
  if(kind==='jobs')repo.db.prepare('INSERT INTO jobs VALUES(?,?,?,?,?)').run(randomUUID(),surviving,randomUUID(),'broken','broken JSON');
  if(kind==='resource')repo.db.prepare('UPDATE resources SET json=? WHERE digest=?').run('"tampered"',hash(JSON.stringify(keep.references![0].png)));
  const before=rows(repo);expect(()=>repo.deleteSession(victim)).toThrow(/DATABASE_INTEGRITY|RESOURCE_INTEGRITY/);expect(rows(repo)).toEqual(before);expect(repo.sessionId).toBe(surviving);
 }finally{repo.close();}
});

it('a failure during resource deletion rolls back session rows, active state, history, requests, jobs and assets together',()=>{
 const {path}=disk(),repo=new Repository(path);try{repo.create('Survivor');const p=project();p.references=[reference('victim asset')];repo.open(p,null);const victim=repo.sessionId!;repo.commit({type:'project.rename',name:'Victim changed'},randomUUID(),'edit');repo.checkpoint();jobs(repo);repo.db.prepare('INSERT INTO jobs VALUES(?,?,?,?,?)').run(randomUUID(),victim,randomUUID(),'job','{}');const before=rows(repo),snapshot=repo.snapshot();repo.db.exec("CREATE TRIGGER fail_cleanup BEFORE DELETE ON resources BEGIN SELECT RAISE(ABORT,'injected resource deletion failure'); END;");expect(()=>repo.deleteSession(victim)).toThrow('injected resource deletion failure');expect(rows(repo)).toEqual(before);expect(repo.snapshot()).toEqual(snapshot);expect(repo.sessionId).toBe(victim);}finally{repo.close();}
});

it('post-commit compaction failure reports a maintenance warning, and an idempotent retry reclaims storage',()=>{
 const {path}=disk();let repo=new Repository(path);repo.create('Victim');const victim=repo.sessionId!,exec=repo.db.exec.bind(repo.db),spy=vi.spyOn(repo.db,'exec').mockImplementation(sql=>{if(sql==='VACUUM')throw new Error('injected compaction failure');return exec(sql);});try{expect(repo.deleteSession(victim)).toBe(true);expect(repo.maintenanceWarning).toBe('STORAGE_RECLAIM_FAILED');expect(repo.snapshot()).toBeNull();expect(repo.recent()).toEqual([]);}finally{spy.mockRestore();}expect(repo.deleteSession(victim)).toBe(false);expect(repo.maintenanceWarning).toBeUndefined();repo.close();repo=new Repository(path);try{expect(repo.snapshot()).toBeNull();expect(repo.recent()).toEqual([]);}finally{repo.close();}
});
