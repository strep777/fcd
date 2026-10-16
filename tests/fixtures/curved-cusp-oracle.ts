import type {Case,XY} from './curved-cusp-source';
export type Primitive={a:XY;b:XY}|{center:XY;radius:number;start:number;end:number};
const tau=2*Math.PI,point=(x:number,y:number):XY=>({x,y});
export function sourceBoundary(c:Case){
 const circle=(radius:number):Primitive=>({center:point(c.cx,c.cy),radius,start:0,end:tau}),line=(x:number,y:number,u:number,v:number):Primitive=>({a:point(x,y),b:point(u,v)});
 let rings:Primitive[][],area:number;
 if(c.kind==='crescent'){
  const {R}=c,r=c.r!,d=c.d!,k=(R*R-r*r+d*d)/(2*d),a=Math.acos(k/R),b=Math.acos((k-d)/r),lens=R*R*Math.acos((d*d+R*R-r*r)/(2*d*R))+r*r*Math.acos((d*d+r*r-R*R)/(2*d*r))-.5*Math.sqrt((-d+R+r)*(d+R-r)*(d-R+r)*(d+R+r));
  rings=[[{center:point(c.cx,c.cy),radius:R,start:a,end:tau-a},{center:point(c.cx+d,c.cy),radius:r,start:b,end:tau-b}]];area=Math.PI*R*R-lens;
 }else if(c.kind==='stadium'){
  const a=c.cx-c.d!,b=c.cx+c.d!,r=c.R;rings=[[line(a,c.cy-r,b,c.cy-r),{center:point(b,c.cy),radius:r,start:-Math.PI/2,end:Math.PI/2},line(b,c.cy+r,a,c.cy+r),{center:point(a,c.cy),radius:r,start:Math.PI/2,end:3*Math.PI/2}]];area=4*c.d!*r+Math.PI*r*r;
 }else if(c.kind==='half-disc'){rings=[[{center:point(c.cx,c.cy),radius:c.R,start:-Math.PI/2,end:Math.PI/2},line(c.cx,c.cy+c.R,c.cx,c.cy-c.R)]];area=Math.PI*c.R*c.R/2;
 }else{rings=[[circle(c.R)],...(c.kind==='annulus'?[[circle(c.r!)]]:[])];area=Math.PI*(c.R*c.R-(c.kind==='annulus'?c.r!*c.r!:0));}
 return{rings,area};
}
export function samples(primitives:Primitive[],step=.05){return primitives.flatMap(s=>{
 if('a'in s){const n=Math.max(1,Math.ceil(Math.hypot(s.b.x-s.a.x,s.b.y-s.a.y)/step));return Array.from({length:n+1},(_,j)=>({x:s.a.x+(s.b.x-s.a.x)*j/n,y:s.a.y+(s.b.y-s.a.y)*j/n}));}
 const n=Math.ceil((s.end-s.start)*s.radius/step);return Array.from({length:n+1},(_,j)=>{const t=s.start+(s.end-s.start)*j/n;return{x:s.center.x+s.radius*Math.cos(t),y:s.center.y+s.radius*Math.sin(t)};});
});}
export function nearest(p:XY,primitives:Primitive[]){let best=Infinity;for(const s of primitives){let q:XY;if('a'in s){const dx=s.b.x-s.a.x,dy=s.b.y-s.a.y,n=dx*dx+dy*dy,t=n?Math.max(0,Math.min(1,((p.x-s.a.x)*dx+(p.y-s.a.y)*dy)/n)):0;q={x:s.a.x+dx*t,y:s.a.y+dy*t};}else{let t=Math.atan2(p.y-s.center.y,p.x-s.center.x);t+=tau*Math.round(((s.start+s.end)/2-t)/tau);t=Math.max(s.start,Math.min(s.end,t));q={x:s.center.x+s.radius*Math.cos(t),y:s.center.y+s.radius*Math.sin(t)};}best=Math.min(best,Math.hypot(p.x-q.x,p.y-q.y));}return best;}
