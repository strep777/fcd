import {expect,it,onTestFinished,vi} from 'vitest';
import {randomUUID} from 'node:crypto';
import {mkdirSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import UPNG from '@pdf-lib/upng';
import {fitMeasuredBoundary} from '../../packages/reference/image-contour';
import {splitReferences} from '../../apps/desktop/main/automatic-reference';
import {pigmentFamily} from '../../packages/reference/illustration';
import * as sharedContours from '../../packages/reference/shared-contour';
import type {Piece,Point,Reference} from '../../packages/schema/index';

type XY={xMm:number;yMm:number};
type Primitive={kind:'line';a:XY;b:XY}|{kind:'arc';center:XY;radius:number;from:number;to:number};
type Path=Pick<Piece,'nodes'|'curves'>;
const xy=(xMm:number,yMm:number):XY=>({xMm,yMm});
const line=(a:XY,b:XY):Primitive=>({kind:'line',a,b});
const arc=(center:XY,radius:number,from:number,to:number):Primitive=>({kind:'arc',center,radius,from,to});
const subtract=(a:XY,b:XY)=>xy(a.xMm-b.xMm,a.yMm-b.yMm);
const length=(v:XY)=>Math.hypot(v.xMm,v.yMm);
const distance=(a:XY,b:XY)=>length(subtract(a,b));
const unit=(v:XY)=>{const d=length(v);return xy(v.xMm/d,v.yMm/d);};
const dot=(a:XY,b:XY)=>a.xMm*b.xMm+a.yMm*b.yMm;
const cross=(a:XY,b:XY)=>a.xMm*b.yMm-a.yMm*b.xMm;
const interpolate=(a:XY,b:XY,t:number)=>xy(a.xMm+(b.xMm-a.xMm)*t,a.yMm+(b.yMm-a.yMm)*t);
function primitiveAt(p:Primitive,t:number):XY{
 if(p.kind==='line')return interpolate(p.a,p.b,t);
 const angle=p.from+(p.to-p.from)*t;return xy(p.center.xMm+p.radius*Math.cos(angle),p.center.yMm+p.radius*Math.sin(angle));
}
const primitiveLength=(p:Primitive)=>p.kind==='line'?distance(p.a,p.b):p.radius*Math.abs(p.to-p.from);
function primitiveDistance(q:XY,p:Primitive):number{
 if(p.kind==='line'){
  const v=subtract(p.b,p.a),t=Math.max(0,Math.min(1,dot(subtract(q,p.a),v)/(dot(v,v)||1)));
  return distance(q,interpolate(p.a,p.b,t));
 }
 const angle=Math.atan2(q.yMm-p.center.yMm,q.xMm-p.center.xMm);
 const inSweep=[angle-2*Math.PI,angle,angle+2*Math.PI].some(a=>a>=Math.min(p.from,p.to)-1e-12&&a<=Math.max(p.from,p.to)+1e-12);
 return inSweep?Math.abs(distance(q,p.center)-p.radius):Math.min(distance(q,primitiveAt(p,0)),distance(q,primitiveAt(p,1)));
}
const truthDistance=(q:XY,source:Primitive[])=>Math.min(...source.map(p=>primitiveDistance(q,p)));
function sourceSamples(source:Primitive[],closed:boolean,step=.75):Point[]{
 const points=source.flatMap(p=>{const count=Math.ceil(primitiveLength(p)/step);return Array.from({length:count},(_,i)=>({...primitiveAt(p,i/count),id:randomUUID()}));});
 if(!closed)points.push({...primitiveAt(source.at(-1)!,1),id:randomUUID()});
 return points;
}
function edges(path:Path,closed:boolean){
 const curves=new Map((path.curves??[]).map(c=>[c.startNodeId,c]));
 return path.nodes.slice(0,closed?undefined:-1).map((a,i)=>{
  const b=path.nodes[(i+1)%path.nodes.length],curve=curves.get(a.id);
  if(curve)expect(curve.endNodeId).toBe(b.id);
  const c1=curve?.c1??interpolate(a,b,1/3),c2=curve?.c2??interpolate(a,b,2/3);
  const at=(t:number)=>{const s=1-t;return xy(s*s*s*a.xMm+3*s*s*t*c1.xMm+3*s*t*t*c2.xMm+t*t*t*b.xMm,s*s*s*a.yMm+3*s*s*t*c1.yMm+3*s*t*t*c2.yMm+t*t*t*b.yMm);};
  return {a,b,c1,c2,at,start:subtract(c1,a),end:subtract(b,c2)};
 });
}
// Evaluate the saved control polygon directly. No production flattening or
// fitted output establishes the oracle: source distances are analytic.
function assertPosition(path:Path,source:Primitive[],closed:boolean,limit:number){
 const segments=edges(path,closed),flattened=segments.flatMap(e=>{
  const count=Math.max(2,Math.ceil((distance(e.a,e.c1)+distance(e.c1,e.c2)+distance(e.c2,e.b))/.08));
  return Array.from({length:count},(_,i)=>e.at(i/count));
 });
 if(!closed)flattened.push(path.nodes.at(-1)!);
 expect(flattened.every(p=>Number.isFinite(p.xMm)&&Number.isFinite(p.yMm))).toBe(true);
 const reverseError=Math.max(...flattened.map(p=>truthDistance(p,source)));
 const sourceError=Math.max(...sourceSamples(source,closed,.2).map(p=>{
  let nearest=Infinity;
  for(let i=0;i<flattened.length-(closed?0:1);i++)nearest=Math.min(nearest,primitiveDistance(p,line(flattened[i],flattened[(i+1)%flattened.length])));
  return nearest;
 }));
 expect(reverseError,'saved geometry must stay on the independent analytic boundary').toBeLessThanOrEqual(limit);
 expect(sourceError,'no original edge span may disappear between saved nodes').toBeLessThanOrEqual(limit);
}
function assertContinuity(path:Path,closed:boolean,include:(p:XY)=>boolean=()=>true){
 const segments=edges(path,closed);let checked=0;
 for(let i=closed?0:1;i<segments.length;i++){
  const before=segments[(i+segments.length-1)%segments.length],after=segments[i];
  if(!include(after.a))continue;
  expect(length(before.end),'incoming saved derivative must not collapse').toBeGreaterThan(1e-9);
  expect(length(after.start),'outgoing saved derivative must not collapse').toBeGreaterThan(1e-9);
  const u=unit(before.end),v=unit(after.start);
  expect(Math.abs(cross(u,v)),`unsupported kink at ${JSON.stringify(after.a)}`).toBeLessThan(1e-6);
  expect(dot(u,v),'collinear handles must point forward, not fold back').toBeGreaterThan(.999999);
  checked++;
 }
 return checked;
}

const lineArc=[line(xy(0,0),xy(40,0)),arc(xy(40,30),30,-Math.PI/2,0),line(xy(70,30),xy(70,65))];
const arcArc=[arc(xy(0,30),30,-Math.PI/2,0),arc(xy(50,30),20,Math.PI,Math.PI/2)];
const stadium=[line(xy(20,20),xy(100,20)),arc(xy(100,45),25,-Math.PI/2,Math.PI/2),line(xy(100,70),xy(20,70)),arc(xy(20,45),25,Math.PI/2,3*Math.PI/2)];

it.each([
 {name:'line-to-arc',source:lineArc,closed:false},
 {name:'arc-to-arc with curvature reversal',source:arcArc,closed:false},
 {name:'closed first/last seam',source:stadium,closed:true},
])('$name retains measured positions and forward continuous saved handles',({source,closed})=>{
 const points=sourceSamples(source,closed),before=structuredClone(points),result=fitMeasuredBoundary(points,closed,randomUUID,.15);
 expect(points).toEqual(before);
 expect(result.nodes.length).toBeGreaterThanOrEqual(closed?3:3);
 expect(result.nodes.length,'native samples must not become hundreds of editable nodes').toBeLessThanOrEqual(18);
 expect(result.curves.length).toBeGreaterThan(0);
 assertPosition(result,source,closed,.18);
 expect(assertContinuity(result,closed)).toBe(result.nodes.length-(closed?0:2));
});

it('reversing a measured path preserves the source and forward handle direction',()=>{
 const points=sourceSamples(lineArc,false).reverse(),result=fitMeasuredBoundary(points,false,randomUUID,.15);
 expect(result.nodes[0]).toEqual(points[0]);expect(result.nodes.at(-1)).toEqual(points.at(-1));
 expect(result.nodes.length).toBeLessThanOrEqual(18);
 assertPosition(result,lineArc,false,.18);assertContinuity(result,false);
});

it('source-supported right-angle corners remain sharp instead of being smoothed',()=>{
 const corners=[xy(0,0),xy(45,0),xy(45,35),xy(0,35)],source=corners.map((p,i)=>line(p,corners[(i+1)%corners.length]));
 const result=fitMeasuredBoundary(sourceSamples(source,true),true,randomUUID,.15),segments=edges(result,true);
 assertPosition(result,source,true,.001);expect(result.nodes.length).toBeLessThanOrEqual(12);
 for(const corner of corners){
  const i=result.nodes.findIndex(p=>distance(p,corner)<1e-8);expect(i,'a certified corner must remain on its original position').toBeGreaterThanOrEqual(0);
  const incoming=unit(segments[(i+segments.length-1)%segments.length].end),outgoing=unit(segments[i].start);
  expect(Math.abs(dot(incoming,outgoing)),'the true 90 degree source corner must survive').toBeLessThan(.001);
 }
});

it('two samples and repeated collinear samples retain exact endpoints without degenerate handles',()=>{
 for(const coordinates of [[xy(2,3),xy(14,19)],[xy(2,3),xy(2,3),xy(8,11),xy(14,19),xy(14,19)]]){
  const points=coordinates.map(p=>({...p,id:randomUUID()})),result=fitMeasuredBoundary(points,false,randomUUID,.15);
  expect(result.nodes).toEqual([points[0],points.at(-1)]);expect(result.curves).toHaveLength(0);
 }
});

it('protected measured corners of a straight closed loop keep their exact coordinates',()=>{
 const corners=[xy(0,0),xy(45,0),xy(45,35),xy(0,35)],source=corners.map((p,i)=>line(p,corners[(i+1)%corners.length]));
 const points=sourceSamples(source,true),anchors=points.filter(p=>corners.some(c=>distance(p,c)<1e-8));
 const offsets=[xy(.35,.25),xy(-.3,.2),xy(-.25,-.35),xy(.2,-.25)];
 anchors.forEach((p,i)=>{p.xMm+=offsets[i].xMm;p.yMm+=offsets[i].yMm;});
 const protectedCorners=new Set(anchors.map(p=>p.id)),before=structuredClone(points);
 // Long measured straight interiors support different line intersections
 // from these fixed source anchors. Their subpixel offsets must survive the
 // final all-lines compaction, including reversed and rotated traversals.
 for(const input of [points,[...points].reverse(),[...points.slice(17),...points.slice(0,17)]]){
  const result=fitMeasuredBoundary(input,true,randomUUID,.65,undefined,protectedCorners);
  expect(result.curves).toHaveLength(0);expect(result.nodes.length).toBeLessThanOrEqual(12);
  for(const anchor of anchors)expect(result.nodes.find(p=>p.id===anchor.id),'line intersections may not move a protected source coordinate').toEqual(anchor);
 }
 expect(points).toEqual(before);
});

it.each([
 {name:'the default complete RGB splitReferences path saves forward continuous line/arc handles',excludeBackground:true},
 {name:'retained background holes preserve identical shared polygon boundaries against original RGB truth',excludeBackground:false},
])('$name',({excludeBackground})=>{
 const captures:unknown[]=[],recover=sharedContours.recoverSharedContours;
 const spy=vi.spyOn(sharedContours,'recoverSharedContours').mockImplementation((...args)=>{
  const answer=recover(...args);captures.push({raw:args[0],pixelMm:args[1],report:answer.report,pieces:answer.pieces});return answer;
 });
 onTestFinished(()=>spy.mockRestore());
 const width=128,height=112,supersample=8,rgba=new Uint8Array(width*height*4);
 const inside=(x:number,y:number)=>x>=20&&y>=20&&y<=92&&(x<=56||Math.hypot(x-56,y-56)<=36);
 for(let y=0;y<height;y++)for(let x=0;x<width;x++){
  let coverage=0;for(let dy=0;dy<supersample;dy++)for(let dx=0;dx<supersample;dx++)if(inside(x+(dx+.5)/supersample,y+(dy+.5)/supersample))coverage++;
  const t=coverage/supersample**2,foreground=[249,227,60],background=[237,231,234];
  rgba.set([...foreground.map((v,k)=>Math.round(v*t+background[k]*(1-t))),255],4*(y*width+x));
 }
 const png='data:image/png;base64,'+Buffer.from(UPNG.encode([rgba.buffer],width,height,0)).toString('base64');
 const references:Reference[]=(['front','back']as const).map(view=>({id:randomUUID(),name:view,view,width,height,png,resources:{} as Reference['resources'],calibration:{a:{x:0,y:height},b:{x:0,y:0},distanceMm:height},calibrationMode:'manual'}));
 const result=splitReferences(references,height,3,excludeBackground,'precise','head');
 if(process.env.FPCAD_EDGE_AUDIT==='1'){
  const dir=resolve('test-results/latest-edge');mkdirSync(dir,{recursive:true});
  writeFileSync(resolve(dir,`edge-continuity-pipeline-${excludeBackground?'default':'holes'}.json`),JSON.stringify({width,height,aa:supersample,excludeBackground,pipeline:captures,regions:result.regions},null,2));
 }
 const targets=result.regions.filter(r=>pigmentFamily(r.piece.color!)===2);expect(targets).toHaveLength(2);
 const source=[line(xy(20,20),xy(56,20)),arc(xy(56,56),36,-Math.PI/2,Math.PI/2),line(xy(56,92),xy(20,92)),line(xy(20,92),xy(20,20))];
 for(const {piece,view}of targets){
  const toPixel=(p:Point):Point=>({...p,yMm:height-p.yMm});
  const saved:Path={nodes:piece.nodes.map(toPixel),curves:piece.curves?.map(c=>({...c,c1:toPixel(c.c1),c2:toPixel(c.c2)}))};
  assertPosition(saved,source,true,1.05);
  if(!excludeBackground){
   // The current contract stores holes as polygon rings, without cubic
   // handles. Both material owners must use the same polygon until the hole
   // schema supports curves. This case certifies coverage and sharing; the
   // separate default case below certifies editable tangent continuity.
   expect(saved.curves).toHaveLength(0);
   const background=result.regions.find(r=>r.view===view&&r.piece.holes?.some(h=>h.length===piece.nodes.length));
   expect(background).toBeDefined();
   const hole=background!.piece.holes!.find(h=>h.length===piece.nodes.length)!;
   const key=(p:XY)=>`${p.xMm.toFixed(8)},${p.yMm.toFixed(8)}`;
   const edgeKeys=(ring:Point[])=>ring.map((p,i)=>[key(p),key(ring[(i+1)%ring.length])].sort().join('|')).sort();
   expect(edgeKeys(hole)).toEqual(edgeKeys(piece.nodes));
   continue;
  }
  expect(saved.curves!.length).toBeGreaterThan(0);
  // Only the two left corners are genuine source corners. Every saved node
  // on the straight/arc half, including the transition, must share a tangent.
  expect(assertContinuity(saved,true,p=>p.xMm>25)).toBeGreaterThanOrEqual(2);
  expect(saved.nodes.length,'a native 36px-radius semicircle should remain sparse').toBeLessThanOrEqual(20);
 }
},60000);
