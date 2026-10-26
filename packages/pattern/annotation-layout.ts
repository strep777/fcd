import type {Piece} from '../schema/index';
import {edgeArcPoints} from './edit';
type Point={xMm:number;yMm:number};

/** Fit an axis-aligned rectangle to the cloth, including all holes. Scaled
 * L-infinity distance certifies its complete boundary, not just its anchor. */
export function interiorRectangle(outer:Point[],holes:Point[][],width:number,height:number){
 if(outer.length<3||width<=0||height<=0)return{xMm:0,yMm:0,widthMm:0,heightMm:0};
 const rings=[outer,...holes].map(r=>r.map(p=>[p.xMm/width,p.yMm/height])),edges=rings.flatMap(r=>r.map((a,i)=>[a,r[(i+1)%r.length]]));
 const xs=rings[0].map(p=>p[0]),ys=rings[0].map(p=>p[1]),minX=Math.min(...xs),maxX=Math.max(...xs),minY=Math.min(...ys),maxY=Math.max(...ys);
 type Tree={minX:number;minY:number;maxX:number;maxY:number;edges?:typeof edges;left?:Tree;right?:Tree};
 const tree=(rows:typeof edges):Tree=>{const points=rows.flat(),x=points.map(p=>p[0]),y=points.map(p=>p[1]),box={minX:Math.min(...x),maxX:Math.max(...x),minY:Math.min(...y),maxY:Math.max(...y)};
  if(rows.length<=8)return{...box,edges:rows};const axis=box.maxX-box.minX>box.maxY-box.minY?0:1;rows.sort((a,b)=>a[0][axis]+a[1][axis]-b[0][axis]-b[1][axis]);const mid=rows.length>>1;return{...box,left:tree(rows.slice(0,mid)),right:tree(rows.slice(mid))};};
 const root=tree(edges);
 // Both queries use exact segments. The tree only skips boxes that cannot
 // intersect the ray or improve the closest boundary distance.
 const distance=(x:number,y:number)=>{let inside=false,d=Infinity;
  const crossing=(node:Tree)=>{if(y<node.minY||y>=node.maxY||x>=node.maxX)return;if(node.edges){for(const [a,b]of node.edges)if((a[1]>y)!==(b[1]>y)&&x<(b[0]-a[0])*(y-a[1])/(b[1]-a[1])+a[0])inside=!inside;}else{crossing(node.left!);crossing(node.right!);}};
  const bound=(node:Tree)=>Math.max(0,node.minX-x,x-node.maxX,node.minY-y,y-node.maxY);
  const nearest=(node:Tree)=>{if(bound(node)>=d)return;if(node.edges){for(const [a,b]of node.edges){const u=a[0]-x,v=a[1]-y,dx=b[0]-a[0],dy=b[1]-a[1];d=Math.min(d,Math.max(Math.abs(u),Math.abs(v)),Math.max(Math.abs(u+dx),Math.abs(v+dy)));
   const sample=(n:number,den:number)=>{if(den===0)return;const t=n/den;if(t>0&&t<1)d=Math.min(d,Math.max(Math.abs(u+t*dx),Math.abs(v+t*dy)));};sample(-u,dx);sample(-v,dy);sample(v-u,dx-dy);sample(-v-u,dx+dy);
  }}else{const a=node.left!,b=node.right!;if(bound(a)<bound(b)){nearest(a);nearest(b);}else{nearest(b);nearest(a);}}};
  crossing(root);nearest(root);return inside?d:-d;
 };
 type Cell={x:number;y:number;hx:number;hy:number;d:number;upper:number};
 const cell=(x:number,y:number,hx:number,hy:number):Cell=>{const d=distance(x,y);return{x,y,hx,hy,d,upper:d+Math.max(hx,hy)};};
 const first=cell((minX+maxX)/2,(minY+maxY)/2,(maxX-minX)/2,(maxY-minY)/2),queue=[first];let best=first;
 const push=(c:Cell)=>{let i=queue.length;queue.push(c);while(i>0){const parent=(i-1)>>1;if(queue[parent].upper>=c.upper)break;queue[i]=queue[parent];i=parent;}queue[i]=c;};
 const pop=()=>{const first=queue[0],last=queue.pop()!;if(queue.length){let i=0;while(i*2+1<queue.length){let child=i*2+1;if(child+1<queue.length&&queue[child+1].upper>queue[child].upper)child++;if(queue[child].upper<=last.upper)break;queue[i]=queue[child];i=child;}queue[i]=last;}return first;};
 const tolerance=Math.max(1e-7,Math.min(maxX-minX,maxY-minY)*.002);
 for(let iterations=0;queue.length&&iterations<4096;iterations++){
  const c=pop();if(c.d>best.d)best=c;if(c.upper-best.d<=tolerance)continue;
  if(c.hx>=c.hy){const h=c.hx/2;push(cell(c.x-h,c.y,h,c.hy));push(cell(c.x+h,c.y,h,c.hy));}else{const h=c.hy/2;push(cell(c.x,c.y-h,c.hx,h));push(cell(c.x,c.y+h,c.hx,h));}
 }
 return{xMm:best.x*width,yMm:best.y*height,widthMm:Math.max(0,2*best.d*width),heightMm:Math.max(0,2*best.d*height)};
}

export function patternAnnotationLayout(piece:Piece,outer?:Point[],holes:Point[][]=piece.holes??[]){
 if(!piece.closed||piece.nodes.length<3)return{caption:[],arrows:[],box:{xMm:0,yMm:0,widthMm:0,heightMm:0},fontSizeMm:0};
 outer??=piece.curves?.length?piece.nodes.flatMap(n=>edgeArcPoints(piece,n.id).slice(0,-1)):piece.nodes;
 const chars=Array.from(piece.name||'—'),same=piece.grainRad!==undefined&&Math.abs(Math.atan2(Math.sin(piece.grainRad-piece.furRad),Math.cos(piece.grainRad-piece.furRad)))<1e-6;
 const directions=[{kind:'fur' as const,angle:piece.furRad,text:same?'毛向 / 布向':'毛向'},...(piece.grainRad!==undefined&&!same?[{kind:'grain' as const,angle:piece.grainRad,text:'布向'}]:[])];
 let best:{box:ReturnType<typeof interiorRectangle>;lines:string[];font:number;width:number;height:number}|undefined;
 for(const columns of new Set([Math.min(chars.length,8),Math.min(chars.length,16),chars.length])){
  const lines=Array.from({length:Math.ceil(chars.length/columns)},(_,i)=>chars.slice(i*columns,(i+1)*columns).join('')),width=Math.max(6,...lines.map(s=>Array.from(s).length)),height=lines.length*1.3+directions.length*4.5+.4;
  const box=interiorRectangle(outer,holes,width,height),font=box.widthMm/width*.8;
  if(!best||font>best.font)best={box,lines,font,width,height};
 }
 const {box,lines,font,width,height}=best!,top=box.yMm+height*font/2,caption=lines.map((text,i)=>({text,xMm:box.xMm,yMm:top-(i+1)*1.3*font,fontSizeMm:font,widthMm:Array.from(text).length*font}));
 const arrows=directions.map((d,i)=>{
  const center={xMm:box.xMm,yMm:top-(lines.length*1.3+.4+i*4.5+2)*font},c=Math.cos(d.angle),s=Math.sin(d.angle),length=Math.min((width-.4)/(Math.abs(c)+.3*Math.abs(s)),2.5/(Math.abs(s)+.3*Math.abs(c)))*font;
  const at=(u:number,v:number)=>({xMm:center.xMm+(u*c-v*s)*length,yMm:center.yMm+(u*s+v*c)*length});
  return{...d,points:[at(-.5,0),at(.5,0),at(.25,.15),at(.5,0),at(.25,-.15)],label:{text:d.text,xMm:center.xMm,yMm:top-(lines.length*1.3+.4+i*4.5+4.15)*font,fontSizeMm:font*.7,widthMm:d.text.length*font*.7}};
 });
 return{caption,arrows,box:{xMm:box.xMm,yMm:box.yMm,widthMm:width*font,heightMm:height*font},fontSizeMm:font};
}
