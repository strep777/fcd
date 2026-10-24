import {expect,it} from 'vitest';
import {randomUUID} from 'node:crypto';
import {mkdirSync,mkdtempSync} from 'node:fs';
import {join} from 'node:path';
import {commandSchema,markingSchema,type Project} from '../../packages/schema/index';
import {withPatternSpacing,patternSpacingMatches} from '../../packages/manufacturing/pattern-spacing';
import {Repository,hash} from '../../apps/desktop/main/repository';
import {pack,unpack} from '../../apps/desktop/main/archive';
import {bindingIssues,pieceGeometryHash} from '../../apps/desktop/main/surface';
import {markingFingerprint} from '../../apps/desktop/main/markings';
import {acceptedCutProject} from '../fixtures/accepted-cut';
import {rectangle} from '../fixtures';

function fixture():Project{
 const p=acceptedCutProject(),other=acceptedCutProject(),extra=rectangle(60,80),piece=p.pieces[0],surface=p.surface!;
 p.pieces[0].allowanceSource='project';extra.allowanceSource='piece';extra.allowanceMm=3;extra.edgeAllowances=[{nodeId:extra.nodes[0].id,endNodeId:extra.nodes[1].id,samples:[{s:0,widthMm:1},{s:1,widthMm:2}]}];p.pieces.push(extra);
 p.modelLibrary=[{id:other.surface!.id,name:'Inactive model',surface:other.surface!,pieces:other.pieces,bindings:other.bindings,markings:[]}];
 const ring=piece.nodes.map(({xMm,yMm})=>({xMm,yMm})),source=markingSchema.parse({id:randomUUID(),name:'Source paint',source:'surface',color:'#ffffff',surfaceId:surface.id,topologyVersion:1,surfaceHash:hash(JSON.stringify(surface)),sourceHash:'source',view:'front',offsetXmm:0,offsetYmm:0,fragments:surface.faces.map(face=>({faceId:face.id,rings:[[[1,0,0],[0,1,0],[0,0,1]]]})),paths:[{pieceId:piece.id,geometryHash:pieceGeometryHash(piece),rings:[ring]}]});
 p.markings=[source,markingSchema.parse({...source,id:randomUUID(),source:'inferred',locked:true,inference:{algorithm:'exact-symmetry-x-1',sourceMarkingId:source.id,sourceFingerprint:markingFingerprint(source),distanceMm:100,planeXmm:50,reviewed:false}})];return p;
}

it('applies one uniform spacing to all live pieces without editing geometry, historical cuts, inactive models or inference review',()=>{
 const p=fixture(),before=structuredClone(p),next=withPatternSpacing(p,7,'round');
 expect(p).toEqual(before);expect(patternSpacingMatches(next,7,'round')).toBe(true);expect(next.defaultAllowanceMm).toBe(7);
 for(const piece of next.pieces){const old=p.pieces.find(old=>old.id===piece.id)!;expect(piece.allowanceMm).toBe(7);expect(piece.allowanceSource).toBe('piece');expect(piece.edgeAllowances).toBeUndefined();expect(piece.join).toBe('round');expect(piece.nodes).toEqual(old.nodes);expect(piece.holes).toEqual(old.holes);expect(piece.curves).toEqual(old.curves);}
 expect(next.cuttingLibrary).toEqual(before.cuttingLibrary);expect(next.modelLibrary).toEqual(before.modelLibrary);expect(next.markings).toEqual(before.markings);expect(next.markings![1].inference!.reviewed).toBe(false);expect(bindingIssues(next)).toEqual([]);
});

it('saves all spacing changes in one undoable transaction and preserves them after file roundtrip and database reopen',()=>{
 mkdirSync('.local/tests',{recursive:true});const path=join(mkdtempSync('.local/tests/pattern-spacing-'),'workspace.sqlite');let repo=new Repository(path);
 try{repo.open(fixture(),null);const before=repo.snapshot()!,inactive=before.modelLibrary!.find(model=>model.id!==before.surface!.id),history=repo.status().history.length,requestId=randomUUID();
  repo.commit(commandSchema.parse({type:'patterns.allowance',widthMm:0,join:'bevel'}),requestId,'spacing');const after=repo.snapshot()!;
  expect(after.revision).toBe(before.revision+1);expect(repo.status().history).toHaveLength(history+1);expect(patternSpacingMatches(after,0,'bevel')).toBe(true);expect(after.cuttingLibrary).toEqual(before.cuttingLibrary);expect(after.modelLibrary!.find(model=>model.id===inactive!.id)).toEqual(inactive);expect(after.markings).toEqual(before.markings);expect(unpack(pack(after).bytes)).toEqual(after);expect(repo.replay(requestId,'spacing')).toBe(true);
  repo.historyMove(false);expect(repo.snapshot()!.pieces).toEqual(before.pieces);expect(repo.snapshot()!.defaultAllowanceMm).toBe(before.defaultAllowanceMm);repo.historyMove(true);const saved=repo.snapshot()!;repo.close();repo=new Repository(path);expect(repo.snapshot()).toEqual(saved);repo.historyMove(false);expect(repo.snapshot()!.pieces).toEqual(before.pieces);repo.historyMove(true);expect(patternSpacingMatches(repo.snapshot()!,0,'bevel')).toBe(true);
 }finally{repo.close();}
});

it('failed bulk persistence rolls back every piece, default, revision and history together',()=>{
 const repo=new Repository(':memory:');try{repo.open(fixture(),null);const before=repo.snapshot(),history=repo.status();repo.db.exec("CREATE TRIGGER fail_bulk_spacing BEFORE INSERT ON commands BEGIN SELECT RAISE(ABORT,'injected write failure'); END;");expect(()=>repo.commit({type:'patterns.allowance',widthMm:8},randomUUID(),'failed-spacing')).toThrow('injected write failure');expect(repo.snapshot()).toEqual(before);expect(repo.status()).toEqual(history);}finally{repo.close();}
});

it.each([-1,1001,NaN,Infinity])('rejects invalid spacing size %s before any state change',widthMm=>{expect(commandSchema.safeParse({type:'patterns.allowance',widthMm}).success).toBe(false);});

it('invalidates a pending cut preview without changing accepted history or marking review',()=>{
 const p=fixture();p.surfaceRun!.accepted=false;p.previewMarkings=structuredClone(p.markings);const next=withPatternSpacing(p,5);expect(next.surfaceRun).toBeUndefined();expect(next.previewMarkings).toBeUndefined();expect(next.cuttingLibrary).toEqual(p.cuttingLibrary);expect(next.markings).toEqual(p.markings);
});
