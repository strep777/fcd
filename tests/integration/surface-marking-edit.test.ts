import {it,expect} from 'vitest';
import {resolve} from 'node:path';
import {randomUUID} from 'node:crypto';
import {project,rectangle} from '../fixtures';
import {parseObj,unwrapSurface,bindingIssues,cutColorHash} from '../../apps/desktop/main/surface';
import {surfaceMarking,staleMarkingIds,projectMarking} from '../../apps/desktop/main/markings';
import {editableShape,transformShape,surfaceDragShape} from '../../packages/surface/attached-edit';
import {editSurfaceMarking,brushSurfaceMarking} from '../../apps/desktop/main/surface-marking-edit';
import {Repository} from '../../apps/desktop/main/repository';
import {pack,unpack} from '../../apps/desktop/main/archive';
const worker=resolve('target/release/fpcad-worker.exe');
async function panel(){
 const p=project();p.pieces=[];
 p.surface=parseObj('v 0 0 0\nv 100 0 0\nv 200 0 0\nv 0 100 0\nv 100 100 0\nv 200 100 0\ng left\nf 1 2 5\nf 1 5 4\ng right\nf 2 3 5\nf 3 6 5');
 const run=await unwrapSurface(worker,p.surface,p);p.pieces=run.pieces;p.bindings=run.bindings;
 p.markings=[await surfaceMarking(worker,p,{nodes:[{xMm:20,yMm:20},{xMm:80,yMm:20},{xMm:80,yMm:80},{xMm:20,yMm:80}],origin:[0,0,0],axes:[[1,0,0],[0,1,0],[0,0,1]]},'#315f7b','Editable')];return p;
}
const paintedArea=(m:Awaited<ReturnType<typeof surfaceMarking>>)=>m.paths.reduce((total,p)=>total+p.rings.reduce((sum,r)=>sum+r.reduce((s,a,i)=>{const b=r[(i+1)%r.length];return s+a.xMm*b.yMm-b.xMm*a.yMm;},0)/2,0),0);
it('repeated sizing and brushing of a body context cannot paint its source pigment onto an arm',async()=>{
 const p=project();p.pieces=[];p.surface=parseObj('v 0 0 0\nv 100 0 0\nv 100 200 0\nv 0 200 0\ng body\nf 1 2 3\nf 1 3 4\nv -100 80 0\nv 0 80 0\nv 0 100 0\nv -100 100 0\ng arm-left\nf 5 6 7\nf 5 7 8');
 const piece=rectangle(200,200);piece.allowanceMm=0;piece.nodes.forEach(n=>n.xMm-=100);
 p.patternLibrary=[{piece,referenceId:randomUUID(),view:'front',category:'unknown',anatomy:{part:'unknown',side:'unknown',method:'silhouette-1',confidence:.4,contexts:[{part:'body',side:'center',confidence:.49},{part:'arm',side:'left',confidence:.1}]}}];
 const body=await projectMarking(worker,p,piece.id,'front',0,0,false,true,{part:'body',side:'center'});p.markings=[body];
 const frame={origin:[0,0,0] as [number,number,number],axes:[[1,0,0],[0,1,0],[0,0,1]] as [[number,number,number],[number,number,number],[number,number,number]]};
 const onlyBody=(m:typeof body)=>expect(m.fragments.every(f=>p.surface!.faces.find(face=>face.id===f.faceId)?.region==='body')).toBe(true);
 const first=await editSurfaceMarking(worker,p,body.id,transformShape(editableShape(p.surface,body,frame,p),1.5));onlyBody(first);p.markings=[first];
 const second=await editSurfaceMarking(worker,p,body.id,transformShape(first.surfaceShape!,1.1));onlyBody(second);p.markings=[second];
 const brushed=await brushSurfaceMarking(worker,p,body.id,{mode:'add',radiusMm:12,points:[{xMm:-40,yMm:90},{xMm:20,yMm:90}]});onlyBody(brushed);p.markings=[brushed];
 expect(staleMarkingIds(p).size).toBe(0);expect(unpack(pack(p).bytes)).toEqual(p);
 // A deliberate drag to a new target changes the restriction; free new paint
 // remains able to span parts as it did before anatomical sizing was added.
 const relocated=await editSurfaceMarking(worker,p,body.id,surfaceDragShape(brushed.surfaceShape!,{xMm:50,yMm:90},{xMm:-50,yMm:90,zMm:0},[0,0,1],'arm-left'));
 expect(relocated.fragments.every(f=>p.surface!.faces.find(face=>face.id===f.faceId)?.region==='arm-left')).toBe(true);
 const unrestricted=await surfaceMarking(worker,p,{nodes:piece.nodes.map(({xMm,yMm})=>({xMm,yMm})),origin:frame.origin,axes:frame.axes},piece.color,'Free paint');expect(new Set(unrestricted.fragments.map(f=>p.surface!.faces.find(face=>face.id===f.faceId)?.region))).toEqual(new Set(['body','arm-left']));
});
it('moving attached paint across seams remaps manufacturing paths, retains identity and is one undoable change',async()=>{
 const p=await panel(),old=p.markings![0],before=structuredClone(p),shape={...old.surfaceShape!,origin:[60,0,0] as [number,number,number]};
 const moved=await editSurfaceMarking(worker,p,old.id,shape);
 expect(p).toEqual(before);expect(moved.id).toBe(old.id);expect(moved.name).toBe(old.name);expect(moved.paths).toHaveLength(2);expect(Math.abs(paintedArea(moved)-3600)).toBeLessThan(.01); // 0.0001 mm clipping grid accumulated over the boundary.
 const repo=new Repository(':memory:');try{repo.open(p,null);repo.commit({type:'marking.put',marking:moved},randomUUID(),'move');expect(staleMarkingIds(repo.snapshot()!).size).toBe(0);expect(unpack(pack(repo.snapshot()!).bytes).markings?.[0]).toEqual(moved);repo.historyMove(false);expect(repo.snapshot()!.markings).toEqual([old]);repo.historyMove(true);expect(repo.snapshot()!.markings).toEqual([moved]);}finally{repo.close();}
});
it('round additive strokes bridge samples; eraser creates a preserved hole on both model and cut paths',async()=>{
 const p=await panel(),old=p.markings![0];
 const added=await brushSurfaceMarking(worker,p,old.id,{mode:'add',radiusMm:5,points:[{xMm:70,yMm:50},{xMm:130,yMm:50}]});
 expect(added.paths).toHaveLength(2);expect(paintedArea(added)).toBeGreaterThan(4000);expect(added.id).toBe(old.id);
 p.markings=[added];const erased=await brushSurfaceMarking(worker,p,old.id,{mode:'erase',radiusMm:8,points:[{xMm:45,yMm:45}]});
 expect(erased.surfaceShape?.holes).toHaveLength(1);expect(Math.abs(paintedArea(added)-paintedArea(erased)-Math.PI*64)).toBeLessThan(2*Math.PI*8*.05); // Perimeter times brush sagitta bound.
 p.markings=[erased];expect(staleMarkingIds(p).size).toBe(0);
});
it('invalid, disconnected, fully erased, locked and stale edits leave the original intact',async()=>{
 const p=await panel(),m=p.markings![0],before=structuredClone(p);
 await expect(brushSurfaceMarking(worker,p,m.id,{mode:'erase',radiusMm:4,points:[{xMm:50,yMm:10},{xMm:50,yMm:90}]})).rejects.toThrow('MARKING_DISCONNECTED');
 await expect(brushSurfaceMarking(worker,p,m.id,{mode:'erase',radiusMm:100,points:[{xMm:50,yMm:50}]})).rejects.toThrow('EMPTY_MARKING');
 await expect(editSurfaceMarking(worker,p,m.id,{...m.surfaceShape!,origin:[500,0,0]})).rejects.toThrow('NO_VISIBLE_PROJECTION');expect(p).toEqual(before);
 m.locked=true;await expect(editSurfaceMarking(worker,p,m.id,m.surfaceShape!)).rejects.toThrow('MARKING_LOCKED');m.locked=false;m.sourceHash='stale';await expect(editSurfaceMarking(worker,p,m.id,m.surfaceShape!)).rejects.toThrow('STALE_MARKING');
});
it('obsolete color cuts block output but do not prevent continuing the surface edit',async()=>{
 const p=await panel(),m=p.markings![0],colorHash=cutColorHash(p);
 p.bindings=p.bindings!.map(b=>({...b,colorHash}));
 const moved=await editSurfaceMarking(worker,p,m.id,{...m.surfaceShape!,origin:[20,0,0]});p.markings=[moved];
 expect(bindingIssues(p).some(i=>i.messageKey==='STALE_BINDING')).toBe(true);
 const second=await brushSurfaceMarking(worker,p,m.id,{mode:'erase',radiusMm:5,points:[{xMm:45,yMm:45}]});p.markings=[second];
 expect(second.surfaceShape!.holes).toHaveLength(1);expect(bindingIssues(p).some(i=>i.messageKey==='STALE_BINDING')).toBe(true);
 expect(p.bindings.every(b=>b.colorHash===colorHash)).toBe(true);
});
