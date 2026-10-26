import {expect,it} from 'vitest';
import {randomUUID} from 'node:crypto';
import {resolve} from 'node:path';
import {project} from '../fixtures';
import {detailPlane,detailWorker,sourceFragmentArea} from '../fixtures/detail-fabrication';
import {parseObj,unwrapSurface,bindingIssues} from '../../apps/desktop/main/surface';
import {surfaceMarking,staleMarkingIds,markingIssues} from '../../apps/desktop/main/markings';
import {markingFingerprint} from '../../apps/desktop/main/marking-fingerprint';
import {inferMarking} from '../../apps/desktop/main/marking-completion';
import {editSurfaceMarking,brushSurfaceMarking} from '../../apps/desktop/main/surface-marking-edit';
import {editableShape,transformShape} from '../../packages/surface/attached-edit';
import {cutPreview} from '../../apps/desktop/main/cut-preview';
import {Repository} from '../../apps/desktop/main/repository';
import {pack,unpack} from '../../apps/desktop/main/archive';
const frame={origin:[0,0,0] as [number,number,number],axes:[[1,0,0],[0,1,0],[0,0,1]] as [[number,number,number],[number,number,number],[number,number,number]]};

it.each(['symmetry','extend'] as const)('real %s inference inherits detail, retains approval and dependency guards and survives undo/archive',async mode=>{
 const p=project();p.pieces=[];p.surface=parseObj('v 0 0 0\nv 100 0 0\nv 200 0 0\nv 0 100 0\nv 100 100 0\nv 200 100 0\ng left\nf 1 2 5\nf 1 5 4\ng right\nf 2 3 5\nf 3 6 5');
 const run=await unwrapSurface(detailWorker,p.surface,p);p.pieces=run.pieces;p.bindings=run.bindings;
 const source=await surfaceMarking(detailWorker,p,{...frame,nodes:[{xMm:0,yMm:0},{xMm:100,yMm:0},{xMm:100,yMm:100},{xMm:0,yMm:100}]},'#080608','Printed source');source.fabrication='detail';p.markings=[source];
 const before=structuredClone(p),inferred=await inferMarking(detailWorker,p,source.id,mode,200,100);expect(p).toEqual(before);expect(inferred.fabrication).toBe('detail');expect(inferred.inference!.reviewed).toBe(false);expect(inferred.inference!.sourceFingerprint).toBe(markingFingerprint(source));expect(sourceFragmentArea(p,inferred)).toBeCloseTo(10000,6);expect(inferred.fragments.every(f=>!source.fragments.some(s=>s.faceId===f.faceId))).toBe(true);
 p.markings.push(inferred);expect(staleMarkingIds(p).size).toBe(0);expect(markingIssues(p).map(i=>i.messageKey)).toEqual(['INFERRED_MARKING_REVIEW']);
 const repo=new Repository(':memory:');try{repo.open(p,null);repo.commit({type:'marking.review',markingId:inferred.id,reviewed:true},randomUUID(),'Review printed inference');const approved=repo.snapshot()!;expect(approved.markings![1].fabrication).toBe('detail');expect(markingIssues(approved)).toEqual([]);expect(unpack(pack(approved).bytes)).toEqual(approved);repo.historyMove(false);expect(repo.snapshot()!.markings![1].inference!.reviewed).toBe(false);repo.historyMove(true);expect(repo.snapshot()!.markings![1]).toEqual(approved.markings![1]);}finally{repo.close();}
 const dependent=structuredClone(p);dependent.markings![0].fabrication='sewn';expect(staleMarkingIds(dependent).has(inferred.id)).toBe(true);expect(dependent.markings![1].inference).toEqual(inferred.inference);
},60000);

it('surface resizing and additive/eraser strokes keep detail role and still produce one cloth panel',async()=>{
 const {p,detail}=await detailPlane({detailRole:'detail'}),old=p.markings!.find(m=>m.sourcePieceId===detail.id)!,before=structuredClone(p);
 const moved=await editSurfaceMarking(detailWorker,p,old.id,transformShape(editableShape(p.surface!,old,frame,p),1.1));expect(p).toEqual(before);expect(moved.id).toBe(old.id);expect(moved.fabrication).toBe('detail');expect(sourceFragmentArea(p,moved)).toBeCloseTo(484,4);p.markings=p.markings!.map(m=>m.id===old.id?moved:m);
 const added=await brushSurfaceMarking(detailWorker,p,old.id,{mode:'add',radiusMm:3,points:[{xMm:60,yMm:50},{xMm:64,yMm:50}]});expect(added.fabrication).toBe('detail');expect(sourceFragmentArea(p,added)).toBeGreaterThan(484);p.markings=p.markings!.map(m=>m.id===old.id?added:m);
 const erased=await brushSurfaceMarking(detailWorker,p,old.id,{mode:'erase',radiusMm:2,points:[{xMm:50,yMm:50}]});expect(erased.fabrication).toBe('detail');expect(erased.surfaceShape!.holes).toHaveLength(1);expect(sourceFragmentArea(p,erased)).toBeLessThan(sourceFragmentArea(p,added));p.markings=p.markings!.map(m=>m.id===old.id?erased:m);expect(staleMarkingIds(p).size).toBe(0);
 const c=await cutPreview(detailWorker,p.surface!,p,{partitionStrategy:'design',automaticCuts:true,colorBoundaryCuts:true,method:'arap'},resolve('dist/assets'));expect(c.run.pieces).toHaveLength(1);expect(c.run.pieces[0].color).toBe('#2786b6');expect(c.markings.find(m=>m.id===old.id)!.fabrication).toBe('detail');expect(c.markings.find(m=>m.id===old.id)!.paths[0].rings).toHaveLength(2);expect(bindingIssues({...p,pieces:c.run.pieces,bindings:c.run.bindings,markings:c.markings}).filter(i=>i.severity==='error')).toEqual([]);
},60000);
