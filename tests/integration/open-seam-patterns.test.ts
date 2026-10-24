import {expect,it} from 'vitest';
import {randomUUID} from 'node:crypto';
import {resolve} from 'node:path';
import {project,rectangle} from '../fixtures';
import {parseObj,bindingIssues} from '../../apps/desktop/main/surface';
import {editSurfaceCuts} from '../../apps/desktop/main/cut-tools';
import {cutPreview} from '../../apps/desktop/main/cut-preview';
import {projectMarking} from '../../apps/desktop/main/markings';
import {Repository} from '../../apps/desktop/main/repository';
import {pack,unpack} from '../../apps/desktop/main/archive';
import {analyze} from '../../apps/desktop/main/worker';
import {assertCutEdges,cutSegmentsWorld,assertCutTraversal} from '../../packages/surface/cut-path-contract';
import {surfaceCurveSegments} from '../../packages/surface/surface-curve';
import type {CutProjection,Surface} from '../../packages/schema/index';

const worker=resolve('target/release/fpcad-worker.exe'),assets=resolve('dist/assets');
const projection:CutProjection={origin:[0,0,0],axes:[[1,0,0],[0,1,0],[0,0,1]]};
const point=(xMm:number,yMm:number,zMm=0)=>({id:randomUUID(),xMm,yMm,zMm});
const pen=(points:ReturnType<typeof point>[])=>({type:'surface.curve' as const,name:'开放结构缝',kind:'pen' as const,closed:false,controlPoints:points,surfaceAnchored:true,projection,tension:1,symmetric:false});
function sheet(){const p=project();p.pieces=[];p.defaultAllowanceMm=0;p.surface=parseObj('v -100 0 0\nv 100 0 0\nv 100 200 0\nv -100 200 0\nf 1 2 3\nf 1 3 4');return p;}
it('two-point open pen divides a sheet, preserves paint and accepts/undoes the exact 1:1 patterns',async()=>{
 let p=sheet();const source=rectangle(80,160);source.nodes.forEach(n=>{n.xMm-=40;n.yMm+=20;});
 p.patternLibrary=[{piece:source,referenceId:randomUUID(),view:'front',category:'paint'}];p.markings=[await projectMarking(worker,p,source.id,'front',0,0)];
 const command=pen([point(-100,100),point(100,100)]),draft=cutSegmentsWorld(p.surface!,surfaceCurveSegments(p.surface!,command.controlPoints,false,'draft'));
 const changed=await editSurfaceCuts(worker,p,command),repo=new Repository(':memory:');
 try{
  repo.open(p,null);repo.commit({type:'surface.refined',...changed},randomUUID(),'open seam');p=repo.snapshot()!;
  const line=p.surface!.cutLines![0],vertices=new Map(p.surface!.vertices.map(v=>[v.id,v]));
  expect(line.closed).toBe(false);assertCutEdges(line.edges,false);assertCutTraversal(draft,line.edges.map(e=>({a:vertices.get(e.a)!,b:vertices.get(e.b)!})),false);
  const loaded=unpack(pack(p).bytes);expect(loaded.surface!.cutLines).toEqual(p.surface!.cutLines);
  const candidate=await cutPreview(worker,loaded.surface!,loaded,{automaticCuts:true,partitionStrategy:'design',colorBoundaryCuts:false,method:'arap'},assets);
  expect(candidate.run.pieces).toHaveLength(2);
  const geometry=await analyze(worker,{...loaded,pieces:candidate.run.pieces});
  expect(geometry.map(g=>g.areaMm2).sort((a,b)=>a-b)).toEqual([20000,20000]);
  expect(candidate.markings[0].paths).toHaveLength(2);
  repo.commit({type:'unwrap.candidate',...candidate},randomUUID(),'preview');repo.commit({type:'unwrap.accept'},randomUUID(),'accept');
  expect(repo.snapshot()!.pieces).toHaveLength(2);expect(bindingIssues(repo.snapshot()!)).toEqual([]);
  repo.historyMove(false);expect(repo.snapshot()!.pieces).toHaveLength(0);repo.historyMove(true);expect(repo.snapshot()!.pieces).toHaveLength(2);
 }finally{repo.close();}
});
it('a longitudinal open seam unwraps a cylindrical sleeve into one measured panel',async()=>{
 const p=sheet(),count=12,radius=50,height=200,vertices=Array.from({length:count*2},(_,i)=>point(radius*Math.cos(i%count*2*Math.PI/count),i<count?0:height,radius*Math.sin(i%count*2*Math.PI/count)));
 const faces:Surface['faces']=Array.from({length:count},(_,i)=>{const j=(i+1)%count;return [[i,j,i+count],[j,j+count,i+count]].map(ids=>({id:randomUUID(),region:'sleeve',vertices:ids.map(i=>vertices[i].id) as [string,string,string]}));}).flat();
 p.surface={id:randomUUID(),source:'obj',topologyVersion:1,vertices,faces};
 Object.assign(p,await editSurfaceCuts(worker,p,pen([vertices[0],vertices[count]])));
 const {run}=await cutPreview(worker,p.surface!,p,{automaticCuts:true,partitionStrategy:'design',method:'arap'},assets);
 expect(run.pieces).toHaveLength(1);
 const [geometry]=await analyze(worker,{...p,pieces:run.pieces});
 expect(geometry.areaMm2).toBeCloseTo(count*2*radius*Math.sin(Math.PI/count)*height,2);
 expect(run.bindings[0].report.edgeErrorMax).toBeLessThan(.0001);
 expect(bindingIssues({...p,pieces:run.pieces,bindings:run.bindings})).toEqual([]);
},30000);
it('open retraces and crossing chains fail without changing project contents',async()=>{
 const p=sheet(),before=structuredClone(p);
 for(const points of [[point(-80,50),point(80,50),point(0,50)],[point(-80,20),point(80,180),point(-80,180),point(80,20)]])await expect(editSurfaceCuts(worker,p,pen(points))).rejects.toThrow('CUT_PATH_INVALID');
 expect(p).toEqual(before);
});
it('an open pen from the boundary to a cone apex creates one darted panel with preserved lengths',async()=>{
 const p=sheet(),vertices=[[0,0,100],[100,0,0],[0,100,0],[-100,0,0],[0,-100,0]].map(([x,y,z])=>point(x,y,z));
 p.surface={id:randomUUID(),source:'obj',topologyVersion:1,vertices,faces:[[0,1,2],[0,2,3],[0,3,4],[0,4,1]].map(ids=>({id:randomUUID(),region:'cone',vertices:ids.map(i=>vertices[i].id) as [string,string,string]}))};
 Object.assign(p,await editSurfaceCuts(worker,p,pen([vertices[1],vertices[0]])));
 const {run}=await cutPreview(worker,p.surface!,p,{automaticCuts:true,partitionStrategy:'design',method:'arap'},assets);
 expect(run.pieces).toHaveLength(1);expect(run.designCutReport!.userSeams).toBe(1);
 expect(run.bindings[0].report.edgeErrorMax).toBeLessThan(.0001);
 expect((await analyze(worker,{...p,pieces:run.pieces})).flatMap(g=>g.issues.filter(i=>i.severity==='error'))).toEqual([]);
 expect(bindingIssues({...p,pieces:run.pieces,bindings:run.bindings})).toEqual([]);
},30000);
