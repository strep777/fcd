import {expect,it} from 'vitest';
import {refitMeasuredCubicWindow,type JointRefitOptions} from '../../packages/reference/joint-source-fit';
import type {Point,Piece} from '../../packages/schema/index';
type Curve=NonNullable<Piece['curves']>[number];
type Baseline={nodes:Point[];curves:Curve[]};
const point=(id:string,xMm:number,yMm:number):Point=>({id,xMm,yMm});
const length=(a:Point,b:Point)=>Math.hypot(a.xMm-b.xMm,a.yMm-b.yMm);
const bezier=(P:Point[],t:number,id='sample')=>{const s=1-t,w=[s*s*s,3*s*s*t,3*s*t*t,t*t*t];return point(id,P.reduce((v,p,i)=>v+w[i]*p.xMm,0),P.reduce((v,p,i)=>v+w[i]*p.yMm,0));};
const segmentDistance=(p:Point,a:Point,b:Point)=>{const dx=b.xMm-a.xMm,dy=b.yMm-a.yMm,d=dx*dx+dy*dy,t=d?Math.max(0,Math.min(1,((p.xMm-a.xMm)*dx+(p.yMm-a.yMm)*dy)/d)):0;return Math.hypot(p.xMm-a.xMm-t*dx,p.yMm-a.yMm-t*dy);};
const nearest=(p:Point,poly:Point[])=>Math.min(...poly.slice(0,-1).map((a,i)=>segmentDistance(p,a,poly[i+1])));
// Uniform analytic sampling uses the second-derivative interpolation bound,
// rather than the production recursive flattener.
function flatten(a:Point,c1:Point,c2:Point,b:Point,tolerance:number,createId:()=>string){
 const M=6*Math.max(Math.hypot(a.xMm-2*c1.xMm+c2.xMm,a.yMm-2*c1.yMm+c2.yMm),Math.hypot(c1.xMm-2*c2.xMm+b.xMm,c1.yMm-2*c2.yMm+b.yMm)),n=Math.max(1,Math.ceil(Math.sqrt(M/(8*tolerance))));
 return Array.from({length:n+1},(_,i)=>i===0?a:i===n?b:bezier([a,c1,c2,b],i/n,createId()));
}
function spanError(source:Point[],target:Point[],_pixel:number,spacing:number){let error=nearest(source.at(-1)!,target);for(let i=0;i+1<source.length;i++){const a=source[i],b=source[i+1],n=Math.max(1,Math.ceil(length(a,b)/spacing));for(let j=0;j<n;j++)error=Math.max(error,nearest(point('',a.xMm+(b.xMm-a.xMm)*j/n,a.yMm+(b.yMm-a.yMm)*j/n),target));}return error;}
function straight(raw:Point[],grid:{size:number}){const a=raw[0],b=raw.find(p=>length(a,p)>grid.size*1e-8);if(!b)return true;return raw.every(p=>Math.abs((b.xMm-a.xMm)*(p.yMm-a.yMm)-(b.yMm-a.yMm)*(p.xMm-a.xMm))<=length(a,b)*grid.size*1e-8);}
function options(scale=1,rotation=0):JointRefitOptions{let id=0;return {grid:{size:scale,ux:Math.cos(rotation),uy:Math.sin(rotation)},protectedIds:new Set(),bevel:()=>false,createId:()=>`generated-${id++}`,tools:{flatten,spanError,straight}};}
const freeze=(value:any):any=>{if(value&&typeof value==='object'){Object.values(value).forEach(freeze);Object.freeze(value);}return value;};
function smooth(scale=1,rotation=0,offset=0){
 const transform=(p:Point)=>({...p,xMm:offset+scale*(p.xMm*Math.cos(rotation)-p.yMm*Math.sin(rotation)),yMm:-offset+scale*(p.xMm*Math.sin(rotation)+p.yMm*Math.cos(rotation))}),P=[point('a',0,0),point('c1',6,0),point('c2',18,12),point('b',24,12)],raw=Array.from({length:25},(_,i)=>transform(bezier(P,i/24,`raw-${i}`))),K=transform(point(raw[12].id,12,6.5)),nodes=[raw[0],K,raw[24]],curves:Curve[]=[{id:'left',startNodeId:nodes[0].id,endNodeId:K.id,c1:transform(point('outer-left',3,0)),c2:transform(point('inner-left',7.5,3.5))},{id:'right',startNodeId:K.id,endNodeId:nodes[2].id,c1:transform(point('inner-right',16.5,8.5)),c2:transform(point('outer-right',21,12))}];
 return {raw,baseline:{nodes,curves}};
}
function curveAndLine(long=false){
 const a=point('a',0,0),trueK=point('k',8,4),b=point('b',long?16:12,long?8:6),P=[a,point('true-c1',3,0),point('true-c2',6,3),trueK],raw=[...Array.from({length:19},(_,i)=>bezier(P,i/18,i===0?'a':i===18?'k':`left-${i}`)),...Array.from({length:8},(_,i)=>point(i===7?'b':`line-${i}`,trueK.xMm+(b.xMm-trueK.xMm)*(i+1)/8,trueK.yMm+(b.yMm-trueK.yMm)*(i+1)/8))],k=point('k',8,4.5),baseline:Baseline={nodes:[raw[0],k,raw.at(-1)!],curves:[{id:'curve',startNodeId:'a',endNodeId:'k',c1:point('outer',3,0),c2:point('biased-inner',6,3.6)}]};
 return {raw,baseline};
}
function geometry(baseline:Baseline,tolerance:number){return baseline.nodes.flatMap((a,i)=>{if(i+1===baseline.nodes.length)return [a];const b=baseline.nodes[i+1],c=baseline.curves.find(c=>c.startNodeId===a.id&&c.endNodeId===b.id);return c?flatten(a,c.c1,c.c2,b,tolerance,()=>'' ).slice(0,-1):[a];});}
// Independently integrate on dense source and curve polylines. Quarter-offset
// quadrature deliberately differs from the helper's midpoint sampling.
function dataRms(raw:Point[],baseline:Baseline,scale:number){const saved=geometry(baseline,scale*.0005),integral=(a:Point[],b:Point[])=>{let sum=0,arc=0;for(let i=0;i+1<a.length;i++){const d=length(a[i],a[i+1]),n=Math.max(1,Math.ceil(d/(scale*.025)));for(let j=0;j<n;j++){const t=(j+.25)/n,p=point('',a[i].xMm+t*(a[i+1].xMm-a[i].xMm),a[i].yMm+t*(a[i+1].yMm-a[i].yMm));sum+=nearest(p,b)**2*d/n;arc+=d/n;}}return{sum,arc};},a=integral(raw,saved),b=integral(saved,raw);return Math.sqrt((a.sum+b.sum)/(a.arc+b.arc));}

it.each([.05,1,10].flatMap(scale=>[0,.37].flatMap(rotation=>[0,1000].map(offset=>({scale,rotation,offset})))))('improves untouched analytic measurements at scale $scale rotation $rotation origin $offset',({scale,rotation,offset})=>{
 const {raw,baseline}=smooth(scale,rotation,offset),snapshot=structuredClone({raw,baseline});freeze(raw);freeze(baseline);
 const result=refitMeasuredCubicWindow(raw,baseline,options(scale,rotation));expect(result).toBeDefined();
 expect({raw,baseline}).toEqual(snapshot);expect(result!.nodes[0]).toBe(baseline.nodes[0]);expect(result!.nodes[2]).toBe(baseline.nodes[2]);expect(result!.curves[0].c1).toBe(baseline.curves[0].c1);expect(result!.curves[1].c2).toBe(baseline.curves[1].c2);
 expect(result!.splitIndex).toBe(12);expect(result!.nodes[1].id).toBe(raw[12].id);expect(length(result!.nodes[1],raw[12])).toBeLessThanOrEqual(.9*scale+scale*1e-7);
 expect(result!.rms).toBeLessThan(result!.beforeRms);expect(dataRms(raw,result!,scale)).toBeLessThan(dataRms(raw,baseline,scale));
 const saved=geometry(result!,scale*.0005);expect(Math.max(spanError(raw,saved,scale,scale*.02),spanError(saved,raw,scale,scale*.02))+.01*scale).toBeLessThanOrEqual(1.05*scale);
});

it.each([5,12,20])('rejects protected source point %s anywhere in the original window',index=>{const {raw,baseline}=smooth(),o=options();o.protectedIds=new Set([raw[index].id]);const snapshot=structuredClone({raw,baseline});freeze(raw);freeze(baseline);expect(refitMeasuredCubicWindow(raw,baseline,o)).toBeUndefined();expect({raw,baseline}).toEqual(snapshot);});
it('keeps protected outer junctions exact while allowing an unprotected internal knot',()=>{const {raw,baseline}=smooth(),o=options();o.protectedIds=new Set([raw[0].id,raw.at(-1)!.id]);const result=refitMeasuredCubicWindow(raw,baseline,o);expect(result).toBeDefined();expect(result!.nodes[0]).toBe(raw[0]);expect(result!.nodes[2]).toBe(raw.at(-1));});
it.each([5,12,20])('rejects an actual short source bevel around index %s',index=>{const {raw,baseline}=smooth();raw[index+1]={...raw[index+1],xMm:raw[index].xMm+.02,yMm:raw[index].yMm};const o=options();o.bevel=p=>{const i=raw.findIndex(q=>q.id===p.id);return i>0&&length(p,raw[i-1])<.04||i+1<raw.length&&length(p,raw[i+1])<.04;};expect(o.bevel(raw[index])).toBe(true);const snapshot=structuredClone({raw,baseline});freeze(raw);freeze(baseline);expect(refitMeasuredCubicWindow(raw,baseline,o)).toBeUndefined();expect({raw,baseline}).toEqual(snapshot);});
it('retains an exact sharp source corner because its zero data residual cannot improve',()=>{
 const a=point('a',-12,0),k=point('k',0,0),b=point('b',9,12),raw=[...Array.from({length:13},(_,i)=>point(i===0?'a':i===12?'k':`l-${i}`,-12+i,0)),...Array.from({length:12},(_,i)=>point(i===11?'b':`r-${i}`,9*(i+1)/12,i+1))],baseline:Baseline={nodes:[a,k,b],curves:[{id:'left',startNodeId:'a',endNodeId:'k',c1:point('l1',-8,0),c2:point('l2',-4,0)},{id:'right',startNodeId:'k',endNodeId:'b',c1:point('r1',3,4),c2:point('r2',6,8)}]};
 expect(dataRms(raw,baseline,1)).toBeLessThan(1e-12);freeze(raw);freeze(baseline);expect(refitMeasuredCubicWindow(raw,baseline,options())).toBeUndefined();
});
it('scores the original endpoint support rather than replacing measured endpoints with fitted anchors',()=>{
 const {raw,baseline}=smooth();baseline.nodes[0]={...baseline.nodes[0],xMm:.7,yMm:.4};baseline.nodes[2]={...baseline.nodes[2],xMm:23.3,yMm:12.4};
 const phantom=raw.map((p,i)=>i===0?baseline.nodes[0]:i+1===raw.length?baseline.nodes[2]:p),snapshot=structuredClone({raw,baseline}),before=dataRms(raw,baseline,1),phantomBefore=dataRms(phantom,baseline,1);freeze(raw);freeze(baseline);
 const result=refitMeasuredCubicWindow(raw,baseline,options());expect(result).toBeDefined();const after=dataRms(raw,result!,1),phantomAfter=dataRms(phantom,result!,1);
 expect({raw,baseline}).toEqual(snapshot);expect(after).toBeLessThan(before);expect(Math.abs(result!.beforeRms-before)).toBeLessThan(Math.abs(result!.beforeRms-phantomBefore));expect(Math.abs(result!.rms-after)).toBeLessThan(Math.abs(result!.rms-phantomAfter));
 expect(result!.curves[0].c1).toBe(baseline.curves[0].c1);expect(result!.curves[1].c2).toBe(baseline.curves[1].c2);
});
it('improves an analytic curve plus short exact line with exact virtual thirds and complete baseline support',()=>{
 const {raw,baseline}=curveAndLine(),k=baseline.nodes[1],b=baseline.nodes[2],third=point('',k.xMm+2*(b.xMm-k.xMm)/3,k.yMm+2*(b.yMm-k.yMm)/3),before=dataRms(raw,baseline,1),missingTail=dataRms(raw,{nodes:baseline.nodes.slice(0,2),curves:baseline.curves},1),snapshot=structuredClone({raw,baseline});
 expect(length(k,b)).toBeLessThan(6);freeze(raw);freeze(baseline);const result=refitMeasuredCubicWindow(raw,baseline,options());expect(result).toBeDefined();expect({raw,baseline}).toEqual(snapshot);
 expect(result!.curves[0].c1).toBe(baseline.curves[0].c1);expect(result!.curves[1].c2.xMm).toBe(third.xMm);expect(result!.curves[1].c2.yMm).toBe(third.yMm);expect(result!.nodes[0]).toBe(baseline.nodes[0]);expect(result!.nodes[2]).toBe(baseline.nodes[2]);
 expect(dataRms(raw,result!,1)).toBeLessThan(before);expect(Math.abs(result!.beforeRms-before)).toBeLessThan(Math.abs(result!.beforeRms-missingTail));
 const saved=geometry(result!,.0005);expect(Math.max(spanError(raw,saved,1,.02),spanError(saved,raw,1,.02))+.01).toBeLessThanOrEqual(1.05);
});
it('rejects a line longer than six native pixels beside a source curve',()=>{const {raw,baseline}=curveAndLine(true);expect(length(baseline.nodes[1],baseline.nodes[2])).toBeGreaterThan(6);freeze(raw);freeze(baseline);expect(refitMeasuredCubicWindow(raw,baseline,options())).toBeUndefined();});
it.each(['wrong-end','reversed-edge','duplicate-edge'] as const)('rejects invalid baseline curve adjacency: %s',kind=>{const {raw,baseline}=curveAndLine();if(kind==='wrong-end')baseline.curves[0].endNodeId=baseline.nodes[2].id;else if(kind==='reversed-edge'){baseline.curves[0].startNodeId='k';baseline.curves[0].endNodeId='a';}else baseline.curves.push({...baseline.curves[0],id:'duplicate'});freeze(raw);freeze(baseline);expect(refitMeasuredCubicWindow(raw,baseline,options())).toBeUndefined();});
it.each([.05,1,10].flatMap(scale=>[0,.37].map(rotation=>({scale,rotation}))))('reversing the measured window preserves geometric results at scale $scale rotation $rotation',({scale,rotation})=>{
 // Each half is shorter than twelve native pixels, so this also exercises
 // the directional hard guard in both traversal directions.
 const {raw,baseline}=smooth(scale*.7,rotation,1000),reverseRaw=[...raw].reverse(),reverseBaseline:Baseline={nodes:[...baseline.nodes].reverse(),curves:[...baseline.curves].reverse().map(c=>({...c,startNodeId:c.endNodeId,endNodeId:c.startNodeId,c1:c.c2,c2:c.c1}))};freeze(raw);freeze(baseline);freeze(reverseRaw);freeze(reverseBaseline);
 const forward=refitMeasuredCubicWindow(raw,baseline,options(scale,rotation)),reverse=refitMeasuredCubicWindow(reverseRaw,reverseBaseline,options(scale,rotation));expect(forward).toBeDefined();expect(reverse).toBeDefined();
 expect(length(forward!.nodes[1],reverse!.nodes[1])).toBeLessThan(scale*1e-7);expect(length(forward!.curves[0].c2,reverse!.curves[1].c1)).toBeLessThan(scale*1e-7);expect(length(forward!.curves[1].c1,reverse!.curves[0].c2)).toBeLessThan(scale*1e-7);
 expect(Math.abs(forward!.rms-reverse!.rms)).toBeLessThan(scale*1e-8);expect(Math.abs(forward!.beforeRms-reverse!.beforeRms)).toBeLessThan(scale*1e-8);
 const a=geometry(forward!,scale*.0005),b=geometry(reverse!,scale*.0005);expect(Math.max(spanError(a,b,scale,scale*.02),spanError(b,a,scale,scale*.02))).toBeLessThan(scale*1e-7);
});
it('does not curve an exact straight source even when the fitted baseline is biased',()=>{const {raw,baseline}=smooth();for(const p of raw)p.yMm=0;for(const p of baseline.nodes)p.yMm=0;freeze(raw);freeze(baseline);expect(refitMeasuredCubicWindow(raw,baseline,options())).toBeUndefined();});
it('rejects more than 64 raw samples',()=>{const {raw,baseline}=smooth();while(raw.length<65)raw.splice(1,0,{...raw[1],id:`extra-${raw.length}`});freeze(raw);freeze(baseline);expect(refitMeasuredCubicWindow(raw,baseline,options())).toBeUndefined();});
it('rejects a source whose native fitting-sample budget exceeds 384',()=>{const {raw,baseline}=smooth(20),o=options(1);freeze(raw);freeze(baseline);expect(refitMeasuredCubicWindow(raw,baseline,o)).toBeUndefined();});
it('rejects a flattening representation exceeding 4000 points',()=>{const {raw,baseline}=smooth(),o=options();o.tools.flatten=(a,c1,c2,b,_t,id)=>Array.from({length:4001},(_,i)=>i===0?a:i===4000?b:bezier([a,c1,c2,b],i/4000,id()));expect(refitMeasuredCubicWindow(raw,baseline,o)).toBeUndefined();});
it.each(['source','control'] as const)('rejects a nonfinite %s without mutating input',where=>{const {raw,baseline}=smooth();if(where==='source')raw[5].xMm=NaN;else baseline.curves[0].c2.yMm=Infinity;freeze(raw);freeze(baseline);expect(refitMeasuredCubicWindow(raw,baseline,options())).toBeUndefined();});
