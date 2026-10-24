import {expect,it} from 'vitest';
import {randomUUID} from 'node:crypto';
import {Repository,hash} from '../../apps/desktop/main/repository';
import {project} from '../fixtures';

function sharedImageProject(){
 const p=project(),png='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==',sha256=hash(Buffer.from(png.slice(22),'base64'));
 const variant={width:1,height:1,png,sha256,scaleX:1,scaleY:1};
 p.references=[{id:randomUUID(),name:'Shared original',view:'front',width:1,height:1,png,resources:{version:1,source:{mime:'image/png',width:1,height:1,orientation:1,data:png,sha256,transform:[1,0,0,1,0,0]},original:{sha256},proxy:{...variant},thumbnail:{...variant}}}];
 return p;
}
function countResourceAttempts(repo:Repository){
 repo.db.exec('CREATE TABLE resource_attempts(digest TEXT); CREATE TRIGGER count_resource_attempts BEFORE INSERT ON resources BEGIN INSERT INTO resource_attempts VALUES(NEW.digest); END;');
 return ()=>Number(repo.db.prepare('SELECT COUNT(*) AS count FROM resource_attempts').get()!.count);
}
function rows(repo:Repository){return Object.fromEntries(['sessions','settings','resources','commands','events','recovery','requests','resource_attempts'].map(table=>[table,repo.db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()]));}

it('inserts a shared original/proxy/thumbnail once and reuses it without another insertion while retaining every image field',()=>{
 const repo=new Repository(':memory:'),input=sharedImageProject(),attempts=countResourceAttempts(repo);
 try{
  repo.open(input,null);expect(attempts()).toBe(1);expect(repo.snapshot()!.references).toEqual(input.references);
  expect(repo.db.prepare('SELECT COUNT(*) AS count FROM resources').get()!.count).toBe(1);
  const state=JSON.parse(String(repo.row()!.state)),image=state.references[0];
  expect(image.png).toMatch(/^sqlite-resource:[a-f0-9]{64}$/);expect(image.resources.source.data).toBe(image.png);expect(image.resources.proxy.png).toBe(image.png);expect(image.resources.thumbnail.png).toBe(image.png);
  repo.checkpoint();expect(attempts()).toBe(1);expect(repo.snapshot()!.references).toEqual(input.references);
 }finally{repo.close();}
});

it('checks the first shared resource again on every call and rolls back an open after stored image corruption',()=>{
 const repo=new Repository(':memory:'),input=sharedImageProject(),attempts=countResourceAttempts(repo);
 try{
  repo.open(input,null);repo.open({...input,id:randomUUID(),name:'Second image owner'},null);expect(attempts()).toBe(1);
  repo.db.prepare('UPDATE resources SET json=?').run(JSON.stringify('damaged image'));const before=rows(repo);
  expect(()=>repo.open({...input,id:randomUUID(),name:'Rejected image owner'},null)).toThrow('RESOURCE_INTEGRITY');expect(rows(repo)).toEqual(before);
 }finally{repo.close();}
});

it('checkpoints an existing verified asset without invoking resource-insertion side effects',()=>{
 const repo=new Repository(':memory:'),input=sharedImageProject();
 try{
  repo.open(input,null);const before=repo.snapshot();
  repo.db.exec("CREATE TRIGGER reject_resource_insert BEFORE INSERT ON resources BEGIN SELECT RAISE(ABORT,'RESOURCE_INSERT_FORBIDDEN'); END;");
  expect(()=>repo.checkpoint()).not.toThrow();expect(repo.snapshot()).toEqual(before);
  repo.db.prepare('UPDATE resources SET json=?').run(JSON.stringify('corrupted after checkpoint'));
  expect(()=>repo.open({...input,id:randomUUID()},null)).toThrow('RESOURCE_INTEGRITY');
 }finally{repo.close();}
});

it('does not retain a resource reference from a failed transaction when the same project is retried',()=>{
 const repo=new Repository(':memory:'),input=sharedImageProject(),attempts=countResourceAttempts(repo);
 try{
  repo.db.exec("CREATE TRIGGER fail_resource BEFORE INSERT ON resources BEGIN SELECT RAISE(ABORT,'RESOURCE_WRITE_FAILED'); END;");
  expect(()=>repo.open(input,null)).toThrow('RESOURCE_WRITE_FAILED');expect(repo.sessionId).toBeNull();expect(attempts()).toBe(0);
  repo.db.exec('DROP TRIGGER fail_resource');repo.open(input,null);expect(attempts()).toBe(1);expect(repo.snapshot()!.references).toEqual(input.references);
 }finally{repo.close();}
});
