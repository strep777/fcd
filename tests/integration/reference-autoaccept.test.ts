import {it,expect} from 'vitest';
import {randomUUID} from 'node:crypto';
import {Repository,hash} from '../../apps/desktop/main/repository';
import {referenceKey} from '../../packages/reference/resources';
import {rectangle} from '../fixtures';
import {commandSchema,type Command} from '../../packages/schema/index';

it('confirms a computed selection and saves its source in one undoable transaction',()=>{
 const repo=new Repository(':memory:');repo.create('selection');
 const reference={id:randomUUID(),name:'original',view:'front' as const,width:20,height:20,png:'data:image/png;base64,AAAA',calibration:{a:{x:0,y:20},b:{x:0,y:0},distanceMm:20}};
 repo.commit({type:'reference.put',reference},randomUUID(),'import');const before=repo.snapshot()!;
 const command={type:'reference.candidate',library:true,run:{referenceId:reference.id,sourceHash:hash(referenceKey(reference)),piece:rectangle(20,20),mask:{width:20,height:20,pixels:'1'.repeat(400)},pixelCount:400,proxyWidth:20,proxyHeight:20,accepted:false}};
 expect(commandSchema.safeParse(command).success).toBe(true);
 repo.commit(command as Command,randomUUID(),'confirm');const saved=repo.snapshot()!;
 expect(saved.revision).toBe(before.revision+1);expect(saved.patternLibrary).toHaveLength(1);expect(saved.referenceRun?.accepted).toBe(true);expect(saved.maskSources).toHaveLength(1);
 repo.historyMove(false);expect(repo.snapshot()!.patternLibrary).toEqual(before.patternLibrary);expect(repo.snapshot()!.maskSources).toEqual(before.maskSources);repo.close();
});

it('keeps the last confirmed selection and history unchanged when retained mask sources reach the limit',()=>{
 const repo=new Repository(':memory:');repo.create('limited selection');
 const reference={id:randomUUID(),name:'original',view:'front' as const,width:20,height:20,png:'data:image/png;base64,AAAA',calibration:{a:{x:0,y:20},b:{x:0,y:0},distanceMm:20}};
 repo.commit({type:'reference.put',reference},randomUUID(),'import');
 const selection=():Command=>({type:'reference.candidate',library:true,run:{referenceId:reference.id,sourceHash:hash(referenceKey(reference)),piece:rectangle(20,20),mask:{width:20,height:20,pixels:'1'.repeat(400)},pixelCount:400,proxyWidth:20,proxyHeight:20,accepted:false}});
 for(let i=0;i<20;i++)repo.commit(selection(),randomUUID(),'confirm');
 const before=repo.snapshot();expect(before!.patternLibrary).toHaveLength(20);
 expect(()=>repo.commit(selection(),randomUUID(),'over limit')).toThrow('MASK_SOURCE_LIMIT');expect(repo.snapshot()).toEqual(before);
 repo.historyMove(false);expect(repo.snapshot()!.patternLibrary).toHaveLength(19);expect(repo.snapshot()!.maskSources).toHaveLength(19);repo.close();
});
