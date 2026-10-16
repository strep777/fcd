import {expect,it} from 'vitest';
import {randomUUID} from 'node:crypto';
import {mkdirSync,mkdtempSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {project,rectangle} from '../fixtures';
import {Repository} from '../../apps/desktop/main/repository';
import {parseObj,bindingIssues} from '../../apps/desktop/main/surface';
import {projectMarking,markingIssues} from '../../apps/desktop/main/markings';
import {cutPreview} from '../../apps/desktop/main/cut-preview';
import {pack,unpack,atomicWrite,readProject} from '../../apps/desktop/main/archive';
import {analyze} from '../../apps/desktop/main/worker';

const worker=resolve('target/release/fpcad-worker.exe');
const commit=(repo:Repository,command:Parameters<Repository['commit']>[0])=>repo.commit(command,randomUUID(),command.type);

it('compact dense color cuts retain independent archive/model snapshots through acceptance, checkpoint, switching, undo, file save and database reopen',async()=>{
 const n=20,rows:string[]=[];for(let y=0;y<=n;y++)for(let x=0;x<=n;x++)rows.push(`v ${x*10} ${y*10} 0`);
 for(let y=0;y<n;y++)for(let x=0;x<n;x++){const a=y*(n+1)+x+1,b=a+1,c=a+n+1,d=c+1;rows.push(`f ${a} ${b} ${d}`,`f ${a} ${d} ${c}`);}
 const p=project();p.pieces=[];p.surface=parseObj(rows.join('\n'));
 const source=rectangle();source.allowanceMm=0;source.color='#ff0000';source.nodes=Array.from({length:200},(_,i)=>({id:randomUUID(),xMm:100+60*Math.cos(i*Math.PI/100),yMm:100+60*Math.sin(i*Math.PI/100)}));
 p.patternLibrary=[{piece:source,referenceId:randomUUID(),view:'front',category:'test'}];p.markings=[await projectMarking(worker,p,source.id,'front',0,0)];
 mkdirSync('.local/tests',{recursive:true});const directory=mkdtempSync('.local/tests/final-core-state-'),database=join(directory,'workspace.sqlite'),destination=join(directory,'saved.fpcad');
 let repo=new Repository(database);
 try{
  repo.open(p,null);const candidate=await cutPreview(worker,p.surface,p,{automaticCuts:false,colorBoundaryCuts:true,normalAngleDeg:180,maxFacesPerPatch:2000},resolve('dist/assets'));
  commit(repo,{type:'unwrap.candidate',run:candidate.run,markings:candidate.markings});commit(repo,{type:'unwrap.accept'});
  const accepted=repo.snapshot()!,entry=structuredClone(accepted.cuttingLibrary![0]),modelId=accepted.surface!.id;
  expect(accepted.pieces).toHaveLength(2);expect(accepted.bindings!.flatMap(b=>b.trim?.triangles??[]).length).toBeLessThan(3000);
  expect(bindingIssues(accepted)).toEqual([]);expect(markingIssues(accepted)).toEqual([]);
  expect(accepted.modelLibrary!.find(m=>m.id===modelId)!.bindings).toEqual(accepted.bindings);
  const snapshot=repo.snapshot()!;expect(snapshot.surface).not.toBe(snapshot.cuttingLibrary![0].surface);
  expect(snapshot.bindings![0].trim).not.toBe(snapshot.cuttingLibrary![0].run.bindings[0].trim);
  snapshot.surface!.vertices[0].xMm+=123;snapshot.bindings![0].trim!.vertices[0].xMm+=123;
  expect(snapshot.cuttingLibrary![0]).toEqual(entry);expect(repo.snapshot()).toEqual(accepted);
  repo.checkpoint();expect(repo.snapshot()).toEqual(accepted);
  commit(repo,{type:'surface.set',surface:parseObj('v 0 0 0\nv 10 0 0\nv 0 10 0\nf 1 2 3')});
  const alternate=repo.snapshot()!;expect(alternate.surface!.id).not.toBe(modelId);
  commit(repo,{type:'model.activate',modelId});expect(repo.snapshot()!.bindings).toEqual(accepted.bindings);
  commit(repo,{type:'cutting.activate',entryId:entry.id});const restored=repo.snapshot()!;
  expect(restored.surface).toEqual(entry.surface);expect(restored.cuttingLibrary![0]).toEqual(entry);
  expect(bindingIssues(restored)).toEqual([]);expect(markingIssues(restored)).toEqual([]);
  repo.historyMove(false);expect(repo.snapshot()!.activeCutId).toBeUndefined();repo.historyMove(false);expect(repo.snapshot()!.surface).toEqual(alternate.surface);
  repo.historyMove(true);repo.historyMove(true);const current=repo.snapshot()!;
  expect(current.activeCutId).toBe(entry.id);expect(current.cuttingLibrary![0]).toEqual(entry);
  expect((await analyze(worker,current)).flatMap(g=>g.issues.filter(i=>i.severity==='error'))).toEqual([]);
  expect(unpack(pack(current).bytes)).toEqual(current);await atomicWrite(destination,pack(current).bytes);expect(await readProject(destination)).toEqual(current);
  repo.markSaved(destination,current.revision);repo.checkpoint();expect(repo.status().savedRevision).toBe(current.revision);
  const session=repo.sessionId;repo.close();repo=new Repository(database);
  expect(repo.sessionId).toBe(session);expect(repo.snapshot()).toEqual(current);expect(repo.status().savedRevision).toBe(current.revision);
  repo.historyMove(false);expect(repo.snapshot()!.activeCutId).toBeUndefined();repo.historyMove(true);
  expect(repo.snapshot()!.cuttingLibrary![0]).toEqual(entry);expect(bindingIssues(repo.snapshot()!)).toEqual([]);
 }finally{repo.close();}
},30000);
