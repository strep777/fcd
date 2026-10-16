import {expect,it} from 'vitest';
import {randomUUID} from 'node:crypto';
import {Repository,hash} from '../../apps/desktop/main/repository';
import {markingFingerprint,markingIssues,staleMarkingIds} from '../../apps/desktop/main/markings';
import {pieceGeometryHash,bindingIssues} from '../../apps/desktop/main/surface';
import {gate} from '../../apps/desktop/main/export';
import {pack,unpack} from '../../apps/desktop/main/archive';
import {splitProjectEdge} from '../../apps/desktop/main/topology-edit';
import {markingSchema,type Project} from '../../packages/schema/index';
import {acceptedCutProject} from '../fixtures/accepted-cut';

function paintedCut():Project {
 const p=acceptedCutProject(),piece=p.pieces[0],surface=p.surface!;
 const ring=piece.nodes.map(({xMm,yMm})=>({xMm,yMm}));
 const source=markingSchema.parse({id:randomUUID(),name:'表面花纹',source:'surface',color:'#ffffff',surfaceId:surface.id,topologyVersion:1,surfaceHash:hash(JSON.stringify(surface)),sourceHash:'',view:'front',offsetXmm:0,offsetYmm:0,
  surfaceShape:{nodes:ring,origin:[0,0,0],axes:[[1,0,0],[0,1,0],[0,0,1]]},
  fragments:surface.faces.map(f=>({faceId:f.id,rings:[[[1,0,0],[0,1,0],[0,0,1]]]})),paths:[{pieceId:piece.id,geometryHash:pieceGeometryHash(piece),rings:[ring]}]
 });
 source.sourceHash=hash(JSON.stringify(source.surfaceShape));
 const inferred=markingSchema.parse({...source,id:randomUUID(),name:'推断花纹',source:'inferred',surfaceShape:undefined,sourceHash:markingFingerprint(source),inference:{algorithm:'exact-symmetry-x-1',sourceMarkingId:source.id,sourceFingerprint:markingFingerprint(source),distanceMm:100,planeXmm:50,reviewed:true}});
 p.markings=[source,inferred];return p;
}

it('exact subdivision retains valid inference approval, locks, output eligibility and undo/file roundtrips',()=>{
 const p=paintedCut(),piece=p.pieces[0];p.markings!.forEach(m=>m.locked=true);
 const repo=new Repository(':memory:');
 try{
  repo.open(p,null);const before=repo.snapshot()!;
  expect(staleMarkingIds(before).size).toBe(0);
  repo.commit({type:'piece.split',pieceId:piece.id,nodeId:piece.nodes[0].id,t:.5},randomUUID(),'split');
  const after=repo.snapshot()!,[source,inferred]=after.markings!;
  expect(after.pieces[0].nodes).toHaveLength(5);
  expect(inferred.inference!.sourceFingerprint).toBe(markingFingerprint(source));
  expect(inferred.inference!.sourceFingerprint).not.toBe(before.markings![1].inference!.sourceFingerprint);
  expect(inferred.inference!.reviewed).toBe(true);expect(inferred.locked).toBe(true);
  expect(after.markings!.map(m=>m.fragments)).toEqual(before.markings!.map(m=>m.fragments));
  expect(bindingIssues(after)).toEqual([]);expect(markingIssues(after)).toEqual([]);
  expect(()=>gate(after,[{id:piece.id,cut:after.pieces[0].nodes,seam:after.pieces[0].nodes,areaMm2:10000,perimeterMm:400,issues:[]}],[])).not.toThrow();
  expect(unpack(pack(after).bytes)).toEqual(after);
  repo.historyMove(false);expect(repo.snapshot()!.markings).toEqual(before.markings);
  repo.historyMove(true);expect(repo.snapshot()!.markings).toEqual(after.markings);
 }finally{repo.close();}
});

it('subdivision preserves missing or mismatched inference dependencies as stale',()=>{
 for(const invalid of ['fingerprint','missing-parent','changed-color','stale-path'] as const){
  const p=paintedCut(),[source,inferred]=p.markings!;
  if(invalid==='fingerprint')inferred.inference!.sourceFingerprint='0'.repeat(64);
  if(invalid==='missing-parent')inferred.inference!.sourceMarkingId=randomUUID();
  if(invalid==='changed-color')source.color='#000000';
  if(invalid==='stale-path')source.paths[0].geometryHash='0'.repeat(64);
  const oldFingerprint=inferred.inference!.sourceFingerprint;
  expect(staleMarkingIds(p).has(inferred.id)).toBe(true);
  const after=splitProjectEdge(p,p.pieces[0].id,p.pieces[0].nodes[0].id,.5);
  expect(after.markings![1].inference!.sourceFingerprint).toBe(oldFingerprint);
  expect(staleMarkingIds(after).has(inferred.id)).toBe(true);
 }
});

it('rebasing a valid dependency does not approve an unreviewed inference or mutate input',()=>{
 const p=paintedCut();p.markings![1].inference!.reviewed=false;
 const before=structuredClone(p),after=splitProjectEdge(p,p.pieces[0].id,p.pieces[0].nodes[0].id,.5);
 expect(p).toEqual(before);expect(staleMarkingIds(after).size).toBe(0);
 expect(markingIssues(after).map(i=>i.messageKey)).toEqual(['INFERRED_MARKING_REVIEW']);
});
