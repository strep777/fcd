import {expect,it} from 'vitest';
import {randomUUID} from 'node:crypto';
import {Repository,hash} from '../../apps/desktop/main/repository';
import {transformProject} from '../../apps/desktop/main/resize-project';
import {markingFingerprint,staleMarkingIds} from '../../apps/desktop/main/markings';
import {pieceGeometryHash} from '../../apps/desktop/main/surface';
import {pack,unpack} from '../../apps/desktop/main/archive';
import {markingSchema,type Project} from '../../packages/schema/index';
import type {ModelTransform} from '../../packages/surface/transform';
import {acceptedCutProject} from '../fixtures/accepted-cut';
import {rectangle} from '../fixtures';

const input=(patch:Partial<ModelTransform>={}):ModelTransform=>({type:'surface.transform',translationMm:{x:10,y:20,z:30},rotationDeg:{x:0,y:0,z:0},scale:{x:1,y:1,z:1},...patch});
function paintedCut():Project{
 const p=acceptedCutProject(),piece=p.pieces[0],surface=p.surface!,shape={origin:[0,0,0],axes:[[1,0,0],[0,1,0],[0,0,1]],nodes:piece.nodes.map(({xMm,yMm})=>({xMm,yMm}))};
 const paint=markingSchema.parse({id:randomUUID(),name:'surface paint',color:'#e63344',source:'surface',surfaceShape:shape,sourceHash:'',surfaceId:surface.id,surfaceHash:hash(JSON.stringify(surface)),topologyVersion:surface.topologyVersion,view:'front',offsetXmm:0,offsetYmm:0,fragments:surface.faces.map(f=>({faceId:f.id,rings:[[[1,0,0],[0,1,0],[0,0,1]]]})),paths:[{pieceId:piece.id,geometryHash:pieceGeometryHash(piece),rings:[piece.nodes.map(({xMm,yMm})=>({xMm,yMm}))]}]});
 paint.sourceHash=hash(JSON.stringify(paint.surfaceShape));p.markings=[paint];
 p.cuttingLibrary![0].markings=structuredClone(p.markings);return p;
}
function commit(repo:Repository,command:ModelTransform,requestId=randomUUID()){return repo.commit(command,requestId,JSON.stringify(command));}
function rowCounts(repo:Repository){return Object.fromEntries(['commands','events','recovery','requests','resources'].map(table=>[table,repo.db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get()!.count]));}

it('whole transforms retain valid surface paint while clearing old cuts and preserving historical snapshots',()=>{
 const p=paintedCut(),historical=structuredClone(p.cuttingLibrary),fragments=structuredClone(p.markings![0].fragments),piece=p.pieces[0];
 expect(staleMarkingIds(p).size).toBe(0);
 transformProject(p,input({pivotMm:{x:0,y:0,z:0},rotationDeg:{x:90,y:90,z:90},scale:{x:2,y:3,z:4}}));
 expect(p.revision).toBe(0);expect(p.surface!.topologyVersion).toBe(2);
 expect(p.pieces.some(v=>v.id===piece.id)).toBe(false);expect(p.bindings).toEqual([]);expect(p.surfaceRun).toBeUndefined();expect(p.activeCutId).toBeUndefined();
 expect(p.markings![0].fragments).toEqual(fragments);expect(p.markings![0].paths).toEqual([]);expect(staleMarkingIds(p).size).toBe(0);
 expect(p.markings![0].surfaceHash).toBe(hash(JSON.stringify(p.surface)));expect(p.markings![0].sourceHash).toBe(hash(JSON.stringify(p.markings![0].surfaceShape)));
 expect(p.cuttingLibrary).toEqual(historical);expect(unpack(pack(p).bytes)).toEqual(p);
});
it('model transforms remove only bound cuts and retain unrelated standalone pattern pieces',()=>{
 const p=paintedCut(),standalone=rectangle(23,45);p.pieces.push(standalone);transformProject(p,input());expect(p.pieces).toEqual([standalone]);expect(p.bindings).toEqual([]);
});
it('local region and vertex deformation leaves previous projected paint stale and historical cuts intact',()=>{
 for(const mode of ['region','vertex'] as const){
  const p=paintedCut();p.surface!.faces[0].region='lower';p.surface!.faces[1].region='upper';
  // Normalize the new classification into current provenance before the edit.
  p.markings![0].surfaceHash=hash(JSON.stringify(p.surface));const before=structuredClone(p),command=input({translationMm:{x:0,y:0,z:5},...(mode==='region'?{regions:['lower']}:{vertexIds:[p.surface!.vertices[1].id]})});
  transformProject(p,command);expect(staleMarkingIds(p).has(p.markings![0].id)).toBe(true);expect(p.markings).toEqual(before.markings);expect(p.surfaceRun).toBeUndefined();expect(p.bindings).toEqual([]);expect(p.cuttingLibrary).toEqual(before.cuttingLibrary);
 }
});
it('transform transactions support undo, redo, recovery and replay without changing cut-library snapshots',()=>{
 const repo=new Repository(':memory:');try{
  repo.open(paintedCut(),null);const before=repo.snapshot()!,command=input({rotationDeg:{x:0,y:0,z:90},scale:{x:2,y:1,z:1}}),requestId=randomUUID();
  commit(repo,command,requestId);const after=repo.snapshot()!;expect(after.revision).toBe(before.revision+1);expect(repo.status().canUndo).toBe(true);expect(repo.status().history[0]).toEqual({revision:1,type:'surface.transform'});
  repo.checkpoint();expect(repo.status().recovery).toContain(1);expect(repo.replay(requestId,JSON.stringify(command))).toBe(true);expect(repo.snapshot()).toEqual(after);
  repo.historyMove(false);const undone=repo.snapshot()!;expect(undone.revision).toBe(2);expect(undone.surface).toEqual(before.surface);expect(undone.markings).toEqual(before.markings);expect(undone.pieces).toEqual(before.pieces);expect(repo.status().canRedo).toBe(true);
  repo.historyMove(true);const redone=repo.snapshot()!;expect(redone.revision).toBe(3);expect(redone.surface).toEqual(after.surface);expect(redone.markings).toEqual(after.markings);expect(redone.cuttingLibrary).toEqual(before.cuttingLibrary);expect(staleMarkingIds(redone).size).toBe(0);
  repo.restore(1);const restored=repo.snapshot()!;expect(restored.revision).toBe(4);expect(restored.surface).toEqual(after.surface);expect(restored.cuttingLibrary).toEqual(before.cuttingLibrary);expect(unpack(pack(restored).bytes)).toEqual(restored);
 }finally{repo.close();}
});
it('invalid selection, degeneracy, locked paint and an aborted transaction leave project, revision and history intact',()=>{
 for(const failure of ['unknown-vertex','unknown-region','degenerate','flipped','locked','callback'] as const){
  const repo=new Repository(':memory:');try{
   const p=paintedCut();if(failure==='locked')p.markings![0].locked=true;repo.open(p,null);repo.checkpoint();const before=repo.snapshot()!,status=repo.status(),counts=rowCounts(repo),requestId=randomUUID();
   const command=input(failure==='unknown-vertex'?{vertexIds:[randomUUID()]}:failure==='unknown-region'?{regions:['missing']}:failure==='degenerate'||failure==='flipped'?{vertexIds:[p.surface!.vertices[0].id],translationMm:{x:failure==='degenerate'?100:150,y:0,z:0}}:{});
   const error=failure==='unknown-vertex'||failure==='unknown-region'?'MODEL_SELECTION_EMPTY':failure==='locked'?'MARKING_LOCKED':failure==='callback'?'ABORTED':'TEMPLATE_INVERSION';
   expect(()=>repo.commit(command,requestId,JSON.stringify(command),failure==='callback'?()=>{throw Error('ABORTED');}:undefined)).toThrow(error);
   expect(repo.snapshot()).toEqual(before);expect(repo.status()).toEqual(status);expect(rowCounts(repo)).toEqual(counts);expect(repo.replay(requestId,JSON.stringify(command))).toBe(false);
  }finally{repo.close();}
 }
});
it('whole transforms reject stale dependency fingerprints instead of silently repairing them',()=>{
 for(const invalid of ['surface-hash','source-hash','inference-fingerprint'] as const){
  const p=paintedCut(),source=p.markings![0];
  if(invalid==='surface-hash')source.surfaceHash='0'.repeat(64);if(invalid==='source-hash')source.sourceHash='0'.repeat(64);
  if(invalid==='inference-fingerprint')p.markings!.push(markingSchema.parse({...source,id:randomUUID(),name:'inferred',source:'inferred',surfaceShape:undefined,inference:{algorithm:'exact-symmetry-x-1',sourceMarkingId:source.id,sourceFingerprint:'0'.repeat(64),distanceMm:100,planeXmm:50,reviewed:false}}));
  const repo=new Repository(':memory:');try{repo.open(p,null);const before=repo.snapshot()!;expect(()=>commit(repo,input())).toThrow('STALE_MARKING');expect(repo.snapshot()).toEqual(before);}finally{repo.close();}
 }
});
it('a valid inferred attachment remains geometrically valid after a whole transform and still requires review',()=>{
 for(const reviewed of [false,true]){
  const p=paintedCut(),source=p.markings![0];p.markings!.push(markingSchema.parse({...source,id:randomUUID(),name:'inferred',source:'inferred',surfaceShape:undefined,inference:{algorithm:'exact-symmetry-x-1',sourceMarkingId:source.id,sourceFingerprint:markingFingerprint(source),distanceMm:100,planeXmm:50,reviewed}}));
  const repo=new Repository(':memory:');try{
   repo.open(p,null);commit(repo,input());const after=repo.snapshot()!,inferred=after.markings![1];expect(staleMarkingIds(after).size).toBe(0);expect(inferred.inference!.reviewed).toBe(false);expect(inferred.inference!.sourceFingerprint).toBe(markingFingerprint(after.markings![0]));expect(after.cuttingLibrary).toEqual(p.cuttingLibrary);
  }finally{repo.close();}
 }
});
