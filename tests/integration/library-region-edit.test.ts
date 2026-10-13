import {it,expect} from 'vitest';
import {resolve} from 'node:path';
import {randomUUID} from 'node:crypto';
import {project,rectangle} from '../fixtures';
import {editLibraryRegion,editableLibraryRegion} from '../../apps/desktop/main/library-region-edit';
import {parseObj,unwrapSurface} from '../../apps/desktop/main/surface';
import {projectMarking,markingIssues,staleMarkingIds} from '../../apps/desktop/main/markings';
import {Repository} from '../../apps/desktop/main/repository';
import {pack,unpack} from '../../apps/desktop/main/archive';
import type {SourceRegionOperation} from '../../packages/schema/index';
const worker=resolve('target/release/fpcad-worker.exe');
function sourceProject(){const p=project(),piece=rectangle(60,60);piece.allowanceMm=0;piece.nodes.forEach(n=>{n.xMm+=20;n.yMm+=20;});p.pieces=[];p.patternLibrary=[{piece,referenceId:randomUUID(),view:'front',category:'hand'}];return p;}
const ringArea=(r:{xMm:number;yMm:number}[])=>Math.abs(r.reduce((s,a,i)=>{const b=r[(i+1)%r.length];return s+a.xMm*b.yMm-b.xMm*a.yMm;},0)/2);
it('source contour changes preserve its absolute frame and metadata and remain a draft until committed',async()=>{
 const p=sourceProject(),region=p.patternLibrary![0],before=structuredClone(p),piece=structuredClone(region.piece);piece.nodes[0].xMm=25;piece.name='must not replace metadata';
 const result=await editLibraryRegion(worker,p,piece.id,{piece,operations:[]});
 expect(p).toEqual(before);expect(result.region.referenceId).toBe(region.referenceId);expect(result.region.category).toBe(region.category);expect(result.region.piece.name).toBe(region.piece.name);expect(result.region.piece.nodes[0]).toEqual({...region.piece.nodes[0],xMm:25});expect(result.region.piece.nodes.slice(1)).toEqual(region.piece.nodes.slice(1));
 const repo=new Repository(':memory:');try{repo.open(p,null);repo.commit({type:'library.region.update',...result},randomUUID(),'source contour');expect(unpack(pack(repo.snapshot()!).bytes).patternLibrary).toEqual([result.region]);repo.historyMove(false);expect(repo.snapshot()!.patternLibrary).toEqual(p.patternLibrary);repo.historyMove(true);expect(repo.snapshot()!.patternLibrary).toEqual([result.region]);}finally{repo.close();}
});
it('ordered brush and pen booleans preserve round holes and do not recenter source coordinates',async()=>{
 const p=sourceProject(),piece=p.patternLibrary![0].piece,operations:SourceRegionOperation[]=[{kind:'brush',mode:'add',radiusMm:5,points:[{xMm:70,yMm:50},{xMm:100,yMm:50}]},{kind:'pen',mode:'add',points:[{xMm:75,yMm:60},{xMm:90,yMm:60},{xMm:90,yMm:70},{xMm:75,yMm:70}]},{kind:'brush',mode:'erase',radiusMm:8,points:[{xMm:45,yMm:45}]}];
 const result=await editLibraryRegion(worker,p,piece.id,{piece,operations}),edited=result.region.piece;
 expect(edited.holes).toHaveLength(1);expect(Math.abs(ringArea(edited.holes![0])-Math.PI*64)).toBeLessThan(2*Math.PI*8*.025);expect(Math.min(...edited.nodes.map(n=>n.xMm))).toBe(20);expect(Math.max(...edited.nodes.map(n=>n.xMm))).toBeCloseTo(105,1);expect(ringArea(edited.nodes)).toBeGreaterThan(3900);expect(edited.id).toBe(piece.id);
 const erasedThenRestored=await editLibraryRegion(worker,p,piece.id,{piece,operations:[operations[2],{...operations[2],mode:'add'}]});expect(erasedThenRestored.region.piece.holes??[]).toHaveLength(0);expect(ringArea(erasedThenRestored.region.piece.nodes)).toBeCloseTo(3600,2);
});
it('invalid, disconnected, fully erased and over-budget edits cannot mutate source data',async()=>{
 const p=sourceProject(),before=structuredClone(p),piece=p.patternLibrary![0].piece;
 await expect(editLibraryRegion(worker,p,piece.id,{piece,operations:[{kind:'brush',mode:'erase',radiusMm:4,points:[{xMm:50,yMm:10},{xMm:50,yMm:90}]}]})).rejects.toThrow('MARKING_DISCONNECTED');
 await expect(editLibraryRegion(worker,p,piece.id,{piece,operations:[{kind:'brush',mode:'erase',radiusMm:100,points:[{xMm:50,yMm:50}]}]})).rejects.toThrow('EMPTY_MARKING');
 await expect(editLibraryRegion(worker,p,piece.id,{piece:{...piece,id:randomUUID()},operations:[]})).rejects.toThrow('INVALID_SELECTION');
 await expect(editLibraryRegion(worker,p,piece.id,{piece:{...piece,nodes:[piece.nodes[0],piece.nodes[2],piece.nodes[1],piece.nodes[3]]},operations:[]})).rejects.toThrow('INVALID_GEOMETRY');
 await expect(editLibraryRegion(worker,p,piece.id,{piece,operations:Array.from({length:11},()=>({kind:'brush' as const,mode:'add' as const,radiusMm:1,points:Array.from({length:500},()=>({xMm:30,yMm:30}))}))})).rejects.toThrow('RESOURCE_LIMIT');expect(p).toEqual(before);
});
async function mapped(){const p=sourceProject();p.surface=parseObj('v 0 0 0\nv 100 0 0\nv 100 100 0\nv 0 100 0\nf 1 2 3\nf 1 3 4');const run=await unwrapSurface(worker,p.surface,p);p.pieces=run.pieces;p.bindings=run.bindings;p.markings=[await projectMarking(worker,p,p.patternLibrary![0].piece.id,'front',0,0)];return p;}
it('source edits refresh attached geometry and print paths in one undoable persistent update',async()=>{
 const p=await mapped(),piece=structuredClone(p.patternLibrary![0].piece),old=p.markings![0];piece.nodes[0].xMm+=10;
 const result=await editLibraryRegion(worker,p,piece.id,{piece,operations:[]});expect(result.markings[0].id).toBe(old.id);expect(result.markings[0].fragments).not.toEqual(old.fragments);expect(result.markings[0].paths).not.toEqual(old.paths);
 const repo=new Repository(':memory:');try{repo.open(p,null);repo.commit({type:'library.region.update',...result},randomUUID(),'edit attached source');expect(markingIssues(repo.snapshot()!)).toEqual([]);expect(unpack(pack(repo.snapshot()!).bytes).markings).toEqual(result.markings);repo.historyMove(false);expect(repo.snapshot()!.markings).toEqual(p.markings);expect(repo.snapshot()!.patternLibrary).toEqual(p.patternLibrary);repo.historyMove(true);expect(repo.snapshot()!.markings).toEqual(result.markings);}finally{repo.close();}
});
it('inactive model attachments update too, while locks, dependent locks and manual UV edits block replacement',async()=>{
 const p=await mapped(),piece=structuredClone(p.patternLibrary![0].piece),marking=p.markings![0];
 const inactive=await mapped();p.modelLibrary=[{id:inactive.surface!.id,name:'Inactive',surface:inactive.surface!,pieces:inactive.pieces,bindings:inactive.bindings,markings:[{...inactive.markings![0],sourcePieceId:piece.id}]}];
 piece.nodes[0].xMm+=5;const result=await editLibraryRegion(worker,p,piece.id,{piece,operations:[]});expect(result.models[0].markings![0].paths).not.toEqual(p.modelLibrary[0].markings![0].paths);
 p.modelLibrary[0].markings![0].locked=true;expect(()=>editableLibraryRegion(p,piece.id)).toThrow('MARKING_LOCKED');p.modelLibrary[0].markings![0].locked=false;
 p.markings!.push({...marking,id:randomUUID(),sourcePieceId:undefined,locked:true,source:'inferred',inference:{algorithm:'exact-symmetry-x-1',sourceMarkingId:marking.id,sourceFingerprint:'0'.repeat(64),distanceMm:1,planeXmm:0,reviewed:false}});expect(()=>editableLibraryRegion(p,piece.id)).toThrow('MARKING_LOCKED');p.markings!.pop();p.markings![0].editMode='uv-manual';expect(()=>editableLibraryRegion(p,piece.id)).toThrow('MANUAL_MARKING_REVIEW');
});
it('automatic sibling pigments share a refreshed registration across models, including lock and manual-edit guards',async()=>{
 const p=sourceProject(),first=p.patternLibrary![0],second={...first,piece:rectangle(20,20)};first.anatomy={part:'head',side:'center',confidence:1,method:'manual'};second.anatomy=first.anatomy;second.piece.allowanceMm=0;second.piece.nodes.forEach(n=>{n.xMm+=80;n.yMm+=20;});p.patternLibrary!.push(second);
 p.surface=parseObj('v 0 0 0\nv 100 0 0\nv 100 100 0\nv 0 100 0\ng head\nf 1 2 3\nf 1 3 4');const run=await unwrapSurface(worker,p.surface,p);p.pieces=run.pieces;p.bindings=run.bindings;p.markings=[];
 for(const region of p.patternLibrary!)p.markings.push(await projectMarking(worker,p,region.piece.id,'front',0,0,false,true));
 const inactiveId=randomUUID(),inactiveSurface={...structuredClone(p.surface),id:inactiveId},inactive={...p,surface:inactiveSurface,markings:[]};
 const inactiveMarkings=[];for(const region of p.patternLibrary!)inactiveMarkings.push(await projectMarking(worker,inactive,region.piece.id,'front',0,0,false,true));p.modelLibrary=[{id:inactiveId,name:'Second head',surface:inactiveSurface,pieces:p.pieces,bindings:p.bindings,markings:inactiveMarkings}];
 expect(staleMarkingIds(p).size).toBe(0);const piece=structuredClone(first.piece);piece.nodes[0].xMm-=2;const before=structuredClone(p),result=await editLibraryRegion(worker,p,piece.id,{piece,operations:[]});expect(p).toEqual(before);expect(result.markings).toHaveLength(2);
 const after={...p,patternLibrary:[result.region,second],markings:result.markings,modelLibrary:result.models};expect(staleMarkingIds(after).size).toBe(0);expect(result.markings[1].source).toBe(p.markings[1].source);expect(result.markings[1].placement!.sourceGroupHash).not.toBe(p.markings[1].placement!.sourceGroupHash);
 const model=result.models[0];expect(staleMarkingIds({...after,surface:model.surface,pieces:model.pieces!,bindings:model.bindings,markings:model.markings}).size).toBe(0);expect(model.markings![0].editMode).toBe('source-manual');expect(model.markings![1].source).toBe(inactiveMarkings[1].source);
 p.markings[0].editMode='uv-manual';await expect(editLibraryRegion(worker,p,piece.id,{piece,operations:[]})).rejects.toThrow('MANUAL_MARKING_REVIEW');expect((await editLibraryRegion(worker,p,piece.id,{piece,operations:[]},true)).markings[0].editMode).toBe('source-manual');p.markings[0].editMode='projected';
 p.markings[1].locked=true;expect(()=>editableLibraryRegion(p,piece.id)).toThrow('MARKING_LOCKED');p.markings[1].locked=false;p.modelLibrary[0].markings![1].editMode='uv-manual';await expect(editLibraryRegion(worker,p,piece.id,{piece,operations:[]},true)).rejects.toThrow('MANUAL_MARKING_REVIEW');expect(p.patternLibrary).toEqual(before.patternLibrary);
});
