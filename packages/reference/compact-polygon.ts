import type {Point} from '../schema/index';

/** Recognize straight supports in a small antialiased boundary. Short rounded
 * pixel corners are intersected only when both adjacent straight sides have
 * independent samples. A rounded dot has no such sustained linear supports. */
export function compactPolygon(points:Point[],id:()=>string){
 const n=points.length,dist=(a:Point,b:Point)=>Math.hypot(a.xMm-b.xMm,a.yMm-b.yMm);
 if(n<9)return;
 const fit=(p:Point[])=>{
  const x=p.reduce((s,q)=>s+q.xMm,0)/p.length,y=p.reduce((s,q)=>s+q.yMm,0)/p.length;
  let xx=0,xy=0,yy=0;for(const q of p){xx+=(q.xMm-x)**2;xy+=(q.xMm-x)*(q.yMm-y);yy+=(q.yMm-y)**2;}
  const angle=.5*Math.atan2(2*xy,xx-yy),nx=-Math.sin(angle),ny=Math.cos(angle),d=nx*x+ny*y;
  return {nx,ny,d,error:Math.max(...p.map(q=>Math.abs(nx*q.xMm+ny*q.yMm-d)))};
 };
 const candidates:{start:number;end:number;length:number;nx:number;ny:number;d:number}[]=[];
 for(let i=0;i<n;i++){
  const span=[points[i]];let last:typeof candidates[number]|undefined;
  for(let count=1;count<n/2;count++){
   span.push(points[(i+count)%n]);const line=fit(span);
   if(line.error>.10)break;
   const length=dist(span[0],span.at(-1)!);
   if(span.length>=4&&length>=3.5)last={start:i,end:i+count,length,...line};
  }
  if(last)candidates.push(last);
 }
 const selected:typeof candidates=[];
 for(const c of candidates.sort((a,b)=>b.length-a.length)){
  if(selected.some(v=>[0,n,-n].some(shift=>Math.min(c.end,v.end+shift)-Math.max(c.start,v.start+shift)>1)))continue;
  selected.push(c);
 }
 selected.sort((a,b)=>a.start-b.start);
 if(selected.length<3||selected.length>16)return;
 const nodes:Point[]=[];
 for(let i=0;i<selected.length;i++){
  const a=selected[(i+selected.length-1)%selected.length],b=selected[i],det=a.nx*b.ny-a.ny*b.nx;
  if(Math.abs(det)<.2)return;
  const p={id:id(),xMm:(a.d*b.ny-a.ny*b.d)/det,yMm:(a.nx*b.d-a.d*b.nx)/det};
  if(Math.min(...points.map(q=>dist(p,q)))>1.5)return;
  nodes.push(p);
 }
 const segment=(p:Point,a:Point,b:Point)=>{const x=b.xMm-a.xMm,y=b.yMm-a.yMm,t=Math.max(0,Math.min(1,((p.xMm-a.xMm)*x+(p.yMm-a.yMm)*y)/(x*x+y*y||1)));return Math.hypot(p.xMm-a.xMm-t*x,p.yMm-a.yMm-t*y);};
 if(points.some(p=>Math.min(...nodes.map((a,i)=>segment(p,a,nodes[(i+1)%nodes.length])))>.65))return;
 for(let i=0;i<nodes.length;i++){const a=nodes[i],b=nodes[(i+1)%nodes.length];for(let k=0;k<=20;k++){const p={...a,xMm:a.xMm+(b.xMm-a.xMm)*k/20,yMm:a.yMm+(b.yMm-a.yMm)*k/20};if(Math.min(...points.map((q,j)=>segment(p,q,points[(j+1)%n])))>1.25)return;}}
 return nodes;
}
