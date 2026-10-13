import {expect,it} from 'vitest';
import {randomUUID} from 'node:crypto';
import {resolve} from 'node:path';
import {project,rectangle} from '../fixtures';
import {userMappingFixture} from '../user-mapping-fixture';
import {Repository} from '../../apps/desktop/main/repository';
import {generateSpecies,speciesDefaults} from '../../apps/desktop/main/species';
import {surfaceMarking,projectMarking,staleMarkingIds,markingFingerprint} from '../../apps/desktop/main/markings';
import {markingSurfaceOutline} from '../../packages/surface/marking-outline';
import {sourceSurfaceShape} from '../../packages/surface/source-drop';
import {shapeWorld,surfaceDragShape} from '../../packages/surface/attached-edit';
import {anatomicalPlacement} from '../../apps/desktop/main/anatomical-placement';
import {placementMatchesModel} from '../../packages/reference/placement-review';
import {parseObj} from '../../apps/desktop/main/surface';
const worker=resolve('target/release/fpcad-worker.exe');
const commit=(r:Repository,c:Parameters<Repository['commit']>[0])=>r.commit(c,randomUUID(),'controls');
it('boundary parity removes subdivided shared triangle edges and retains real hole contours',()=>{
 const surface=parseObj('v 0 0 0\nv 10 0 0\nv 10 10 2\nv 0 10 1\nf 1 2 3\nf 1 3 4'),marking={surfaceId:surface.id,topologyVersion:surface.topologyVersion,fragments:[{faceId:surface.faces[0].id,rings:[[[1,0,0],[0,1,0],[0,0,1]]] as [number,number,number][][]},{faceId:surface.faces[1].id,rings:[[[1,0,0],[.5,.5,0],[0,1,0],[0,0,1]]] as [number,number,number][][]}]};
 const outline=markingSurfaceOutline(surface,marking);expect(outline).toHaveLength(4);expect(outline.some(line=>Math.abs(line.a.xMm-line.a.yMm)<1e-8&&Math.abs(line.b.xMm-line.b.yMm)<1e-8)).toBe(false);
 marking.fragments[0].rings.push([[.6,.2,.2],[.2,.6,.2],[.2,.2,.6]]);expect(markingSurfaceOutline(surface,marking)).toHaveLength(7);
});
it('real front and back silhouette pigments preserve the screen side of each limb on built-in models',()=>{
 const p=userMappingFixture();if(!p)return;expect(p.surface!.source).toBe('species-template-1');let checked=0;
 for(const source of p.patternLibrary!.filter(r=>['arm','paw','ear','leg','foot'].includes(r.anatomy?.part??'')&&['left','right'].includes(r.anatomy?.side??''))){const placement=anatomicalPlacement(p,source),originalModel=structuredClone(p),manual=structuredClone(source);manual.anatomy!.method='manual';const direct=anatomicalPlacement(originalModel,manual);expect(placement.targetCenter.xMm).toBeCloseTo(-direct.targetCenter.xMm,6);expect(placement.modelSide).not.toBe(placement.side);const inferredSign=source.view==='front'?(source.anatomy!.side==='left'?1:-1):(source.anatomy!.side==='left'?-1:1);expect(Math.sign(placement.targetCenter.xMm)).toBe(inferredSign);checked++;}
 expect(checked).toBeGreaterThan(25);
});
it('manual classifications and explicitly named imported model sides remain authoritative',async()=>{
 const p=project();p.pieces=[];p.surface=generateSpecies(speciesDefaults('canine'));p.surface.source='obj';const piece=rectangle(60,100);p.patternLibrary=[{piece,referenceId:randomUUID(),view:'front',category:'arm',anatomy:{part:'arm',side:'left',confidence:1,method:'silhouette-1'}}];for(const view of ['front','back'] as const){p.patternLibrary[0].view=view;const placement=anatomicalPlacement(p,p.patternLibrary[0]);expect(placement.modelSide).toBe('left');expect(placement.regions.every(region=>region.startsWith('arm-left'))).toBe(true);const mark=await projectMarking(worker,p,piece.id,view,0,0,false,true);expect(placementMatchesModel(p,mark)).toBe(true);}p.surface.source='species-template-1';p.patternLibrary[0].anatomy!.method='manual';expect(anatomicalPlacement(p,p.patternLibrary[0]).modelSide).toBe('left');
});
it('surface boundaries follow a curved body rather than the floating source plane, and remove interior mesh edges',async()=>{
 const p=userMappingFixture()??project();if(!p.surface)p.surface=generateSpecies(speciesDefaults('canine'));p.pieces=[];p.bindings=[];
 const mesh=p.surface!,vertices=mesh.vertices.filter(v=>mesh.faces.some(f=>f.region==='arm-right'&&f.vertices.includes(v.id))),center=vertices.length?vertices.reduce((n,v)=>({xMm:n.xMm+v.xMm/vertices.length,yMm:n.yMm+v.yMm/vertices.length,zMm:n.zMm+v.zMm/vertices.length}),{xMm:0,yMm:0,zMm:0}):{xMm:0,yMm:1000,zMm:100};
 const shape=sourceSurfaceShape(rectangle(240,240),center,{origin:[0,0,0],axes:[[1,0,0],[0,1,0],[0,0,1]]}),mark=await surfaceMarking(worker,p,shape,'#f95738','Curved arm');
 const outline=markingSurfaceOutline(mesh,mark);expect(outline.length).toBeGreaterThan(0);const map=new Map(mesh.vertices.map(v=>[v.id,v])),faces=new Map(mesh.faces.map(f=>[f.id,f]));
 for(const line of outline){const [a,b,c]=faces.get(line.faceId)!.vertices.map(id=>map.get(id)!),u=[b.xMm-a.xMm,b.yMm-a.yMm,b.zMm-a.zMm],v=[c.xMm-a.xMm,c.yMm-a.yMm,c.zMm-a.zMm],n=[u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0]],length=Math.hypot(...n);for(const point of [line.a,line.b])expect(Math.abs(n[0]*(point.xMm-a.xMm)+n[1]*(point.yMm-a.yMm)+n[2]*(point.zMm-a.zMm))/length).toBeLessThan(1e-8);}
 expect(outline.some(line=>Math.abs(line.a.zMm-shape.origin[2])>5)).toBe(true);
 const full={...mark,fragments:mesh.faces.filter(f=>f.region==='arm-right').slice(0,2).map(f=>({faceId:f.id,rings:[[[1,0,0],[0,1,0],[0,0,1]]] as [number,number,number][][]}))};expect(markingSurfaceOutline(mesh,full).length).toBeLessThanOrEqual(6);
});
it('final locking and clearing are single undoable model operations, retaining sources and other models',async()=>{
 const p=userMappingFixture()??project();if(!p.surface)p.surface=generateSpecies(speciesDefaults('canine'));p.pieces=[];p.bindings=[];p.markings=[];const source=rectangle(50,50),head=p.surface.vertices.reduce((best,v)=>v.zMm>best.zMm?v:best),shape=sourceSurfaceShape(source,head,{origin:[0,0,0],axes:[[1,0,0],[0,1,0],[0,0,1]]});p.markings=[await surfaceMarking(worker,p,shape,'#f95738','Manual attached')];
 const lib=structuredClone(p.patternLibrary),archives=structuredClone(p.cuttingLibrary),repo=new Repository(':memory:');try{repo.open(p,null);commit(repo,{type:'markings.lockAll',locked:true});expect(repo.snapshot()!.markings!.every(m=>m.locked)).toBe(true);expect(()=>commit(repo,{type:'marking.delete',markingId:p.markings![0].id})).toThrow('MARKING_LOCKED');commit(repo,{type:'markings.lockAll',locked:false});commit(repo,{type:'marking.delete',markingId:p.markings[0].id});expect(repo.snapshot()!.markings).toHaveLength(0);repo.historyMove(false,randomUUID(),'undo delete');expect(repo.snapshot()!.markings).toHaveLength(1);commit(repo,{type:'markings.lockAll',locked:true});const locked=repo.snapshot()!;commit(repo,{type:'markings.clear'});expect(repo.snapshot()!.markings).toHaveLength(0);expect(repo.snapshot()!.patternLibrary).toEqual(lib);expect(repo.snapshot()!.cuttingLibrary).toEqual(archives);expect(repo.snapshot()!.modelLibrary!.find(m=>m.id===p.surface!.id)!.markings).toHaveLength(0);repo.historyMove(false,randomUUID(),'undo clear');expect(repo.snapshot()!.markings).toEqual(locked.markings);}finally{repo.close();}
});
it('one final approval refreshes inference dependencies and refuses stale automatic geometry atomically',async()=>{
 const p=project();p.pieces=[];p.surface=generateSpecies(speciesDefaults('canine'));const piece=rectangle(50,50);piece.nodes.forEach(n=>{n.xMm-=25;n.yMm+=1400;});p.patternLibrary=[{piece,referenceId:randomUUID(),view:'front',category:'head',anatomy:{part:'head',side:'center',confidence:1,method:'manual'}}];const parent=await projectMarking(worker,p,piece.id,'front',0,0,false,true),child={...structuredClone(parent),id:randomUUID(),source:'inferred' as const,placement:undefined,inference:{algorithm:'exact-symmetry-x-1' as const,sourceMarkingId:parent.id,sourceFingerprint:markingFingerprint(parent),distanceMm:1,planeXmm:0,reviewed:false}};p.markings=[parent,child];const repo=new Repository(':memory:');try{repo.open(p,null);commit(repo,{type:'markings.lockAll',locked:true});const after=repo.snapshot()!;expect(after.markings!.every(m=>m.locked&&(m.placement?.reviewed??true)&&(m.inference?.reviewed??true))).toBe(true);expect(staleMarkingIds(after).size).toBe(0);commit(repo,{type:'markings.lockAll',locked:false});const stale=repo.snapshot()!;stale.markings![0].surfaceHash='invalid';const other=new Repository(':memory:');try{other.open(stale,null);const before=other.snapshot();expect(()=>commit(other,{type:'markings.lockAll',locked:true})).toThrow('STALE_MARKING');expect(other.snapshot()).toEqual(before);}finally{other.close();}}finally{repo.close();}
});
