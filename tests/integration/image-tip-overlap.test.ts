import{expect,it,afterAll}from'vitest';
import fs from'node:fs';
import{partialTips}from'../../packages/reference/image-tip-partial';
import{spliceSourceTips}from'../../packages/reference/image-tip-splice';
import{fixture,models,truth,distance,cubic,transform,mapGeometry,type Geometry,type Transform}from'../fixtures/source-tip-overlap';
import type{Point}from'../../packages/schema/index';
type Window={from:Point;to:Point;tip:Point;through?:Point[]};
const records:any[]=[];
function partial(f:ReturnType<typeof fixture>,order:('A'|'B'|'C')[],radius=14,modify?:(c:ReturnType<typeof models>)=>void){
 const candidates=models(f,order,radius);modify?.(candidates);const model={source:f.source,candidates,rejects:[]};
 const before=structuredClone({f,model});let serial=0;
 const result=partialTips(f.base.nodes,f.source,f.source,f.closed,f.width,f.height,f.rgba,()=>`partial-${++serial}`,model);
 expect({f,model}).toEqual(before);return result;
}
function splice(base:Geometry,closed:boolean,windows:Window[]){
 const before=structuredClone({base,windows});let serial=0;
 const result=spliceSourceTips(base,closed,windows,()=>`splice-${++serial}`);
 expect({base,windows}).toEqual(before);expect(result).toBeDefined();return result!;
}
function corners(result:Geometry,expected:Point[]){for(const tip of expected)expect(Math.min(...result.nodes.map(p=>distance(p,tip)))).toBeLessThan(1e-8);}
function connectivity(result:Geometry,closed:boolean){
 expect(new Set(result.nodes.map(p=>p.id)).size).toBe(result.nodes.length);
 for(const p of result.nodes)expect(Number.isFinite(p.xMm)&&Number.isFinite(p.yMm)).toBe(true);
 for(const c of result.curves){const index=result.nodes.findIndex(p=>p.id===c.startNodeId);expect(index).toBeGreaterThanOrEqual(0);expect(result.nodes[(index+1)%result.nodes.length].id).toBe(c.endNodeId);}
 if(!closed)expect(result.nodes.length).toBeGreaterThan(1);
}
function outsideArc(base:Geometry,result:Geometry){
 for(const curve of base.curves){const actual=result.curves.find(c=>c.startNodeId===curve.startNodeId&&c.endNodeId===curve.endNodeId);expect(actual).toBeDefined();expect(distance(actual!.c1,curve.c1)).toBeLessThan(1e-10);expect(distance(actual!.c2,curve.c2)).toBeLessThan(1e-10);
  const a=base.nodes.find(p=>p.id===curve.startNodeId)!,b=base.nodes.find(p=>p.id===curve.endNodeId)!,aa=result.nodes.find(p=>p.id===actual!.startNodeId)!,bb=result.nodes.find(p=>p.id===actual!.endNodeId)!;
  for(let j=0;j<=16;j++)expect(distance(cubic(a,curve.c1,curve.c2,b,j/16),cubic(aa,actual!.c1,actual!.c2,bb,j/16))).toBeLessThan(1e-10);
 }
}
function signature(g:Geometry){return g.nodes.map((a,i)=>{const b=g.nodes[(i+1)%g.nodes.length],c=g.curves.find(c=>c.startNodeId===a.id&&c.endNodeId===b.id);return[a.xMm,a.yMm,b.xMm,b.yMm,...(c?[c.c1.xMm,c.c1.yMm,c.c2.xMm,c.c2.yMm]:[])].map(v=>Math.round(v*1e8)/1e8).join(',');}).sort();}
function execute(f:ReturnType<typeof fixture>,order:('A'|'B'|'C')[]){const p=partial(f,order);expect(p).toBeDefined();const windows=p!.windows as Window[],g=splice(f.base,f.closed,windows);corners(g,order.map(k=>truth[k]));connectivity(g,f.closed);outsideArc(f.base,g);records.push({closed:f.closed,reverse:f.reverse,seam:f.seam,scoreOrder:order,windows:windows.map(w=>({from:w.from,to:w.to,path:[w.tip,...w.through??[]]})),nodes:g.nodes.length});return{p:p!,g};}

it.each([false,true])('restores both adjacent supported corners with overlapping windows, closed=%s',closed=>{execute(fixture(closed),['A','B']);});
it.each([false,true])('score order A,C,B restores the same three corner path as A,B,C, closed=%s',closed=>{const f=fixture(closed),one=execute(f,['A','B','C']),two=execute(f,['A','C','B']);expect(signature(two.g)).toEqual(signature(one.g));});
it.each([false,true])('opposite traversal preserves all three overlapping corner models, closed=%s',closed=>{const f=fixture(closed,true);execute(f,['A','C','B']);});
it('a closed contour starting inside the overlap does not lose or repeat a supported corner',()=>{const one=execute(fixture(true),['A','C','B']),two=execute(fixture(true,false,true),['A','C','B']);expect(signature(two.g)).toEqual(signature(one.g));});
it('incompatible shared flank normals never combine independent corner evidence',()=>{const f=fixture(false),p=partial(f,['A','B'],14,c=>{const b=c.find(v=>distance(v.tip,truth.B)<1e-8)!;b.n1={xMm:.08,yMm:Math.sqrt(1-.08**2)};});expect(p).toBeDefined();for(const w of p!.windows as Window[]){const tips=[w.tip,...w.through??[]];expect(tips.some(t=>distance(t,truth.A)<1e-8)&&tips.some(t=>distance(t,truth.B)<1e-8)).toBe(false);}const g=splice(f.base,false,p!.windows as Window[]);outsideArc(f.base,g);connectivity(g,false);});
it('a source patch gap keeps two corner windows separate and retains the unsupported interval',()=>{const f=fixture(false),p=partial(f,['A','B'],7);expect(p).toBeDefined();for(const w of p!.windows as Window[])expect(w.through??[]).toHaveLength(0);expect(p!.windows).toHaveLength(2);const g=splice(f.base,false,p!.windows as Window[]);corners(g,[truth.A,truth.B]);outsideArc(f.base,g);connectivity(g,false);expect(g.nodes.some(p=>p.xMm>49&&p.xMm<53&&p.yMm===40)).toBe(true);});
it('unaccepted model evidence cannot replace the middle raster chamfer or create a through corner',()=>{const f=fixture(false),p=partial(f,['A','B','C'],14,c=>{c.find(v=>distance(v.tip,truth.B)<1e-8)!.accepted=false;});expect(p).toBeDefined();const windows=p!.windows as Window[];for(const w of windows)expect([w.tip,...w.through??[]].some(t=>distance(t,truth.B)<1e-8)).toBe(false);const g=splice(f.base,false,windows);corners(g,[truth.A,truth.C]);expect(g.nodes.some(p=>p.id==='b-left')).toBe(true);expect(g.nodes.some(p=>p.id==='b-right')).toBe(true);outsideArc(f.base,g);});
const transforms:Transform[]=[{angle:0,scale:.1,dx:900,dy:-300},{angle:.37,scale:1,dx:-11,dy:28},{angle:2.19,scale:13,dx:10000,dy:-7000}];
it.each(transforms)('the world transform $angle / $scale preserves the same splice and exact round end',t=>{const f=fixture(true),p=partial(f,['A','C','B']);expect(p).toBeDefined();const base=mapGeometry(f.base,t),windows=(p!.windows as Window[]).map(w=>({from:transform(w.from,t),to:transform(w.to,t),tip:transform(w.tip,t),through:w.through?.map(p=>transform(p,t))})),g=splice(base,true,windows);corners(g,Object.values(truth).map(p=>transform(p,t)));outsideArc(base,g);connectivity(g,true);});
function square48(){const source=Array.from({length:48},(_,i)=>({id:`s48-${i}`,xMm:i<12?20+i:i<24?32:i<36?32-(i-24):20,yMm:i<12?20:i<24?20+i-12:i<36?32:32-(i-36)}));const seed=models(fixture(),['A'])[0],tip={id:'square-seam',xMm:20,yMm:20};return{source,candidate:{...seed,i:0,point:tip,tip,n1:{xMm:1,yMm:0},n2:{xMm:0,yMm:1},radius:6}};}
it('a48sample source crosses a negative-index seam once without duplicated model evidence',()=>{const f=square48(),model={source:f.source,candidates:[f.candidate],rejects:[]},before=structuredClone(model);let serial=0;const p=partialTips(f.source,f.source,f.source,true,64,64,new Uint8Array(64*64*4).fill(255),()=>`s48-new-${++serial}`,model);expect(model).toEqual(before);expect(p).toBeDefined();expect(p!.windows).toHaveLength(1);expect(p!.tips.size).toBe(1);expect(new Set(p!.points.map(p=>p.id)).size).toBe(p!.points.length);expect(p!.points.every(p=>Number.isFinite(p.xMm)&&Number.isFinite(p.yMm))).toBe(true);});
it.each([0,144])('a model window covering the whole48sample circumference cannot smuggle multiple turns, i=%s',index=>{const f=square48(),candidate={...f.candidate,i:index,radius:40},model={source:f.source,candidates:[candidate],rejects:[]},before=structuredClone(model);let calls=0;expect(()=>{const p=partialTips(f.source,f.source,f.source,true,64,64,new Uint8Array(64*64*4).fill(255),()=>`forbidden-${++calls}`,model);expect(p).toBeUndefined();}).not.toThrow();expect(model).toEqual(before);expect(calls).toBe(0);});
const invalidCases=['through-Infinity','through-NaN','total65tips','combined66tips','windows65','nodes2049','curves513','nonfinite-base-node','nonfinite-cubic-control'];
it.each(invalidCases)('%s fails atomically before allocating splice identities',name=>{const base=structuredClone(fixture(false).base),a={id:'from',xMm:40,yMm:30},b={id:'to',xMm:50,yMm:40},tip={...truth.A},windows:Window[]=[{from:a,to:b,tip,through:[]}];if(name==='through-Infinity')windows[0].through=[{id:'inf',xMm:Infinity,yMm:30}];if(name==='through-NaN')windows[0].through=[{id:'nan',xMm:40,yMm:NaN}];if(name==='total65tips')windows[0].through=Array.from({length:64},(_,i)=>({id:`extra-${i}`,xMm:41+i/100,yMm:40}));if(name==='combined66tips')windows.splice(0,1,...[0,1].map(k=>({from:a,to:b,tip:{...tip,id:`tip-${k}`},through:Array.from({length:32},(_,i)=>({id:`extra-${k}-${i}`,xMm:41+i/100,yMm:40}))})));if(name==='windows65')windows.splice(0,1,...Array.from({length:65},(_,i)=>({from:a,to:b,tip:{...tip,id:`tip-${i}`}})));if(name==='nodes2049')base.nodes=Array.from({length:2049},(_,i)=>({id:`large-${i}`,xMm:i/100,yMm:20}));if(name==='curves513')base.curves=Array.from({length:513},(_,i)=>({...base.curves[0],id:`curve-${i}`}));if(name==='nonfinite-base-node')base.nodes[0].xMm=Infinity;if(name==='nonfinite-cubic-control')base.curves[0].c1.yMm=NaN;const before=structuredClone({base,windows});let calls=0;expect(()=>{expect(spliceSourceTips(base,false,windows,()=>`forbidden-${++calls}`)).toBeUndefined();}).not.toThrow();expect({base,windows}).toEqual(before);expect(calls).toBe(0);});
afterAll(()=>{const directory='test-results/contour-repair/source-tip-overlap',stage=process.env.FPCAD_TIP_OVERLAP_STAGE??'diagnostic';if(!/^[a-z0-9-]+$/.test(stage))throw Error('INVALID_OVERLAP_STAGE');fs.mkdirSync(directory,{recursive:true});fs.writeFileSync(directory+'/'+stage+'-metrics.json',JSON.stringify({scope:'Supplied fixed model evidence tests aggregation/splicing only, not RGB inference or full shared-network acceptance.',records},null,2));});
