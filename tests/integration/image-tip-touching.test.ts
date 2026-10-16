import{afterAll,expect,it}from'vitest';
import{mkdirSync,writeFileSync}from'node:fs';
import{partialTips}from'../../packages/reference/image-tip-partial';
import{spliceSourceTips}from'../../packages/reference/image-tip-splice';
import{fixture,models,truth,distance,cubic,type Geometry}from'../fixtures/source-tip-overlap';
import type{Point}from'../../packages/schema/index';

// Fixed-source evidence for aggregation/splicing. This deliberately supplies
// models rather than claiming that the fixture's opaque white RGBA infers them.
// Expected intervals and geometry below precede every call to partialTips.
const variants=[
 {name:'open',closed:false,reverse:false,seam:false},
 {name:'open-reverse',closed:false,reverse:true,seam:false},
 {name:'closed',closed:true,reverse:false,seam:false},
 {name:'closed-reverse',closed:true,reverse:true,seam:false},
 {name:'closed-seam-in-A',closed:true,reverse:false,seam:true},
 {name:'closed-reverse-seam-in-A',closed:true,reverse:true,seam:true}
];
const cases=variants.flatMap(v=>[false,true].flatMap(observedDifferent=>[['A','B'],['B','A']].map(order=>({...v,observedDifferent,order:order as('A'|'B')[],label:v.name+' observedDifferent='+observedDifferent+' scoreOrder='+order.join(',')}))));
const xy=(p:Point)=>[p.xMm,p.yMm];
const same=(p:Point,q:Point)=>Object.is(p.xMm,q.xMm)&&Object.is(p.yMm,q.yMm);
const expectedForward:[number,number][]=[[40,10],[40,30],[40,40],[51,40],[60,40],[60,50],[60,58],[62,60],[100,60],[110,70],[100,80]];
const records:unknown[]=[];
function oneSource(f:ReturnType<typeof fixture>,xMm:number,yMm:number){
 const matches=f.source.filter(p=>Object.is(p.xMm,xMm)&&Object.is(p.yMm,yMm));expect(matches,JSON.stringify({xMm,yMm})).toHaveLength(1);return matches[0];
}
function sourceProof(f:ReturnType<typeof fixture>,candidates:ReturnType<typeof models>){
 const A=candidates.find(c=>same(c.tip as Point,truth.A))!,B=candidates.find(c=>same(c.tip as Point,truth.B))!;
 expect(A.radius).toBe(9);expect(B.radius).toBe(8);
 // Original sampling has unit-spaced x50,x51,x52 on the shared side. A's
 // source box ends at x50.5; B's starts at x51.5. Thus their first-outside
 // anchors are the SAME existing x51 source sample, with disjoint interiors.
 expect(Math.floor(A.point.xMm)+.5+A.radius).toBe(50.5);
 expect(Math.floor(B.point.xMm)+.5-B.radius).toBe(51.5);
 const shared=oneSource(f,51,40),towardA=oneSource(f,50,40),towardB=oneSource(f,52,40);
 const within=(p:Point,c:typeof A)=>Math.abs(p.xMm-(Math.floor(c.point.xMm)+.5))<=c.radius&&Math.abs(p.yMm-(Math.floor(c.point.yMm)+.5))<=c.radius;
 expect(within(shared,A)).toBe(false);expect(within(shared,B)).toBe(false);
 expect(within(towardA,A)).toBe(true);expect(within(towardB,B)).toBe(true);
 expect(within(oneSource(f,40,30),A)).toBe(false);expect(within(oneSource(f,40,31),A)).toBe(true);
 expect(within(oneSource(f,60,50),B)).toBe(false);expect(within(oneSource(f,60,49),B)).toBe(true);
 return{shared,index:f.source.indexOf(shared)};
}
function noDuplicatesOrZeroEdges(points:Point[],closed:boolean){
 expect(new Set(points.map(p=>p.id)).size).toBe(points.length);
 expect(points.every(p=>Number.isFinite(p.xMm)&&Number.isFinite(p.yMm))).toBe(true);
 const edges=closed?points.length:points.length-1;
 for(let i=0;i<edges;i++)expect(distance(points[i],points[(i+1)%points.length]),'zero edge at '+i).toBeGreaterThan(1e-10);
}
function cubicExact(base:Geometry,actual:Geometry){
 expect(actual.curves).toHaveLength(base.curves.length);
 for(const before of base.curves){
  const after=actual.curves.find(c=>c.startNodeId===before.startNodeId&&c.endNodeId===before.endNodeId);expect(after,before.id).toBeDefined();
  for(const control of ['c1','c2']as const)for(const axis of ['xMm','yMm']as const)expect(Object.is(after![control][axis],before[control][axis]),before.id+' '+control+'.'+axis).toBe(true);
  const a=base.nodes.find(p=>p.id===before.startNodeId)!,b=base.nodes.find(p=>p.id===before.endNodeId)!,aa=actual.nodes.find(p=>p.id===after!.startNodeId)!,bb=actual.nodes.find(p=>p.id===after!.endNodeId)!;
  expect(same(a,aa)&&same(b,bb)).toBe(true);
  for(let j=0;j<=16;j++)expect(same(cubic(a,before.c1,before.c2,b,j/16),cubic(aa,after!.c1,after!.c2,bb,j/16)),before.id+' sample '+j).toBe(true);
 }
}
function expectedPath(result:Geometry,closed:boolean,reverse:boolean){
 let expected=[...expectedForward,...(closed?[[15,80],[15,10]]as[number,number][]:[])];if(reverse)expected.reverse();
 let actual=result.nodes.map(xy);
 if(closed){
  const a=actual.findIndex(p=>p[0]===40&&p[1]===10),b=expected.findIndex(p=>p[0]===40&&p[1]===10);
  expect(a).toBeGreaterThanOrEqual(0);actual=[...actual.slice(a),...actual.slice(0,a)];expected=[...expected.slice(b),...expected.slice(0,b)];
 }
 expect(actual).toHaveLength(expected.length);
 for(let i=0;i<expected.length;i++){
  const target=expected[i],generatedCut=target[0]===40&&target[1]===30||target[0]===60&&target[1]===50;
  // Only newly interpolated splice endpoints use the existing splice1e-10
  // geometry allowance. Original source anchors, shared(51,40), both true
  // tips, all untouched nodes and outside cubic checks remain exact.
  if(generatedCut)expect(Math.hypot(actual[i][0]-target[0],actual[i][1]-target[1])).toBeLessThanOrEqual(1e-10);
  else expect(actual[i]).toStrictEqual(target);
 }
}
it.each(cases)('$label preserves both touching source windows and one shared anchor',spec=>{
 const f=fixture(spec.closed,spec.reverse,spec.seam),candidates=models(f,spec.order);
 for(const candidate of candidates)candidate.radius=same(candidate.tip as Point,truth.A)?9:8;
 const proof=sourceProof(f,candidates),observed=f.source.map(p=>spec.observedDifferent?{...p,id:'observed-'+p.id,xMm:p.xMm+.125,yMm:p.yMm-.0625}:p),model={source:f.source,candidates,rejects:[]};
 const before=structuredClone({f,observed,model});let allocated=0;
 const partial=partialTips(f.base.nodes,f.source,observed,f.closed,f.width,f.height,f.rgba,()=>`new-tip-${++allocated}`,model);
 expect({f,observed,model}).toEqual(before);expect(partial).toBeDefined();expect(allocated).toBe(2);
 records.push({phase:'partial-observed-before-assertion',case:spec,sourceContact:proof.shared,windows:partial!.windows.map(w=>({from:w.from,to:w.to,tip:w.tip,through:w.through})),tipCount:partial!.tips.size,sourceAnchorCount:partial!.baseline.filter(p=>p.id===proof.shared.id).length,observedAnchorCount:partial!.points.filter(p=>p.id===observed[proof.index].id).length});
 expect(partial!.windows).toHaveLength(2);expect(partial!.tips.size).toBe(2);
 for(const name of ['A','B']as const){
  const window=partial!.windows.find(w=>same(w.tip as Point,truth[name]));expect(window,name+' must survive').toBeDefined();expect(window!.through).toHaveLength(0);
  const first=name==='A'?oneSource(f,40,30):proof.shared,last=name==='A'?proof.shared:oneSource(f,60,50);
  expect(window!.from).toBe(f.reverse?last:first);expect(window!.to).toBe(f.reverse?first:last);
  expect(partial!.points.filter(p=>same(p,truth[name]))).toHaveLength(1);expect(partial!.baseline.filter(p=>same(p,truth[name]))).toHaveLength(1);
 }
 // Coordinates AND identity distinguish observed from source. A result that
 // appends the shared anchor twice, or substitutes source for observed, fails.
 const observedAnchor=observed[proof.index];
 expect(partial!.points.filter(p=>p.id===observedAnchor.id)).toHaveLength(1);expect(partial!.points.filter(p=>same(p,observedAnchor))).toHaveLength(1);
 expect(partial!.points.find(p=>p.id===observedAnchor.id)).toBe(observedAnchor);
 expect(partial!.baseline.filter(p=>p.id===proof.shared.id)).toHaveLength(1);expect(partial!.baseline.filter(p=>same(p,proof.shared))).toHaveLength(1);
 expect(partial!.baseline.find(p=>p.id===proof.shared.id)).toBe(proof.shared);
 noDuplicatesOrZeroEdges(partial!.points,f.closed);noDuplicatesOrZeroEdges(partial!.baseline,f.closed);
 const windows=partial!.windows as{from:Point;to:Point;tip:Point;through?:Point[]}[],spliceBefore=structuredClone({base:f.base,windows});let serial=0;
 const saved=spliceSourceTips(f.base,f.closed,windows,()=>`new-splice-${++serial}`);expect({base:f.base,windows}).toEqual(spliceBefore);expect(saved).toBeDefined();
 expectedPath(saved!,f.closed,f.reverse);noDuplicatesOrZeroEdges(saved!.nodes,f.closed);cubicExact(f.base,saved!);
 for(const tip of [truth.A,truth.B])expect(saved!.nodes.filter(p=>same(p,tip))).toHaveLength(1);
 expect(saved!.nodes.filter(p=>same(p,proof.shared))).toHaveLength(1);
 for(const curve of saved!.curves){const index=saved!.nodes.findIndex(p=>p.id===curve.startNodeId);expect(index).toBeGreaterThanOrEqual(0);expect(saved!.nodes[(index+1)%saved!.nodes.length].id).toBe(curve.endNodeId);}
 records.push({case:spec,sourceContact:{index:proof.index,point:proof.shared},observedAnchor,windows:windows.map(w=>({from:w.from,to:w.to,tip:w.tip,through:w.through})),points:partial!.points.length,baseline:partial!.baseline.length,savedNodes:saved!.nodes.map(xy),outsideCubicObjectIs:true});
});
afterAll(()=>{const directory=process.env.FPCAD_TOUCHING_RUN??'test-results/current-task-2/image-tip-touching';mkdirSync(directory,{recursive:true});writeFileSync(directory+'/touching-metrics.json',JSON.stringify({scope:'Independent fixed source geometry + supplied model evidence test aggregation and exact splicing, not RGB inference or final imageBoundaryFit/shared acceptance.',cases:cases.length,records},null,2));});
