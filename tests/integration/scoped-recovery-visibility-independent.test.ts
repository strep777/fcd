import {randomUUID} from 'node:crypto';
import {resolve} from 'node:path';
import {expect,it} from 'vitest';
import type {Surface,Marking} from '../../packages/schema/index';
import {localPlacementOffset} from '../../packages/surface/local-placement';
import {projectReferenceGeometry} from '../../apps/desktop/main/markings';
import {previewFragments} from '../../packages/surface/marking-preview';
import {project,rectangle} from '../fixtures';

it('a visible local recovery anchor does not authorize painting behind an out-of-scope nearer part',async()=>{
 const vertices:Surface['vertices']=[],faces:Surface['faces']=[],plane=(left:number,right:number,zMm:number,region:string)=>{
  const v=[[left,0],[right,0],[right,100],[left,100]].map(([xMm,yMm])=>({id:randomUUID(),xMm,yMm,zMm}));vertices.push(...v);
  const rows=[[0,1,2],[0,2,3]].map(t=>({id:randomUUID(),region,vertices:t.map(i=>v[i].id) as [string,string,string]}));faces.push(...rows);return rows;
 };
 const target=plane(0,100,0,'target'),occluder=plane(5,100,10,'nearer-other-part'),mesh:Surface={id:randomUUID(),source:'obj',topologyVersion:1,vertices,faces},p=project(),source=rectangle(20,20),worker=resolve('target/release/fpcad-worker.exe');
 source.allowanceMm=0;p.pieces=[];p.surface=mesh;p.patternLibrary=[{piece:source,referenceId:randomUUID(),view:'front',category:'body'}];
 const placement:NonNullable<Marking['placement']>={algorithm:'anatomy-2',part:'body',side:'center',regions:['target'],scaleX:1,scaleY:1,sourceCenter:{xMm:10,yMm:10},targetCenter:{xMm:-15,yMm:50},reviewed:false},scope=new Set<string>(target.map(f=>f.id)),before=structuredClone(p);
 expect(occluder).toHaveLength(2);
 await expect(projectReferenceGeometry(worker,p,source.id,'front',0,0,placement,scope)).rejects.toThrow('NO_VISIBLE_PROJECTION');
 const correction=localPlacementOffset(mesh,source,placement,'front',0,0,scope);expect(correction).toBeDefined();
 const unscoped=await projectReferenceGeometry(worker,p,source.id,'front',correction!.offsetXmm,correction!.offsetYmm,placement);
 const scoped=await projectReferenceGeometry(worker,p,source.id,'front',correction!.offsetXmm,correction!.offsetYmm,placement,scope),byId=new Map(vertices.map(v=>[v.id,v]));
 const xCoordinates=(result:typeof scoped)=>result.fragments.flatMap(fragment=>{const f=faces.find(f=>f.id===fragment.faceId)!;return fragment.rings.flatMap(r=>r.map(w=>w.reduce((s,n,i)=>s+n*byId.get(f.vertices[i])!.xMm,0)));});
 expect(unscoped.fragments.length).toBeGreaterThan(0);expect(xCoordinates(unscoped).every(x=>x<=5+1e-7)).toBe(true);expect(p).toEqual(before);
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
 const result=projectReferenceGeometry(worker,p,source.id,'front',10,10,undefined,scope);
 if(kind==='farther'){const projected=await result;expect(projected.fragments.length).toBeGreaterThan(0);expect(projected.fragments.every(f=>scope.has(f.faceId))).toBe(true);expect(projected.fragments.some(f=>other.some(v=>v.id===f.faceId))).toBe(false);}
 else await expect(result).rejects.toThrow(kind==='nearer'?'NO_VISIBLE_PROJECTION':'AMBIGUOUS_PROJECTION');
 expect(p).toEqual(before);
});
