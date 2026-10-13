import {it,expect} from 'vitest';
import {randomUUID} from 'node:crypto';
import {resolve} from 'node:path';
import {project,rectangle} from '../fixtures';
import {parseObj,unwrapSurface} from '../../apps/desktop/main/surface';
import {projectMarking,surfaceMarking,staleMarkingIds} from '../../apps/desktop/main/markings';
import {Repository} from '../../apps/desktop/main/repository';
import {sourceSurfaceShape} from '../../packages/surface/source-drop';
import {cutPreview} from '../../apps/desktop/main/cut-preview';

it('atomically rejects resize when a bound cut is also the paint source',async()=>{
 const worker=resolve('target/release/fpcad-worker.exe'),p=project();p.pieces=[];p.surface=parseObj('v 0 0 0\nv 100 0 0\nv 100 100 0\nv 0 100 0\nf 1 2 3\nf 1 3 4');
 const run=await unwrapSurface(worker,p.surface,p);p.pieces=run.pieces;p.bindings=run.bindings;
 const source=p.pieces[0];p.markings=[await projectMarking(worker,p,source.id,'front',50,50)];expect(staleMarkingIds(p).size).toBe(0);
 const repo=new Repository(':memory:');repo.open(p,null);const before=repo.snapshot();expect(()=>repo.commit({type:'surface.resize',scale:2},randomUUID(),'resize')).toThrow('MARKING_SOURCE_BOUND');
 expect(repo.snapshot()).toEqual(before);expect(staleMarkingIds(repo.snapshot()!).size).toBe(0);repo.close();
});

it('resized independent paint produces valid new colored cuts with scaled hole area',async()=>{
 const worker=resolve('target/release/fpcad-worker.exe'),p=project();p.pieces=[];p.surface=parseObj('v 0 0 0\nv 100 0 0\nv 100 100 0\nv 0 100 0\nf 1 2 3\nf 1 3 4');
 const source=rectangle(60,40);source.holes=[[[20,10],[20,30],[40,30],[40,10]].map(([xMm,yMm])=>({id:randomUUID(),xMm,yMm}))];
 const shape=sourceSurfaceShape(source,{xMm:50,yMm:50,zMm:0},{origin:[0,0,0],axes:[[1,0,0],[0,1,0],[0,0,1]]});expect(Object.keys(shape).slice(0,2)).toEqual(['nodes','holes']);p.markings=[await surfaceMarking(worker,p,shape,source.color,source.name)];expect(staleMarkingIds(p).size).toBe(0);
 const repo=new Repository(':memory:');repo.open(p,null);repo.commit({type:'surface.resize',scale:2},randomUUID(),'resize');const resized=repo.snapshot()!;
 const candidate=await cutPreview(worker,resized.surface!,resized,{method:'lscm',automaticCuts:true,colorBoundaryCuts:true},resolve('dist/assets'));
 repo.commit({type:'unwrap.candidate',run:candidate.run,markings:candidate.markings},randomUUID(),'candidate');repo.commit({type:'unwrap.accept'},randomUUID(),'accept');const accepted=repo.snapshot()!;
 expect(staleMarkingIds(accepted).size).toBe(0);expect(accepted.bindings!.every(binding=>!!binding.trim)).toBe(true);expect(accepted.pieces.some(piece=>piece.color===source.color&&piece.holes?.length)).toBe(true);
 const area=(ring:{xMm:number;yMm:number}[])=>ring.reduce((sum,a,i)=>{const b=ring[(i+1)%ring.length];return sum+a.xMm*b.yMm-b.xMm*a.yMm;},0)/2;
 expect(accepted.markings![0].paths.reduce((sum,path)=>sum+Math.abs(path.rings.reduce((s,ring)=>s+area(ring),0)),0)).toBeCloseTo(8000,1);repo.close();
});
