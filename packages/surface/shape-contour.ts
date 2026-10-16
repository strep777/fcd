import type {Marking,Piece} from '../schema/index';
import {edgeArcPoints,moveNode,splitEdge} from '../pattern/edit';
import {surfaceSpline} from './spline';

type Shape=NonNullable<Marking['surfaceShape']>;
type Point={xMm:number;yMm:number};
export type ShapeContour=Pick<Shape,'nodes'|'holes'|'curves'|'spline'>;
const xy=(p:Point):Point=>({xMm:p.xMm,yMm:p.yMm});

/** Persist editable Bézier controls, not their potentially thousands of derived
 * samples. The ordinary 2000 editable-node limit remains unchanged. */
export function pieceContour(piece:Piece):ShapeContour{
 const indices=new Map(piece.nodes.map((n,i)=>[n.id,i])),seen=new Set<number>();
 const curves=piece.curves?.map(c=>{const startIndex=indices.get(c.startNodeId);if(startIndex===undefined||piece.nodes[(startIndex+1)%piece.nodes.length].id!==c.endNodeId||seen.has(startIndex))throw Error('INVALID_GEOMETRY');seen.add(startIndex);return {startIndex,c1:xy(c.c1),c2:xy(c.c2)};});
 return {nodes:piece.nodes.map(xy),...(piece.holes?.length?{holes:piece.holes.map(r=>r.map(xy))}:{}),...(curves?.length?{curves}:{} )};
}
export function contourPiece(shape:ShapeContour,createId:()=>string=()=>crypto.randomUUID()):Piece{
 const nodes=shape.nodes.map(p=>({...p,id:createId()})),seen=new Set<number>();
 if(shape.spline&&shape.curves?.length)throw Error('INVALID_GEOMETRY');
 const curves=shape.curves?.map(c=>{if(!Number.isInteger(c.startIndex)||c.startIndex<0||c.startIndex>=nodes.length||seen.has(c.startIndex)||![c.c1.xMm,c.c1.yMm,c.c2.xMm,c.c2.yMm].every(Number.isFinite))throw Error('INVALID_GEOMETRY');seen.add(c.startIndex);return {id:createId(),startNodeId:nodes[c.startIndex].id,endNodeId:nodes[(c.startIndex+1)%nodes.length].id,c1:{...c.c1,id:createId()},c2:{...c.c2,id:createId()}};});
 return {id:createId(),name:'Surface contour',nodes,holes:shape.holes?.map(r=>r.map(p=>({...p,id:createId()}))),curves,closed:true,allowanceMm:0,cutQty:1,mirror:false,material:'Surface',furRad:0,color:'#ffffff'};
}
export function sampleShapeContour(shape:ShapeContour):Point[]{
 if(shape.spline)return surfaceSpline(shape.nodes,shape.spline.tension,shape.spline.toleranceMm);
 if(!shape.curves?.length)return shape.nodes;
 let id=0;const piece=contourPiece(shape,()=>String(id++)),result:Point[]=[];
 for(const node of piece.nodes){const points=edgeArcPoints(piece,node.id);if(result.length+points.length-1>200000)throw Error('RESOURCE_LIMIT');result.push(...points.slice(0,-1).map(xy));}
 return result;
}
export function mapShapeContour<T extends ShapeContour>(shape:T,map:(p:Point)=>Point):T{
 return {...shape,nodes:shape.nodes.map(map),...(shape.holes?{holes:shape.holes.map(r=>r.map(map))}:{}),...(shape.curves?{curves:shape.curves.map(c=>({...c,c1:map(c.c1),c2:map(c.c2)}))}:{})};
}
export function moveContourNode(shape:ShapeContour,index:number,p:Point):ShapeContour{
 let id=0;const piece=contourPiece(shape,()=>String(id++));if(!piece.nodes[index])throw Error('ENTITY_MISSING');
 return pieceContour(moveNode(piece,piece.nodes[index].id,p.xMm,p.yMm));
}
/** Inserting a control knot subdivides its curve exactly by de Casteljau. */
export function splitContourEdge(shape:ShapeContour,index:number,t:number):ShapeContour{
 let id=0;const piece=contourPiece(shape,()=>String(id++));return pieceContour(splitEdge(piece,piece.nodes[index].id,Math.max(.001,Math.min(.999,t))));
}
export function deleteContourNode(shape:ShapeContour,index:number):ShapeContour{
 const count=shape.nodes.length;if(count<=3)return shape;const previous=(index+count-1)%count;
 return {...shape,nodes:shape.nodes.filter((_,i)=>i!==index),curves:shape.curves?.filter(c=>c.startIndex!==index&&c.startIndex!==previous).map(c=>({...c,startIndex:c.startIndex>index?c.startIndex-1:c.startIndex}))};
}
export function nearestContourEdge(shape:ShapeContour,p:Point){
 const curves=new Map(shape.curves?.map(c=>[c.startIndex,c]));let best={index:-1,t:0,distance:Infinity};
 for(let i=0;i<shape.nodes.length;i++){
  const a=shape.nodes[i],b=shape.nodes[(i+1)%shape.nodes.length],c=curves.get(i);
  const at=(t:number)=>{if(!c)return {xMm:a.xMm+(b.xMm-a.xMm)*t,yMm:a.yMm+(b.yMm-a.yMm)*t};const s=1-t;return {xMm:s*s*s*a.xMm+3*s*s*t*c.c1.xMm+3*s*t*t*c.c2.xMm+t*t*t*b.xMm,yMm:s*s*s*a.yMm+3*s*s*t*c.c1.yMm+3*s*t*t*c.c2.yMm+t*t*t*b.yMm};};
  const distance=(t:number)=>{const q=at(t);return Math.hypot(p.xMm-q.xMm,p.yMm-q.yMm);};
  let t=0;
  if(c){for(let j=1;j<=32;j++)if(distance(j/32)<distance(t))t=j/32;let low=Math.max(0,t-1/32),high=Math.min(1,t+1/32);for(let j=0;j<24;j++){const x=low+(high-low)/3,y=high-(high-low)/3;if(distance(x)<distance(y))high=y;else low=x;}t=(low+high)/2;}
  else{const dx=b.xMm-a.xMm,dy=b.yMm-a.yMm;t=Math.max(0,Math.min(1,((p.xMm-a.xMm)*dx+(p.yMm-a.yMm)*dy)/(dx*dx+dy*dy)||0));}
  const d=distance(t);if(d<best.distance)best={index:i,t,distance:d};
 }
 return best;
}
