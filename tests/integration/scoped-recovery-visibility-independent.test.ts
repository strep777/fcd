import {randomUUID} from 'node:crypto';
import {resolve} from 'node:path';
import {expect,it} from 'vitest';
import type {Surface} from '../../packages/schema/index';
import {projectMarking} from '../../apps/desktop/main/markings';
import {previewFragments} from '../../packages/surface/marking-preview';
import {project,rectangle} from '../fixtures';

it('automatic placement never moves an out-of-scope pigment and retains all nearer-part occluders when its original position is visible',async()=>{
 const vertices:Surface['vertices']=[],faces:Surface['faces']=[],plane=(left:number,right:number,zMm:number,region:string)=>{
  const v=[[left,0],[right,0],[right,100],[left,100]].map(([xMm,yMm])=>({id:randomUUID(),xMm,yMm,zMm}));vertices.push(...v);
  const rows=[[0,1,2],[0,2,3]].map(t=>({id:randomUUID(),region,vertices:t.map(i=>v[i].id) as [string,string,string]}));faces.push(...rows);return rows;
 };
 const target=plane(0,100,0,'torso'),occluder=plane(5,100,10,'arm-left'),mesh:Surface={id:randomUUID(),source:'obj',topologyVersion:1,vertices,faces},p=project(),source=rectangle(20,20),worker=resolve('target/release/fpcad-worker.exe'),referenceId=randomUUID();
 source.allowanceMm=0;source.nodes.forEach(n=>{n.xMm-=25;n.yMm+=40;});p.pieces=[];p.surface=mesh;p.patternLibrary=[{piece:source,referenceId,view:'front',category:'body',anatomy:{part:'body',side:'center',confidence:1,method:'silhouette-1'}}];
 p.references=[{id:referenceId,name:'Complete 100 mm torso frame',view:'front',width:100,height:100,png:'data:image/png;base64,AA==',calibration:{a:{x:0,y:100},b:{x:0,y:0},distanceMm:100},illustration:{algorithm:'illustration-2',subject:'character',bounds:{minX:0,minY:0,maxX:100,maxY:100},partBounds:[{part:'body',side:'center',bounds:{minX:0,minY:0,maxX:100,maxY:100}}],foregroundPixels:10000,discardedPixels:0,palette:[source.color],smoothingPx:0}}];
 const scope=new Set<string>(target.map(f=>f.id)),before=structuredClone(p);
 expect(occluder).toHaveLength(2);
 await expect(projectMarking(worker,p,source.id,'front',0,0,false,true,undefined,scope)).rejects.toThrow('NO_VISIBLE_PROJECTION');expect(p).toEqual(before);
 // Move the source deliberately into its measured frame. Automatic placement
 // must keep this exact pose while the out-of-scope arm still hides x > 5.
 source.nodes.forEach(n=>n.xMm+=25);const visibleBefore=structuredClone(p),unscoped=await projectMarking(worker,p,source.id,'front',0,0,false,true);
 const scoped=await projectMarking(worker,p,source.id,'front',0,0,false,true,undefined,scope),byId=new Map(vertices.map(v=>[v.id,v]));
 const xCoordinates=(result:typeof scoped)=>result.fragments.flatMap(fragment=>{const f=faces.find(f=>f.id===fragment.faceId)!;return fragment.rings.flatMap(r=>r.map(w=>w.reduce((s,n,i)=>s+n*byId.get(f.vertices[i])!.xMm,0)));});
 expect(unscoped.fragments.length).toBeGreaterThan(0);expect(xCoordinates(unscoped).every(x=>x<=5+1e-7)).toBe(true);expect(p).toEqual(visibleBefore);expect(scoped.offsetXmm).toBe(0);expect(scoped.offsetYmm).toBe(0);expect(scoped.placement!.reviewed).toBe(false);expect(scoped.fragments.every(f=>scope.has(f.faceId))).toBe(true);
 expect(Math.max(...xCoordinates(scoped)),'Every point at x > 5 on target z=0 is hidden behind the z=10 part').toBeLessThanOrEqual(5+1e-7);
});

it('live attached-sheet preview does not show material hidden by a nearer disconnected part',()=>{
 const vertices:Surface['vertices']=[],faces:Surface['faces']=[],plane=(left:number,zMm:number)=>{
  const v=[[left,0],[100,0],[100,100],[left,100]].map(([xMm,yMm])=>({id:randomUUID(),xMm,yMm,zMm}));vertices.push(...v);
  const rows=[[0,1,2],[0,2,3]].map(t=>({id:randomUUID(),region:'cloth',vertices:t.map(i=>v[i].id) as [string,string,string]}));faces.push(...rows);return rows;
 };
 const target=plane(0,0);plane(5,10);const mesh:Surface={id:randomUUID(),source:'obj',topologyVersion:1,vertices,faces},before=structuredClone(mesh);
 const fragments=previewFragments(mesh,{anchorFaceId:target[0].id,origin:[0,0,0],axes:[[1,0,0],[0,1,0],[0,0,1]],nodes:[{xMm:0,yMm:10},{xMm:20,yMm:10},{xMm:20,yMm:30},{xMm:0,yMm:30}]})!;
 const byId=new Map(vertices.map(v=>[v.id,v])),xs=fragments.flatMap(fragment=>{const f=faces.find(f=>f.id===fragment.faceId)!;return fragment.rings.flatMap(r=>r.map(w=>w.reduce((s,n,i)=>s+n*byId.get(f.vertices[i])!.xMm,0)));});
 expect(fragments.length).toBeGreaterThan(0);expect(mesh).toEqual(before);
 expect(Math.max(...xs),'Live preview must retain all nearer-sheet occluders outside the connected target scope').toBeLessThanOrEqual(5+1e-7);
});

it.each(['farther','nearer','coincident'] as const)('manual face scope selects targets while retaining global %s-sheet visibility checks',async kind=>{
 const vertices:Surface['vertices']=[],faces:Surface['faces']=[],plane=(zMm:number,region:string)=>{
  const v=[[0,0],[100,0],[100,100],[0,100]].map(([xMm,yMm])=>({id:randomUUID(),xMm,yMm,zMm}));vertices.push(...v);
  const rows=[[0,1,2],[0,2,3]].map(t=>({id:randomUUID(),region,vertices:t.map(i=>v[i].id) as [string,string,string]}));faces.push(...rows);return rows;
 };
 const target=plane(0,'selected'),other=plane(kind==='farther'?-10:kind==='nearer'?10:0,'other'),mesh:Surface={id:randomUUID(),source:'obj',topologyVersion:1,vertices,faces},p=project(),source=rectangle(20,20),worker=resolve('target/release/fpcad-worker.exe');
 source.allowanceMm=0;p.pieces=[];p.surface=mesh;p.patternLibrary=[{piece:source,referenceId:randomUUID(),view:'front',category:'manual'}];const before=structuredClone(p),scope=new Set<string>(target.map(f=>f.id));
 const result=projectMarking(worker,p,source.id,'front',10,10,false,false,undefined,scope);
 if(kind==='farther'){const projected=await result;expect(projected.fragments.length).toBeGreaterThan(0);expect(projected.fragments.every(f=>scope.has(f.faceId))).toBe(true);expect(projected.fragments.some(f=>other.some(v=>v.id===f.faceId))).toBe(false);}
 else await expect(result).rejects.toThrow(kind==='nearer'?'NO_VISIBLE_PROJECTION':'AMBIGUOUS_PROJECTION');
 expect(p).toEqual(before);
});
