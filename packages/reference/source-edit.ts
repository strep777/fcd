import type {Piece,Point,Reference} from '../schema/index';
import {splitEdge,edgeArcPoints} from '../pattern/edit';
import {drawingIssue} from '../surface/drawing';
export type SourcePoint={xMm:number;yMm:number};
export type SourceOperation={kind:'brush';mode:'add'|'erase';points:SourcePoint[];radiusMm:number}|{kind:'pen';mode:'add'|'erase';points:SourcePoint[]};
export type SourceEdit={piece:Piece;operations:SourceOperation[]};
const distance=(a:SourcePoint,b:SourcePoint)=>Math.hypot(a.xMm-b.xMm,a.yMm-b.yMm);
export function cloneSource(piece:Piece):Piece{return JSON.parse(JSON.stringify(piece)) as Piece;}
export function removeSourceNode(piece:Piece,id:string):Piece{
 const ring=[piece.nodes,...(piece.holes??[])].find(r=>r.some(n=>n.id===id));if(!ring||ring.length<=3)return piece;
 const nodes=piece.nodes.filter(n=>n.id!==id),holes=piece.holes?.map(r=>r.filter(n=>n.id!==id));
 return {...piece,nodes,holes,curves:piece.curves?.filter(c=>c.startNodeId!==id&&c.endNodeId!==id),edgeAllowances:piece.edgeAllowances?.filter(e=>e.nodeId!==id&&e.endNodeId!==id),notches:piece.notches?.filter(n=>n.nodeId!==id)};
}
const mix=(a:SourcePoint,b:SourcePoint,t:number)=>({xMm:a.xMm+(b.xMm-a.xMm)*t,yMm:a.yMm+(b.yMm-a.yMm)*t});
function curveAt(a:Point,c1:Point,c2:Point,b:Point,t:number){const p=mix(a,c1,t),q=mix(c1,c2,t),r=mix(c2,b,t);return mix(mix(p,q,t),mix(q,r,t),t);}
/** Find a point on the existing edge; curve insertion uses exact de Casteljau splitting. */
export function insertSourceNode(piece:Piece,p:SourcePoint):{piece:Piece;nodeId:string}{
 let best:{ringIndex:number;index:number;t:number;distance:number}|undefined;
 for(const [ringIndex,ring] of [piece.nodes,...(piece.holes??[])].entries())for(let index=0;index<ring.length;index++){
  const a=ring[index],b=ring[(index+1)%ring.length],curve=ringIndex===0?piece.curves?.find(c=>c.startNodeId===a.id&&c.endNodeId===b.id):undefined;let t:number,d:number;
  if(curve){let lo=0,hi=1,bestSample=0,bestD=Infinity;for(let i=0;i<=64;i++){const value=distance(p,curveAt(a,curve.c1,curve.c2,b,i/64));if(value<bestD){bestD=value;bestSample=i;}}lo=Math.max(0,(bestSample-1)/64);hi=Math.min(1,(bestSample+1)/64);for(let i=0;i<28;i++){const x=lo+(hi-lo)/3,y=hi-(hi-lo)/3;if(distance(p,curveAt(a,curve.c1,curve.c2,b,x))<distance(p,curveAt(a,curve.c1,curve.c2,b,y)))hi=y;else lo=x;}t=(lo+hi)/2;d=distance(p,curveAt(a,curve.c1,curve.c2,b,t));}
  else{const dx=b.xMm-a.xMm,dy=b.yMm-a.yMm,l=dx*dx+dy*dy;t=l?Math.max(0,Math.min(1,((p.xMm-a.xMm)*dx+(p.yMm-a.yMm)*dy)/l)):0;d=distance(p,mix(a,b,t));}
  if(!best||d<best.distance)best={ringIndex,index,t,distance:d};
 }
 if(!best)throw Error('INVALID_GEOMETRY');const ring=[piece.nodes,...(piece.holes??[])][best.ringIndex],t=Math.max(.0001,Math.min(.9999,best.t));
 if(best.ringIndex===0){const next=splitEdge(piece,ring[best.index].id,t);return {piece:next,nodeId:next.nodes[best.index+1].id};}
 const node={id:crypto.randomUUID(),...mix(ring[best.index],ring[(best.index+1)%ring.length],t)},holes=piece.holes!.map((r,i)=>{if(i!==best!.ringIndex-1)return r;const next=[...r];next.splice(best!.index+1,0,node);return next;});return {piece:{...piece,holes},nodeId:node.id};
}
/** Keep live validation bounded. Dense curve flattening is checked by the native worker on confirm. */
export function sourceDrawingIssue(piece:Piece){
 const holes=piece.holes??[],points=[...piece.nodes,...holes.flat(),...(piece.curves??[]).flatMap(c=>[c.c1,c.c2])];
 if(piece.nodes.length>2000||holes.length>32||holes.some(h=>h.length>2000)||points.some(p=>!Number.isFinite(p.xMm)||!Number.isFinite(p.yMm)))return 'DRAWING_LIMIT';
 try{const nodes:SourcePoint[]=[];for(const node of piece.nodes){const edge=edgeArcPoints(piece,node.id).slice(0,-1);if(nodes.length+edge.length>2000)return '';nodes.push(...edge);}return drawingIssue(nodes)||(holes.reduce((n,h)=>n+h.length,0)<=2000?holes.map(h=>drawingIssue(h)).find(Boolean):'')||'';}catch(error){const code=(error as Error).message;return code==='RESOURCE_LIMIT'?'':code;}
}
/** Pixel artwork and millimetre outlines retain the reference's calibration transform. */
export function sourceImageTransform(reference:Reference):string|undefined{
 const c=reference.calibration;if(!c)return;const dx=c.b.x-c.a.x,dy=c.b.y-c.a.y,l=dx*dx+dy*dy;if(l<1e-12)return;const k=c.distanceMm/l,a=-dy*k,b=-dx*k,d=-dy*k,e=dx*k;return `matrix(${a} ${b} ${e} ${d} ${-a*c.a.x-e*c.a.y} ${-b*c.a.x-d*c.a.y})`;
}
