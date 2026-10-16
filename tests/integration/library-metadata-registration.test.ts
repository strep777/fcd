import {expect,it} from 'vitest';
import {randomUUID} from 'node:crypto';
import {resolve} from 'node:path';
import {project,rectangle} from '../fixtures';
import {parseObj} from '../../apps/desktop/main/surface';
import {projectMarking,staleMarkingIds} from '../../apps/desktop/main/markings';
import {refreshLibraryRegionMetadata} from '../../apps/desktop/main/library-region-edit';
import {Repository} from '../../apps/desktop/main/repository';
const worker=resolve('target/release/fpcad-worker.exe');
async function mappedGroups(){
 const p=project();p.pieces=[];p.surface=parseObj('v 0 0 0\nv 100 0 0\nv 100 100 0\nv 0 100 0\ng head\nf 1 2 3\nf 1 3 4\nv 0 -200 0\nv 100 -200 0\nv 100 -100 0\nv 0 -100 0\ng body\nf 5 6 7\nf 5 7 8');
 const ref=randomUUID();p.patternLibrary=[['head',20,20,60],['head',80,20,20],['body',20,-180,60]].map(([part,x,y,size])=>{const piece=rectangle(Number(size),Number(size));piece.allowanceMm=0;piece.nodes.forEach(n=>{n.xMm+=Number(x);n.yMm+=Number(y);});return {piece,referenceId:ref,view:'front' as const,category:String(part),anatomy:{part:part as 'head'|'body',side:'center' as const,confidence:1,method:'manual' as const}};});
 p.markings=[];for(const region of p.patternLibrary)p.markings.push(await projectMarking(worker,p,region.piece.id,'front',0,0,false,true));
 const surface={...structuredClone(p.surface),id:randomUUID()},inactive={...p,surface,markings:[]},markings=[];for(const region of p.patternLibrary)markings.push(await projectMarking(worker,inactive,region.piece.id,'front',0,0,false,true));p.modelLibrary=[{id:surface.id,name:'Second model',surface,pieces:[],markings}];return p;
}
it('changing source anatomy refreshes old and new pigment groups on active and saved models atomically',async()=>{
 const p=await mappedGroups(),before=structuredClone(p),region={...p.patternLibrary![0],category:'body',anatomy:{...p.patternLibrary![0].anatomy!,part:'body' as const}},result=await refreshLibraryRegionMetadata(worker,p,region);
 expect(p).toEqual(before);expect(result.markings).toHaveLength(3);expect(result.markings.map(m=>m.id)).toEqual(p.markings!.map(m=>m.id));for(let i=0;i<3;i++)expect(result.markings[i].placement!.sourceGroupHash).not.toBe(p.markings![i].placement!.sourceGroupHash);
 const repo=new Repository(':memory:');try{repo.open(p,null);repo.commit({type:'library.region.update',...result},randomUUID(),'anatomy');const after=repo.snapshot()!;expect(staleMarkingIds(after).size).toBe(0);const model=after.modelLibrary!.find(m=>m.id!==after.surface!.id)!;expect(staleMarkingIds({...after,surface:model.surface,pieces:model.pieces!,bindings:model.bindings,markings:model.markings}).size).toBe(0);expect(after.markings![0].placement!.part).toBe('body');repo.historyMove(false);expect(repo.snapshot()!.patternLibrary).toEqual(before.patternLibrary);expect(repo.snapshot()!.markings).toEqual(before.markings);}finally{repo.close();}
});
it('a locked sibling in either affected group blocks metadata changes before mutation',async()=>{
 const p=await mappedGroups(),region={...p.patternLibrary![0],anatomy:{...p.patternLibrary![0].anatomy!,part:'body' as const}};
 p.markings![1].locked=true;await expect(refreshLibraryRegionMetadata(worker,p,region)).rejects.toThrow('MARKING_LOCKED');p.markings![1].locked=false;p.modelLibrary![0].markings![2].locked=true;const before=structuredClone(p);await expect(refreshLibraryRegionMetadata(worker,p,region)).rejects.toThrow('MARKING_LOCKED');expect(p).toEqual(before);
});
