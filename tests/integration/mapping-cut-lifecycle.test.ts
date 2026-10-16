import {expect,it} from 'vitest';
import {randomUUID} from 'node:crypto';
import {resolve} from 'node:path';
import {project} from '../fixtures';
import {Repository} from '../../apps/desktop/main/repository';
import {parseObj} from '../../apps/desktop/main/surface';
import {surfaceMarking,staleMarkingIds} from '../../apps/desktop/main/markings';
import {cutPreview} from '../../apps/desktop/main/cut-preview';
const worker=resolve('target/release/fpcad-worker.exe'),obj='v 0 0 0\nv 200 0 0\nv 200 100 0\nv 0 100 0\nf 1 2 3\nf 1 3 4';
async function accepted(){
 const p=project();p.pieces=[];p.surface=parseObj(obj);p.markings=[await surfaceMarking(worker,p,{origin:[0,0,0],axes:[[1,0,0],[0,1,0],[0,0,1]],nodes:[{xMm:40,yMm:20},{xMm:160,yMm:20},{xMm:160,yMm:80},{xMm:40,yMm:80}]},'#ff0000','Surface paint')];
 const repo=new Repository(':memory:');repo.open(p,null);const result=await cutPreview(worker,p.surface,p,{automaticCuts:true,normalAngleDeg:180},resolve('dist/assets'));repo.commit({type:'unwrap.candidate',run:result.run,markings:result.markings},randomUUID(),'candidate');repo.commit({type:'unwrap.accept'},randomUUID(),'accept');return repo;
}
it('resizing accepted painted cuts retains valid paint and clears the active manufacturing source',async()=>{
 const repo=await accepted();try{const before=repo.snapshot()!,entry=structuredClone(before.cuttingLibrary![0]);expect(staleMarkingIds(before).size).toBe(0);const tampered=structuredClone(before);tampered.markings![0].surfaceShape!.nodes[0].xMm+=1;expect(staleMarkingIds(tampered).size).toBe(1);repo.commit({type:'surface.resize',scale:1.5},randomUUID(),'resize');const after=repo.snapshot()!;
 expect(staleMarkingIds(after).size).toBe(0);expect(after.activeCutId).toBeUndefined();expect(after.bindings).toEqual([]);expect(after.cuttingLibrary![0]).toEqual(entry);expect(after.markings![0].fragments).toEqual(before.markings![0].fragments);expect(after.markings![0].surfaceShape!.nodes[0].xMm).toBeCloseTo(60);
 }finally{repo.close();}
});
it('deleting an archive referenced by an inactive model cannot orphan its retained surface paint',async()=>{
 const repo=await accepted();try{const acceptedProject=repo.snapshot()!,entry=acceptedProject.cuttingLibrary![0],modelId=acceptedProject.surface!.id;repo.commit({type:'surface.set',surface:parseObj(obj.replaceAll('200','300'))},randomUUID(),'new-model');
 let rejected=false;try{repo.commit({type:'cutting.delete',entryId:entry.id},randomUUID(),'delete');}catch{rejected=true;}
 repo.commit({type:'model.activate',modelId},randomUUID(),'original-model');expect(staleMarkingIds(repo.snapshot()!).size).toBe(0);if(rejected)expect(repo.snapshot()!.cuttingLibrary!.some(e=>e.id===entry.id)).toBe(true);
 }finally{repo.close();}
});
