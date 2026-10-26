import type {Surface,Piece,Marking} from '../schema/index';
import {edgeArcPoints,pointBounds} from '../pattern/edit';
import {interiorAnchor} from '../pattern/interior';
import {placedPoint} from '../reference/placement-transform';
type XY=[number,number];

/** A small automatic accent just outside a differently shaped garment can be
 * proposed at the nearest visible point of its already selected body part.
 * This is a translation only; source scale, holes and manual poses are intact.
 * The caller keeps the automatic placement unreviewed and persists the offset. */
export function localPlacementOffset(mesh:Surface,source:Piece,placement:NonNullable<Marking['placement']>,view:'front'|'back',offsetXmm:number,offsetYmm:number,scope?:Set<string>){
 const rings=[source.nodes.flatMap(n=>edgeArcPoints(source,n.id).slice(0,-1)),...source.holes??[]],inside=interiorAnchor(rings[0],rings.slice(1));if(inside.clearanceMm<=1e-6)return;
 const anchor=placedPoint(inside,placement,offsetXmm,offsetYmm),origin:XY=[anchor.xMm,anchor.yMm],sign=view==='front'?1:-1,vertices=new Map(mesh.vertices.map(v=>[v.id,v]));
 const weight=(p:XY,t:XY[])=>{const [a,b,c]=t,den=(b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]);const u=((p[0]-a[0])*(c[1]-a[1])-(p[1]-a[1])*(c[0]-a[0]))/den,v=((b[0]-a[0])*(p[1]-a[1])-(b[1]-a[1])*(p[0]-a[0]))/den;return[1-u-v,u,v];};
 const faces=mesh.faces.map(f=>{const v=f.vertices.map(id=>vertices.get(id)!),xy=v.map(p=>[sign*p.xMm,p.yMm] as XY),[a,b,c]=xy;return{f,xy,depth:v.map(p=>sign*p.zMm),det:(b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0])};}).filter(f=>Math.abs(f.det)>1e-6);
 const targets=faces.filter(f=>f.det>0&&placement.regions.includes(f.f.region)&&(!scope||scope.has(f.f.id)));if(!targets.length)return;
 const target=pointBounds(targets.flatMap(f=>f.xy.map(([xMm,yMm])=>({xMm,yMm})))),shape=pointBounds(rings[0].map(p=>placedPoint(p,placement))),width=target.maxX-target.minX,height=target.maxY-target.minY;
 // A full illustration or large misplaced patch needs a deliberate edit.
 // This bounded correction applies only to local details near their own part.
 if(shape.maxX-shape.minX>width*.35||shape.maxY-shape.minY>height*.35)return;
 const nearest=(t:XY[])=>{if(weight(origin,t).every(n=>n>=0))return origin;return t.map((a,i)=>{const b=t[(i+1)%3],d=[b[0]-a[0],b[1]-a[1]],s=Math.max(0,Math.min(1,((origin[0]-a[0])*d[0]+(origin[1]-a[1])*d[1])/(d[0]**2+d[1]**2)));return[a[0]+s*d[0],a[1]+s*d[1]] as XY;}).sort((a,b)=>Math.hypot(a[0]-origin[0],a[1]-origin[1])-Math.hypot(b[0]-origin[0],b[1]-origin[1]))[0];};
 const candidates=targets.map(face=>{const edge=nearest(face.xy),p=edge.map((n,i)=>n*.92+face.xy.reduce((s,v)=>s+v[i],0)/3*.08) as XY;return{face,p,distance:Math.hypot(p[0]-origin[0],p[1]-origin[1])};}).filter(c=>c.distance<=Math.min(width,height)*.25).sort((a,b)=>a.distance-b.distance||a.p[0]-b.p[0]||a.p[1]-b.p[1]);
 for(const candidate of candidates.slice(0,64)){
  const {face,p}=candidate,w=weight(p,face.xy),depth=w.reduce((s,n,i)=>s+n*face.depth[i],0);
  // Visibility uses every model face, including other parts. A hidden target
  // or genuinely coincident sheet is never a successful recovery location.
  if(faces.some(other=>{if(other===face)return false;const w=weight(p,other.xy);return w.every(n=>n>=-1e-9)&&w.reduce((s,n,i)=>s+n*other.depth[i],0)>=depth-1e-6;}))continue;
  return{offsetXmm:offsetXmm+p[0]-origin[0],offsetYmm:offsetYmm+p[1]-origin[1]};
 }
}
