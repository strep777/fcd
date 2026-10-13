import {it,expect} from 'vitest';
import {randomUUID} from 'node:crypto';
import {resolve} from 'node:path';
import {project,rectangle} from '../fixtures';
import {prepareCutMarkings} from '../../apps/desktop/main/cut-markings';
import {cutPreview} from '../../apps/desktop/main/cut-preview';
import {projectMarking,projectReferenceGeometry,markingFingerprint,markingIssues} from '../../apps/desktop/main/markings';
import {parseObj,unwrapSurface,bindingIssues,pieceGeometryHash,cutColorHash} from '../../apps/desktop/main/surface';
import {Repository} from '../../apps/desktop/main/repository';
import {pack,unpack} from '../../apps/desktop/main/archive';
import {registrationFingerprint} from '../../packages/reference/placement-registration';
import {placedPoint} from '../../packages/reference/placement-transform';
import type {Marking} from '../../packages/schema/index';
const worker=resolve('target/release/fpcad-worker.exe');
async function fixture(placed=false){
 const p=project();p.pieces=[];p.surface=parseObj('v 0 0 0\nv 200 0 0\nv 200 200 0\nv 0 200 0\ng head\nf 1 2 3\nf 1 3 4');
 const source=rectangle(80,60);source.allowanceMm=0;source.nodes.forEach(n=>{n.xMm+=30;n.yMm+=40;});
 p.patternLibrary=[{piece:source,referenceId:randomUUID(),view:'front',category:'head',anatomy:{part:'head',side:'center',confidence:1,method:'manual'}}];
 const marking=await projectMarking(worker,p,source.id,'front',3.125,-4.25);
 if(placed){marking.placement={algorithm:'anatomy-1',part:'head',side:'center',regions:['head'],sourceGroupHash:registrationFingerprint(p,p.patternLibrary[0]),sourceCenter:{xMm:70,yMm:70},targetCenter:{xMm:90,yMm:110},scaleX:.6,scaleY:.8,rotationRad:.3,reviewed:true};marking.fragments=(await projectReferenceGeometry(worker,p,source.id,'front',marking.offsetXmm,marking.offsetYmm,marking.placement)).fragments;}
 marking.name='Reviewed custom pigment';marking.color='#123456';p.markings=[marking];return {p,source,marking};
}
function coarse(marking:Marking){
 marking.fragments=marking.fragments.map(f=>({...f,rings:f.rings.map(r=>r.map(w=>w.map(n=>n*.999999+.000001/3) as [number,number,number]))}));
}
function points(p:Awaited<ReturnType<typeof fixture>>['p'],m:Marking){const vertices=new Map(p.surface!.vertices.map(v=>[v.id,v])),faces=new Map(p.surface!.faces.map(f=>[f.id,f]));return m.fragments.flatMap(f=>f.rings.flatMap(r=>r.map(w=>{const face=faces.get(f.faceId)!;return {xMm:w.reduce((sum,n,i)=>sum+n*vertices.get(face.vertices[i])!.xMm,0),yMm:w.reduce((sum,n,i)=>sum+n*vertices.get(face.vertices[i])!.yMm,0)};})));}
it('reconstructs coarse fragments with the saved reviewed transform and custom metadata without mutating the project',async()=>{
 const {p,source,marking}=await fixture(true);coarse(marking);const before=structuredClone(p),next=await prepareCutMarkings(worker,p),m=next.markings![0];
 expect(p).toEqual(before);expect(m.fragments).not.toEqual(marking.fragments);expect({...m,fragments:marking.fragments}).toEqual(marking);
 const restored=points(p,m);for(const n of source.nodes){const expected=placedPoint(n,marking.placement!,marking.offsetXmm,marking.offsetYmm);expect(Math.min(...restored.map(v=>Math.hypot(v.xMm-expected.xMm,v.yMm-expected.yMm)))).toBeLessThan(1e-8);}
});
it('reconstructs source-manual geometry from its edited source while preserving source edit mode',async()=>{
 const {p,source,marking}=await fixture();coarse(marking);source.nodes[0].xMm+=7.25;marking.source='manual';marking.editMode='source-manual';marking.sourceHash=pieceGeometryHash(source);const before=structuredClone(p),expected=await projectReferenceGeometry(worker,p,source.id,marking.view,marking.offsetXmm,marking.offsetYmm),next=await prepareCutMarkings(worker,p);
 expect(p).toEqual(before);expect(next.markings![0].fragments).toEqual(expected.fragments);expect(next.markings![0].source).toBe('manual');expect(next.markings![0].editMode).toBe('source-manual');expect(next.markings![0].id).toBe(marking.id);
});
it('preserves positive-area source islands and holes thinner than the old projection grid',async()=>{
 for(const island of [false,true]){
  const {p,source,marking}=await fixture();
  if(island)source.nodes=[[20,.00005],[50,.00005],[50,.00015],[20,.00015]].map(([xMm,yMm])=>({id:randomUUID(),xMm,yMm}));
  else source.holes=[[[50,40.00005],[50,40.0002],[90,40.0002],[90,40.00005]].map(([xMm,yMm])=>({id:randomUUID(),xMm,yMm}))];
  marking.sourceHash=pieceGeometryHash(source);marking.offsetXmm=0;marking.offsetYmm=0;marking.fragments=(await projectReferenceGeometry(worker,p,source.id,'front',0,0)).fragments;coarse(marking);const next=await prepareCutMarkings(worker,p),vertices=new Map(p.surface!.vertices.map(v=>[v.id,v])),faces=new Map(p.surface!.faces.map(f=>[f.id,f])),area=(ring:number[][])=>ring.reduce((sum,a,i)=>{const b=ring[(i+1)%ring.length];return sum+a[0]*b[1]-b[0]*a[1];},0)/2;
  const restored=next.markings![0].fragments.flatMap(f=>f.rings.map(r=>r.map(w=>[0,1].map(axis=>w.reduce((sum,n,i)=>{const v=vertices.get(faces.get(f.faceId)!.vertices[i])!;return sum+n*(axis?v.yMm:v.xMm);},0))))),restoredArea=Math.abs(restored.reduce((sum,r)=>sum+area(r),0));
  expect(restoredArea).toBeCloseTo(island?.003:4800-.006,7);if(!island)expect(restored.some(r=>area(r)<0)).toBe(true);
 }
});
it('reconstructs separate copies of the same source with each saved transform',async()=>{
 const {p,marking}=await fixture(true),other={...structuredClone(marking),id:randomUUID(),placement:{...marking.placement!,targetCenter:{xMm:145,yMm:130},rotationRad:-.25}};p.markings!.push(other);coarse(marking);coarse(other);const next=await prepareCutMarkings(worker,p);
 for(let i=0;i<2;i++){const m=p.markings![i],expected=await projectReferenceGeometry(worker,p,m.sourcePieceId!,m.view,m.offsetXmm,m.offsetYmm,m.placement);expect(next.markings![i].fragments).toEqual(expected.fragments);expect(next.markings![i].id).toBe(m.id);}
 expect(next.markings![0].fragments).not.toEqual(next.markings![1].fragments);
});
it('prepares a locked projection without unlocking it or permitting marking commands',async()=>{
 const {p,source,marking}=await fixture(true);coarse(marking);marking.locked=true;const before=structuredClone(p),next=await prepareCutMarkings(worker,p);expect(p).toEqual(before);expect(next.markings![0].locked).toBe(true);expect(next.markings![0].placement).toEqual(marking.placement);expect(next.markings![0].fragments).not.toEqual(marking.fragments);
 await expect(projectMarking(worker,next,source.id,'front',0,0,true)).rejects.toThrow('MARKING_LOCKED');const repo=new Repository(':memory:');try{repo.open(next,null);expect(()=>repo.commit({type:'marking.delete',markingId:marking.id},randomUUID(),'delete')).toThrow('MARKING_LOCKED');}finally{repo.close();}
});
it('does not let precise preparation bypass the existing locked replacement acceptance guard',async()=>{
 const {p,source,marking}=await fixture(true),run=await unwrapSurface(worker,p.surface!,p,{automaticCuts:false,normalAngleDeg:180});p.pieces=run.pieces;p.bindings=run.bindings;marking.paths=(await projectReferenceGeometry(worker,p,source.id,marking.view,marking.offsetXmm,marking.offsetYmm,marking.placement)).paths;coarse(marking);marking.locked=true;
 const candidate=await cutPreview(worker,p.surface!,p,{automaticCuts:false,colorBoundaryCuts:true,normalAngleDeg:180},resolve('dist/assets')),repo=new Repository(':memory:');try{repo.open(p,null);repo.commit({type:'unwrap.candidate',run:candidate.run,markings:candidate.markings},randomUUID(),'candidate');const before=repo.snapshot();expect(()=>repo.commit({type:'unwrap.accept'},randomUUID(),'accept')).toThrow('MARKING_LOCKED');expect(repo.snapshot()).toEqual(before);}finally{repo.close();}
});
it('retains manual UV and legacy manual thin islands and holes byte for byte',async()=>{
 const {p,marking}=await fixture();const bary=([x,y]:number[]):[number,number,number]=>[1-x/200,(x-y)/200,y/200],island=[[20,.00005],[50,.00005],[50,.00015],[20,.00015]].map(bary),hole=[[20,.00005],[20,.00015],[50,.00015],[50,.00005]].map(bary);
 marking.source='manual';marking.editMode='uv-manual';marking.fragments=[{faceId:p.surface!.faces[0].id,rings:[[[1,0,0],[0,1,0],[0,0,1]],hole]},{faceId:p.surface!.faces[0].id,rings:[island]}];const legacy={...structuredClone(marking),id:randomUUID(),editMode:undefined};p.markings!.push(legacy);const before=structuredClone(p),next=await prepareCutMarkings(worker,p);expect(p).toEqual(before);expect(next.markings).toEqual(before.markings);
});
it('retains reviewed inferred paint and its parent without refreshing a changed dependency',async()=>{
 const {p,marking}=await fixture();coarse(marking);const child:Marking={...structuredClone(marking),id:randomUUID(),source:'inferred',sourcePieceId:undefined,inference:{algorithm:'exact-symmetry-x-1',sourceMarkingId:marking.id,sourceFingerprint:markingFingerprint(marking),distanceMm:10,planeXmm:100,reviewed:true}};p.markings!.push(child);const before=structuredClone(p),next=await prepareCutMarkings(worker,p);expect(next).toEqual(before);expect(p).toEqual(before);
 marking.color='#654321';await expect(prepareCutMarkings(worker,p)).rejects.toThrow('STALE_MARKING');
});
it('keeps candidate hashes consistent through acceptance, archival, undo and serialization',async()=>{
 const {p,marking}=await fixture(true);coarse(marking);const before=structuredClone(p),candidate=await cutPreview(worker,p.surface!,p,{automaticCuts:false,colorBoundaryCuts:true,normalAngleDeg:180},resolve('dist/assets'));expect(p).toEqual(before);expect(candidate.markings[0].fragments).not.toEqual(marking.fragments);
 const candidateProject={...p,pieces:candidate.run.pieces,bindings:candidate.run.bindings,markings:candidate.markings};expect(bindingIssues(candidateProject)).toEqual([]);expect(candidate.run.bindings.every(b=>b.colorHash===cutColorHash(candidateProject))).toBe(true);
 const repo=new Repository(':memory:');try{repo.open(p,null);repo.commit({type:'unwrap.candidate',run:candidate.run,markings:candidate.markings},randomUUID(),'candidate');expect(repo.snapshot()!.markings).toEqual(before.markings);repo.historyMove(false);expect(repo.snapshot()!.markings).toEqual(before.markings);expect(repo.snapshot()!.surfaceRun).toBeUndefined();repo.historyMove(true);repo.commit({type:'unwrap.accept'},randomUUID(),'accept');const accepted=repo.snapshot()!;expect(bindingIssues(accepted)).toEqual([]);expect(markingIssues(accepted)).toEqual([]);expect(accepted.markings![0].placement).toEqual(marking.placement);expect(accepted.markings![0].color).toBe(marking.color);expect(unpack(pack(accepted).bytes)).toEqual(accepted);repo.historyMove(false);expect(repo.snapshot()!.markings).toEqual(before.markings);}finally{repo.close();}
});
