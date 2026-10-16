import {randomUUID} from 'node:crypto';
import {expect,it} from 'vitest';
import {rectangle} from '../fixtures';
import {recoverSharedContours} from '../../packages/reference/shared-contour';
import {safeContour,contourBoundaryError} from '../../packages/reference/contour-topology';
import type {BoundaryFit} from '../../packages/reference/image-contour';
import type {Piece,Point} from '../../packages/schema/index';

type XY={xMm:number;yMm:number};
const ring=(coordinates:number[][]):Point[]=>coordinates.map(([xMm,yMm])=>({id:randomUUID(),xMm,yMm}));
const rect=(a:number,b:number,c:number,d:number)=>ring([[a,b],[c,b],[c,d],[a,d]]);
const signed=(r:XY[])=>r.reduce((s,a,i)=>{const b=r[(i+1)%r.length];return s+a.xMm*b.yMm-b.xMm*a.yMm;},0);
const piece=(nodes:Point[],holes:Point[][]=[]):Piece=>({...rectangle(),allowanceMm:0,nodes,holes,curves:[]});
const inside=(p:XY,r:XY[])=>{let hit=false;for(let i=0,j=r.length-1;i<r.length;j=i++){const a=r[i],b=r[j];if((a.yMm>p.yMm)!==(b.yMm>p.yMm)&&p.xMm<(b.xMm-a.xMm)*(p.yMm-a.yMm)/(b.yMm-a.yMm)+a.xMm)hit=!hit;}return hit;};
const owns=(p:Piece,q:XY)=>inside(q,p.nodes)&&!(p.holes??[]).some(h=>inside(q,h));
const keys=(r:XY[])=>r.map(p=>`${p.xMm.toFixed(5)},${p.yMm.toFixed(5)}`).sort();
function scene(nested=true){const outer=rect(20,20,60,60),hole=rect(32,32,36,36);return[piece(outer,nested?[[...hole].reverse()]:[]),piece(rect(0,0,100,100),[[...outer].reverse()]),...(nested?[piece(hole)]:[])];}
function coordinates(scale=1,rotation=0,offset=0){const c=Math.cos(rotation),s=Math.sin(rotation);return{
 world:(p:Point):Point=>({...p,xMm:offset+scale*(c*p.xMm-s*p.yMm),yMm:-offset+scale*(s*p.xMm+c*p.yMm)}),
 local:(p:Point):Point=>{const x=(p.xMm-offset)/scale,y=(p.yMm+offset)/scale;return{...p,xMm:c*x+s*y,yMm:-s*x+c*y};}
};}
function mapped(p:Piece,f:(p:Point)=>Point):Piece{return{...p,nodes:p.nodes.map(f),holes:p.holes?.map(h=>h.map(f)),curves:[]};}
/** This callback models an already certified measurement. It isolates the
 * network's public source-baseline contract, and makes no RGB-authentication
 * claim. The separate line-tip suites exercise the actual RGB producer. */
function measurement(target:Point[],transform=coordinates(),includeSource=true):BoundaryFit{return(raw,closed,_colors,id)=>{
 const local=raw.map(transform.local);if(!closed||Math.abs(Math.min(...local.map(p=>p.xMm))-20)>1e-5||Math.abs(Math.max(...local.map(p=>p.xMm))-60)>1e-5)return;
 const directed=Math.sign(signed(local))===Math.sign(signed(target))?target:[...target].reverse(),nodes=directed.map(p=>transform.world({...p,id:id()}));
 return{nodes,curves:[],...(includeSource?{sourceBoundary:nodes}:{} )};
};}
function partition(pieces:Piece[]){for(let y=.317;y<100;y+=2.3)for(let x=.671;x<100;x+=2.3)expect(pieces.filter(p=>owns(p,{xMm:x,yMm:y})),`owner count at ${x},${y}`).toHaveLength(1);}

it.each([.05,1,10].flatMap(scale=>[0,.37].map(rotation=>({scale,rotation}))))('a certified shared outer loop preserves its extra hole after scale $scale rotation $rotation and large translation',({scale,rotation})=>{
 const transform=coordinates(scale,rotation,1e6),originals=scene().map(p=>mapped(p,transform.world)),before=structuredClone(originals),target=rect(17,20,60,60),result=recoverSharedContours(originals,.8*scale,randomUUID,measurement(target,transform)),saved=result.pieces.map(p=>mapped(p,transform.local));
 expect(originals).toEqual(before);expect(result.report.imageSupportedChains).toBe(1);
 expect(keys(saved[0].nodes)).toEqual(keys(target));expect(keys(saved[1].holes![0])).toEqual(keys(target));
 expect(saved[0].holes).toHaveLength(1);expect(keys(saved[0].holes![0])).toEqual(keys(rect(32,32,36,36)));expect(keys(saved[2].nodes)).toEqual(keys(saved[0].holes![0]));
 expect(owns(saved[0],{xMm:18,yMm:25})).toBe(true);expect(owns(saved[1],{xMm:18,yMm:25})).toBe(false);expect(owns(saved[0],{xMm:34,yMm:34})).toBe(false);expect(owns(saved[2],{xMm:34,yMm:34})).toBe(true);partition(saved);
});

it('keeps the original bound when the same extended proposal has no certified source baseline',()=>{
 const originals=scene(),result=recoverSharedContours(originals,.8,randomUUID,measurement(rect(17,20,60,60),coordinates(),false));
 expect(result.report.imageSupportedChains).toBe(0);for(let i=0;i<originals.length;i++){expect(safeContour(result.pieces[i],originals[i],.8)).toBe(true);expect(contourBoundaryError(result.pieces[i],originals[i],.1,1.05)).toBeLessThanOrEqual(1.05);}partition(result.pieces);
});

it.each([
 {name:'a measured outer edge intersects the existing inner hole',target:()=>rect(34,20,60,60)},
 {name:'a source-certified polygon crosses itself',target:()=>ring([[17,20],[60,60],[60,20],[17,60]])}
])('$name restores both owners and revokes the source exception',({target})=>{
 const originals=scene(),before=structuredClone(originals),result=recoverSharedContours(originals,.8,randomUUID,measurement(target()));
 expect(originals).toEqual(before);expect(result.report.imageSupportedChains).toBe(0);
 for(let i=0;i<originals.length;i++){expect(safeContour(result.pieces[i],originals[i],.8)).toBe(true);expect(contourBoundaryError(result.pieces[i],originals[i],.1,1.05)).toBeLessThanOrEqual(1.05);expect(result.pieces[i].holes?.length??0).toBe(originals[i].holes?.length??0);}
 expect(keys(result.pieces[0].nodes)).toEqual(keys(result.pieces[1].holes![0]));expect(owns(result.pieces[0],{xMm:18,yMm:25})).toBe(false);expect(owns(result.pieces[2],{xMm:34,yMm:34})).toBe(true);partition(result.pieces);
});

it('source certification cannot let one island overlap an independent material chain',()=>{
 const originals=scene(false),other=rect(14,30,18,40);originals[1].holes!.push([...other].reverse());originals.push(piece(other));
 const result=recoverSharedContours(originals,.8,randomUUID,measurement(rect(17,20,60,60)));
 expect(result.report.imageSupportedChains).toBe(0);expect(owns(result.pieces[2],{xMm:17.5,yMm:35})).toBe(true);expect(owns(result.pieces[0],{xMm:17.5,yMm:35})).toBe(false);
 for(let i=0;i<originals.length;i++)expect(safeContour(result.pieces[i],originals[i],.8)).toBe(true);partition(result.pieces);
});
