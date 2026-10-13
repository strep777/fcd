type XY=[number,number];
const area=(ring:XY[])=>ring.reduce((sum,p,i)=>{const q=ring[(i+1)%ring.length],o=ring[0];return sum+(p[0]-o[0])*(q[1]-o[1])-(q[0]-o[0])*(p[1]-o[1]);},0)/2;
/** Cyclic RDP keeps existing vertices within a globally bounded distance.
 * The caller validates hole containment and intersections before accepting it. */
export function simplifyColorBoundary(ring:XY[],tolerance=.001):XY[]{
 if(ring.length<=3)return ring;
 const distance=(p:XY,a:XY,b:XY)=>{const dx=b[0]-a[0],dy=b[1]-a[1],length=dx*dx+dy*dy,t=length?Math.max(0,Math.min(1,((p[0]-a[0])*dx+(p[1]-a[1])*dy)/length)):0;return Math.hypot(p[0]-a[0]-t*dx,p[1]-a[1]-t*dy);};
 const anchor=ring.reduce((best,p,i)=>distance(p,ring[0],ring[0])>distance(ring[best],ring[0],ring[0])?i:best,1);
 const simplify=(path:XY[])=>{const keep=new Set([0,path.length-1]),stack=[[0,path.length-1]];while(stack.length){const [a,b]=stack.pop()!;let max=tolerance,index=-1;for(let i=a+1;i<b;i++){const d=distance(path[i],path[a],path[b]);if(d>max){max=d;index=i;}}if(index>=0){keep.add(index);stack.push([a,index],[index,b]);}}return path.filter((_,i)=>keep.has(i));};
 const a=simplify(ring.slice(0,anchor+1)),b=simplify([...ring.slice(anchor),ring[0]]),result=[...a.slice(0,-1),...b.slice(0,-1)];
 return result.length>=3&&Math.sign(area(result))===Math.sign(area(ring))?result:ring;
}
