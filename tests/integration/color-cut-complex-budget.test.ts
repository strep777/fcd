import {expect,it} from 'vitest';
import {randomUUID} from 'node:crypto';
import {resolve} from 'node:path';
import {project,rectangle} from '../fixtures';
import {parseObj,unwrapSurface,bindingIssues} from '../../apps/desktop/main/surface';
import {projectMarking} from '../../apps/desktop/main/markings';
import {colorCuts} from '../../apps/desktop/main/color-cuts';
import {analyze} from '../../apps/desktop/main/worker';
import type {Binding} from '../../packages/schema/index';
const worker=resolve('target/release/fpcad-worker.exe');
const trimArea=(trim:NonNullable<Binding['trim']>)=>{const vertices=new Map(trim.vertices.map(v=>[v.id,v]));return trim.triangles.reduce((sum,t)=>{const [a,b,c]=t.vertices.map(id=>vertices.get(id)!);return sum+Math.abs((b.xMm-a.xMm)*(c.yMm-a.yMm)-(b.yMm-a.yMm)*(c.xMm-a.xMm))/2;},0);};
it('partitions a2200-node color boundary within editable budgets while conserving all material and exact surface maps',async()=>{
 const p=project();p.pieces=[];p.surface=parseObj('v 0 0 0\nv 200 0 0\nv 200 200 0\nv 0 200 0\nf 1 2 3\nf 1 3 4');
 const run=await unwrapSurface(worker,p.surface,p,{automaticCuts:false,normalAngleDeg:180});expect(run.pieces).toHaveLength(1);const piece=run.pieces[0];piece.allowanceMm=0;
 const source=rectangle(160,160);source.allowanceMm=0;source.nodes.forEach(n=>{n.xMm+=20;n.yMm+=20;});p.patternLibrary=[{piece:source,referenceId:randomUUID(),view:'front',category:'test'}];
 const marking=await projectMarking(worker,p,source.id,'front',0,0),center={x:piece.nodes.reduce((sum,v)=>sum+v.xMm,0)/piece.nodes.length,y:piece.nodes.reduce((sum,v)=>sum+v.yMm,0)/piece.nodes.length},star=Array.from({length:2200},(_,i)=>{const angle=i*2*Math.PI/2200,radius=i%2?60:80;return {xMm:center.x+radius*Math.cos(angle),yMm:center.y+radius*Math.sin(angle)};});
 marking.paths=[{pieceId:piece.id,geometryHash:run.bindings[0].geometryHash,rings:[star]}];p.markings=[marking];
 const result=await colorCuts(worker,p,run,[marking]);expect(result.pieces.length).toBeGreaterThan(2);expect(result.pieces.length).toBeLessThanOrEqual(500);for(const piece of result.pieces){expect(piece.nodes.length).toBeLessThanOrEqual(2000);expect(piece.holes?.length??0).toBeLessThanOrEqual(32);expect(piece.holes?.every(r=>r.length<=2000)??true).toBe(true);}
 expect(result.bindings.reduce((sum,b)=>sum+trimArea(b.trim!),0)).toBeCloseTo(40000,5);expect(result.bindings.filter((_,i)=>result.pieces[i].color===source.color).reduce((sum,b)=>sum+trimArea(b.trim!),0)).toBeCloseTo(2200*60*80*Math.sin(2*Math.PI/2200)/2,5);
 expect(bindingIssues({...p,pieces:result.pieces,bindings:result.bindings})).toEqual([]);expect((await analyze(worker,{...p,pieces:result.pieces})).flatMap(g=>g.issues.filter(i=>i.severity==='error'))).toEqual([]);
},30000);
