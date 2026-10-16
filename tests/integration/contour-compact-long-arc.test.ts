import {randomUUID} from 'node:crypto';
import {mkdirSync,writeFileSync} from 'node:fs';
import sharp from 'sharp';
import {afterAll,expect,it} from 'vitest';
import {splitReferences} from '../../apps/desktop/main/automatic-reference';
import {fitMeasuredBoundary} from '../../packages/reference/image-contour';
import {pigmentFamily} from '../../packages/reference/illustration';
import type {Piece,Point,Reference} from '../../packages/schema/index';

type XY={xMm:number;yMm:number};
const records:unknown[]=[],distance=(p:XY,a:XY,b:XY)=>{const x=b.xMm-a.xMm,y=b.yMm-a.yMm,t=Math.max(0,Math.min(1,((p.xMm-a.xMm)*x+(p.yMm-a.yMm)*y)/(x*x+y*y||1)));return Math.hypot(p.xMm-a.xMm-t*x,p.yMm-a.yMm-t*y);};
function sample(nodes:Point[],curves:NonNullable<Piece['curves']>,closed:boolean){
 return nodes.slice(0,closed?undefined:-1).flatMap((a,i)=>{const b=nodes[(i+1)%nodes.length],c=curves.find(c=>c.startNodeId===a.id&&c.endNodeId===b.id),u=c?.c1??a,v=c?.c2??b,n=Math.max(1,Math.ceil((Math.hypot(u.xMm-a.xMm,u.yMm-a.yMm)+Math.hypot(v.xMm-u.xMm,v.yMm-u.yMm)+Math.hypot(b.xMm-v.xMm,b.yMm-v.yMm))/.01));return Array.from({length:n+1},(_,j)=>{const t=j/n,s=1-t;return{xMm:s**3*a.xMm+3*s*s*t*u.xMm+3*s*t*t*v.xMm+t**3*b.xMm,yMm:s**3*a.yMm+3*s*s*t*u.yMm+3*s*t*t*v.yMm+t**3*b.yMm};});});
}
const nearest=(p:XY,ring:XY[])=>Math.min(...ring.slice(0,-1).map((a,i)=>distance(p,a,ring[i+1])));
const area=(ring:XY[])=>Math.abs(ring.reduce((s,a,i)=>{const b=ring[(i+1)%ring.length];return s+a.xMm*b.yMm-a.yMm*b.xMm;},0)/2);

it('fits an independently prescribed 20px shallow source arc within its supplied .15px error budget',()=>{
 const points=Array.from({length:201},(_,i)=>({id:randomUUID(),xMm:i/10,yMm:.8*Math.sin(Math.PI*i/200)})),tangent=(p:XY)=>{const slope=.8*Math.PI/20*Math.cos(Math.PI*p.xMm/20),n=Math.hypot(1,slope);return{xMm:1/n,yMm:slope/n};};
 const fit=fitMeasuredBoundary(points,false,randomUUID,.15,tangent),output=sample(fit.nodes,fit.curves,false),maxError=Math.max(...points.map(p=>nearest(p,output))),metrics={fixture:'analytic y=.8*sin(pi*x/20)',tolerance:.15,maxError,nodes:fit.nodes.length,curves:fit.curves.length};records.push(metrics);
 expect(maxError,JSON.stringify(metrics)).toBeLessThanOrEqual(.15);expect(fit.curves.length,JSON.stringify(metrics)).toBeGreaterThan(0);
 expect(fit.nodes[0]).toEqual(points[0]);expect(fit.nodes.at(-1)).toEqual(points.at(-1));
});

it.each([{width:20,rx:10,ry:2.5},{width:24,rx:12,ry:3}].flatMap(shape=>[false,true].map(excludeBackground=>({...shape,excludeBackground}))))('default import retains a $width px flattened ellipse with backdrop removal $excludeBackground',async({width:span,rx,ry,excludeBackground})=>{
 const width=48,height=48,cx=24.21,cy=23.73,aa=8,rgba=new Uint8Array(width*height*4);
 // The material and its analytic boundary precede rasterization. White is
 // composited over opaque black using independent 8x8 area coverage.
 for(let y=0;y<height;y++)for(let x=0;x<width;x++){let covered=0;for(let sy=0;sy<aa;sy++)for(let sx=0;sx<aa;sx++)covered+=+(((x+(sx+.5)/aa-cx)/rx)**2+((y+(sy+.5)/aa-cy)/ry)**2<1);const v=Math.round(255*covered/aa**2);rgba.set([v,v,v,255],4*(y*width+x));}
 const png=await sharp(rgba,{raw:{width,height,channels:4}}).png().toBuffer(),truth=Array.from({length:2049},(_,i)=>({xMm:cx+rx*Math.cos(i*Math.PI/1024),yMm:cy+ry*Math.sin(i*Math.PI/1024)}));let first:XY[]|undefined;
 for(const scale of [.05,1,10]){
  const calibration={a:{x:0,y:height},b:{x:0,y:0},distanceMm:height*scale},references:Reference[]=(['front','back']as const).map(view=>({id:randomUUID(),name:view,view,width,height,png:'data:image/png;base64,'+png.toString('base64'),calibration,calibrationMode:'manual',resources:{} as Reference['resources']})),output=splitReferences(references,height*scale,6,excludeBackground),pieces=output.regions.filter(r=>r.view==='front').map(r=>r.piece),bright=pieces.filter(p=>pigmentFamily(p.color!)===0);
  expect(bright).toHaveLength(1);const piece=bright[0],pixel=(p:XY)=>({...p,xMm:p.xMm/scale,yMm:height-p.yMm/scale}),native=sample(piece.nodes.map(p=>({...p,...pixel(p)})),(piece.curves??[]).map(c=>({...c,c1:{...c.c1,...pixel(c.c1)},c2:{...c.c2,...pixel(c.c2)}})),true),errors=native.map(p=>nearest(p,truth)).sort((a,b)=>a-b),forward=errors.at(-1)!,reverse=Math.max(...truth.map(p=>nearest(p,native))),p95=errors[Math.floor(errors.length*.95)],savedArea=area(native),sourceArea=Math.PI*rx*ry,sourcePerimeter=truth.slice(0,-1).reduce((s,p,i)=>s+Math.hypot(p.xMm-truth[i+1].xMm,p.yMm-truth[i+1].yMm),0),calibrationDrift=first?Math.max(...native.map(p=>nearest(p,first!)),...first.map(p=>nearest(p,native))):0,metrics={fixture:'independent flattened ellipse',span,rx,ry,excludeBackground,scale,forward,reverse,p95,savedArea,sourceArea,sourcePerimeter,calibrationDrift,nodes:piece.nodes.length,curves:piece.curves?.length??0,pieces:pieces.length};records.push(metrics);const message=JSON.stringify(metrics);
  expect.soft(forward,message).toBeLessThanOrEqual(1.05);expect.soft(reverse,message).toBeLessThanOrEqual(1.05);expect.soft(p95,message).toBeLessThanOrEqual(.55);expect.soft(Math.abs(savedArea-sourceArea),message).toBeLessThanOrEqual(sourcePerimeter*.5+Math.PI*.25);expect.soft(calibrationDrift,message).toBeLessThanOrEqual(.02);expect.soft(piece.holes??[],message).toHaveLength(0);expect.soft(pieces,message).toHaveLength(excludeBackground?1:2);
  if(excludeBackground)expect.soft(piece.curves?.length??0,message).toBeGreaterThan(0);else{const dark=pieces.filter(p=>pigmentFamily(p.color!)===6);expect.soft(dark,message).toHaveLength(1);expect.soft(dark[0]?.holes??[],message).toHaveLength(1);}
  first??=native;
 }
},60000);

afterAll(()=>{const dir='test-results/contour-repair/compact-source-review';mkdirSync(dir,{recursive:true});writeFileSync(dir+'/long-arc-regression-metrics.json',JSON.stringify({oracle:'Analytic sine arc / ellipse before independent 8x8 RGB rasterization. Direct fit .15px; full default import max1.05px, p95 .55px, calibration .02px and independent half-pixel source-area tube.',records},null,2));});
