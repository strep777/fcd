import {it,expect} from 'vitest';
import {randomUUID} from 'node:crypto';
import {resolve} from 'node:path';
import {project,rectangle} from '../fixtures';
import {analyze} from '../../apps/desktop/main/worker';
import {seamReports,outputSeamIssues} from '../../apps/desktop/main/seams';
import {gate} from '../../apps/desktop/main/export';
import {Repository} from '../../apps/desktop/main/repository';
const worker=resolve('target/release/fpcad-worker.exe');
it('single-piece output validates either seam side with its unprinted partner but excludes unrelated seams',async()=>{
 const p=project();p.pieces.push(rectangle(110,200),rectangle(60,200));const side=(i:number)=>({pieceId:p.pieces[i].id,nodeId:p.pieces[i].nodes[0].id,endNodeId:p.pieces[i].nodes[1].id,start:0,end:1,reverse:false});p.seams=[{id:randomUUID(),name:'paired edges',a:side(0),b:side(1),expectedEaseMm:0,toleranceMm:1,locked:false}];const geometry=await analyze(worker,p);
 expect(outputSeamIssues(p,geometry,[p.pieces[0].id])).toHaveLength(1);expect(outputSeamIssues(p,geometry,[p.pieces[1].id])).toHaveLength(1);expect(outputSeamIssues(p,geometry,[p.pieces[2].id])).toEqual([]);p.seams[0].expectedEaseMm=-10;expect(outputSeamIssues(p,geometry,[p.pieces[1].id])).toEqual([]);
});
it('seam compares seam edge length with signed ease; mismatches and stale topology block output',async()=>{
 const p=project(),b=rectangle(110,200);p.pieces.push(b);const side=(i:number)=>({pieceId:p.pieces[i].id,nodeId:p.pieces[i].nodes[0].id,endNodeId:p.pieces[i].nodes[1].id,start:0,end:1,reverse:false});p.seams=[{id:randomUUID(),name:'edge seam',a:side(0),b:side(1),expectedEaseMm:-10,toleranceMm:1,locked:true}];const g=await analyze(worker,p);
 expect(seamReports(p,g)[0]).toMatchObject({aMm:100,bMm:110,residualMm:0,status:'valid'});expect(()=>gate(p,g,[])).not.toThrow();p.seams[0].expectedEaseMm=10;expect(seamReports(p,g)[0].residualMm).toBe(20);expect(()=>gate(p,g,[])).toThrow('INVALID_SEAMS');p.seams[0].a.endNodeId=randomUUID();expect(seamReports(p,g)[0].status).toBe('stale');
});
it('seam links, deletes and undo restore all metadata; dependent piece removal is blocked',()=>{
 const repo=new Repository(':memory:'),p=project();p.pieces.push(rectangle());repo.open(p,null);const side=(i:number)=>({pieceId:p.pieces[i].id,nodeId:p.pieces[i].nodes[0].id,endNodeId:p.pieces[i].nodes[1].id,start:0,end:1,reverse:false}),seam={id:randomUUID(),name:'s',a:side(0),b:side(1),expectedEaseMm:0,toleranceMm:1,locked:true};repo.commit({type:'seam.put',seam},randomUUID(),'s');expect(()=>repo.commit({type:'piece.delete',pieceId:p.pieces[0].id},randomUUID(),'del')).toThrow('SEAM_DEPENDENCY');expect(()=>repo.commit({type:'seam.delete',seamId:seam.id},randomUUID(),'locked unlink')).toThrow('SEAM_LOCKED');repo.commit({type:'seam.put',seam:{...seam,locked:false}},randomUUID(),'unlock');repo.commit({type:'seam.delete',seamId:seam.id},randomUUID(),'unlink');repo.historyMove(false);expect(repo.snapshot()?.seams).toEqual([{...seam,locked:false}]);repo.historyMove(false);expect(repo.snapshot()?.seams).toEqual([seam]);repo.close();
});
