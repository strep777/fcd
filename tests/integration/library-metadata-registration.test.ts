import {expect,it} from 'vitest';
import {randomUUID} from 'node:crypto';
import {resolve} from 'node:path';
import {project,rectangle} from '../fixtures';
import {parseObj} from '../../apps/desktop/main/surface';
import {projectMarking,staleMarkingIds,markingFingerprint} from '../../apps/desktop/main/markings';
import {refreshLibraryRegionMetadata} from '../../apps/desktop/main/library-region-edit';
import {Repository} from '../../apps/desktop/main/repository';
import {pack,unpack} from '../../apps/desktop/main/archive';
import type {Project,Marking} from '../../packages/schema/index';
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

async function saveSecondModel(p:Project){
 const surface={...structuredClone(p.surface!),id:randomUUID()},inactive={...p,surface,markings:[]},markings:Marking[]=[];
 for(const region of p.patternLibrary!)for(const context of region.anatomy?.contexts??[region.anatomy!])markings.push(await projectMarking(worker,inactive,region.piece.id,region.view,0,0,false,true,context));
 p.modelLibrary=[{id:surface.id,name:'Saved model',surface,pieces:[],markings}];
}
function savedProject(p:Project){const model=p.modelLibrary!.find(m=>m.id!==p.surface!.id)!;return {...p,surface:model.surface,pieces:model.pieces??[],bindings:model.bindings,markings:model.markings};}
async function persistMetadata(p:Project,region:NonNullable<Project['patternLibrary']>[number]){
 const before=structuredClone(p),result=await refreshLibraryRegionMetadata(worker,p,region),repo=new Repository(':memory:');expect(p).toEqual(before);
 try{
  repo.open(p,null);repo.commit({type:'library.region.update',...result},randomUUID(),'metadata correction');const after=repo.snapshot()!;
  const reopened=unpack(pack(after).bytes);expect(reopened.markings).toEqual(after.markings);expect(staleMarkingIds(reopened)).toEqual(staleMarkingIds(after));
  repo.historyMove(false);expect(repo.snapshot()!.patternLibrary).toEqual(before.patternLibrary);expect(repo.snapshot()!.markings).toEqual(before.markings);
  repo.historyMove(true);expect(repo.snapshot()!.markings).toEqual(after.markings);return after;
 }finally{repo.close();}
}

it.each(['missing-part','unclassified'] as const)('saves a corrected %s source and retains invalid old attachments across active/saved models and undo',async kind=>{
 const p=await mappedGroups();for(const markings of [p.markings!,p.modelLibrary![0].markings!])markings[0].placement!.reviewed=true;
 const source=p.patternLibrary![0],region={...source,category:kind,anatomy:{part:kind==='missing-part'?'horn' as const:'unknown' as const,side:'center' as const,confidence:1,method:'manual' as const}},after=await persistMetadata(p,region);
 expect(after.patternLibrary!.find(r=>r.piece.id===source.piece.id)!.anatomy).toEqual(region.anatomy);
 for(const [old,current] of [[p,after],[savedProject(p),savedProject(after)]]){
  const original=old.markings![0],retained=current.markings!.find(m=>m.id===original.id)!;
  expect(retained.fragments).toEqual(original.fragments);expect(retained.paths).toEqual(original.paths);expect(retained.placement!.reviewed).toBe(false);expect(retained.placement!.sourceGroupHash).toBeUndefined();expect(staleMarkingIds(current).has(original.id)).toBe(true);
  expect(current.markings).toHaveLength(old.markings!.length);expect(staleMarkingIds(current).has(current.markings![1].id)).toBe(false);
 }
});

it('saves an undetermined limb side instead of rejecting the source classification',async()=>{
 const p=project();p.pieces=[];p.surface=parseObj('v -200 0 0\nv -100 0 0\nv -100 100 0\nv -200 100 0\ng arm-left\nf 1 2 3\nf 1 3 4\nv 100 0 0\nv 200 0 0\nv 200 100 0\nv 100 100 0\ng arm-right\nf 5 6 7\nf 5 7 8');
 const piece=rectangle(100,100);piece.allowanceMm=0;p.patternLibrary=[{piece,referenceId:randomUUID(),view:'front',category:'arm',anatomy:{part:'arm',side:'left',confidence:1,method:'manual'}}];p.markings=[await projectMarking(worker,p,piece.id,'front',0,0,false,true)];await saveSecondModel(p);
 const after=await persistMetadata(p,{...p.patternLibrary[0],anatomy:{part:'arm',side:'unknown',confidence:1,method:'manual'}});
 expect(after.patternLibrary![0].anatomy!.side).toBe('unknown');expect(staleMarkingIds(after).has(p.markings[0].id)).toBe(true);expect(staleMarkingIds(savedProject(after)).has(p.modelLibrary![0].markings![0].id)).toBe(true);
});

it('collapsing anatomical contexts keeps one matching registration and preserves surplus geometry as stale',async()=>{
 const p=project();p.pieces=[];p.surface=parseObj('v 0 0 0\nv 100 0 0\nv 100 200 0\nv 0 200 0\ng body\nf 1 2 3\nf 1 3 4\nv -100 80 0\nv 0 80 0\nv 0 100 0\nv -100 100 0\ng arm-left\nf 5 6 7\nf 5 7 8');
 const piece=rectangle(200,200);piece.allowanceMm=0;piece.nodes.forEach(n=>n.xMm-=100);
 const anatomy={part:'unknown' as const,side:'unknown' as const,confidence:.4,method:'silhouette-1' as const,contexts:[{part:'body' as const,side:'center' as const,confidence:.6},{part:'arm' as const,side:'left' as const,confidence:.4}]};
 p.patternLibrary=[{piece,referenceId:randomUUID(),view:'front',category:'unknown',anatomy}];p.markings=[];for(const context of anatomy.contexts)p.markings.push(await projectMarking(worker,p,piece.id,'front',0,0,false,true,context));await saveSecondModel(p);
 const after=await persistMetadata(p,{...p.patternLibrary[0],category:'arm',anatomy:{part:'arm',side:'left',confidence:1,method:'manual'}});
 for(const current of [after,savedProject(after)]){
  expect(current.markings).toHaveLength(2);const stale=staleMarkingIds(current),valid=current.markings!.filter(m=>!stale.has(m.id));
  expect(valid).toHaveLength(1);expect(valid[0].placement!.part).toBe('arm');expect(valid[0].placement!.reviewed).toBe(false);
  const oldBody=current.markings!.find(m=>m.placement!.part==='body')!;expect(oldBody).toBeDefined();expect(stale.has(oldBody.id)).toBe(true);
 }
});

it('metadata cannot repair a preexisting stale attachment or approve its inferred dependencies',async()=>{
 const p=await mappedGroups(),parent=p.markings![0];parent.sourceHash='0'.repeat(64);parent.placement!.reviewed=true;
 const child:Marking={...structuredClone(parent),id:randomUUID(),source:'inferred',sourcePieceId:undefined,placement:undefined,inference:{algorithm:'exact-symmetry-x-1',sourceMarkingId:parent.id,sourceFingerprint:markingFingerprint(parent),distanceMm:1,planeXmm:0,reviewed:false}};p.markings!.push(child);
 p.modelLibrary![0].markings![0].sourceHash='0'.repeat(64);
 const after=await persistMetadata(p,{...p.patternLibrary![0],piece:{...p.patternLibrary![0].piece,name:'Corrected source name'}});
 expect(staleMarkingIds(after).has(parent.id)).toBe(true);expect(after.markings!.find(m=>m.id===parent.id)!.sourceHash).toBe('0'.repeat(64));expect(staleMarkingIds(savedProject(after)).has(p.modelLibrary![0].markings![0].id)).toBe(true);
 const inferred=after.markings!.find(m=>m.id===child.id)!;expect(inferred.inference).toEqual(child.inference);expect(staleMarkingIds(after).has(child.id)).toBe(true);
});

it('reclassifying a valid parent leaves its inferred geometry, dependency fingerprint and pending review unchanged',async()=>{
 const p=await mappedGroups(),parent=p.markings![0];parent.placement!.reviewed=true;
 const child:Marking={...structuredClone(parent),id:randomUUID(),source:'inferred',sourcePieceId:undefined,placement:undefined,inference:{algorithm:'exact-symmetry-x-1',sourceMarkingId:parent.id,sourceFingerprint:markingFingerprint(parent),distanceMm:1,planeXmm:0,reviewed:false}};p.markings!.push(child);expect(staleMarkingIds(p).size).toBe(0);
 const after=await persistMetadata(p,{...p.patternLibrary![0],category:'body',anatomy:{part:'body',side:'center',confidence:1,method:'manual'}}),inferred=after.markings!.find(m=>m.id===child.id)!;
 expect(inferred).toEqual(child);expect(after.markings!.find(m=>m.id===parent.id)!.placement!.reviewed).toBe(false);expect(staleMarkingIds(after).has(child.id)).toBe(true);
});

it.each(['active','saved'] as const)('retains the %s model manual-edit guard while correcting source classification',async target=>{
 const p=await mappedGroups(),markings=target==='active'?p.markings!:p.modelLibrary![0].markings!;markings[0].source='manual';markings[0].editMode='uv-manual';const before=structuredClone(p);
 await expect(refreshLibraryRegionMetadata(worker,p,{...p.patternLibrary![0],anatomy:{part:'horn',side:'left',confidence:1,method:'manual'}})).rejects.toThrow('MANUAL_MARKING_REVIEW');expect(p).toEqual(before);
});
