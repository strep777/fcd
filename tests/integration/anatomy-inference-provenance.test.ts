import {it,expect} from 'vitest';
import {randomUUID} from 'node:crypto';
import {Repository,hash} from '../../apps/desktop/main/repository';
import {markingFingerprint,staleMarkingIds,markingIssues} from '../../apps/desktop/main/markings';
import {markingSchema} from '../../packages/schema/index';
import {gate} from '../../apps/desktop/main/export';
import {pack,unpack} from '../../apps/desktop/main/archive';
import {acceptedCutProject} from '../fixtures/accepted-cut';
function paintedCut(){
 const p=acceptedCutProject(),surface=p.surface!,piece=p.pieces[0],ring=piece.nodes.map(({xMm,yMm})=>({xMm,yMm}));
 const source=markingSchema.parse({id:randomUUID(),name:'Surface paint',source:'surface',color:'#ffffff',surfaceId:surface.id,topologyVersion:surface.topologyVersion,surfaceHash:hash(JSON.stringify(surface)),sourceHash:'',view:'front',offsetXmm:0,offsetYmm:0,
  surfaceShape:{nodes:ring,origin:[0,0,0],axes:[[1,0,0],[0,1,0],[0,0,1]]},fragments:surface.faces.map(f=>({faceId:f.id,rings:[[[1,0,0],[0,1,0],[0,0,1]]]})),paths:[{pieceId:piece.id,geometryHash:p.bindings![0].geometryHash,rings:[ring]}]
 });source.sourceHash=hash(JSON.stringify(source.surfaceShape));
 const inferred=markingSchema.parse({...source,id:randomUUID(),name:'Inferred paint',source:'inferred',surfaceShape:undefined,sourceHash:markingFingerprint(source),inference:{algorithm:'exact-symmetry-x-1',sourceMarkingId:source.id,sourceFingerprint:markingFingerprint(source),distanceMm:100,planeXmm:50,reviewed:true}});
 p.markings=[source,inferred];return p;
}
const commit=(r:Repository,c:Parameters<Repository['commit']>[0])=>r.commit(c,randomUUID(),c.type);
it.each([true,false])('classification preserves valid inference and its existing reviewed=%s state',reviewed=>{
 const p=paintedCut();p.markings![1].inference!.reviewed=reviewed;const repo=new Repository(':memory:');try{
  repo.open(p,null);const before=repo.snapshot()!;commit(repo,{type:'surface.anatomy',assignments:[{region:'sheet',part:'body',side:'center'}]});
  const after=repo.snapshot()!,piece=after.pieces[0];expect(after.surface!.vertices).toEqual(before.surface!.vertices);
  expect(staleMarkingIds(after).size).toBe(0);expect(after.markings![1].inference!.reviewed).toBe(reviewed);
  expect(after.markings![1].inference!.sourceFingerprint).toBe(markingFingerprint(after.markings![0]));
  const geometry=[{id:piece.id,cut:piece.nodes,seam:piece.nodes,areaMm2:10000,perimeterMm:400,issues:[]}];
  if(reviewed)expect(()=>gate(after,geometry,[])).not.toThrow();else expect(()=>gate(after,geometry,[])).toThrow('INFERRED_MARKING_REVIEW');
  expect(unpack(pack(after).bytes)).toEqual(after);repo.historyMove(false);expect(repo.snapshot()!.markings).toEqual(before.markings);repo.historyMove(true);expect(repo.snapshot()!.markings).toEqual(after.markings);
 }finally{repo.close();}
});
it.each(['fingerprint','parent-path','parent-source','missing-parent'] as const)('classification cannot repair an inference with an invalid %s',invalid=>{
 const p=paintedCut(),[source,inferred]=p.markings!;
 if(invalid==='fingerprint')inferred.inference!.sourceFingerprint='0'.repeat(64);
 if(invalid==='parent-path')source.paths[0].geometryHash='0'.repeat(64);
 if(invalid==='parent-source')source.sourceHash='0'.repeat(64);
 if(invalid==='missing-parent')inferred.inference!.sourceMarkingId=randomUUID();
 const repo=new Repository(':memory:');try{
  repo.open(p,null);const fingerprint=repo.snapshot()!.markings![1].inference!.sourceFingerprint;
  commit(repo,{type:'surface.anatomy',assignments:[{region:'sheet',part:'body',side:'center'}]});
  expect(staleMarkingIds(repo.snapshot()!).has(inferred.id)).toBe(true);expect(repo.snapshot()!.markings![1].inference!.sourceFingerprint).toBe(fingerprint);
  expect(markingIssues(repo.snapshot()!).some(i=>i.messageKey==='STALE_MARKING')).toBe(true);
 }finally{repo.close();}
});
