import {it,expect} from 'vitest';
import {randomUUID} from 'node:crypto';
import chain from '../fixtures/paw-pad-shared-chain.json';
import {recoverBoundaryChain} from '../../packages/reference/recover-contour';
import type {Point} from '../../packages/schema/index';

// Exact traced shared boundary from the raised pink pad in the original JPEG.
// The observed broad bend excludes its true junctions and terminal pad crease.
it.each([.05,1,10].flatMap(scale=>[0,.37].map(rotation=>({scale,rotation}))))('shared pad bend retains source accuracy at scale $scale rotation $rotation',({scale,rotation})=>{
 const c=Math.cos(rotation),s=Math.sin(rotation);
 const points=chain.map(([x,y])=>({id:randomUUID(),xMm:1000+scale*((x-609)*c-(750-y)*s),yMm:-1000+scale*((x-609)*s+(750-y)*c)}));
 const result=recoverBoundaryChain(points,.8*scale,randomUUID);
 expect(result.nodes[0]).toEqual(points[0]);expect(result.nodes.at(-1)).toEqual(points.at(-1));
 const normalize=(p:{xMm:number;yMm:number})=>{const x=(p.xMm-1000)/scale,y=(p.yMm+1000)/scale;return {xMm:x*c+y*s,yMm:-x*s+y*c};};
 const turns=result.nodes.flatMap((n,i)=>{
  const p=normalize(n);if(i===0||i===result.nodes.length-1||p.xMm+609<635||p.xMm+609>653||750-p.yMm<292||750-p.yMm>306)return [];
  const a=result.curves.find(curve=>curve.endNodeId===n.id)?.c2??result.nodes[i-1],b=result.curves.find(curve=>curve.startNodeId===n.id)?.c1??result.nodes[i+1];
  const ux=n.xMm-a.xMm,uy=n.yMm-a.yMm,vx=b.xMm-n.xMm,vy=b.yMm-n.yMm;return [Math.abs(Math.atan2(ux*vy-uy*vx,ux*vx+uy*vy))];
 });
 expect(turns.length).toBeGreaterThan(0);expect(Math.max(...turns)).toBeLessThanOrEqual(Math.PI/9);
 const original=points.map(normalize),sampled=result.nodes.flatMap((a,i)=>{
  if(i===result.nodes.length-1)return [normalize(a)];const b=result.nodes[i+1],curve=result.curves.find(curve=>curve.startNodeId===a.id);
  return Array.from({length:256},(_,j)=>{const t=j/256,u=1-t;return normalize(curve?{xMm:u*u*u*a.xMm+3*u*u*t*curve.c1.xMm+3*u*t*t*curve.c2.xMm+t*t*t*b.xMm,yMm:u*u*u*a.yMm+3*u*u*t*curve.c1.yMm+3*u*t*t*curve.c2.yMm+t*t*t*b.yMm}:{xMm:a.xMm+t*(b.xMm-a.xMm),yMm:a.yMm+t*(b.yMm-a.yMm)});});
 });
 const distance=(p:Omit<Point,'id'>,a:Omit<Point,'id'>,b:Omit<Point,'id'>)=>{const x=b.xMm-a.xMm,y=b.yMm-a.yMm,d=x*x+y*y,t=d?Math.max(0,Math.min(1,((p.xMm-a.xMm)*x+(p.yMm-a.yMm)*y)/d)):0;return Math.hypot(p.xMm-a.xMm-t*x,p.yMm-a.yMm-t*y);};
 const error=(a:Omit<Point,'id'>[],b:Omit<Point,'id'>[])=>Math.max(...a.map(p=>Math.min(...b.slice(1).map((q,i)=>distance(p,b[i],q)))));
 const sourceSamples=original.flatMap((a,i)=>i===original.length-1?[a]:Array.from({length:Math.ceil(Math.hypot(original[i+1].xMm-a.xMm,original[i+1].yMm-a.yMm)/.1)},(_,j)=>{const b=original[i+1],t=j/Math.ceil(Math.hypot(b.xMm-a.xMm,b.yMm-a.yMm)/.1);return {xMm:a.xMm+t*(b.xMm-a.xMm),yMm:a.yMm+t*(b.yMm-a.yMm)};}));
 expect(Math.max(error(sourceSamples,sampled),error(sampled,original))).toBeLessThanOrEqual(1.05+1e-8);
});
