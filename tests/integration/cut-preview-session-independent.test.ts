import {spawn} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {resolve} from 'node:path';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {cutPreview} from '../../apps/desktop/main/cut-preview';
import {parseObj} from '../../apps/desktop/main/surface';
import {projectMarking} from '../../apps/desktop/main/markings';
import * as remapping from '../../apps/desktop/main/unwrap-markings';
import {project,rectangle} from '../fixtures';

// Observe actual native processes. No geometry response, binary or timer is
// replaced; the injected failure below happens after real remapping returns.
vi.mock('node:child_process',async original=>{const actual=await original<typeof import('node:child_process')>();return {...actual,spawn:vi.fn(actual.spawn)};});
const worker=resolve('target/release/fpcad-worker.exe'),assets=resolve('dist/assets'),starts=vi.mocked(spawn),options={method:'arap' as const,partitionStrategy:'design' as const,automaticCuts:true,colorBoundaryCuts:true};
beforeEach(()=>{starts.mockClear();});
afterEach(()=>vi.restoreAllMocks());
async function input(){
 const p=project();p.pieces=[];p.defaultAllowanceMm=0;p.surface=parseObj('v 0 0 0\nv 100 0 0\nv 100 200 0\nv 0 200 0\nf 1 2 3\nf 1 3 4');
 const blue=rectangle(30,60);blue.color='#02a6f4';blue.allowanceMm=0;blue.nodes.forEach(n=>{n.xMm+=20;n.yMm+=40;});p.patternLibrary=[{piece:blue,referenceId:randomUUID(),view:'front',category:'paint'}];p.markings=[await projectMarking(worker,p,blue.id,'front',0,0)];
 starts.mockClear();return p;
}
function exited(){
 // One batch process owns prepare, clip, remap and final analysis. The
 // explicit surface-unwrapping session remains separately owned as designed.
 expect(starts).toHaveBeenCalledTimes(2);
 for(const call of starts.mock.calls)expect(call[1]).toEqual(['--stream']);
 for(const result of starts.mock.results){expect(result.type).toBe('return');const child=result.value;expect(child.exitCode!==null||child.signalCode!==null,'cutPreview must await every native process exit before settling').toBe(true);}
}
function metrics(candidate:Awaited<ReturnType<typeof cutPreview>>){
 const rows=candidate.run.bindings.map(binding=>{const piece=candidate.run.pieces.find(p=>p.id===binding.pieceId)!,trim=binding.trim!,uv=new Map(trim.vertices.map(v=>[v.id,v])),areaMm2=trim.triangles.reduce((sum,t)=>{const [a,b,c]=t.vertices.map(id=>uv.get(id)!);return sum+Math.abs((b.xMm-a.xMm)*(c.yMm-a.yMm)-(b.yMm-a.yMm)*(c.xMm-a.xMm))/2;},0);return{color:piece.color,areaMm2};}).sort((a,b)=>a.color.localeCompare(b.color));
 expect(rows).toHaveLength(2);expect(rows.find(p=>p.color==='#02a6f4')!.areaMm2).toBeCloseTo(1800,7);expect(rows.reduce((sum,p)=>sum+p.areaMm2,0)).toBeCloseTo(20000,7);
 expect(candidate.run.cutPreview).toHaveLength(2);expect(candidate.run.accepted).toBe(false);expect(candidate.markings).toHaveLength(1);return rows;
}

it('one complete colored cut preview reuses native sessions and awaits all native exits',async()=>{
 const p=await input(),before=structuredClone(p),candidate=await cutPreview(worker,p.surface!,p,options,assets);
 exited();metrics(candidate);expect(p).toEqual(before);
});

it('a failure after real native remapping closes both sessions and a fresh preview recovers exact geometry',async()=>{
 const p=await input(),before=structuredClone(p),nativeRemap=remapping.unwrapMarkings;let nativeRemapCompleted=false;
 const failure=vi.spyOn(remapping,'unwrapMarkings').mockImplementationOnce(async(...args)=>{await nativeRemap(...args);nativeRemapCompleted=true;throw Error('INDEPENDENT_POST_REMAP_FAILURE');});
 await expect(cutPreview(worker,p.surface!,p,options,assets)).rejects.toThrow('INDEPENDENT_POST_REMAP_FAILURE');
 expect(nativeRemapCompleted).toBe(true);exited();expect(p).toEqual(before);failure.mockRestore();starts.mockClear();
 const recovered=await cutPreview(worker,p.surface!,p,options,assets);exited();metrics(recovered);expect(p).toEqual(before);
});
