import {expect,it} from 'vitest';
import {randomUUID,createHash} from 'node:crypto';
import {projectSchema,markingSchema,type Project} from '../../packages/schema/index';
import {cutCandidateInputHash} from '../../apps/desktop/main/cut-candidate';
import {Repository} from '../../apps/desktop/main/repository';
import {pack,unpack} from '../../apps/desktop/main/archive';
import {acceptedCutProject} from '../fixtures/accepted-cut';

/** The pre-materialPalette persisted input contract, retained independently
 * for compatibility. New history metadata must not change old-project bytes. */
function legacyHash(p:Project){const references=p.references?.map(({id,view,calibration,illustration})=>({id,view,calibration,illustration}));return createHash('sha256').update(JSON.stringify({surface:p.surface,pieces:p.pieces,bindings:p.bindings,markings:p.markings,patternLibrary:p.patternLibrary,materials:p.materials,defaultAllowanceMm:p.defaultAllowanceMm,references})).digest('hex');}
function history(){const p=acceptedCutProject(),entry=p.cuttingLibrary![0];entry.run.materialPalette={algorithm:'reference-fabric-1',baseColor:p.pieces[0].color,markings:[]};p.activeCutId=entry.id;const extra=structuredClone(entry);extra.id=randomUUID();extra.name='Unrelated saved cut';p.cuttingLibrary!.push(extra);return projectSchema.parse(p);}
const commit=(repo:Repository,command:Parameters<Repository['commit']>[0])=>repo.commit(command,randomUUID(),command.type);
function pending(p:Project){const repo=new Repository(':memory:');try{repo.open(p,null);commit(repo,{type:'unwrap.candidate',run:{...p.surfaceRun!,accepted:false}});return unpack(pack(repo.snapshot()!).bytes);}finally{repo.close();}}

it('all genuine old snapshots without a palette retain the exact original candidate input hash',()=>{
 const p=acceptedCutProject();p.activeCutId=p.cuttingLibrary![0].id;expect(cutCandidateInputHash(p)).toBe(legacyHash(p));const copy=structuredClone(p);copy.cuttingLibrary![0].name='Renamed immutable snapshot';copy.cuttingLibrary![0].createdAt='2026-10-25T00:00:00.000Z';expect(cutCandidateInputHash(copy)).toBe(legacyHash(p));expect(cutCandidateInputHash(unpack(pack(copy).bytes))).toBe(legacyHash(copy));
});
it('only an actually active palette contributes; unrelated saved palette/version metadata is not a live input',()=>{
 const p=history(),before=cutCandidateInputHash(p),changed=structuredClone(p);changed.cuttingLibrary![1].run.materialPalette!.baseColor='#ffffff';changed.cuttingLibrary![1].name='Unrelated edited metadata';expect(cutCandidateInputHash(changed)).toBe(before);changed.cuttingLibrary![0].run.materialPalette!.baseColor='#ffffff';expect(cutCandidateInputHash(changed)).not.toBe(before);
});
it('switching the actually selected palette changes the input while adding/removing a used palette preserves old fallback identity',()=>{
 const p=history(),withPalette=cutCandidateInputHash(p),switched=structuredClone(p);switched.activeCutId=switched.cuttingLibrary![1].id;expect(cutCandidateInputHash(switched)).not.toBe(withPalette);delete p.cuttingLibrary![0].run.materialPalette;expect(cutCandidateInputHash(p)).toBe(legacyHash(p));expect(cutCandidateInputHash(p)).not.toBe(withPalette);
});
it('a cut-library marking uses its own snapshot palette even when that entry is not active',()=>{
 const p=history(),entry=p.cuttingLibrary![0];delete p.activeCutId;const piece=p.pieces[0],binding=p.bindings![0],m=markingSchema.parse({id:randomUUID(),name:'Stored cut paint',source:'cut-library',cutLibraryId:entry.id,cutLibrarySourceHash:binding.geometryHash,sourceHash:binding.geometryHash,surfaceId:p.surface!.id,topologyVersion:p.surface!.topologyVersion,surfaceHash:binding.surfaceHash,color:piece.color,view:'front',offsetXmm:0,offsetYmm:0,fragments:p.surface!.faces.map(f=>({faceId:f.id,rings:[[[1,0,0],[0,1,0],[0,0,1]]]})),paths:[{pieceId:piece.id,geometryHash:binding.geometryHash,rings:[piece.nodes.map(({xMm,yMm})=>({xMm,yMm}))]}]});p.markings=[m];entry.markings=[structuredClone(m)];entry.run.materialPalette!.markings=[{markingId:m.id,color:piece.color}];const hash=cutCandidateInputHash(p),changed=structuredClone(p);changed.cuttingLibrary![0].run.materialPalette!.markings[0].color='#1260c0';expect(cutCandidateInputHash(changed)).not.toBe(hash);changed.cuttingLibrary![0].run.materialPalette=structuredClone(entry.run.materialPalette);changed.cuttingLibrary![1].run.materialPalette!.baseColor='#ffffff';expect(cutCandidateInputHash(changed)).toBe(hash);
 const manual=structuredClone(p);manual.markings![0].source='manual';const before=cutCandidateInputHash(manual);manual.cuttingLibrary![0].run.materialPalette!.baseColor='#ffffff';expect(cutCandidateInputHash(manual)).toBe(before);
});

it('a persisted pending candidate refuses changed active material history atomically without forging its saved input hash',()=>{
 const saved=pending(history()),originalHash=saved.surfaceRun!.inputHash,changed=structuredClone(saved);changed.cuttingLibrary![0].run.materialPalette!.baseColor='#ffffff';expect(changed.surfaceRun!.inputHash).toBe(originalHash);const repo=new Repository(':memory:');try{repo.open(changed,null);const before=repo.snapshot(),status=repo.status(),request=randomUUID();expect(()=>repo.commit({type:'unwrap.accept'},request,'stale history')).toThrow('STALE_RESULT');expect(repo.snapshot()).toEqual(before);expect(repo.status()).toEqual(status);expect(repo.replay(request,'stale history')).toBe(false);expect(repo.snapshot()!.cuttingLibrary).toHaveLength(2);}finally{repo.close();}
});
it('the same persisted pending candidate still accepts when only an unused history palette changed',()=>{
 const p=pending(history());p.cuttingLibrary![1].run.materialPalette!.baseColor='#ffffff';const repo=new Repository(':memory:');try{repo.open(p,null);commit(repo,{type:'unwrap.accept'});expect(repo.snapshot()!.surfaceRun!.accepted).toBe(true);expect(repo.snapshot()!.cuttingLibrary).toHaveLength(3);}finally{repo.close();}
});
it('discarding a pending candidate restores the pre-calculation state and cannot accept that discarded result',()=>{
 const p=history(),repo=new Repository(':memory:');try{repo.open(p,null);commit(repo,{type:'unwrap.candidate',run:{...p.surfaceRun!,accepted:false}});expect(repo.snapshot()!.surfaceRun!.accepted).toBe(false);repo.historyMove(false);expect(repo.snapshot()!.surfaceRun).toEqual(p.surfaceRun);const before=repo.snapshot(),status=repo.status(),id=randomUUID();expect(()=>repo.commit({type:'unwrap.accept'},id,'discarded candidate')).toThrow('STALE_RESULT');expect(repo.snapshot()).toEqual(before);expect(repo.status()).toEqual(status);expect(repo.replay(id,'discarded candidate')).toBe(false);}finally{repo.close();}
});
