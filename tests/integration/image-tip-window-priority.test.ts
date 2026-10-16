import {afterAll,expect,it} from 'vitest';
import {mkdirSync,writeFileSync} from 'node:fs';
import {partialTips} from '../../packages/reference/image-tip-partial';
import {spliceSourceTips} from '../../packages/reference/image-tip-splice';
import {fixture,models,truth,distance,type Candidate} from '../fixtures/source-tip-overlap';

// Supplied fixed models isolate window arbitration. Opaque white fixture RGBA
// does not certify RGB inference. Endpoints and the real A corner are prescribed
// by the existing source fixture, independently of any production output.
const variants=[
 {name:'open',closed:false,reverse:false,seam:false},
 {name:'open-reverse',closed:false,reverse:true,seam:false},
 {name:'closed',closed:true,reverse:false,seam:false},
 {name:'closed-reverse',closed:true,reverse:true,seam:false},
 {name:'closed-seam',closed:true,reverse:false,seam:true},
 {name:'closed-reverse-seam',closed:true,reverse:true,seam:true}
];
const records:unknown[]=[];
type F=ReturnType<typeof fixture>;
function evidence(f:F){
 const base=models(f,['A'],9)[0];
 const valid:Candidate={...structuredClone(base),error:.01,fitError:.01};
 // The supplied first model has a better score and lies only3px from the
 // true corner. Its vertical-side endpoint is nevertheless3px off its line,
 // outside the existing1.5px contract. No output is used to choose this case.
 const invalid:Candidate={...structuredClone(base),error:.001,fitError:.01,tip:{...base.tip,xMm:43}};
 const before=structuredClone({f,valid,invalid});
 const incoming=f.reverse?{xMm:51,yMm:40}:{xMm:40,yMm:30},outgoing=f.reverse?{xMm:40,yMm:30}:{xMm:51,yMm:40};
 expect(f.source.filter(p=>p.xMm===incoming.xMm&&p.yMm===incoming.yMm)).toHaveLength(1);
 expect(f.source.filter(p=>p.xMm===outgoing.xMm&&p.yMm===outgoing.yMm)).toHaveLength(1);
 expect(distance(valid.tip,invalid.tip)).toBe(3);
 expect(f.reverse?Math.abs(outgoing.xMm-invalid.tip.xMm):Math.abs(incoming.xMm-invalid.tip.xMm)).toBe(3);
 return{valid,invalid,before,incoming,outgoing};
}
function run(f:F,candidates:Candidate[]){
 const model={source:f.source,candidates,rejects:[]},before=structuredClone({f,model});let calls=0;
 const result=partialTips(f.base.nodes,f.source,f.source,f.closed,f.width,f.height,f.rgba,()=>`window-new-${++calls}`,model);
 expect({f,model}).toEqual(before);return{result,calls};
}
function validResult(f:F,candidates:Candidate[],label:string){
 const only=run(f,[candidates.find(c=>c.tip.xMm===40&&c.tip.yMm===40)!]),actual=run(f,candidates);
 expect(only.result).toBeDefined();expect(actual.result).toBeDefined();expect(actual.calls).toBe(1);
 expect(actual.result).toEqual(only.result);expect(actual.result!.windows).toHaveLength(1);expect(actual.result!.tips.size).toBe(1);
 const w=actual.result!.windows[0],from=f.reverse?{xMm:51,yMm:40}:{xMm:40,yMm:30},to=f.reverse?{xMm:40,yMm:30}:{xMm:51,yMm:40};
 expect({xMm:w.from.xMm,yMm:w.from.yMm}).toEqual(from);expect({xMm:w.to.xMm,yMm:w.to.yMm}).toEqual(to);
 expect({xMm:w.tip.xMm,yMm:w.tip.yMm}).toEqual({xMm:40,yMm:40});expect(w.through).toHaveLength(0);
 expect(new Set(actual.result!.points.map(p=>p.id)).size).toBe(actual.result!.points.length);
 expect(new Set(actual.result!.baseline.map(p=>p.id)).size).toBe(actual.result!.baseline.length);
 const input=structuredClone({base:f.base,windows:actual.result!.windows});let serial=0;
 const saved=spliceSourceTips(f.base,f.closed,actual.result!.windows,()=>`window-splice-${++serial}`);
 expect({base:f.base,windows:actual.result!.windows}).toEqual(input);expect(saved).toBeDefined();
 expect(saved!.nodes.filter(p=>p.xMm===truth.A.xMm&&p.yMm===truth.A.yMm)).toHaveLength(1);
 expect(new Set(saved!.nodes.map(p=>p.id)).size).toBe(saved!.nodes.length);
 // A local replacement retains the non-target circular controls/endpoints
 // under the existing splice fixture's1e-10numeric allowance.
 for(const c of f.base.curves){const after=saved!.curves.find(v=>v.startNodeId===c.startNodeId&&v.endNodeId===c.endNodeId);expect(after).toBeDefined();expect(distance(after!.c1,c.c1)).toBeLessThan(1e-10);expect(distance(after!.c2,c.c2)).toBeLessThan(1e-10);}
 for(const c of saved!.curves){const i=saved!.nodes.findIndex(n=>n.id===c.startNodeId);expect(i).toBeGreaterThanOrEqual(0);expect(saved!.nodes[(i+1)%saved!.nodes.length].id).toBe(c.endNodeId);}
 records.push({label,closed:f.closed,reverse:f.reverse,seam:f.seam,windows:actual.result!.windows,saved});
}
it.each(variants.flatMap(v=>[false,true].map(reverseInput=>({...v,reverseInput,label:v.name+' inputOrder='+reverseInput}))))('$label retains a valid second-ranked window after rejecting the first',spec=>{
 const f=fixture(spec.closed,spec.reverse,spec.seam),e=evidence(f),candidates=spec.reverseInput?[e.valid,e.invalid]:[e.invalid,e.valid];
 validResult(f,candidates,spec.label);expect({f,valid:e.valid,invalid:e.invalid}).toEqual(e.before);
});
it.each(variants)('$name rejects all invalid nearby windows without allocating identities',spec=>{
 const f=fixture(spec.closed,spec.reverse,spec.seam),e=evidence(f),second={...structuredClone(e.invalid),error:.002,tip:{...e.invalid.tip,xMm:44.5}};
 const actual=run(f,[e.invalid,second]);expect(actual.result).toBeUndefined();expect(actual.calls).toBe(0);
 records.push({case:spec,result:'undefined',allocations:actual.calls});
});
it.each(variants)('$name retains a valid first model once without replacing it by a lower-ranked duplicate',spec=>{
 const f=fixture(spec.closed,spec.reverse,spec.seam),e=evidence(f),valid={...e.valid,error:.001},duplicate={...structuredClone(e.valid),error:.01,tip:{...e.valid.tip,xMm:40.25,yMm:40.25}};
 validResult(f,[duplicate,valid],spec.name+' valid-first');
});
afterAll(()=>{const directory=process.env.FPCAD_TIP_WINDOW_RUN??'test-results/contour-repair/image-tip-window-priority';mkdirSync(directory,{recursive:true});writeFileSync(directory+'/window-contracts.json',JSON.stringify({scope:'Fixed supplied-model arbitration/splicing contracts; not RGB inference or full shared-network acceptance.',count:24,records},null,2));});
