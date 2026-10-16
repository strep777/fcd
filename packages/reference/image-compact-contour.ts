import type {Point} from '../schema/index';

/** Trace the half-coverage isophote of a small, high-contrast painted island.
 * Pixel values, rather than the thresholded mask's staircase normals, locate
 * every crossing. Ambiguous cells or multiple compatible loops reject it. */
export function compactSourceBoundary(raw:Point[],width:number,height:number,rgba:Uint8Array,createId:()=>string){
 if(raw.length<6||raw.length>40000||raw.some(p=>!Number.isFinite(p.xMm)||!Number.isFinite(p.yMm)))return;
 const x0=Math.floor(Math.min(...raw.map(p=>p.xMm)))-2,x1=Math.ceil(Math.max(...raw.map(p=>p.xMm)))+2,y0=Math.floor(Math.min(...raw.map(p=>p.yMm)))-2,y1=Math.ceil(Math.max(...raw.map(p=>p.yMm)))+2;
 if(x0<0||y0<0||x1>=width||y1>=height||x1-x0>28||y1-y0>28)return;
 const inside=(x:number,y:number)=>{let hit=false;for(let i=0,j=raw.length-1;i<raw.length;j=i++){const a=raw[i],b=raw[j];if((a.yMm>y)!==(b.yMm>y)&&x<(b.xMm-a.xMm)*(y-a.yMm)/(b.yMm-a.yMm)+a.xMm)hit=!hit;}return hit;};
 const inner:number[]=[],outer:number[]=[],value=(i:number)=>Math.max(rgba[4*i],rgba[4*i+1],rgba[4*i+2]);
 for(let y=y0;y<=y1;y++)for(let x=x0;x<=x1;x++){const i=y*width+x;if(rgba[4*i+3]!==255)return;(inside(x+.5,y+.5)?inner:outer).push(i);}
 if(inner.length<4||inner.length>256||outer.filter(i=>value(i)<80).length<outer.length*.3)return;
 inner.sort((a,b)=>value(b)-value(a));const light=inner.slice(0,Math.max(1,Math.ceil(inner.length*.2))),dark=outer.filter(i=>value(i)<80);
 const mean=(ids:number[])=>[0,1,2].map(c=>ids.reduce((s,i)=>s+rgba[4*i+c],0)/ids.length),a=mean(light),b=mean(dark),d=a.map((v,c)=>v-b[c]),norm=d.reduce((s,v)=>s+v*v,0);
 if(norm<180**2)return;
 const field=(x:number,y:number)=>d.reduce((s,v,c)=>s+(rgba[4*(y*width+x)+c]-b[c])*v,0)/norm-.5;
 const points=new Map<string,Point>(),adjacency=new Map<string,string[]>();
 const link=(key:string,other:string)=>{const list=adjacency.get(key)??[];list.push(other);adjacency.set(key,list);};
 for(let y=y0;y<y1;y++)for(let x=x0;x<x1;x++){
  const corners=[[x,y],[x+1,y],[x+1,y+1],[x,y+1]],values=corners.map(([xx,yy])=>field(xx,yy)),crossings:string[]=[];
  for(let e=0;e<4;e++){const f=(e+1)%4,u=values[e],v=values[f];if((u>=0)===(v>=0))continue;const p=corners[e],q=corners[f],key=e===0?`h${x},${y}`:e===1?`v${x+1},${y}`:e===2?`h${x},${y+1}`:`v${x},${y}`,t=u/(u-v);crossings.push(key);points.set(key,{id:createId(),xMm:p[0]+.5+t*(q[0]-p[0]),yMm:p[1]+.5+t*(q[1]-p[1])});}
  if(crossings.length===4)return;
  if(crossings.length===2){link(crossings[0],crossings[1]);link(crossings[1],crossings[0]);}
 }
 if(points.size<8)return;
 const pending=new Set(points.keys()),loops:Point[][]=[];
 while(pending.size){const first=pending.values().next().value!,ring:Point[]=[];let previous='',current=first,closed=false;
  for(let guard=0;guard<=points.size;guard++){if(!pending.delete(current))break;ring.push(points.get(current)!);const next=adjacency.get(current)?.find(k=>k!==previous);if(next===undefined)break;previous=current;current=next;if(current===first){closed=true;break;}}
  if(closed&&ring.length>=8){const cx=ring.reduce((s,p)=>s+p.xMm,0)/ring.length,cy=ring.reduce((s,p)=>s+p.yMm,0)/ring.length;if(inside(cx,cy))loops.push(ring);}
 }
 if(loops.length!==1)return;const ring=loops[0];
 const area=(p:Point[])=>p.reduce((s,a,i)=>{const b=p[(i+1)%p.length];return s+a.xMm*b.yMm-a.yMm*b.xMm;},0);
 if(area(ring)*area(raw)<0)ring.reverse();
 // The derivative comes from the source intensity field. It is fitting data,
 // not a tangent adjustment applied after the path has been constructed.
 const intensity=(x:number,y:number)=>{const xx=x-.5,yy=y-.5,ix=Math.floor(xx),iy=Math.floor(yy),tx=xx-ix,ty=yy-iy;return field(ix,iy)*(1-tx)*(1-ty)+field(ix+1,iy)*tx*(1-ty)+field(ix,iy+1)*(1-tx)*ty+field(ix+1,iy+1)*tx*ty;};
 const tangents=new Map<string,{xMm:number;yMm:number}>();
 ring.forEach((p,i)=>{const gx=intensity(p.xMm+.5,p.yMm)-intensity(p.xMm-.5,p.yMm),gy=intensity(p.xMm,p.yMm+.5)-intensity(p.xMm,p.yMm-.5),n=Math.hypot(gx,gy),a=ring[(i+ring.length-1)%ring.length],b=ring[(i+1)%ring.length],sign=-gy*(b.xMm-a.xMm)+gx*(b.yMm-a.yMm)>=0?1:-1;if(n>.05)tangents.set(p.id,{xMm:-gy/n*sign,yMm:gx/n*sign});});
 return{points:ring,tangents};
}
