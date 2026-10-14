import {expect, it} from 'vitest';
import {randomUUID} from 'node:crypto';
import {traceMask} from '../../apps/desktop/main/reference-segmentation';
import {recoverContour} from '../../packages/reference/recover-contour';
import {recoverSharedContours} from '../../packages/reference/shared-contour';
import {contourBoundaryError, safeContour} from '../../packages/reference/contour-topology';
import type {Piece} from '../../packages/schema/index';

function trace(w:number,h:number,fill:(x:number,y:number)=>boolean){
 const mask=new Uint8Array(w*h);
 for(let y=0;y<h;y++)for(let x=0;x<w;x++)if(fill(x+.5,y+.5))mask[y*w+x]=1;
 return traceMask(w,h,mask,{a:{x:0,y:h},b:{x:0,y:0},distanceMm:h},w,h,'#0096dc',true).piece;
}
function bow(piece:Piece){return Math.max(0,...(piece.curves??[]).map(c=>{
 const a=piece.nodes.find(n=>n.id===c.startNodeId)!,b=piece.nodes.find(n=>n.id===c.endNodeId)!,d=Math.hypot(b.xMm-a.xMm,b.yMm-a.yMm);
 return Math.max(...[c.c1,c.c2].map(p=>Math.abs((b.xMm-a.xMm)*(p.yMm-a.yMm)-(b.yMm-a.yMm)*(p.xMm-a.xMm))/d));
}));}
it.each([.017,.047,.087,.173,.317,.713,1.217,2.317,5.317])('recovers long painted straight spans at slope %s without bowed curves',slope=>{
 const w=520,h=520,raw=trace(w,h,(x,y)=>x>=12&&x<490&&y>=25+slope*(x-12)&&y<42+slope*(x-12));
 const local=recoverContour(raw,.8,randomUUID),shared=recoverSharedContours([raw],.8,randomUUID).pieces[0];
 for(const result of[local,shared]){
  expect(bow(result),'a raster staircase cannot justify bending a painted straight edge').toBeLessThan(1e-7);
  expect(result.nodes.length,'straight interiors must not retain many alternating pixel steps').toBeLessThan(20);
  expect(safeContour(result,raw,.8)).toBe(true);
  expect(contourBoundaryError(result,raw,.1,1.05)).toBeLessThanOrEqual(1.05);
 }
});
it.each([.05,1,10].flatMap(scale=>[0,.37].map(rotation=>({scale,rotation}))))('preserves the straight sides of an acute raster diamond at scale $scale rotation $rotation',({scale,rotation})=>{
 const rx=35,ry=190,angle=.087,raster=trace(520,520,(x,y)=>{const u=(x-260)*Math.cos(angle)+(y-260)*Math.sin(angle),v=-(x-260)*Math.sin(angle)+(y-260)*Math.cos(angle);return Math.abs(u)/rx+Math.abs(v)/ry<1;});
 const move=(p:Piece['nodes'][number])=>({...p,xMm:10000+scale*(p.xMm*Math.cos(rotation)-p.yMm*Math.sin(rotation)),yMm:-20000+scale*(p.xMm*Math.sin(rotation)+p.yMm*Math.cos(rotation))});
 const raw={...raster,nodes:raster.nodes.map(move),holes:raster.holes?.map(h=>h.map(move))};
 for(const result of[recoverContour(raw,.8*scale,randomUUID),recoverSharedContours([raw],.8*scale,randomUUID).pieces[0]]){
  expect(bow(result)).toBeLessThan(1e-7*scale);expect(result.nodes.length).toBeLessThan(20);
  expect(safeContour(result,raw,.8*scale)).toBe(true);expect(contourBoundaryError(result,raw,.1*scale,1.05*scale)).toBeLessThanOrEqual(1.05*scale);
 }
});
it.each([.017,.087,.317,.713,1.217].flatMap(angle=>[7,30,90].map(halfWidth=>({angle,halfWidth}))))('keeps a rotated painted rectangle straight, angle $angle half-width $halfWidth',({angle,halfWidth})=>{
 const fill=(x:number,y:number)=>{const u=(x-260)*Math.cos(angle)+(y-260)*Math.sin(angle),v=-(x-260)*Math.sin(angle)+(y-260)*Math.cos(angle);return Math.abs(u)<230&&Math.abs(v)<halfWidth;};
 const raw=trace(520,520,fill),result=recoverContour(raw,.8,randomUUID);
 expect(bow(result)).toBeLessThan(1e-7);expect(result.nodes.length).toBeLessThan(20);
 expect(safeContour(result,raw,.8)).toBe(true);expect(contourBoundaryError(result,raw,.1,1.05)).toBeLessThanOrEqual(1.05);
});
it.each([.017,.087,.317,.713,1.217].flatMap(angle=>[7,30,90].map(halfWidth=>({angle,halfWidth}))))('fits an embedded shared rectangle once, angle $angle half-width $halfWidth',({angle,halfWidth})=>{
 const fill=(x:number,y:number)=>{const u=(x-260)*Math.cos(angle)+(y-260)*Math.sin(angle),v=-(x-260)*Math.sin(angle)+(y-260)*Math.cos(angle);return Math.abs(u)<230&&Math.abs(v)<halfWidth;};
 const originals=[trace(520,520,fill),trace(520,520,(x,y)=>x>=2&&x<518&&y>=2&&y<518&&!fill(x,y))];
 const {pieces}=recoverSharedContours(originals,.8,randomUUID),result=pieces[0];
 expect(bow(result)).toBeLessThan(1e-7);expect(result.nodes.length).toBeLessThan(20);
 for(let i=0;i<2;i++){expect(safeContour(pieces[i],originals[i],.8)).toBe(true);expect(contourBoundaryError(pieces[i],originals[i],.1,1.05)).toBeLessThanOrEqual(1.05);}
});
