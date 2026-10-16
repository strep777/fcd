import {it,expect} from 'vitest';
import {randomUUID} from 'node:crypto';
import {resolve} from 'node:path';
import {project,rectangle} from '../fixtures';
import {parseObj,unwrapSurface} from '../../apps/desktop/main/surface';
import {projectMarking,editMarking} from '../../apps/desktop/main/markings';
import {mappedMarking} from '../../apps/desktop/main/fragment-mapping';
import {analyze} from '../../apps/desktop/main/worker';
import {markingSchema} from '../../packages/schema/index';
const worker=resolve('target/release/fpcad-worker.exe');
it('keeps densely sampled curved markings valid during projection, remapping and editing existing patterns',async()=>{
 const p=project();p.pieces=[];p.surface=parseObj('v 0 0 0\nv 60000 0 0\nv 60000 60000 0\nv 0 60000 0\nv 30000 30000 0\nf 1 2 5\nf 2 3 5\nf 3 4 5\nf 4 1 5');
 const source=rectangle();source.allowanceMm=0;const n=16,radius=20000,step=2*Math.PI/n,handle=4/3*Math.tan(step/4)*radius;
 source.nodes=Array.from({length:n},(_,i)=>({id:randomUUID(),xMm:30000+radius*Math.cos(i*step),yMm:30000+radius*Math.sin(i*step)}));
 source.curves=source.nodes.map((a,i)=>{const b=source.nodes[(i+1)%n],alpha=i*step,beta=(i+1)*step;return {id:randomUUID(),startNodeId:a.id,endNodeId:b.id,c1:{id:randomUUID(),xMm:a.xMm-handle*Math.sin(alpha),yMm:a.yMm+handle*Math.cos(alpha)},c2:{id:randomUUID(),xMm:b.xMm+handle*Math.sin(beta),yMm:b.yMm-handle*Math.cos(beta)}};});
 p.patternLibrary=[{piece:source,referenceId:randomUUID(),view:'front',category:'test'}];const original=structuredClone(source),geometry=(await analyze(worker,{...p,pieces:[source]}))[0];expect(geometry.seam!.length).toBeGreaterThan(2000);
 const run=await unwrapSurface(worker,p.surface,p,{automaticCuts:false,normalAngleDeg:180});p.pieces=run.pieces;p.bindings=run.bindings;
 const marking=await projectMarking(worker,p,source.id,'front',0,0),remapped=await mappedMarking(worker,p,marking),area=(rings:{xMm:number;yMm:number}[][])=>rings.reduce((sum,ring)=>sum+ring.reduce((s,a,i)=>{const b=ring[(i+1)%ring.length],o=ring[0];return s+(a.xMm-o.xMm)*(b.yMm-o.yMm)-(b.xMm-o.xMm)*(a.yMm-o.yMm);},0)/2,0);
 for(const m of [marking,remapped]){expect(markingSchema.safeParse(m).success).toBe(true);expect(m.paths[0].rings.length).toBeGreaterThan(1);expect(m.paths.every(path=>path.rings.every(r=>r.length<=2000))).toBe(true);expect(Math.abs(area(m.paths.flatMap(path=>path.rings))-geometry.areaMm2)/geometry.areaMm2).toBeLessThan(1e-7);}
 expect(source).toEqual(original);expect(remapped.fragments).toEqual(marking.fragments);
 p.markings=[marking];const path=marking.paths[0];const edited=await editMarking(worker,p,marking.id,path.pieceId,path.rings);expect(markingSchema.safeParse(edited).success).toBe(true);expect(edited.paths.every(path=>path.rings.every(r=>r.length<=2000))).toBe(true);
},30000);
