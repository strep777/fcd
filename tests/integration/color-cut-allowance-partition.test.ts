import {it,expect} from 'vitest';
import {randomUUID} from 'node:crypto';
import {resolve} from 'node:path';
import {project,rectangle} from '../fixtures';
import {parseObj,bindingIssues} from '../../apps/desktop/main/surface';
import {projectMarking} from '../../apps/desktop/main/markings';
import {cutPreview} from '../../apps/desktop/main/cut-preview';
import {analyze} from '../../apps/desktop/main/worker';
const worker=resolve('target/release/fpcad-worker.exe');
it('opens a small inset hole with reported new seams while preserving the requested allowance and all material',async()=>{
 const p=project();p.pieces=[];p.defaultAllowanceMm=10;p.surface=parseObj('v 0 0 0\nv 200 0 0\nv 200 200 0\nv 0 200 0\nf 1 2 3\nf 1 3 4');
 const source=rectangle(80,80);source.allowanceMm=0;source.nodes.forEach(n=>{n.xMm+=60;n.yMm+=60;});source.holes=[[[95,95],[95,105],[105,105],[105,95]].map(([xMm,yMm])=>({id:randomUUID(),xMm,yMm}))];
 p.patternLibrary=[{piece:source,referenceId:randomUUID(),view:'front',category:'inset'}];p.markings=[await projectMarking(worker,p,source.id,'front',0,0)];const before=structuredClone(p),candidate=await cutPreview(worker,p.surface,p,{automaticCuts:false,colorBoundaryCuts:true,normalAngleDeg:180},resolve('dist/assets'));
 expect(p).toEqual(before);expect(candidate.run.designCutReport!.manufacturingSeams).toBeGreaterThan(0);expect(candidate.run.pieces.every(p=>p.allowanceMm===10)).toBe(true);expect(candidate.run.pieces.length).toBeLessThanOrEqual(500);
 const ready={...p,pieces:candidate.run.pieces,bindings:candidate.run.bindings,markings:candidate.markings};expect(bindingIssues(ready)).toEqual([]);expect((await analyze(worker,ready)).flatMap(g=>g.issues.filter(i=>i.severity==='error'))).toEqual([]);
 let total=0,colored=0;for(const b of candidate.run.bindings){const trim=b.trim!,v=new Map(trim.vertices.map(v=>[v.id,v])),area=trim.triangles.reduce((sum,t)=>{const [a,b,c]=t.vertices.map(id=>v.get(id)!);return sum+Math.abs((b.xMm-a.xMm)*(c.yMm-a.yMm)-(b.yMm-a.yMm)*(c.xMm-a.xMm))/2;},0);total+=area;if(candidate.run.pieces.find(p=>p.id===b.pieceId)!.color===source.color)colored+=area;}
 expect(total).toBeCloseTo(40000,5);expect(colored).toBeCloseTo(6300,5);
});
