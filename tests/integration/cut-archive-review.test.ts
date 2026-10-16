import {beforeAll,expect,it} from 'vitest';
import {randomUUID} from 'node:crypto';
import {resolve} from 'node:path';
import {project,rectangle} from '../fixtures';
import {Repository,hash} from '../../apps/desktop/main/repository';
import {parseObj,bindingIssues,unwrapSurface} from '../../apps/desktop/main/surface';
import {projectMarking,surfaceMarking,markingIssues,staleMarkingIds} from '../../apps/desktop/main/markings';
import {inferMarking} from '../../apps/desktop/main/marking-completion';
import {cutPreview} from '../../apps/desktop/main/cut-preview';
import {gate} from '../../apps/desktop/main/export';
import {analyze} from '../../apps/desktop/main/worker';
import type {Project} from '../../packages/schema/index';
const worker=resolve('target/release/fpcad-worker.exe');
const commit=(repo:Repository,command:Parameters<Repository['commit']>[0])=>repo.commit(command,randomUUID(),command.type);
let automatic:Project,approvedArchive:Project;
async function candidate(repo:Repository){const p=repo.snapshot()!,result=await cutPreview(worker,p.surface!,p,{automaticCuts:true,colorBoundaryCuts:true,normalAngleDeg:180},resolve('dist/assets'));commit(repo,{type:'unwrap.candidate',run:result.run,markings:result.markings});}
function open(p:Project){const repo=new Repository(':memory:');repo.open(structuredClone(p),null);return repo;}
beforeAll(async()=>{
 automatic=project();automatic.pieces=[];automatic.surface=parseObj('v 0 0 0\nv 100 0 0\nv 100 100 0\nv 0 100 0\ng head\nf 1 2 3\nf 1 3 4');const referenceId=randomUUID(),piece=rectangle(10,10);piece.allowanceMm=0;
 automatic.references=[{id:referenceId,name:'Head source',view:'front',width:100,height:100,png:'data:image/png;base64,AA==',calibration:{a:{x:0,y:100},b:{x:0,y:0},distanceMm:100},illustration:{algorithm:'illustration-2',subject:'head',bounds:{minX:0,minY:0,maxX:100,maxY:100},partBounds:[{part:'head',bounds:{minX:0,minY:0,maxX:100,maxY:100}}],foregroundPixels:10000,discardedPixels:0,palette:['#ffffff'],smoothingPx:0}}];
 automatic.patternLibrary=[{piece,referenceId,view:'front',category:'head',anatomy:{part:'head',side:'center',confidence:1,method:'manual'}}];automatic.markings=[await projectMarking(worker,automatic,piece.id,'front',0,0,false,true)];
 const repo=open(automatic);try{commit(repo,{type:'marking.placement.review',markingIds:[automatic.markings[0].id],reviewed:true});await candidate(repo);commit(repo,{type:'unwrap.accept'});approvedArchive=repo.snapshot()!;}finally{repo.close();}
});
it('unreviewed automatic placement can preview but acceptance leaves all state/history unchanged',async()=>{
 const repo=open(automatic);try{await candidate(repo);const before=repo.snapshot(),history=repo.status();expect(before!.surfaceRun!.pieces.length).toBeGreaterThan(1);expect(()=>commit(repo,{type:'unwrap.accept'})).toThrow('AUTOMATIC_PLACEMENT_REVIEW');expect(repo.snapshot()).toEqual(before);expect(repo.status()).toEqual(history);expect(repo.snapshot()!.cuttingLibrary).toBeUndefined();
 commit(repo,{type:'marking.placement.review',markingIds:[automatic.markings![0].id],reviewed:true});await candidate(repo);commit(repo,{type:'unwrap.accept'});expect(markingIssues(repo.snapshot()!)).toEqual([]);
 }finally{repo.close();}
});
function legacyDraft(){const p=structuredClone(approvedArchive);p.markings![0].placement!.reviewed=false;p.cuttingLibrary![0].markings[0].placement!.reviewed=false;return p;}
it('legacy unreviewed cut requires explicit human review and preserves the immutable original archive',async()=>{
 const repo=open(legacyDraft());try{const before=repo.snapshot()!,entry=structuredClone(before.cuttingLibrary![0]),geometry=await analyze(worker,before);expect(()=>gate(before,geometry,[])).toThrow('AUTOMATIC_PLACEMENT_REVIEW');expect(before.markings![0].sourcePieceId).toBeUndefined();
 commit(repo,{type:'marking.placement.review',markingIds:[before.markings![0].id],reviewed:true});const after=repo.snapshot()!;expect(after.cuttingLibrary![0]).toEqual(entry);expect(markingIssues(after)).toEqual([]);expect(()=>gate(after,geometry,[])).not.toThrow();repo.historyMove(false);expect(repo.snapshot()!.markings![0].placement!.reviewed).toBe(false);
 }finally{repo.close();}
});
it('legacy archive approval rejects changed origin, fragments, placement, topology, geometry and paths',()=>{
 const mutations:((p:Project)=>void)[]=[p=>{p.markings![0].cutLibrarySourceHash='0'.repeat(64);},p=>{p.markings![0].fragments[0].rings[0].reverse();},p=>{p.markings![0].placement!.scaleX*=1.01;},p=>{p.surface!.topologyVersion++;},p=>{p.surface!.vertices[0].xMm+=1;},p=>{p.pieces.find(piece=>piece.id===p.markings![0].paths[0].pieceId)!.nodes[0].xMm+=1;},p=>{p.markings![0].paths[0].rings[0][0].xMm+=1;}];
 for(const [index,change] of mutations.entries()){const p=legacyDraft();change(p);const repo=open(p);try{const before=repo.snapshot(),history=repo.status();expect(()=>commit(repo,{type:'marking.placement.review',markingIds:[p.markings![0].id],reviewed:true}),['origin','fragments','placement','topology','surface','geometry','paths'][index]).toThrow('STALE_PLACEMENT');expect(repo.snapshot()).toEqual(before);expect(repo.status()).toEqual(history);}finally{repo.close();}}
});
it('design material baking scopes placement approval to painted cuts while manufacturing still rejects an edited background binding',async()=>{
 const p=legacyDraft(),marking=p.markings![0],painted=new Set(marking.paths.map(path=>path.pieceId)),background=p.pieces.find(piece=>!painted.has(piece.id));expect(p.surfaceRun!.options!.partitionStrategy).toBe('design');expect(painted.size).toBeGreaterThan(0);expect(background).toBeDefined();expect(p.pieces.some(piece=>painted.has(piece.id)&&piece.color===marking.color)).toBe(true);
 background!.nodes[0].xMm+=1;const repo=open(p);try{const entry=structuredClone(p.cuttingLibrary![0]);expect(()=>commit(repo,{type:'marking.placement.review',markingIds:[marking.id],reviewed:true})).not.toThrow();const after=repo.snapshot()!;expect(after.cuttingLibrary![0]).toEqual(entry);expect(markingIssues(after)).toEqual([]);expect(bindingIssues(after).some(issue=>issue.entityId===background!.id&&issue.messageKey==='STALE_BINDING')).toBe(true);const geometry=await analyze(worker,after);expect(()=>gate(after,geometry,[])).toThrow('STALE_BINDING');}finally{repo.close();}
});
it('first anatomy assignment hashes the normalized saved surface and archived review rejects classification changes until restore',()=>{
 const repo=open(approvedArchive);try{const entry=structuredClone(repo.snapshot()!.cuttingLibrary![0]);commit(repo,{type:'surface.anatomy',assignments:[{region:'head',part:'body',side:'center'}]});const p=repo.snapshot()!,digest=hash(JSON.stringify(p.surface));expect(p.markings![0].surfaceHash).toBe(digest);expect(p.bindings!.every(b=>b.surfaceHash===digest)).toBe(true);expect(staleMarkingIds(p).size).toBe(0);expect(markingIssues(p).some(i=>i.messageKey==='AUTOMATIC_PLACEMENT_REVIEW')).toBe(true);expect(()=>commit(repo,{type:'marking.placement.review',markingIds:[p.markings![0].id],reviewed:true})).toThrow('STALE_PLACEMENT');
 commit(repo,{type:'cutting.activate',entryId:entry.id});expect(repo.snapshot()!.cuttingLibrary![0]).toEqual(entry);expect(markingIssues(repo.snapshot()!)).toEqual([]);expect(bindingIssues(repo.snapshot()!)).toEqual([]);
 }finally{repo.close();}
});
it('real unreviewed inferred symmetry can preview but cannot be archived before review',async()=>{
 const p=project();p.pieces=[];p.surface=parseObj('v 0 0 0\nv 100 0 0\nv 200 0 0\nv 0 100 0\nv 100 100 0\nv 200 100 0\ng left\nf 1 2 5\nf 1 5 4\ng right\nf 2 3 5\nf 3 6 5');const run=await unwrapSurface(worker,p.surface,p);p.pieces=run.pieces;p.bindings=run.bindings;
 p.markings=[await surfaceMarking(worker,p,{nodes:[{xMm:0,yMm:0},{xMm:100,yMm:0},{xMm:100,yMm:100},{xMm:0,yMm:100}],origin:[0,0,0],axes:[[1,0,0],[0,1,0],[0,0,1]]},'#ff0000','Left')];p.markings.push(await inferMarking(worker,p,p.markings[0].id,'symmetry',100,100));
 const repo=open(p);try{await candidate(repo);const before=repo.snapshot();expect(()=>commit(repo,{type:'unwrap.accept'})).toThrow('INFERRED_MARKING_REVIEW');expect(repo.snapshot()).toEqual(before);commit(repo,{type:'marking.review',markingId:p.markings[1].id,reviewed:true});await candidate(repo);commit(repo,{type:'unwrap.accept'});expect(repo.snapshot()!.cuttingLibrary).toHaveLength(1);expect(markingIssues(repo.snapshot()!)).toEqual([]);}finally{repo.close();}
});
