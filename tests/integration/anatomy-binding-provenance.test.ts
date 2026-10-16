import {it,expect} from 'vitest';
import {randomUUID} from 'node:crypto';
import {Repository,hash} from '../../apps/desktop/main/repository';
import {bindingIssues} from '../../apps/desktop/main/surface';
import {sculptSurface} from '../../apps/desktop/main/body-edit';
import {gate} from '../../apps/desktop/main/export';
import {pack,unpack} from '../../apps/desktop/main/archive';
import {acceptedCutProject} from '../fixtures/accepted-cut';

const commit=(repo:Repository,c:Parameters<Repository['commit']>[0])=>repo.commit(c,randomUUID(),c.type);
const classify={type:'surface.anatomy' as const,assignments:[{region:'sheet',part:'body' as const,side:'center' as const}]};
it('classification keeps a sculpt-invalidated cut stale through undo, redo and file roundtrips',()=>{
 const repo=new Repository(':memory:');
 try{
  repo.open(acceptedCutProject(),null);const original=repo.snapshot()!;
  const surface=sculptSurface(original.surface!,{center:original.surface!.vertices[0],radiusMm:25,delta:{xMm:-20,yMm:0,zMm:0},mode:'move',strength:1});
  commit(repo,{type:'surface.set',surface});const sculpted=repo.snapshot()!;
  commit(repo,classify);const after=repo.snapshot()!,piece=after.pieces[0];
  expect(after.bindings).toEqual(sculpted.bindings);expect(after.pieces).toEqual(original.pieces);
  expect(bindingIssues(after).map(i=>i.messageKey)).toContain('STALE_BINDING');
  const geometry=[{id:piece.id,cut:piece.nodes,seam:piece.nodes,areaMm2:10000,perimeterMm:400,issues:[]}];
  expect(()=>gate(after,geometry,[])).toThrow('STALE_BINDING');
  const entry=original.cuttingLibrary![0];expect(after.cuttingLibrary![0]).toEqual(entry);
  expect(bindingIssues(unpack(pack(after).bytes)).map(i=>i.messageKey)).toContain('STALE_BINDING');
  repo.historyMove(false);expect(repo.snapshot()!.surface).toEqual(sculpted.surface);
  repo.historyMove(true);expect(bindingIssues(repo.snapshot()!).map(i=>i.messageKey)).toContain('STALE_BINDING');
 }finally{repo.close();}
});
it('classification updates valid bindings while preserving mismatched geometry and color dependencies',()=>{
 for(const invalid of ['none','geometry','color'] as const){
  const p=acceptedCutProject();if(invalid==='geometry')p.bindings![0].geometryHash='0'.repeat(64);if(invalid==='color')p.bindings![0].colorHash='0'.repeat(64);
  const repo=new Repository(':memory:');try{
   repo.open(p,null);const before=repo.snapshot()!;commit(repo,classify);const after=repo.snapshot()!;
   expect(bindingIssues(after).some(i=>i.severity==='error')).toBe(invalid!=='none');
   if(invalid==='none')expect(after.bindings![0].surfaceHash).toBe(hash(JSON.stringify(after.surface)));
   else expect(after.bindings).toEqual(before.bindings);
   expect(after.cuttingLibrary).toEqual(before.cuttingLibrary);
  }finally{repo.close();}
 }
});
