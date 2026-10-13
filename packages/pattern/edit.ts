import type {Piece,Point} from '../schema/index';
import {derivedName} from '../schema/names';
type XY={xMm:number;yMm:number};
/** All embedded coordinates share one transform, including holes, control handles and labels. */
export function mapPiece(piece:Piece,transform:(p:XY)=>XY):Piece{
 const map=(p:Point)=>({...p,...transform(p)});
 return {...piece,nodes:piece.nodes.map(map),holes:piece.holes?.map(h=>h.map(map)),curves:piece.curves?.map(c=>({...c,c1:map(c.c1),c2:map(c.c2)})),labels:piece.labels?.map(l=>({...l,...transform(l)}))};
}
export function moveNode(piece:Piece,id:string,xMm:number,yMm:number):Piece{
 const source=[...piece.nodes,...(piece.holes??[]).flat()].find(n=>n.id===id);if(!source)return piece;const dx=xMm-source.xMm,dy=yMm-source.yMm;
 const shift=(p:Point)=>({...p,xMm:p.xMm+dx,yMm:p.yMm+dy});
 return {...piece,nodes:piece.nodes.map(n=>n.id===id?{...n,xMm,yMm}:n),holes:piece.holes?.map(r=>r.map(n=>n.id===id?{...n,xMm,yMm}:n)),curves:piece.curves?.map(c=>({...c,c1:c.startNodeId===id?shift(c.c1):c.c1,c2:c.endNodeId===id?shift(c.c2):c.c2}))};
}
export function duplicatePiece(piece:Piece,dx=30,dy=-30):Piece{
 const p=mapPiece(piece,n=>({xMm:n.xMm+dx,yMm:n.yMm+dy})),ids=new Map([...piece.nodes,...(piece.holes??[]).flat()].map(n=>[n.id,crypto.randomUUID()]));
 return {...p,id:crypto.randomUUID(),name:derivedName(p.name,' copy'),nodes:p.nodes.map(n=>({...n,id:ids.get(n.id)!})),holes:p.holes?.map(h=>h.map(n=>({...n,id:ids.get(n.id)!}))),curves:p.curves?.map(c=>({...c,id:crypto.randomUUID(),startNodeId:ids.get(c.startNodeId)!,endNodeId:ids.get(c.endNodeId)!,c1:{...c.c1,id:crypto.randomUUID()},c2:{...c.c2,id:crypto.randomUUID()}})),edgeAllowances:p.edgeAllowances?.map(e=>({...e,nodeId:ids.get(e.nodeId)!,endNodeId:ids.get(e.endNodeId)!})),notches:p.notches?.map(({sourceSeamId,...n})=>({...n,id:crypto.randomUUID(),nodeId:ids.get(n.nodeId)!})),labels:p.labels?.map(l=>({...l,id:crypto.randomUUID()}))};
}
export function piecePath(piece:Piece):string{
 const curves=new Map(piece.curves?.map(c=>[c.startNodeId+':'+c.endNodeId,c]));
 const path=piece.nodes.map((n,i)=>{
  if(!i)return `M${n.xMm},${-n.yMm}`;
  const curve=curves.get(piece.nodes[i-1].id+':'+n.id);
  return curve?`C${curve.c1.xMm},${-curve.c1.yMm} ${curve.c2.xMm},${-curve.c2.yMm} ${n.xMm},${-n.yMm}`:`L${n.xMm},${-n.yMm}`;
 }).join(' ');
 const a=piece.nodes.at(-1),b=piece.nodes[0],closing=curves.get(a?.id+':'+b?.id);
 return path+(!piece.closed?'':(closing?` C${closing.c1.xMm},${-closing.c1.yMm} ${closing.c2.xMm},${-closing.c2.yMm} ${b.xMm},${-b.yMm}`:'')+' Z')+(piece.holes??[]).map(h=>h.map((p,i)=>`${i?'L':'M'}${p.xMm},${-p.yMm}`).join(' ')+' Z').join(' ');
}
/** Mirrors the core's 0.01 mm chord budget for arc-length remapping during exact Bezier splitting. */
export function edgeArcPoints(piece:Piece,nodeId:string):XY[]{const i=piece.nodes.findIndex(n=>n.id===nodeId);if(i<0)throw Error('ENTITY_MISSING');if(!piece.closed&&i===piece.nodes.length-1)throw Error('INVALID_EDGE');const a=piece.nodes[i],b=piece.nodes[(i+1)%piece.nodes.length],c=piece.curves?.find(c=>c.startNodeId===nodeId),out:XY[]=[a];if(!c)return [a,b];const midpoint=(a:XY,b:XY)=>({xMm:(a.xMm+b.xMm)/2,yMm:(a.yMm+b.yMm)/2}),distance=(p:XY,a:XY,b:XY)=>{const dx=b.xMm-a.xMm,dy=b.yMm-a.yMm,l=dx*dx+dy*dy,t=l?Math.max(0,Math.min(1,((p.xMm-a.xMm)*dx+(p.yMm-a.yMm)*dy)/l)):0;return Math.hypot(p.xMm-a.xMm-t*dx,p.yMm-a.yMm-t*dy);};const flatten=(a:XY,c1:XY,c2:XY,b:XY,depth=0)=>{if(out.length>=2000||depth>24)throw Error('RESOURCE_LIMIT');if(Math.max(distance(c1,a,b),distance(c2,a,b))<=.01){out.push(b);return;}const p=midpoint(a,c1),q=midpoint(c1,c2),r=midpoint(c2,b),s=midpoint(p,q),u=midpoint(q,r),m=midpoint(s,u);flatten(a,p,s,m,depth+1);flatten(m,u,r,b,depth+1);};flatten(a,c.c1,c.c2,b);return out;}
export function splitEdge(piece:Piece,nodeId:string,t=.5):Piece{
 if(t<=0||t>=1||!Number.isFinite(t))throw new Error('INVALID_SPLIT');const i=piece.nodes.findIndex(n=>n.id===nodeId);if(i<0)throw new Error('ENTITY_MISSING');if(!piece.closed&&i===piece.nodes.length-1)throw new Error('INVALID_EDGE');const a=piece.nodes[i],b=piece.nodes[(i+1)%piece.nodes.length],curve=piece.curves?.find(c=>c.startNodeId===a.id),point=(p:XY):Point=>({id:crypto.randomUUID(),...p}),mix=(a:XY,b:XY):XY=>({xMm:a.xMm+(b.xMm-a.xMm)*t,yMm:a.yMm+(b.yMm-a.yMm)*t});
 let inserted:Point,curves=piece.curves?.filter(c=>c.startNodeId!==a.id)??[];
 if(curve){const p=mix(a,curve.c1),q=mix(curve.c1,curve.c2),r=mix(curve.c2,b),s=mix(p,q),u=mix(q,r);inserted=point(mix(s,u));curves.push({...curve,endNodeId:inserted.id,c1:point(p),c2:point(s)},{id:crypto.randomUUID(),startNodeId:inserted.id,endNodeId:b.id,c1:point(u),c2:point(r)});}
 else inserted=point(mix(a,b));const nodes=[...piece.nodes];nodes.splice(i+1,0,inserted);
 const updated={...piece,nodes,curves},length=(path:XY[])=>path.slice(1).reduce((s,v,i)=>s+Math.hypot(v.xMm-path[i].xMm,v.yMm-path[i].yMm),0),leftLength=length(edgeArcPoints(updated,a.id)),rightLength=length(edgeArcPoints(updated,inserted.id)),fraction=leftLength/(leftLength+rightLength),allowances=piece.edgeAllowances?.flatMap(e=>{if(e.nodeId!==a.id)return [e];const width=(s:number)=>{const i=e.samples.findIndex((v,i)=>i>0&&s<=v.s),v=e.samples[Math.max(1,i)],p=e.samples[Math.max(1,i)-1];return p.widthMm+(v.widthMm-p.widthMm)*(s-p.s)/(v.s-p.s);};const splitWidth=width(fraction);return [{nodeId:a.id,endNodeId:inserted.id,samples:[...e.samples.filter(v=>v.s<fraction).map(v=>({...v,s:v.s/fraction})),{s:1,widthMm:splitWidth}]},{nodeId:inserted.id,endNodeId:b.id,samples:[{s:0,widthMm:splitWidth},...e.samples.filter(v=>v.s>fraction).map(v=>({...v,s:(v.s-fraction)/(1-fraction)}))]}];});
 return {...updated,edgeAllowances:allowances,notches:piece.notches?.map(n=>n.nodeId!==a.id?n:n.position<=fraction?{...n,position:n.position/fraction}:{...n,nodeId:inserted.id,position:(n.position-fraction)/(1-fraction)})};
}

/** Constant stack usage for full-project framing, including dense cut contours. */
export function pointBounds(points:Iterable<XY>){
 let minX=Infinity,maxX=-Infinity,minY=Infinity,maxY=-Infinity;
 for(const p of points){minX=Math.min(minX,p.xMm);maxX=Math.max(maxX,p.xMm);minY=Math.min(minY,p.yMm);maxY=Math.max(maxY,p.yMm);}
 return {minX,maxX,minY,maxY};
}
