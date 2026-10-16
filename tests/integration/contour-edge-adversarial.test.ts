import {randomUUID} from 'node:crypto';
import {describe,expect,it} from 'vitest';
import {segmentPixels,calibratedPoint} from '../../apps/desktop/main/reference-segmentation';
import {smoothContour} from '../../packages/reference/smooth-contour';
import type {Calibration,Piece,Point} from '../../packages/schema/index';
import ear from '../fixtures/character-ear-contour.json';
import thigh from '../fixtures/character-front-yellow-thigh-contour.json';
import body from '../fixtures/character-back-body-contour.json';

type XY={xMm:number;yMm:number};
type Pixel={x:number;y:number};
const distance=(a:XY,b:XY)=>Math.hypot(a.xMm-b.xMm,a.yMm-b.yMm);
function segmentDistance(p:XY,a:XY,b:XY){
 const dx=b.xMm-a.xMm,dy=b.yMm-a.yMm,d=dx*dx+dy*dy;
 const t=d?Math.max(0,Math.min(1,((p.xMm-a.xMm)*dx+(p.yMm-a.yMm)*dy)/d)):0;
 return Math.hypot(p.xMm-a.xMm-t*dx,p.yMm-a.yMm-t*dy);
}
// Evaluate the saved geometry directly. Do not reuse the fitter's flattening,
// error estimator or corner classification as this suite's acceptance oracle.
function sample(piece:Piece,ring:Point[],pixel:number):XY[]{
 return ring.flatMap((a,i)=>{
  const b=ring[(i+1)%ring.length],c=piece.curves?.find(c=>c.startNodeId===a.id&&c.endNodeId===b.id);
  const reach=c?distance(a,c.c1)+distance(c.c1,c.c2)+distance(c.c2,b):distance(a,b);
  const count=Math.max(1,Math.ceil(reach/(pixel*.2)));
  return Array.from({length:count},(_,j)=>{
   const t=j/count,s=1-t;
   return c?{xMm:s**3*a.xMm+3*s*s*t*c.c1.xMm+3*s*t*t*c.c2.xMm+t**3*b.xMm,yMm:s**3*a.yMm+3*s*s*t*c.c1.yMm+3*s*t*t*c.c2.yMm+t**3*b.yMm}
    :{xMm:a.xMm+t*(b.xMm-a.xMm),yMm:a.yMm+t*(b.yMm-a.yMm)};
  });
 });
}
function signedArea(r:XY[]){const o=r[0];return r.reduce((s,a,i)=>{const b=r[(i+1)%r.length];return s+(a.xMm-o.xMm)*(b.yMm-o.yMm)-(b.xMm-o.xMm)*(a.yMm-o.yMm);},0)/2;}
const measuredSegments=new WeakMap<XY[],{a:XY;b:XY;minX:number;maxX:number;minY:number;maxY:number}[]>();
function nearest(p:XY,r:XY[]){
 let segments=measuredSegments.get(r);
 if(!segments){segments=r.map((a,i)=>{const b=r[(i+1)%r.length];return{a,b,minX:Math.min(a.xMm,b.xMm),maxX:Math.max(a.xMm,b.xMm),minY:Math.min(a.yMm,b.yMm),maxY:Math.max(a.yMm,b.yMm)};});measuredSegments.set(r,segments);}
 let best=Infinity;
 for(const s of segments){
  // The coordinate gap to the segment's box is a strict lower bound on its
  // Euclidean distance. Skip only segments already proven farther away;
  // the independent curve samples, exact distance and acceptance stay intact.
  if(p.xMm<s.minX-best||p.xMm>s.maxX+best||p.yMm<s.minY-best||p.yMm>s.maxY+best)continue;
  best=Math.min(best,segmentDistance(p,s.a,s.b));
 }
 return best;
}
function evidence(result:Piece,raw:Piece,pixel:number){
 expect(result.holes?.length??0,'holes must remain separately editable').toBe(raw.holes?.length??0);
 const original=[raw.nodes,...(raw.holes??[])],recovered=[result.nodes,...(result.holes??[])];
 let sourceArea=0,resultArea=0;
 for(let i=0;i<original.length;i++){
  const a=sample(raw,original[i],pixel),b=sample(result,recovered[i],pixel);
  expect(Math.sign(signedArea(b)),'ring winding').toBe(Math.sign(signedArea(a)));
  let error=0;
  for(const p of a)error=Math.max(error,nearest(p,b));
  for(const p of b)error=Math.max(error,nearest(p,a));
  expect(error/pixel,'independent bidirectional boundary error in native pixels').toBeLessThanOrEqual(1.05);
  const factor=i===0?1:-1;sourceArea+=factor*Math.abs(signedArea(a));resultArea+=factor*Math.abs(signedArea(b));
 }
 expect(Math.abs(resultArea-sourceArea)/sourceArea,'selected material area').toBeLessThanOrEqual(.03);
}
function bow(piece:Piece,pixel:number){
 return Math.max(0,...(piece.curves??[]).map(c=>{
  const a=piece.nodes.find(n=>n.id===c.startNodeId)!,b=piece.nodes.find(n=>n.id===c.endNodeId)!;
  return Math.max(segmentDistance(c.c1,a,b),segmentDistance(c.c2,a,b))/pixel;
 }));
}
function turn(piece:Piece,index:number){
 const n=piece.nodes[index],previous=piece.nodes[(index+piece.nodes.length-1)%piece.nodes.length],next=piece.nodes[(index+1)%piece.nodes.length];
 const a=piece.curves?.find(c=>c.endNodeId===n.id)?.c2??previous,b=piece.curves?.find(c=>c.startNodeId===n.id)?.c1??next;
 const ux=n.xMm-a.xMm,uy=n.yMm-a.yMm,vx=b.xMm-n.xMm,vy=b.yMm-n.yMm;
 return Math.abs(Math.atan2(ux*vy-uy*vx,ux*vx+uy*vy));
}
function inside(p:Pixel,ring:Pixel[]){let hit=false;for(let i=0,j=ring.length-1;i<ring.length;j=i++){
 const a=ring[i],b=ring[j];if((a.y>p.y)!==(b.y>p.y)&&p.x<(b.x-a.x)*(p.y-a.y)/(b.y-a.y)+a.x)hit=!hit;
}return hit;}
function calibration(size:number,scale:number,angle:number):Calibration{
 return {a:{x:0,y:size},b:{x:size*Math.sin(angle),y:size-size*Math.cos(angle)},distanceMm:size*scale};
}
function extract(size:number,fill:(p:Pixel)=>boolean,scale=1,angle=0){
 const rgba=new Uint8Array(size*size*4);let seed:Pixel|undefined,count=0;
 for(let y=0;y<size;y++)for(let x=0;x<size;x++){
  const selected=fill({x:x+.5,y:y+.5}),i=(y*size+x)*4;
  rgba.set(selected?[0,150,220,255]:[245,245,245,255],i);
  if(selected){seed??={x,y};count++;}
 }
 expect(seed).toBeDefined();
 const c=calibration(size,scale,angle);
 const args=[size,size,rgba,seed!,0,c,size,size] as const;
 const raw=segmentPixels(...args,false,true),result=segmentPixels(...args,true,true);
 expect(result.pixelCount,'recovery must not reclassify color pixels').toBe(count);
 expect(result.mask).toEqual(raw.mask);
 return {raw:raw.piece,result:result.piece,c,pixel:scale};
}

describe('business-input adversarial contour recovery',()=>{
 const straightCases=[0,.07,.27,.73,1,1.37,2.8,5.6].flatMap(slope=>[
  {slope,length:112,thickness:6,scale:.08,rotation:0},
  {slope,length:96,thickness:19,scale:1,rotation:.41},
  {slope,length:39,thickness:11,scale:7,rotation:2.1}
 ]).concat([.08,1,7].flatMap(scale=>[.41,2.1].map(rotation=>({slope:1.37,length:112,thickness:6,scale,rotation}))));
 it.each(straightCases)('straight bar slope=$slope length=$length width=$thickness scale=$scale calibration rotation=$rotation',({slope,length,thickness,scale,rotation})=>{
  const angle=Math.atan(slope),co=Math.cos(angle),si=Math.sin(angle);
  const corners=[[-length/2,-thickness/2],[length/2,-thickness/2],[length/2,thickness/2],[-length/2,thickness/2]]
   .map(([u,v])=>({x:80+u*co-v*si,y:80+u*si+v*co}));
  const {raw,result,c,pixel}=extract(160,p=>inside(p,corners),scale,rotation);
  evidence(result,raw,pixel);
  expect(bow(result,pixel),'straight paint must not acquire bowed handles').toBeLessThan(1e-7);
  const paintedCorners=corners.map(p=>calibratedPoint(p.x,p.y,c));
  const interiorTurns=result.nodes.flatMap((p,i)=>Math.min(...paintedCorners.map(q=>distance(p,q)))>4*pixel?[turn(result,i)]:[]);
  expect(Math.max(0,...interiorTurns),'straight spans away from painted corners must not have raster-driven turns').toBeLessThanOrEqual(.08);
  expect(result.nodes.length,'four straight spans must not retain raster stair steps').toBeLessThanOrEqual(12);
  const finalPath=sample(result,result.nodes,pixel);
  for(const p of corners){
   const n=calibratedPoint(p.x,p.y,c),sourceDistance=nearest(n,raw.nodes)/pixel;
   // Pixel cells do not uniquely determine one editable vertex at the ideal
   // intersection. A short straight cap is legitimate within their envelope,
   // but its path must retain the source corner and a locally sharp turn.
   expect(nearest(n,finalPath)/pixel,`painted corner ${JSON.stringify(p)} remains inside the original quantization envelope`).toBeLessThanOrEqual(sourceDistance+1.05);
   const cornerTurns=result.nodes.flatMap((q,i)=>distance(q,n)<=4*pixel?[turn(result,i)]:[]);
   expect(Math.max(0,...cornerTurns),'painted corner must remain a sharp turn, not a rounded join').toBeGreaterThanOrEqual(.7);
  }
 });

 it.each([0,.31,1.02])('concave zigzag and oblique hole retain physical corners, rotation=%s',angle=>{
  const outer=[{x:12,y:18},{x:133,y:32},{x:115,y:135},{x:70,y:118},{x:83,y:92},{x:53,y:85},{x:39,y:125},{x:12,y:111}];
  const hole=[{x:39,y:39},{x:72,y:43},{x:68,y:64},{x:36,y:58}];
  const {raw,result,c,pixel}=extract(160,p=>inside(p,outer)&&!inside(p,hole),1,angle);
  evidence(result,raw,pixel);
  expect(bow(result,pixel),'polygonal material corners must not be rounded').toBeLessThan(1e-7);
  expect(result.nodes.length).toBeLessThanOrEqual(outer.length*3);
  expect(result.holes).toHaveLength(1);expect(result.holes![0].length).toBeLessThanOrEqual(12);
  for(const p of outer){const n=calibratedPoint(p.x,p.y,c);expect(Math.min(...result.nodes.map(p=>distance(p,n)))/pixel).toBeLessThanOrEqual(1.8);}
 });

 it.each([{rx:16,ry:29,angle:.23,scale:.08},{rx:47,ry:61,angle:.67,scale:1},{rx:63,ry:34,angle:1.13,scale:7}])
  ('observed ellipse rx=$rx ry=$ry rotation=$angle scale=$scale stays within source evidence',({rx,ry,angle,scale})=>{
   const co=Math.cos(angle),si=Math.sin(angle);
   const {raw,result,pixel}=extract(160,p=>{const dx=p.x-80,dy=p.y-80;return ((dx*co+dy*si)/rx)**2+((-dx*si+dy*co)/ry)**2<1;},scale,.39);
   evidence(result,raw,pixel);
   expect(result.nodes.length,'curved paint must not retain its dense pixel staircase').toBeLessThan(raw.nodes.length/3);
   expect(result.curves?.length??0,'a broad observed bend has supported curve segments').toBeGreaterThan(0);
  });

 it('a 3-pixel painted notch survives instead of being removed for appearance',()=>{
  const polygon=[{x:12,y:12},{x:120,y:12},{x:120,y:58},{x:117,y:58},{x:117,y:66},{x:120,y:66},{x:120,y:125},{x:12,y:125}];
  const {raw,result,c,pixel}=extract(140,p=>inside(p,polygon));
  evidence(result,raw,pixel);
  for(const p of polygon.slice(2,6)){const corner=calibratedPoint(p.x,p.y,c);expect(Math.min(...result.nodes.map(n=>distance(n,corner))),'each notch corner').toBeLessThanOrEqual(1.05);}
 });

 it.each([.08,1,7])('a true concave circular indentation keeps sharp line-arc junctions at scale %s',scale=>{
  const {raw,result,c,pixel}=extract(160,p=>p.x>=20&&p.x<130&&p.y>=20&&p.y<140&&Math.hypot(p.x-130,p.y-80)>44,scale,.41);
  evidence(result,raw,pixel);
  expect(raw.holes?.length??0).toBe(0);expect(result.holes?.length??0).toBe(0);
  expect(result.nodes.length).toBeLessThan(raw.nodes.length/3);
  expect(result.curves?.length??0).toBeGreaterThan(0);
  for(const side of [-1,1]){
   const tip=calibratedPoint(130,80+side*44,c);
   expect(Math.min(...result.nodes.map(n=>distance(n,tip)))/pixel,'sharp junction between painted line and concave arc').toBeLessThanOrEqual(1.8);
  }
 });

 it('a tiny original pixel hole stays exact while the broad exterior is recovered',()=>{
  const {raw,result,pixel}=extract(160,p=>((p.x-80)/61)**2+((p.y-80)/49)**2<1&&!(p.x>=78&&p.x<81&&p.y>=78&&p.y<81));
  evidence(result,raw,pixel);
  expect(raw.holes).toHaveLength(1);expect(result.holes).toHaveLength(1);
  const coordinates=(r:Point[])=>r.map(p=>[p.xMm,p.yMm]);
  expect(coordinates(result.holes![0]),'sub-16-pixel hole must preserve exact evidence').toEqual(coordinates(raw.holes![0]));
  expect(result.nodes.length).toBeLessThan(raw.nodes.length/3);
  expect(result.curves?.length??0).toBeGreaterThan(0);
 });

 it.each([{name:'ear',fixture:ear},{name:'thigh',fixture:thigh},{name:'back body',fixture:body}])
  ('fixed real original-image $name boundary survives independent geometry checks',({name,fixture})=>{
   const point=([xMm,yMm]:number[]):Point=>({id:randomUUID(),xMm,yMm});
   const raw:Piece={id:randomUUID(),name,nodes:fixture.nodes.map(point),holes:fixture.holes.map(h=>h.map(point)),closed:true,allowanceMm:0,cutQty:1,mirror:false,material:'毛皮',furRad:0,color:fixture.color};
   const before=JSON.stringify(raw),result=smoothContour(raw,fixture.pixelMm,randomUUID);
   evidence(result,raw,fixture.pixelMm/.8);
   expect(JSON.stringify(raw),'recovering geometry cannot alter the stored source').toBe(before);
   expect(result.nodes.length).toBeLessThan(raw.nodes.length/3);
   expect(result.curves?.length??0).toBeGreaterThan(0);
  });
});
