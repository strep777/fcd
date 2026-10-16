import {expect,it} from 'vitest';
import {randomUUID} from 'node:crypto';
import {illustrationRegions,pigmentFamily} from '../../packages/reference/illustration';
import {traceMask} from '../../apps/desktop/main/reference-segmentation';
import {recoverSharedContours} from '../../packages/reference/shared-contour';
import type {Piece,Point} from '../../packages/schema/index';

type XY={x:number;y:number};
const polygon:XY[]=[{x:56.3,y:10.2},{x:94.1,y:96.4},{x:50.2,y:78.1},{x:20.4,y:96.4}];
const inside=(x:number,y:number)=>{let result=false;for(let i=0,j=polygon.length-1;i<polygon.length;j=i++){const a=polygon[i],b=polygon[j];if((a.y>y)!==(b.y>y)&&x<(b.x-a.x)*(y-a.y)/(b.y-a.y)+a.x)result=!result;}return result;};
const angle=(a:XY,b:XY)=>Math.abs(Math.atan2(a.x*b.y-a.y*b.x,a.x*b.x+a.y*b.y));
function turnAt(piece:Piece,id:string){const i=piece.nodes.findIndex(n=>n.id===id),p=piece.nodes[i],a=piece.curves?.find(c=>c.endNodeId===id)?.c2??piece.nodes[(i+piece.nodes.length-1)%piece.nodes.length],b=piece.curves?.find(c=>c.startNodeId===id)?.c1??piece.nodes[(i+1)%piece.nodes.length];return angle({x:p.xMm-a.xMm,y:p.yMm-a.yMm},{x:b.xMm-p.xMm,y:b.yMm-p.yMm});}

it.each([.05,1,10].flatMap(scale=>[0,.37].map(rotation=>({scale,rotation}))))('the original antialiased image keeps its analytic acute apex and concave corner at scale $scale rotation $rotation',({scale,rotation})=>{
 const width=112,height=112,rgba=new Uint8Array(width*height*4),colors=[[237,231,234],[249,227,60]],aa=8;
 // Render the known source polygon before any classification or tracing.
 // Its corner coordinates and headings are the oracle, not a raw node ID,
 // retained raster vertex, detector flag, or fitted curve.
 for(let y=0;y<height;y++)for(let x=0;x<width;x++){
  const sum=[0,0,0];for(let dy=0;dy<aa;dy++)for(let dx=0;dx<aa;dx++){const rgb=colors[inside(x+(dx+.5)/aa,y+(dy+.5)/aa)?1:0];for(let c=0;c<3;c++)sum[c]+=rgb[c]/(aa*aa);}
  rgba.set([...sum.map(Math.round),255],(y*width+x)*4);
 }
 const classified=illustrationRegions(width,height,rgba,false,'head'),transform=(p:Point)=>({...p,xMm:1000+scale*(p.xMm*Math.cos(rotation)-p.yMm*Math.sin(rotation)),yMm:-1000+scale*(p.xMm*Math.sin(rotation)+p.yMm*Math.cos(rotation))}),raw=classified.regions.map(r=>{const mask=new Uint8Array(width*height);r.indices.forEach(i=>mask[i]=1);const piece=traceMask(width,height,mask,{a:{x:0,y:height},b:{x:0,y:0},distanceMm:height},width,height,r.color,true).piece;return {...piece,nodes:piece.nodes.map(transform),holes:piece.holes?.map(h=>h.map(transform))};}),pieces=recoverSharedContours(raw,.8*scale,randomUUID).pieces,target=pieces.filter(p=>pigmentFamily(p.color!)===2);
 expect(target).toHaveLength(1);
 for(const i of [0,2]){
  const corner=polygon[i],before=polygon[(i+polygon.length-1)%polygon.length],after=polygon[(i+1)%polygon.length],sourceTurn=angle({x:corner.x-before.x,y:corner.y-before.y},{x:after.x-corner.x,y:after.y-corner.y}),point=transform({id:'oracle',xMm:corner.x,yMm:height-corner.y});
  const near=target[0].nodes.filter(n=>Math.hypot(n.xMm-point.xMm,n.yMm-point.yMm)<=(Math.SQRT1_2+1.05)*scale);
  expect(near.length,JSON.stringify({corner,scale,rotation})).toBeGreaterThan(0);
  // Even allowing the half-pixel diagonal and the 1.05px fit envelope at
  // 8px of source support on each straight side, a true corner retains a
  // nonzero heading change. A forced continuous join would fail this test.
  const uncertainty=2*Math.asin((Math.SQRT1_2+1.05)/8);
  expect(Math.max(...near.map(n=>turnAt(target[0],n.id))),JSON.stringify({corner,sourceTurn,scale,rotation})).toBeGreaterThanOrEqual(sourceTurn-uncertainty);
 }
});
