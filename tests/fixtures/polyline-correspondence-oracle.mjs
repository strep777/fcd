// Independent finite-segment distance oracle. No production geometry imports.
const sub=(a,b)=>[a[0]-b[0],a[1]-b[1]],dot=(a,b)=>a[0]*b[0]+a[1]*b[1];
const at=(a,d,t)=>[a[0]+d[0]*t,a[1]+d[1]*t];
const size=d=>Math.hypot(...d);
export const segments=ring=>ring.map((a,i)=>({a,b:ring[(i+1)%ring.length]}));
const bbox=s=>({minX:Math.min(s.a[0],s.b[0]),maxX:Math.max(s.a[0],s.b[0]),minY:Math.min(s.a[1],s.b[1]),maxY:Math.max(s.a[1],s.b[1])});
const near=(a,b,r)=>a.minX<=b.maxX+r&&b.minX<=a.maxX+r&&a.minY<=b.maxY+r&&b.minY<=a.maxY+r;
function merge(spans){const result=[];for(const [a,b] of spans.sort((a,b)=>a[0]-b[0])){if(b<=a)continue;const previous=result.at(-1);if(previous&&a<=previous[1])previous[1]=Math.max(previous[1],b);else result.push([a,b]);}return result;}
// Intersect p(t), 0<=t<=1 with the exact capsule around finite segment q.
// Endpoint disks and the middle strip are solved in their own projection ranges.
function intervals(p,q,radius){
 const d=sub(p.b,p.a),v=sub(q.b,q.a),vv=dot(v,v),base=sub(p.a,q.a),cuts=[0,1];
 const u0=vv?dot(base,v)/vv:0,du=vv?dot(d,v)/vv:0;
 if(du)for(const u of [0,1]){const t=(u-u0)/du;if(t>0&&t<1)cuts.push(t);}cuts.sort((a,b)=>a-b);const result=[];
 for(let i=1;i<cuts.length;i++){
  const lo=cuts[i-1],hi=cuts[i],u=u0+du*(lo+hi)/2;let b=base,delta=d;
  if(vv&&u>=1)b=sub(p.a,q.b);
  else if(vv&&u>0){b=[base[0]-v[0]*u0,base[1]-v[1]*u0];delta=[d[0]-v[0]*du,d[1]-v[1]*du];}
  const dd=dot(delta,delta);if(!dd){if(dot(b,b)<=radius*radius)result.push([lo,hi]);continue;}
  const center=-dot(b,delta)/dd,residual=at(b,delta,center),remaining=radius*radius-dot(residual,residual);if(remaining<0)continue;
  const half=Math.sqrt(remaining/dd),a=Math.max(lo,center-half),z=Math.min(hi,center+half);if(z>a)result.push([a,z]);
 }
 return result;
}
export function prepareDistance(source,target,maxRadius){
 const targets=target.map(s=>({...s,box:bbox(s)}));
 return source.map(s=>({...s,length:size(sub(s.b,s.a)),targets:targets.filter(q=>near(bbox(s),q.box,maxRadius))}));
}
export function uncoveredLength(prepared,radius){
 let total=0;for(const p of prepared){const spans=merge(p.targets.flatMap(q=>intervals(p,q,radius))),covered=spans.reduce((sum,[a,b])=>sum+b-a,0);total+=Math.max(0,1-covered)*p.length;}return total;
}
export function distanceBounds(prepared,maxRadius,resolution=1e-9){
 // Capsule union covers every point, rather than just vertices or sample points.
 // The numerical uncovered-length floor is much smaller than the distance bracket.
 if(uncoveredLength(prepared,maxRadius)>1e-10)return {lowerMm:maxRadius,upperMm:null,certified:false};
 let lo=0,hi=maxRadius;while(hi-lo>resolution){const mid=(lo+hi)/2;if(uncoveredLength(prepared,mid)<=1e-10)hi=mid;else lo=mid;}return {lowerMm:lo,upperMm:hi,certified:true};
}
