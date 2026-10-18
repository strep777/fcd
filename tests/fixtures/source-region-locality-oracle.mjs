import assert from 'node:assert/strict';

const cross=(a,b,c)=>(b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]);
const box=points=>[Math.min(...points.map(p=>p[0])),Math.min(...points.map(p=>p[1])),Math.max(...points.map(p=>p[0])),Math.max(...points.map(p=>p[1]))];
const contains=(p,ring)=>{let hit=false;for(let i=0,j=ring.length-1;i<ring.length;j=i++){const a=ring[i],b=ring[j];if((a[1]>p[1])!==(b[1]>p[1])&&p[0]<(b[0]-a[0])*(p[1]-a[1])/(b[1]-a[1])+a[0])hit=!hit;}return hit;};
const distance=(p,a,b)=>{const dx=b[0]-a[0],dy=b[1]-a[1],t=Math.max(0,Math.min(1,((p[0]-a[0])*dx+(p[1]-a[1])*dy)/(dx*dx+dy*dy||1)));return Math.hypot(p[0]-a[0]-t*dx,p[1]-a[1]-t*dy);};
const boundaryDistance=(p,ring)=>Math.min(...ring.map((a,i)=>distance(p,a,ring[(i+1)%ring.length])));
function outline(shape){
 assert(!shape.spline,'this real-source oracle expects saved cubic or polygon controls');
 return shape.nodes.flatMap((a,i)=>{const b=shape.nodes[(i+1)%shape.nodes.length],c=shape.curves?.find(c=>c.startIndex===i);if(!c)return [[a.xMm,a.yMm]];
  return Array.from({length:128},(_,j)=>{const t=j/128,s=1-t;return ['xMm','yMm'].map(k=>s**3*a[k]+3*s*s*t*c.c1[k]+3*s*t*t*c.c2[k]+t**3*b[k]);});
 });
}
/** Independent geometry checks: no production projection, preview, clipping,
 * contour-sampling or hit-testing helpers are imported. Region names cannot
 * truncate a physically continuous shoulder/torso sheet. */
export function localityOracle(surface,shape){
 const contour=outline(shape),holes=(shape.holes??[]).map(r=>r.map(p=>[p.xMm,p.yMm])),bounds=box(contour),pad=Math.max(2,Math.hypot(bounds[2]-bounds[0],bounds[3]-bounds[1])*.02),tolerance=.075;
 const project=v=>shape.axes.map(axis=>axis.reduce((sum,n,i)=>sum+n*([v.xMm,v.yMm,v.zMm][i]-shape.origin[i]),0)),world=new Map(surface.vertices.map(v=>[v.id,v])),projected=new Map(surface.vertices.map(v=>[v.id,project(v)]));
 const rows=surface.faces.map(face=>{const triangle=face.vertices.map(id=>projected.get(id)),det=cross(...triangle);return {face,triangle,det,bounds:box(triangle)};}),byId=new Map(rows.map(r=>[r.face.id,r]));
 const eligible=rows.filter(r=>r.det>1e-9&&r.bounds[0]<=bounds[2]+pad&&r.bounds[2]>=bounds[0]-pad&&r.bounds[1]<=bounds[3]+pad&&r.bounds[3]>=bounds[1]-pad),edges=new Map();
 const edgeKeys=face=>face.vertices.map((a,i)=>[a,face.vertices[(i+1)%3]].sort().join(':'));
 for(const row of eligible)for(const key of edgeKeys(row.face)){const list=edges.get(key)??[];list.push(row.face.id);edges.set(key,list);}
 const allowed=new Set(),queue=[];if(eligible.some(r=>r.face.id===shape.anchorFaceId)){allowed.add(shape.anchorFaceId);queue.push(shape.anchorFaceId);}
 for(let i=0;i<queue.length;i++)for(const key of edgeKeys(byId.get(queue[i]).face))for(const id of edges.get(key)??[])if(!allowed.has(id)){allowed.add(id);queue.push(id);}
 const front=rows.filter(r=>r.det>1e-9),frontDepth=p=>{let depth=-Infinity,owner;for(const row of front){const b=row.bounds;if(p[0]<b[0]-1e-7||p[0]>b[2]+1e-7||p[1]<b[1]-1e-7||p[1]>b[3]+1e-7)continue;const[a,c,d]=row.triangle,u=cross(a,p,d)/row.det,v=cross(a,c,p)/row.det;if(u< -1e-7||v< -1e-7||u+v>1+1e-7)continue;const candidate=(1-u-v)*a[2]+u*c[2]+v*d[2];if(Math.hypot(p[0],p[1],candidate)<=Math.hypot(bounds[2]-bounds[0],bounds[3]-bounds[1])+tolerance&&candidate>depth){depth=candidate;owner=row.face;}}return {depth,faceId:owner?.id,region:owner?.region};};
 function verify(fragments,targetRegion){
  assert(fragments?.length,'a visible source must retain actual fragments');let samples=0,maxOcclusionMm=0,maxOutsideMm=0,maxDistanceMm=0;const regions=new Set();
  for(const fragment of fragments){const row=byId.get(fragment.faceId);assert(row,'fragment references a real model face');assert(allowed.has(fragment.faceId),'fragment must stay on the anchor-connected front sheet inside the measured source footprint');assert(!/^leg/.test(row.face.region)&&row.face.region!==(targetRegion==='arm-left'?'arm-right':'arm-left'),'source cannot reach a leg or opposite arm');regions.add(row.face.region);
   const rings=fragment.rings.map(r=>r.map(w=>[0,1].map(k=>w.reduce((s,n,i)=>s+n*row.triangle[i][k],0)))),paint=p=>rings.reduce((hit,r)=>hit!==contains(p,r),false);
   const verifyPoint=p=>{if(!paint(p))return;const[a,b,c]=row.triangle,u=cross(a,p,c)/row.det,v=cross(a,b,p)/row.det;if(u< -1e-8||v< -1e-8||u+v>1+1e-8)return;p=[p[0],p[1],(1-u-v)*a[2]+u*b[2]+v*c[2]];const outside=contains(p,contour)?0:boundaryDistance(p,contour);maxOutsideMm=Math.max(maxOutsideMm,outside);assert(outside<=tolerance,JSON.stringify({failure:'filled area cannot leave the measured cubic contour',outsideMm:outside,point:p,fragmentFace:fragment.faceId}));for(const hole of holes)assert(!contains(p,hole)||boundaryDistance(p,hole)<=tolerance,'filled area cannot fill a source hole');assert(p[0]>=bounds[0]-tolerance&&p[0]<=bounds[2]+tolerance&&p[1]>=bounds[1]-tolerance&&p[1]<=bounds[3]+tolerance,'millimetre footprint cannot grow');const top=frontDepth(p),occlusion=top.depth-p[2];maxOcclusionMm=Math.max(maxOcclusionMm,occlusion);assert(occlusion<=.002,JSON.stringify({failure:'filled area must be visible against local original model triangles',fragmentFace:fragment.faceId,point:p,occlusionMm:occlusion,occluder:top}));const reach=Math.hypot(...p);assert(reach<=Math.hypot(bounds[2]-bounds[0],bounds[3]-bounds[1])+tolerance,'paint cannot reach a remote surface farther than the source physical diagonal');maxDistanceMm=Math.max(maxDistanceMm,reach);samples++;};
   for(const ring of fragment.rings)for(let i=0;i<ring.length;i++){
    const a=ring[i],b=ring[(i+1)%ring.length],va=row.face.vertices.map(id=>world.get(id)),aw=[0,1,2].map(k=>a.reduce((s,w,j)=>s+w*[va[j].xMm,va[j].yMm,va[j].zMm][k],0)),bw=[0,1,2].map(k=>b.reduce((s,w,j)=>s+w*[va[j].xMm,va[j].yMm,va[j].zMm][k],0)),count=Math.max(1,Math.ceil(Math.hypot(...aw.map((n,k)=>n-bw[k]))/5));
    // Concave half-plane clipping can encode disjoint filled islands with a
    // zero-area outward/backward bridge. Test the actual even-odd painted
    // neighbourhood, never a bridge that cancels in the displayed fill.
    for(let j=0;j<count;j++){const w=a.map((n,k)=>n+(b[k]-n)*j/count);assert(w.every(n=>Number.isFinite(n)&&n>=-1e-7&&n<=1+1e-7));assert(Math.abs(w.reduce((s,n)=>s+n,0)-1)<1e-7);const p=[0,1].map(k=>w.reduce((s,n,i)=>s+n*row.triangle[i][k],0));for(let k=0;k<8;k++)verifyPoint([p[0]+.002*Math.cos(k*Math.PI/4),p[1]+.002*Math.sin(k*Math.PI/4)]);}
   }
   for(let i=0;i<16;i++)for(let j=0;j<16-i;j++){const w=[1-(i+j+2/3)/16,(i+1/3)/16,(j+1/3)/16];verifyPoint([0,1].map(k=>w.reduce((s,n,i)=>s+n*row.triangle[i][k],0)));}
  }
  return {regions:[...regions].sort(),samples,sourceWidthMm:bounds[2]-bounds[0],sourceHeightMm:bounds[3]-bounds[1],maxOutsideMm,maxOcclusionMm,maxDistanceMm,connectedFaces:allowed.size};
 }
 return {allowed,verify};
}

/** Equal-area physical sampling compares filled sets, including holes and
 * disconnected islands, without treating removable bridge edges as paint. */
export function compareFragmentFill(surface,preview,native,resolution=80){
 const vertices=new Map(surface.vertices.map(v=>[v.id,v])),result={points:0,avoidedBoundaryPoints:0,extraPoints:0,missingPoints:0,extraAreaMm2:0,missingAreaMm2:0,maxWrongBoundaryDistanceMm:0},ids=new Set([...preview,...native].map(f=>f.faceId));
 for(const id of ids){const face=surface.faces.find(f=>f.id===id),p=face.vertices.map(id=>vertices.get(id)).map(p=>[p.xMm,p.yMm,p.zMm]),u=p[1].map((n,i)=>n-p[0][i]),v=p[2].map((n,i)=>n-p[0][i]),length=Math.hypot(...u),normal=[u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0]],twice=Math.hypot(...normal),local=[[0,0],[length,0],[u.reduce((s,n,i)=>s+n*v[i],0)/length,twice/length]],convert=fragments=>fragments.filter(f=>f.faceId===id).map(f=>f.rings.map(r=>r.map(w=>[0,1].map(k=>w.reduce((s,n,i)=>s+n*local[i][k],0))))),a=convert(preview),b=convert(native),paint=(point,fragments)=>fragments.some(rings=>rings.reduce((hit,r)=>hit!==contains(point,r),false)),edgeDistance=(point,fragments)=>Math.min(Infinity,...fragments.flat().flatMap(r=>r.map((a,i)=>distance(point,a,r[(i+1)%r.length]))));
  const sample=(u,v)=>{const w=[1-u-v,u,v],point=[0,1].map(k=>w.reduce((s,n,i)=>s+n*local[i][k],0)),da=edgeDistance(point,a),db=edgeDistance(point,b);if(Math.min(da,db)<.01){result.avoidedBoundaryPoints++;return;}result.points++;const got=paint(point,a),expected=paint(point,b);if(got===expected)return;const area=twice/2/resolution**2;if(got){result.extraPoints++;result.extraAreaMm2+=area;}else{result.missingPoints++;result.missingAreaMm2+=area;}const error=expected?da:db;if(error>result.maxWrongBoundaryDistanceMm){result.maxWrongBoundaryDistanceMm=error;result.farthestWrongPoint={faceId:id,barycentric:w,world:[0,1,2].map(k=>w.reduce((s,n,i)=>s+n*p[i][k],0)),preview:got,native:expected};}};
  for(let i=0;i<resolution;i++)for(let j=0;j<resolution-i;j++){sample((i+1/3)/resolution,(j+1/3)/resolution);if(i+j<resolution-1)sample((i+2/3)/resolution,(j+2/3)/resolution);}
 }
 assert.equal(result.extraPoints,0,JSON.stringify(result));assert.equal(result.missingPoints,0,JSON.stringify(result));return result;
}
