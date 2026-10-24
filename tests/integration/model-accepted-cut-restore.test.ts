import {expect,it} from 'vitest';
import {randomUUID} from 'node:crypto';
import type {Marking} from '../../packages/schema/index';
import {Repository,hash} from '../../apps/desktop/main/repository';
import {cutColorHash,pieceGeometryHash} from '../../apps/desktop/main/surface';
import {pack,unpack} from '../../apps/desktop/main/archive';
import {acceptedCutProject} from '../fixtures/accepted-cut';
import {rectangle} from '../fixtures';

function switched(){
 const source=acceptedCutProject(),surface=source.surface!,entry=source.cuttingLibrary![0];
 const marking:Marking={id:randomUUID(),name:'Current model paint',color:'#88aacc',source:'surface',sourceHash:'source',surfaceId:surface.id,topologyVersion:surface.topologyVersion,surfaceHash:source.surfaceRun!.sourceHash,view:'front',offsetXmm:0,offsetYmm:0,fragments:[{faceId:surface.faces[0].id,rings:[[[1,0,0],[0,1,0],[0,0,1]]]}],paths:[]};
 source.markings=[marking];source.bindings![0].colorHash=cutColorHash(source);source.surfaceRun!.bindings=structuredClone(source.bindings!);source.surfaceRun!.cutEdges=[[surface.vertices[0].id,surface.vertices[2].id]];entry.run=structuredClone(source.surfaceRun!);entry.markings=structuredClone(source.markings);source.activeCutId=entry.id;
 const standalone=rectangle(25,35);source.pieces.push(standalone);
 const other=acceptedCutProject().surface!;source.modelLibrary=[{id:other.id,name:'Model B',surface:other,pieces:[],bindings:[],markings:[],seams:[]}];
 const repo=new Repository(':memory:');try{
  repo.open(source,null);repo.commit({type:'model.activate',modelId:other.id},randomUUID(),'switch-to-B');
  const project=repo.snapshot()!,model=project.modelLibrary!.find(m=>m.id===surface.id)!;
  expect(project.surface!.id).toBe(other.id);expect(project.surfaceRun).toBeUndefined();expect(project.activeCutId).toBeUndefined();
  return {project,model,entry:project.cuttingLibrary![0],modelId:surface.id,otherId:other.id,standaloneId:standalone.id};
 }finally{repo.close();}
}

it('restores the unique fully matching accepted cut after A to B to A without replacing current model data',()=>{
 const {project,model,entry,modelId,otherId,standaloneId}=switched(),repo=new Repository(':memory:');
 // Metadata unrelated to the cut is deliberately more recent than the archive.
 model.name='Renamed model A';model.markings![0].locked=true;
 const expected=structuredClone(model),archive=structuredClone(project.cuttingLibrary);
 try{
  repo.open(project,null);const before=repo.snapshot()!,requestId=randomUUID();repo.commit({type:'model.activate',modelId},requestId,'restore-A');
  const restored=repo.snapshot()!;expect(restored.revision).toBe(before.revision+1);expect(restored.activeCutId).toBe(entry.id);expect(restored.surfaceRun).toEqual(entry.run);expect(restored.surfaceRun!.accepted).toBe(true);expect(restored.surfaceRun!.cutEdges).not.toHaveLength(0);
  expect(restored.surface).toEqual(expected.surface);expect(restored.bindings).toEqual(expected.bindings);expect(restored.markings).toEqual(expected.markings);expect(restored.modelLibrary!.find(m=>m.id===modelId)!.name).toBe(expected.name);expect(restored.pieces.filter(p=>p.id!==standaloneId)).toEqual(expected.pieces);expect(restored.pieces.some(p=>p.id===standaloneId)).toBe(true);expect(restored.cuttingLibrary).toEqual(archive);expect(restored.previewMarkings).toBeUndefined();expect(restored.nesting).toBeUndefined();expect(repo.replay(requestId,'restore-A')).toBe(true);
  expect(unpack(pack(restored).bytes)).toEqual(restored);
  repo.historyMove(false);expect(repo.snapshot()!.surface!.id).toBe(otherId);expect(repo.snapshot()!.surfaceRun).toBeUndefined();expect(repo.snapshot()!.activeCutId).toBeUndefined();
  repo.historyMove(true);expect(repo.snapshot()!.surfaceRun).toEqual(entry.run);expect(repo.snapshot()!.activeCutId).toBe(entry.id);expect(repo.snapshot()!.cuttingLibrary).toEqual(archive);
 }finally{repo.close();}
});

const failures=['no archive','ambiguous archive','same surface ID with changed mesh','archive surface hash mismatch','run source hash mismatch','piece metadata changed','binding report changed','missing piece','missing binding','stale surface hash in both bindings','stale geometry hash in both bindings','matching edited geometry with stale hashes','stale live color','stale color hash in both bindings'] as const;
it.each(failures)('keeps cut metadata absent for %s and preserves the restored current model',failure=>{
 const {project,model,entry,modelId,standaloneId}=switched(),repo=new Repository(':memory:');
 if(failure==='no archive')project.cuttingLibrary=[];
 if(failure==='ambiguous archive')project.cuttingLibrary!.push({...structuredClone(entry),id:randomUUID()});
 if(failure==='same surface ID with changed mesh')model.surface.vertices[0].xMm+=.5;
 if(failure==='archive surface hash mismatch')entry.surface.vertices[0].xMm+=.5;
 if(failure==='run source hash mismatch')entry.run.sourceHash='0'.repeat(64);
 if(failure==='piece metadata changed')model.pieces![0].allowanceMm+=1;
 if(failure==='binding report changed')model.bindings![0].report.status='needsReview';
 if(failure==='missing piece')model.pieces=[];
 if(failure==='missing binding')model.bindings=[];
 if(failure==='stale surface hash in both bindings')model.bindings![0].surfaceHash=entry.run.bindings[0].surfaceHash='0'.repeat(64);
 if(failure==='stale geometry hash in both bindings')model.bindings![0].geometryHash=entry.run.bindings[0].geometryHash='0'.repeat(64);
 if(failure==='matching edited geometry with stale hashes'){
  model.pieces![0].nodes[0].xMm+=.5;entry.run.pieces=structuredClone(model.pieces!);
  expect(model.bindings![0].geometryHash).not.toBe(pieceGeometryHash(model.pieces![0]));
 }
 if(failure==='stale live color')model.markings![0].color='#ddbb88';
 if(failure==='stale color hash in both bindings')model.bindings![0].colorHash=entry.run.bindings[0].colorHash='0'.repeat(64);
 const expected=structuredClone(model),archives=structuredClone(project.cuttingLibrary);
 try{
  repo.open(project,null);repo.commit({type:'model.activate',modelId},randomUUID(),'restore-unmatched-A');const restored=repo.snapshot()!;
  expect(restored.surfaceRun).toBeUndefined();expect(restored.activeCutId).toBeUndefined();expect(restored.surface).toEqual(expected.surface);expect(restored.bindings).toEqual(expected.bindings);expect(restored.markings).toEqual(expected.markings);expect(restored.pieces.filter(p=>p.id!==standaloneId)).toEqual(expected.pieces??[]);expect(restored.cuttingLibrary).toEqual(archives);
 }finally{repo.close();}
});

it('does not accept a current binding with a refreshed hash when the complete historical piece differs',()=>{
 const {project,model,modelId}=switched(),repo=new Repository(':memory:');model.pieces![0].nodes[0].xMm+=.5;model.bindings![0].geometryHash=pieceGeometryHash(model.pieces![0]);model.surface.topologyVersion++;
 model.bindings![0].topologyVersion=model.surface.topologyVersion;model.bindings![0].surfaceHash=hash(JSON.stringify(model.surface));
 try{repo.open(project,null);repo.commit({type:'model.activate',modelId},randomUUID(),'restore-edited-A');expect(repo.snapshot()!.surfaceRun).toBeUndefined();expect(repo.snapshot()!.activeCutId).toBeUndefined();expect(repo.snapshot()!.pieces).toContainEqual(model.pieces![0]);}finally{repo.close();}
});

it('compares the full piece after ordinary material-name normalization without restoring an older archive over it',()=>{
 const {project,model,entry,modelId}=switched(),repo=new Repository(':memory:'),materialId=randomUUID();
 project.materials=[{id:materialId,name:'Renamed fur',version:2,category:'fur',thicknessMm:1,furLengthMm:10,compensationMm:0,defaultAllowanceMm:0,furRequired:false,grainRequired:false,rotationsRad:[0],seamToleranceMm:0,stretchWarpRatio:0,stretchWeftRatio:0,measurementSource:'estimated',sourceNote:''}];
 for(const piece of [model.pieces![0],entry.run.pieces[0]]){piece.materialId=materialId;piece.material='Original fur';}
 const archive=structuredClone(project.cuttingLibrary);
 try{repo.open(project,null);repo.commit({type:'model.activate',modelId},randomUUID(),'restore-renamed-material');const restored=repo.snapshot()!;expect(restored.pieces.find(p=>p.id===model.pieces![0].id)!.material).toBe('Renamed fur');expect(restored.surfaceRun).toBeUndefined();expect(restored.activeCutId).toBeUndefined();expect(restored.cuttingLibrary).toEqual(archive);}finally{repo.close();}
});
