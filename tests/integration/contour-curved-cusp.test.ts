// Analytic source contracts for the complete shared material graph.
import {randomUUID} from 'node:crypto';
import {mkdirSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {expect,it} from 'vitest';
import {cases,sourceFixture,type XY} from '../fixtures/curved-cusp-source';
import {sourceBoundary,nearest,samples,type Primitive} from '../fixtures/curved-cusp-oracle';
import {analyticCrescentEvidence} from '../fixtures/analytic-crescent-boundary';
import {imageBoundaryFit} from '../../packages/reference/image-contour';
import {recoverSharedContours} from '../../packages/reference/shared-contour';
import type {Piece} from '../../packages/schema/index';
import {pathSegments,flatten,sampleSegments,nearestIndex,intersections,exactPathArea,polygonArea} from '../fixtures/curved-cusp-geometry';
const dir=process.env.FPCAD_CURVED_CUSP_RUN??'test-results/contour-curved-cusp';
type CapViolation={q:XY;t:number;dx:number;dy:number};
type CapEvidence={source:string;center:XY;radius:number;pole:XY;poleDistance:number;violations:CapViolation[]};
const inside=(q:XY,r:XY[])=>{let yes=false;for(let i=0,j=r.length-1;i<r.length;j=i++){const a=r[i],b=r[j];if((a.y>q.y)!==(b.y>q.y)&&q.x<(b.x-a.x)*(q.y-a.y)/(b.y-a.y)+a.x)yes=!yes;}return yes;};
it.each(cases)('$name retains the independently prescribed final shared geometry',c=>{
 const f=sourceFixture(c),before=structuredClone(f.originals),rgba=f.rgba.slice(),fit=imageBoundaryFit(f.size,f.size,f.rgba,f.toPixel,f.fromPixel),result=recoverSharedContours(f.originals,.8*c.scale,randomUUID,fit),truth=sourceBoundary(c);
 const map=(p:{xMm:number;yMm:number})=>{const q=f.toOracle(p);return{x:q.xMm,y:q.yMm};},paths=result.pieces.map(p=>pathSegments(p,map)),flat=paths.map(rs=>rs.map(ring=>flatten(ring,.001))),polygons=flat.map(rs=>rs.map(ring=>ring.map(e=>e.a)));
 const corners=[{x:0,y:0},{x:f.size,y:0},{x:f.size,y:f.size},{x:0,y:f.size}].map(f.toLocal),frame:Primitive[]=corners.map((a,i)=>({a,b:corners[(i+1)%corners.length]}));
 const blue=truth.rings.flat(),outerCircle=truth.rings[0],innerCircle=truth.rings[1];
 // Yellow component identities are fixed by source: pixel0 belongs to the
 // surrounding component; annulus also has an independent central disk.
 const references=[blue,...(c.kind==='annulus'?[frame.concat(outerCircle),innerCircle]:[frame.concat(blue)])];
 const metrics=result.pieces.map((piece,i)=>{
  // Sample flattened LINE edges so their physical spacing really is<=.05;
  // uniform cubic parameter samples would not certify this arc-length bound.
  const output=flat[i].flat(),target=references[i],queries=sampleSegments(output,.05),sourceQueries=samples(target,.05),near=nearestIndex(output);
  const forward=Math.max(...queries.map((p:XY)=>nearest(p,target)))+.027,reverse=Math.max(...sourceQueries.map(p=>near(p).distance))+.027,area=Math.abs(exactPathArea(paths[i][0]))-paths[i].slice(1).reduce((s:number,r)=>s+Math.abs(exactPathArea(r)),0);
  return{index:i,name:piece.name,forwardUpper:forward,reverseUpper:reverse,area,holes:piece.holes?.length??0,nodes:piece.nodes.length,curves:piece.curves?.length??0,crossings:intersections(flat[i]),zeroEdges:flat[i].flat().filter(e=>Math.hypot(e.a.x-e.b.x,e.a.y-e.b.y)<1e-9).length};
 });
 const analytic=c.kind==='crescent'?analyticCrescentEvidence(result.pieces[0],f.toOracle,{cx:c.cx,cy:c.cy,R:c.R,r:c.r!,d:c.d!}):null;
 let gaps=0,overlaps=0,wrongInterior=0;
 for(let y=.317;y<f.size;y+=2.7)for(let x=.731;x<f.size;x+=2.7){const p={x,y},q=f.toLocal(p),owners=polygons.flatMap((rings,i:number)=>inside(q,rings[0])&&!rings.slice(1).some((r:XY[])=>inside(q,r))?[i]:[]);if(!owners.length)gaps++;if(owners.length>1)overlaps++;if(nearest(q,blue)>1.25&&(owners.includes(0)!==(f.signed(p)<0)))wrongInterior++;}
 // Fixed circular-cap source windows. Orientation-independent derivative
 // products reject a branch that turns backwards on a true monotone arc.
 // No universal20degree rule is applied to naturally curved polygon caps.
 let cap:CapEvidence|null=null;
 if(c.kind==='stadium'||c.kind==='half-disc'){
  const center={x:c.cx+(c.kind==='stadium'?c.d!:0),y:c.cy},r=c.R,pole={x:center.x+r,y:center.y},near=nearestIndex(flat[0].flat()),violations:CapViolation[]=[];
  for(const segment of paths[0][0])for(let k=0;k<=128;k++){
   const t=k/128,s=1-t,a=segment.a,b=segment.b,u=segment.c1??a,v=segment.c2??b,q={x:s**3*a.x+3*s*s*t*u.x+3*s*t*t*v.x+t**3*b.x,y:s**3*a.y+3*s*s*t*u.y+3*s*t*t*v.y+t**3*b.y},dx=3*(s*s*(u.x-a.x)+2*s*t*(v.x-u.x)+t*t*(b.x-v.x)),dy=3*(s*s*(u.y-a.y)+2*s*t*(v.y-u.y)+t*t*(b.y-v.y));
   if(q.x>center.x+r*.4&&Math.abs(q.y-center.y)>1.5&&Math.abs(q.y-center.y)<r*.8&&dx*dy*(center.y-q.y)<-1e-8)violations.push({q,t,dx,dy});
  }
  cap={source:'Exact right semicircle, centered as fixed before rendering',center,radius:r,pole,poleDistance:near(pole).distance,violations};
 }
 mkdirSync(dir,{recursive:true});writeFileSync(resolve(dir,cases.findIndex(v=>v.name===c.name)+'-result.json'),JSON.stringify({case:c,truth,metrics,analytic,partition:{gaps,overlaps,wrongInterior},cap,report:result.report,raw:f.originals,final:result.pieces},null,2));
 expect(f.originals).toStrictEqual(before);expect(Buffer.from(f.rgba).equals(Buffer.from(rgba))).toBe(true);
 expect(result.pieces).toHaveLength(c.kind==='annulus'?3:2);expect({gaps,overlaps,wrongInterior}).toEqual({gaps:0,overlaps:0,wrongInterior:0});
 for(const [i,m]of metrics.entries()){
  expect(m.forwardUpper,JSON.stringify(m)).toBeLessThanOrEqual(1.25);expect(m.reverseUpper,JSON.stringify(m)).toBeLessThanOrEqual(1.25);
  expect(m.crossings).toEqual([]);expect(m.zeroEdges).toBe(0);expect(m.holes).toBe(i===0?(c.kind==='annulus'?1:0):i===1?1:0);
  const piece=result.pieces[i],ids=new Set(piece.nodes.map(n=>n.id));expect(ids.size).toBe(piece.nodes.length);expect([piece.nodes,...piece.holes??[]].flat().every(p=>Number.isFinite(p.xMm)&&Number.isFinite(p.yMm))).toBe(true);expect((piece.curves??[]).flatMap(c=>[c.c1,c.c2]).every(p=>Number.isFinite(p.xMm)&&Number.isFinite(p.yMm))).toBe(true);
  for(const curve of piece.curves??[])expect(piece.nodes.some((n,j)=>n.id===curve.startNodeId&&piece.nodes[(j+1)%piece.nodes.length].id===curve.endNodeId)).toBe(true);
  expect(Math.sign(polygonArea(polygons[i][0]))).toBe(1);for(const ring of polygons[i].slice(1))expect(Math.sign(polygonArea(ring))).toBe(-1);
 }
 expect(Math.abs(metrics[0].area-truth.area)).toBeLessThanOrEqual(Math.max(.64,truth.area*.03));
 if(analytic){expect(analytic.forward.certifiedUpper).toBeLessThanOrEqual(1.25);expect(analytic.reverse.certifiedUpper).toBeLessThanOrEqual(1.25);expect(analytic.area.error).toBeLessThanOrEqual(analytic.area.budget);expect(analytic.topology.crossings).toEqual([]);}
 if(cap){expect(cap.poleDistance).toBeLessThanOrEqual(1.25);expect(cap.violations).toEqual([]);}
});
