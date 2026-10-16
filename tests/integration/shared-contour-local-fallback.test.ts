import {randomUUID} from 'node:crypto';
import {describe,expect,it} from 'vitest';
import {rectangle} from '../fixtures';
import {recoverSharedContours} from '../../packages/reference/shared-contour';
import {safeContour,contourBoundaryError} from '../../packages/reference/contour-topology';
import type {Piece,Point} from '../../packages/schema/index';
import type {BoundaryFit} from '../../packages/reference/image-contour';

// These public-API regressions supply already certified source measurements.
// They test local rollback, shared ownership and source-permission bookkeeping;
// image-source suites independently test whether RGB evidence is certified.

describe('local fallback coordination',()=>{
const ring=(a:number,b:number,c:number,d:number):Point[]=>[[a,b],[c,b],[c,d],[a,d]].map(([xMm,yMm])=>({id:randomUUID(),xMm,yMm}));
const piece=(name:string,nodes:Point[],holes:Point[][]=[]):Piece=>({...rectangle(),name,nodes,holes,curves:[],allowanceMm:0});
const sign=(r:Point[])=>Math.sign(r.reduce((sum,a,i)=>{const b=r[(i+1)%r.length];return sum+a.xMm*b.yMm-b.xMm*a.yMm;},0));
const inside=(r:Point[],q:Point)=>{let yes=false;for(let i=0,j=r.length-1;i<r.length;j=i++){const a=r[i],b=r[j];if((a.yMm>q.yMm)!==(b.yMm>q.yMm)&&q.xMm<(b.xMm-a.xMm)*(q.yMm-a.yMm)/(b.yMm-a.yMm)+a.xMm)yes=!yes;}return yes;};
const owns=(p:Piece,xMm:number,yMm:number)=>inside(p.nodes,{id:'probe',xMm,yMm})&&!(p.holes??[]).some(h=>inside(h,{id:'probe',xMm,yMm}));
// Integer4decimal keys have the same coordinate budget and canonicalise-0.
const keys=(r:Point[])=>r.map(p=>`${Math.round(p.xMm*1e4)},${Math.round(p.yMm*1e4)}`).sort();
const phases=[{scale:1,angle:0,offset:0,reverse:false},{scale:1,angle:0,offset:0,reverse:true},{scale:.05,angle:.37,offset:1e6,reverse:false},{scale:10,angle:.37,offset:-1e6,reverse:true}];
function transform(scale:number,angle:number,offset:number){const c=Math.cos(angle),s=Math.sin(angle);return{world:(p:Point)=>({...p,xMm:offset+scale*(c*p.xMm-s*p.yMm),yMm:-offset+scale*(s*p.xMm+c*p.yMm)}),local:(p:Point)=>{const x=(p.xMm-offset)/scale,y=(p.yMm+offset)/scale;return{...p,xMm:c*x+s*y,yMm:-s*x+c*y};}};}
const mapped=(p:Piece,f:(p:Point)=>Point):Piece=>({...p,nodes:p.nodes.map(f),holes:p.holes?.map(h=>h.map(f)),curves:[]});

it.each(phases)('one-chain fallback preserves the other individually safe measured edge at $scale/$angle reversed=$reverse',({scale,angle,offset,reverse})=>{
 const t=transform(scale,angle,offset),scene=[piece('left',ring(0,0,10,10)),piece('middle',ring(10,0,20,10)),piece('right',ring(20,0,30,10))],originals=(reverse?[...scene].reverse():scene).map(p=>mapped(p,t.world)),before=structuredClone(originals);
 // Each0.4px triangular displacement changes its neighbour by2%. Together
 // they enlarge the middle by4%, so at least one proposal must be rejected.
 const fit:BoundaryFit=(raw,closed,_colors,id)=>{if(closed)return;const r=raw.map(t.local),x=r.every(p=>Math.abs(p.xMm-10)<1e-5)?10:r.every(p=>Math.abs(p.xMm-20)<1e-5)?20:undefined;if(x===undefined)return;return{nodes:[raw[0],t.world({id:id(),xMm:x+(x===10?-.4:.4),yMm:5}),raw.at(-1)!],curves:[]};};
 const result=recoverSharedContours(originals,.8*scale,randomUUID,fit),saved=result.pieces.map(p=>mapped(p,t.local));expect(originals).toEqual(before);expect(result.report.imageSupportedChains).toBe(1);
 for(let i=0;i<originals.length;i++)expect(safeContour(result.pieces[i],originals[i],.8*scale)).toBe(true);
 for(let y=.317;y<10;y+=.83)for(let x=.231;x<30;x+=.61)expect(saved.filter(p=>owns(p,x,y))).toHaveLength(1);
 const bends=saved.flatMap(p=>p.nodes.filter(n=>Math.abs(n.yMm-5)<1e-4&&((n.xMm>9&&n.xMm<11)||(n.xMm>19&&n.xMm<21))).map(n=>`${n.xMm.toFixed(4)},${n.yMm.toFixed(4)}`));expect(new Set(bends).size).toBe(1);
});

it.each(phases)('a rejected certified self-crossing hole revokes its authority while preserving a correct certified neighbour at $scale reversed=$reverse',({scale,angle,offset,reverse})=>{
 const t=transform(scale,angle,offset),outer=ring(0,0,40,40),hole=ring(10,10,14,14),scene=[piece('island',outer,[[...hole].reverse()]),piece('surround',ring(-10,-10,50,50),[[...outer].reverse()]),piece('inner',hole)],originals=(reverse?[...scene].reverse():scene).map(p=>mapped(p,t.world)),before=structuredClone(originals),certified=ring(-3,0,40,40);
 // The callback represents already certified source evidence. RGB
 // authentication is exercised by existing image-source suites separately.
 const fit:BoundaryFit=(raw,closed,_colors,id)=>{if(!closed)return;const r=raw.map(t.local),minX=Math.min(...r.map(p=>p.xMm)),maxX=Math.max(...r.map(p=>p.xMm));let target:Point[];if(Math.abs(minX)<1e-5&&Math.abs(maxX-40)<1e-5)target=certified;else if(Math.abs(minX-10)<1e-5&&Math.abs(maxX-14)<1e-5)target=[[10,10],[14,14],[14,10],[10,14]].map(([xMm,yMm])=>({id:id(),xMm,yMm}));else return;if(sign(target)!==sign(r))target=[...target].reverse();const nodes=target.map(p=>t.world({...p,id:id()}));return{nodes,curves:[],sourceBoundary:nodes};};
 const result=recoverSharedContours(originals,.8*scale,randomUUID,fit),saved=result.pieces.map(p=>mapped(p,t.local)),island=saved.find(p=>p.name==='island')!,surround=saved.find(p=>p.name==='surround')!,inner=saved.find(p=>p.name==='inner')!;
 expect(originals).toEqual(before);expect(result.report.imageSupportedChains).toBe(1);expect(keys(island.nodes)).toEqual(keys(certified));expect(keys(surround.holes![0])).toEqual(keys(certified));expect(keys(island.holes![0])).toEqual(keys(hole));expect(keys(inner.nodes)).toEqual(keys(hole));
 expect(owns(island,-2,20)).toBe(true);expect(owns(surround,-2,20)).toBe(false);expect(owns(island,12,12)).toBe(false);expect(owns(inner,12,12)).toBe(true);
 const old=originals.find(p=>p.name==='island')!;expect(contourBoundaryError(result.pieces.find(p=>p.name==='island')!,old,.1*scale,1.05*scale)).toBeGreaterThan(1.05*scale);
 for(let y=-9.713;y<50;y+=2.37)for(let x=-9.219;x<50;x+=2.13)expect(saved.filter(p=>owns(p,x,y))).toHaveLength(1);
});
it.each([0,-1,NaN,Infinity])('invalid calibration %s fails without changing owners or source data',pixelMm=>{const p=piece('original',ring(0,0,10,10)),before=structuredClone(p);expect(()=>recoverSharedContours([p],pixelMm,randomUUID)).toThrow('INVALID_CALIBRATION');expect(p).toEqual(before);});

});

describe('source baseline cache and owner order',()=>{
const ring=(xy:number[][]):Point[]=>xy.map(([xMm,yMm])=>({id:randomUUID(),xMm,yMm}));
const piece=(name:string,xy:number[][]):Piece=>({...rectangle(),name,nodes:ring(xy),curves:[],holes:[],allowanceMm:0});
it.each(['middle-first','valid-neighbour-first'] as const)('a previously valid certified neighbour stays valid independent of which owner was checked first: %s',order=>{
 const left=piece('left',[[0,0],[10,0],[10,10],[0,10]]),middle=piece('middle',[[10,0],[10,10],[20,10],[20,0]]),right=piece('right',[[20,0],[30,0],[30,10],[20,10]]);
 const sourceLeft=piece('source left',[[0,0],[10,0],[13,5],[10,10],[0,10]]),actualLeft=piece('initial measured left',[[0,0],[10,0],[13,5],[10,10],[0,10],[.64,5]]),leftAfterWrongRollback=piece('left after certified-chain rollback',[[0,0],[10,0],[10,10],[0,10],[.64,5]]);
 // Source area115 with a3.2unit inward change is valid. Revoking the
 // certified edge leaves raw area100 with that same3.2unit change, invalid.
 expect(safeContour(actualLeft,sourceLeft,.8)).toBe(true);expect(safeContour(leftAfterWrongRollback,left,.8)).toBe(false);
 const sourceMiddle=piece('source middle',[[10,0],[13,5],[10,10],[20,10],[20,0]]),actualMiddle=piece('initial measured middle',[[10,0],[13,5],[10,10],[20,10],[20.6,5],[20,0]]);
 expect(safeContour(actualMiddle,sourceMiddle,.8)).toBe(false);
 const originals=order==='middle-first'?[middle,left,right]:[left,middle,right],before=structuredClone(originals);
 const fit:BoundaryFit=(raw,closed,_colors,id)=>{
  if(closed)return;
  if(raw.every(p=>Math.abs(p.xMm-10)<1e-8)){const nodes=[raw[0],{id:id(),xMm:13,yMm:5},raw.at(-1)!];return{nodes,curves:[],sourceBoundary:nodes};}
  if(raw.every(p=>Math.abs(p.xMm-20)<1e-8))return{nodes:[raw[0],{id:id(),xMm:20.6,yMm:5},raw.at(-1)!],curves:[]};
  if(raw.some(p=>Math.abs(p.xMm)<1e-8)&&raw.every(p=>p.xMm<=10+1e-8)){
   let nodes=ring([[10,0],[0,0],[.64,5],[0,10],[10,10]]);if(Math.hypot(nodes[0].xMm-raw[0].xMm,nodes[0].yMm-raw[0].yMm)>1e-8)nodes=nodes.reverse();nodes[0]=raw[0];nodes[nodes.length-1]=raw.at(-1)!;return{nodes,curves:[]};
  }
 };
 const result=recoverSharedContours(originals,.8,randomUUID,fit),saved=result.pieces.find(p=>p.name==='left')!,certifiedEdgeRetained=saved.nodes.some(p=>Math.abs(p.xMm-13)<1e-7&&Math.abs(p.yMm-5)<1e-7),metrics={order,retained:result.report.imageSupportedChains,certifiedEdgeRetained,report:result.report,left:saved.nodes.map(p=>[p.xMm,p.yMm])};
 console.log(JSON.stringify(metrics));expect(originals).toEqual(before);expect(result.report.imageSupportedChains,JSON.stringify(metrics)).toBe(2);expect(certifiedEdgeRetained,JSON.stringify(metrics)).toBe(true);expect(safeContour(saved,sourceLeft,.8)).toBe(true);
});

});
