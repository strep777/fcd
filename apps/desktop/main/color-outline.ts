import {boxIndex,type Box} from '../../../packages/surface/spatial';
type XY=[number,number];
type Contours={outer:XY[];holes:XY[][]};
const inside=(p:XY,ring:XY[])=>{let value=false;for(let i=0,j=ring.length-1;i<ring.length;j=i++){const a=ring[i],b=ring[j];if((a[1]>p[1])!==(b[1]>p[1])&&p[0]<(b[0]-a[0])*(p[1]-a[1])/(b[1]-a[1])+a[0])value=!value;}return value;};
const cross=(a:XY,b:XY,p:XY)=>(b[0]-a[0])*(p[1]-a[1])-(b[1]-a[1])*(p[0]-a[0]);
function intersects(a:XY,b:XY,c:XY,d:XY){
 const epsilon=1e-10,sign=(n:number)=>Math.abs(n)<=epsilon?0:Math.sign(n),on=(p:XY,a:XY,b:XY)=>p[0]>=Math.min(a[0],b[0])-epsilon&&p[0]<=Math.max(a[0],b[0])+epsilon&&p[1]>=Math.min(a[1],b[1])-epsilon&&p[1]<=Math.max(a[1],b[1])+epsilon;
 const u=sign(cross(a,b,c)),v=sign(cross(a,b,d)),w=sign(cross(c,d,a)),x=sign(cross(c,d,b));return u*v<0&&w*x<0||u===0&&on(c,a,b)||v===0&&on(d,a,b)||w===0&&on(a,c,d)||x===0&&on(b,c,d);
}
/** A distance bound alone does not preserve topology when a narrow hole nearly
 * touches the outer contour. Keep the exact contours if simplification crosses
 * an edge or changes containment; the caller can split an over-budget outline. */
export function safeColorOutline(original:Contours,candidate:Contours):Contours{
 const rings=[candidate.outer,...candidate.holes];if(candidate.holes.length!==original.holes.length||rings.some(r=>r.length<3))return original;
 const segments=rings.flatMap((ring,r)=>ring.map((a,i)=>({a,b:ring[(i+1)%ring.length],ring:r,index:i,length:ring.length}))),boxes=segments.map(({a,b})=>[Math.min(a[0],b[0])-1e-10,Math.min(a[1],b[1])-1e-10,Math.max(a[0],b[0])+1e-10,Math.max(a[1],b[1])+1e-10] as Box),index=boxIndex(boxes);
 for(let i=0;i<segments.length;i++){const a=segments[i];if(Math.hypot(a.b[0]-a.a[0],a.b[1]-a.a[1])<=1e-12)return original;for(const j of index.query(boxes[i])){if(j<=i)continue;const b=segments[j];if(a.ring===b.ring&&(Math.abs(a.index-b.index)===1||Math.abs(a.index-b.index)===a.length-1))continue;if(intersects(a.a,a.b,b.a,b.b))return original;}}
 for(let i=0;i<candidate.holes.length;i++){const hole=candidate.holes[i];if(!inside(hole[0],candidate.outer))return original;for(let j=0;j<candidate.holes.length;j++)if(i!==j&&inside(hole[0],candidate.holes[j]))return original;}
 return candidate;
}
