type P={xMm:number;yMm:number};
type Edge={x:number;y:number;dx:number;dy:number;length2:number;loX:number;loY:number;hiX:number;hiY:number};
type Node={loX:number;loY:number;hiX:number;hiY:number;items?:number[];left?:Node;right?:Node};
/** Exact distances. The squared comparison only avoids hypot for an edge
 * that is separated from the current winner by a roundoff allowance. */
export function segmentDistanceIndex(points:readonly P[],closed:boolean){
 const count=Math.max(0,points.length-(closed?0:1)),edges:Edge[]=[];
 for(let i=0;i<count;i++){const a=points[i],b=points[(i+1)%points.length],dx=b.xMm-a.xMm,dy=b.yMm-a.yMm;edges.push({x:a.xMm,y:a.yMm,dx,dy,length2:dx*dx+dy*dy,loX:Math.min(a.xMm,b.xMm),loY:Math.min(a.yMm,b.yMm),hiX:Math.max(a.xMm,b.xMm),hiY:Math.max(a.yMm,b.yMm)});}
 const build=(ids:number[]):Node=>{let loX=Infinity,loY=Infinity,hiX=-Infinity,hiY=-Infinity;for(const id of ids){const e=edges[id];loX=Math.min(loX,e.loX);loY=Math.min(loY,e.loY);hiX=Math.max(hiX,e.hiX);hiY=Math.max(hiY,e.hiY);}const node:Node={loX,loY,hiX,hiY};if(ids.length<=8)node.items=ids;else{const x=hiX-loX>=hiY-loY;ids.sort((a,b)=>x?(edges[a].loX+edges[a].hiX)-(edges[b].loX+edges[b].hiX)||a-b:(edges[a].loY+edges[a].hiY)-(edges[b].loY+edges[b].hiY)||a-b);const middle=ids.length>>1;node.left=build(ids.slice(0,middle));node.right=build(ids.slice(middle));}return node;};
 const root=build(edges.map((_,i)=>i)),large=edges.some(e=>Math.max(Math.abs(e.x),Math.abs(e.y),Math.abs(e.dx),Math.abs(e.dy))>1e150),finite=edges.every(e=>[e.x,e.y,e.dx,e.dy].every(Number.isFinite));
 const stack:Node[]=[];let seed=-1,lastX=NaN,lastY=NaN,lastRadius=NaN,lastValue=Infinity;
 const overlaps=(b:Node|Edge,loX:number,loY:number,hiX:number,hiY:number)=>loX<=b.hiX&&b.loX<=hiX&&loY<=b.hiY&&b.loY<=hiY;
 const bound=(b:Node|Edge,x:number,y:number)=>Math.max(0,b.loX-x,x-b.hiX,b.loY-y,y-b.hiY);
 const distance=(e:Edge,x:number,y:number,best=Infinity)=>{const t=e.length2?Math.max(0,Math.min(1,((x-e.x)*e.dx+(y-e.y)*e.dy)/e.length2)):0,dx=x-e.x-t*e.dx,dy=y-e.y-t*e.dy,square=dx*dx+dy*dy,bestSquare=best*best;
  if(Number.isFinite(square)&&Number.isFinite(bestSquare)&&square>=2.2250738585072014e-308&&bestSquare>=2.2250738585072014e-308&&square>bestSquare+32*Number.EPSILON*Math.max(square,bestSquare))return Infinity;
  return Math.hypot(dx,dy);
 };
 return {nearest(p:P,radius=Infinity){
  const x=p.xMm,y=p.yMm,loX=x-radius,loY=y-radius,hiX=x+radius,hiY=y+radius;
  if(large||Math.max(Math.abs(x),Math.abs(y))>1e150){let result=Infinity;for(const e of edges)if(overlaps(e,loX,loY,hiX,hiY))result=Math.min(result,distance(e,x,y));return result;}
  const cacheable=finite&&Number.isFinite(x)&&Number.isFinite(y)&&!Number.isNaN(radius);
  if(cacheable&&Object.is(x,lastX)&&Object.is(y,lastY)&&Object.is(radius,lastRadius))return lastValue;
  let best=Infinity,bestId=-1;
  if(seed>=0&&overlaps(edges[seed],loX,loY,hiX,hiY)){best=distance(edges[seed],x,y);bestId=seed;}
  const slack=Number.EPSILON*32*Math.max(1,Math.abs(x),Math.abs(y),Math.abs(root.loX),Math.abs(root.loY),Math.abs(root.hiX),Math.abs(root.hiY));
  stack.length=0;stack.push(root);
  while(stack.length){const node=stack.pop()!;if(!overlaps(node,loX,loY,hiX,hiY)||bound(node,x,y)>best+slack)continue;
   if(node.items){for(const id of node.items){const e=edges[id];if(id===bestId||!overlaps(e,loX,loY,hiX,hiY)||bound(e,x,y)>best+slack)continue;const d=distance(e,x,y,best);if(d<best){best=d;bestId=id;}}}
   else{const a=node.left!,b=node.right!;if(bound(a,x,y)<=bound(b,x,y))stack.push(b,a);else stack.push(a,b);}
   if(cacheable&&best===0)break;
  }
  seed=bestId;if(cacheable){lastX=x;lastY=y;lastRadius=radius;lastValue=best;}return best;
 }};
}
