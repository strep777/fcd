import {describe,it,expect} from 'vitest';
import {randomUUID} from 'node:crypto';
import {resolve} from 'node:path';
import {project,rectangle} from '../fixtures';
import {Repository} from '../../apps/desktop/main/repository';
import {parseObj,unwrapSurface,bindingIssues} from '../../apps/desktop/main/surface';
import {surfaceMarking,markingIssues} from '../../apps/desktop/main/markings';
import {inferMarking} from '../../apps/desktop/main/marking-completion';
import {unwrapMarkings} from '../../apps/desktop/main/unwrap-markings';
import {pairedNotches} from '../../apps/desktop/main/seam-notches';
import {seamIssues} from '../../packages/manufacturing/seams';
import {analyze} from '../../apps/desktop/main/worker';
import {pack,unpack} from '../../apps/desktop/main/archive';
import {workflowBytes,readWorkflow} from '../../apps/desktop/main/workflow-exchange';
import type {Project,Piece,Seam} from '../../packages/schema/index';

const worker=resolve('target/release/fpcad-worker.exe');
const mesh=()=>parseObj('v 0 0 0\nv 100 0 0\nv 200 0 0\nv 0 100 0\nv 100 100 0\nv 200 100 0\ng left\nf 1 2 5\nf 1 5 4\ng right\nf 2 3 5\nf 3 6 5');
const side=(p:Piece)=>({pieceId:p.id,nodeId:p.nodes[0].id,endNodeId:p.nodes[1].id,start:0,end:1,reverse:false});
const seam=(a:Piece,b:Piece):Seam=>({id:randomUUID(),name:'保存接缝',a:side(a),b:side(b),expectedEaseMm:0,toleranceMm:1,locked:false});
const commit=(repo:Repository,command:Parameters<Repository['commit']>[0])=>repo.commit(command,randomUUID(),randomUUID());
const unchanged=(repo:Repository,action:()=>void,code:string)=>{const before=repo.snapshot(),status=repo.status();expect(action).toThrow(code);expect(repo.snapshot()).toEqual(before);expect(repo.status()).toEqual(status);};
async function panel():Promise<Project>{
 const p=project();p.pieces=[];p.surface=mesh();const run=await unwrapSurface(worker,p.surface,p);p.pieces=run.pieces;p.bindings=run.bindings;
 const shape={nodes:[{xMm:10,yMm:10},{xMm:90,yMm:10},{xMm:90,yMm:90},{xMm:10,yMm:90}],origin:[0,0,0] as [number,number,number],axes:[[1,0,0],[0,1,0],[0,0,1]] as [[number,number,number],[number,number,number],[number,number,number]]};
 p.markings=[await surfaceMarking(worker,p,shape,'#ee964b','原始花纹')];return p;
}

describe('cross-step edits preserve dependencies and locked work',()=>{
 it('restores model seams and paired notches after switching, reloading archives and undoing',async()=>{
  const p=await panel(),s=seam(p.pieces[0],p.pieces[1]);p.seams=[s];p.pieces=pairedNotches(p,s.id,3,3);
  const repo=new Repository(':memory:');try{
   repo.open(p,null);commit(repo,{type:'project.rename',name:'保存工作'});const saved=repo.snapshot()!;
   commit(repo,{type:'surface.set',surface:mesh()});expect(repo.snapshot()!.seams).toEqual([]);
   for(const exchanged of [unpack(pack(repo.snapshot()!).bytes),readWorkflow(workflowBytes(repo.snapshot()!))]){
    const restored=new Repository(':memory:');try{restored.open(exchanged,null);commit(restored,{type:'model.activate',modelId:p.surface!.id});const active=restored.snapshot()!;expect(active.seams).toEqual([s]);expect(active.pieces).toEqual(saved.pieces);expect(seamIssues(active,await analyze(worker,active))).toEqual([]);expect(markingIssues(active)).toEqual([]);}finally{restored.close();}
   }
   commit(repo,{type:'model.activate',modelId:p.surface!.id});expect(repo.snapshot()!.seams).toEqual([s]);repo.historyMove(false);expect(repo.snapshot()!.surface!.id).not.toBe(p.surface!.id);repo.historyMove(true);expect(repo.snapshot()!.seams).toEqual([s]);
  }finally{repo.close();}
 });
 it('refuses a model switch that would silently remove a seam to a standalone pattern',async()=>{
  const p=await panel(),extra=rectangle();p.pieces.push(extra);p.seams=[seam(p.pieces[0],extra)];
  const repo=new Repository(':memory:');try{repo.open(p,null);unchanged(repo,()=>commit(repo,{type:'surface.set',surface:mesh()}),'SEAM_DEPENDENCY');}finally{repo.close();}
 });
 it('deleting a cut removes its binding and UV paths without invalidating the remaining marking',async()=>{
  const p=await panel(),piece=p.markings![0].paths[0].pieceId,repo=new Repository(':memory:');try{
   repo.open(p,null);commit(repo,{type:'piece.delete',pieceId:piece});const current=repo.snapshot()!;
   expect(current.bindings?.some(b=>b.pieceId===piece)).toBe(false);expect(current.markings?.some(m=>m.paths.some(path=>path.pieceId===piece))).toBe(false);expect(bindingIssues(current)).toEqual([]);expect(markingIssues(current)).toEqual([]);
   expect(current.modelLibrary![0].pieces?.some(p=>p.id===piece)).toBe(false);repo.historyMove(false);expect(repo.snapshot()!.pieces).toEqual(p.pieces);
  }finally{repo.close();}
 });
 it('refuses deleting a cut used by a locked marking',async()=>{
  const p=await panel();p.markings![0].locked=true;const repo=new Repository(':memory:');try{repo.open(p,null);unchanged(repo,()=>commit(repo,{type:'piece.delete',pieceId:p.markings![0].paths[0].pieceId}),'MARKING_LOCKED');}finally{repo.close();}
 });
 it('refuses deleting a source marking when its inferred dependent is locked',async()=>{
  const p=await panel(),source=p.markings![0];const inferred=await inferMarking(worker,p,source.id,'symmetry',100,100);inferred.locked=true;p.markings!.push(inferred);
  const repo=new Repository(':memory:');try{repo.open(p,null);unchanged(repo,()=>commit(repo,{type:'marking.delete',markingId:source.id}),'MARKING_LOCKED');}finally{repo.close();}
 });
 it('deletes an unlocked source and its inferred dependent together, with atomic undo',async()=>{
  const p=await panel(),source=p.markings![0];p.markings!.push(await inferMarking(worker,p,source.id,'symmetry',100,100));
  const repo=new Repository(':memory:');try{repo.open(p,null);commit(repo,{type:'marking.delete',markingId:source.id});expect(repo.snapshot()!.markings).toEqual([]);repo.historyMove(false);expect(repo.snapshot()!.markings).toEqual(p.markings);}finally{repo.close();}
 });
 it('refuses a Boolean-style replacement that would orphan seam references',()=>{
  const p=project(),other=rectangle();p.pieces.push(other);p.seams=[seam(p.pieces[0],other)];const repo=new Repository(':memory:');try{repo.open(p,null);unchanged(repo,()=>commit(repo,{type:'pieces.replace',removeIds:p.pieces.map(p=>p.id),pieces:[rectangle()]}),'SEAM_DEPENDENCY');}finally{repo.close();}
 });
 it('a locked seam rejects metadata edits and unlinking until explicitly unlocked',()=>{
  const p=project(),other=rectangle();p.pieces.push(other);const s=seam(p.pieces[0],other);s.locked=true;p.seams=[s];
  const repo=new Repository(':memory:');try{repo.open(p,null);unchanged(repo,()=>commit(repo,{type:'seam.put',seam:{...s,expectedEaseMm:5}}),'SEAM_LOCKED');unchanged(repo,()=>commit(repo,{type:'seam.delete',seamId:s.id}),'SEAM_LOCKED');commit(repo,{type:'seam.put',seam:{...s,locked:false}});commit(repo,{type:'seam.delete',seamId:s.id});expect(repo.snapshot()!.seams).toEqual([]);}finally{repo.close();}
 });
 it('preserves a legacy active model before its first switch even without a library record',async()=>{
  const p=await panel(),repo=new Repository(':memory:');try{repo.open(p,null);commit(repo,{type:'surface.set',surface:mesh()});expect(repo.snapshot()!.modelLibrary?.some(m=>m.id===p.surface!.id)).toBe(true);commit(repo,{type:'model.activate',modelId:p.surface!.id});expect(repo.snapshot()!.pieces).toEqual(p.pieces);expect(repo.snapshot()!.markings).toEqual(p.markings);}finally{repo.close();}
 });
 it('re-cut acceptance refuses dropping existing seams and preserves the original cuts',async()=>{
  const p=await panel();p.seams=[seam(p.pieces[0],p.pieces[1])];const run=await unwrapSurface(worker,p.surface!,{...p,pieces:[]}),repo=new Repository(':memory:');try{repo.open(p,null);commit(repo,{type:'unwrap.candidate',run});unchanged(repo,()=>commit(repo,{type:'unwrap.accept'}),'SEAM_DEPENDENCY');}finally{repo.close();}
 });
 it('removing a parent cut cannot reset review on a locked inference on a different cut',async()=>{
  const p=await panel(),source=p.markings![0],m=await inferMarking(worker,p,source.id,'symmetry',100,100);m.inference!.reviewed=true;m.locked=true;p.markings!.push(m);const repo=new Repository(':memory:');try{repo.open(p,null);unchanged(repo,()=>commit(repo,{type:'piece.delete',pieceId:source.paths[0].pieceId}),'MARKING_LOCKED');}finally{repo.close();}
 });
 it('unwrapping cannot turn an outdated reviewed inference into a valid manufacturing marking',async()=>{
  const p=await panel(),source=p.markings![0],m=await inferMarking(worker,p,source.id,'symmetry',100,100);m.inference!.reviewed=true;p.markings!.push(m);source.color='#f95738';
  expect(markingIssues(p).some(i=>i.messageKey==='STALE_MARKING')).toBe(true);const run=await unwrapSurface(worker,p.surface!,{...p,pieces:[]});await expect(unwrapMarkings(worker,p,run)).rejects.toThrow('STALE_MARKING');
 });
 it('an imported stale locked seam can be unlocked and removed so the project is repairable',async()=>{
  const p=await panel(),s=seam(p.pieces[0],p.pieces[1]);s.a.endNodeId=randomUUID();s.locked=true;p.seams=[s];const repo=new Repository(':memory:');try{repo.open(p,null);commit(repo,{type:'seam.put',seam:{...s,locked:false}});commit(repo,{type:'seam.delete',seamId:s.id});expect(repo.snapshot()!.seams).toEqual([]);}finally{repo.close();}
 });
});
