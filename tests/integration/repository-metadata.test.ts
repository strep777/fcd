import {expect,it,vi} from 'vitest';
import {randomUUID} from 'node:crypto';
import {resolve} from 'node:path';
import {Repository} from '../../apps/desktop/main/repository';
import {project} from '../fixtures';

it('returns the saved destination repeatedly without restoring the project snapshot',()=>{
 const repo=new Repository(':memory:'),input=project(),destination=resolve('.local/tests/metadata-saved.fpcad'),replacement=resolve('.local/tests/metadata-save-as.fpcad');
 try{
  expect(repo.projectMetadata()).toBeNull();repo.open(input,null);
  const snapshot=vi.spyOn(repo,'snapshot');
  try{
   expect(repo.projectMetadata()).toEqual({name:input.name,destination:null});
   repo.markSaved(destination,input.revision);
   expect(repo.projectMetadata()).toEqual({name:input.name,destination});
   expect(repo.projectMetadata()).toEqual({name:input.name,destination});
   repo.markSaved(replacement,input.revision);
   expect(repo.projectMetadata()).toEqual({name:input.name,destination:replacement});
   expect(snapshot).not.toHaveBeenCalled();
  }finally{snapshot.mockRestore();}
 }finally{repo.close();}
});

it('reads the current session name and destination after switching between saved projects',()=>{
 const repo=new Repository(':memory:'),first={...project(),name:'First saved project'},second={...project(),name:'Second saved project'},firstPath=resolve('.local/tests/metadata-first.fpcad'),secondPath=resolve('.local/tests/metadata-second.fpcad');
 try{
  repo.open(first,firstPath);const firstSession=repo.sessionId!;
  repo.open(second,secondPath);const secondSession=repo.sessionId!;
  expect(repo.projectMetadata()).toEqual({name:second.name,destination:secondPath});
  repo.activate(firstSession);expect(repo.projectMetadata()).toEqual({name:first.name,destination:firstPath});
  repo.activate(secondSession);expect(repo.projectMetadata()).toEqual({name:second.name,destination:secondPath});
 }finally{repo.close();}
});

it('does not hydrate a large image resource for metadata while full snapshots still enforce resource integrity',()=>{
 const repo=new Repository(':memory:'),input=project(),destination=resolve('.local/tests/metadata-large-resource.fpcad');
 // Storage-contract fixture only: these bytes are never sent to an image decoder.
 const png='data:image/png;base64,'+Buffer.alloc(2*1024*1024).toString('base64');
 input.references=[{id:randomUUID(),name:'Large stored image',view:'front',width:1024,height:1024,png}];
 try{
  repo.open(input,destination);
  expect(Number(repo.db.prepare('SELECT length(json) AS bytes FROM resources').get()!.bytes)).toBeGreaterThan(2*1024*1024);
  const snapshot=vi.spyOn(repo,'snapshot');
  try{
   expect(repo.projectMetadata()).toEqual({name:input.name,destination});
   repo.db.prepare('UPDATE resources SET json=?').run(JSON.stringify('damaged stored image'));
   expect(repo.projectMetadata()).toEqual({name:input.name,destination});
   expect(snapshot).not.toHaveBeenCalled();
   expect(()=>repo.snapshot()).toThrow('RESOURCE_INTEGRITY');
   expect(snapshot).toHaveBeenCalledOnce();
  }finally{snapshot.mockRestore();}
 }finally{repo.close();}
});
