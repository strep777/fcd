export interface XY{x:number;y:number}
export const bounds=(ring:XY[])=>({minX:Math.min(...ring.map(p=>p.x)),maxX:Math.max(...ring.map(p=>p.x)),minY:Math.min(...ring.map(p=>p.y)),maxY:Math.max(...ring.map(p=>p.y))});
const cross=(a:XY,b:XY,c:XY)=>(b.x-a.x)*(c.y-a.y)-(b.y-a.y)*(c.x-a.x);
function pointSegment(p:XY,a:XY,b:XY){const dx=b.x-a.x,dy=b.y-a.y,den=dx*dx+dy*dy,t=den?Math.max(0,Math.min(1,((p.x-a.x)*dx+(p.y-a.y)*dy)/den)):0;return Math.hypot(p.x-a.x-t*dx,p.y-a.y-t*dy);}
function segmentDistance(a:XY,b:XY,c:XY,d:XY){if(cross(a,b,c)*cross(a,b,d)<0&&cross(c,d,a)*cross(c,d,b)<0)return 0;return Math.min(pointSegment(a,c,d),pointSegment(b,c,d),pointSegment(c,a,b),pointSegment(d,a,b));}
function inside(p:XY,ring:XY[]){let yes=false;for(let i=0,j=ring.length-1;i<ring.length;j=i++){const a=ring[i],b=ring[j];if((a.y>p.y)!==(b.y>p.y)&&p.x<(b.x-a.x)*(p.y-a.y)/(b.y-a.y)+a.x)yes=!yes;}return yes;}
/** Outer rings are treated as solid: material holes are deliberately unavailable for nesting. */
export function collide(a:XY[],b:XY[],gap:number){const aa=bounds(a),bb=bounds(b);if(aa.maxX+gap<bb.minX-1e-7||bb.maxX+gap<aa.minX-1e-7||aa.maxY+gap<bb.minY-1e-7||bb.maxY+gap<aa.minY-1e-7)return false;
 for(let i=0;i<a.length;i++)for(let j=0;j<b.length;j++)if(segmentDistance(a[i],a[(i+1)%a.length],b[j],b[(j+1)%b.length])<Math.max(1e-7,gap-1e-7))return true;
 return inside(a[0],b)||inside(b[0],a);
}
