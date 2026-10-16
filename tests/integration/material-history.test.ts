import {expect,it} from 'vitest';
import {randomUUID} from 'node:crypto';
import {Repository} from '../../apps/desktop/main/repository';
import {materialSchema} from '../../packages/schema/index';
import {acceptedCutProject} from '../fixtures/accepted-cut';

it('historical cuts keep referenced materials until their last archive is removed',()=>{
 const p=acceptedCutProject(),entry=p.cuttingLibrary![0];
 const material=materialSchema.parse({id:randomUUID(),name:'内衬',version:1,category:'lining',thicknessMm:1,furLengthMm:0,compensationMm:0,defaultAllowanceMm:10,furRequired:false,grainRequired:false,rotationsRad:[0],seamToleranceMm:1,stretchWarpRatio:0,stretchWeftRatio:0,measurementSource:'measured',sourceNote:''});
 entry.run.pieces[0].materialId=material.id;entry.run.pieces[0].material=material.name;
 // Only the inactive archive owns this material; live models/candidates are empty.
 p.pieces=[];p.surface=undefined;p.bindings=undefined;p.surfaceRun=undefined;p.materials=[material];
 const repo=new Repository(':memory:');
 try{
  repo.open(p,null);const before=repo.snapshot(),history=repo.status();
  expect(()=>repo.commit({type:'material.delete',materialId:material.id},randomUUID(),'blocked')).toThrow('MATERIAL_IN_USE');
  expect(repo.snapshot()).toEqual(before);expect(repo.status()).toEqual(history);
  repo.commit({type:'cutting.activate',entryId:entry.id},randomUUID(),'restore');
  expect(repo.snapshot()!.pieces[0].materialId).toBe(material.id);
  repo.historyMove(false);
  repo.commit({type:'cutting.delete',entryId:entry.id},randomUUID(),'delete-cut');
  repo.commit({type:'material.delete',materialId:material.id},randomUUID(),'delete-material');
  expect(repo.snapshot()!.materials).toEqual([]);
 }finally{repo.close();}
});
