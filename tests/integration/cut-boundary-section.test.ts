import {it,expect} from 'vitest';
import {randomUUID} from 'node:crypto';
import {resolve} from 'node:path';
import {project,rectangle} from '../fixtures';
import {parseObj,bindingIssues} from '../../apps/desktop/main/surface';
import {projectMarking} from '../../apps/desktop/main/markings';
import {editSurfaceCuts} from '../../apps/desktop/main/cut-tools';
import {cutPreview} from '../../apps/desktop/main/cut-preview';
import {analyze} from '../../apps/desktop/main/worker';
const worker=resolve('target/release/fpcad-worker.exe');
it('colors crossing a saved closed pen seam yield manufacturable cuts without grid retrace spurs',async()=>{
 const p=project();p.pieces=[];p.surface=parseObj('v 0 0 0\nv 200 0 0\nv 200 100 0\nv 0 100 0\ng body\nf 1 2 3\nf 1 3 4');
 const source=rectangle(120,60);source.allowanceMm=0;source.nodes.forEach(n=>{n.xMm+=40;n.yMm+=20;});
 p.patternLibrary=[{piece:source,referenceId:randomUUID(),view:'front',category:'body'}];p.markings=[await projectMarking(worker,p,source.id,'front',0,0)];
 // Close the same internal section along the existing outer boundary. The
 // physical partition remains two halves; no extra interior seams are added.
 const controlPoints=[[0,50],[200,50],[200,0],[0,0]].map(([xMm,yMm])=>({id:randomUUID(),xMm,yMm,zMm:0}));
 const saved={...p,...await editSurfaceCuts(worker,p,{type:'surface.curve',name:'Closed section path',kind:'pen',controlPoints,projection:{origin:[0,0,0],axes:[[1,0,0],[0,1,0],[0,0,1]]},tension:1,closed:true,symmetric:false})},before=structuredClone(saved),candidate=await cutPreview(worker,saved.surface!,saved,{automaticCuts:true,colorBoundaryCuts:true,normalAngleDeg:120},resolve('dist/assets'));
 expect(candidate.run.designCutReport).toEqual({materialDomains:4,userSeams:1,topologySeams:0,distortionSeams:0,manufacturingSeams:0});expect(saved).toEqual(before);expect(candidate.run.pieces).toHaveLength(4);expect(new Set(candidate.run.pieces.map(p=>p.color))).toEqual(new Set([source.color,'#eceae5']));
 const ready={...saved,pieces:candidate.run.pieces,bindings:candidate.run.bindings,markings:candidate.markings};expect(bindingIssues(ready)).toEqual([]);expect((await analyze(worker,ready)).flatMap(g=>g.issues.filter(i=>i.severity==='error'))).toEqual([]);
 let total=0,colored=0;for(const b of candidate.run.bindings){const trim=b.trim!,vertices=new Map(trim.vertices.map(v=>[v.id,v])),area=trim.triangles.reduce((sum,t)=>{const [a,b,c]=t.vertices.map(id=>vertices.get(id)!);return sum+Math.abs((b.xMm-a.xMm)*(c.yMm-a.yMm)-(c.xMm-a.xMm)*(b.yMm-a.yMm))/2;},0);total+=area;if(candidate.run.pieces.find(p=>p.id===b.pieceId)!.color===source.color)colored+=area;}
 expect(total).toBeCloseTo(20000,5);expect(colored).toBeCloseTo(7200,5);expect(saved.surface!.cutLines![0].controlPoints).toEqual(controlPoints);expect(saved.surface!.cutLines![0].closed).toBe(true);
});
