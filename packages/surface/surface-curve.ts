import type {Surface} from '../schema/index';
import type {Bary,FaceCut} from './refine';

type XYZ={xMm:number;yMm:number;zMm:number};
type V=[number,number,number];
const vec=(p:XYZ):V=>[p.xMm,p.yMm,p.zMm];
const sub=(a:V,b:V):V=>[a[0]-b[0],a[1]-b[1],a[2]-b[2]];
const dot=(a:V,b:V)=>a[0]*b[0]+a[1]*b[1]+a[2]*b[2];
const cross=(a:V,b:V):V=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
const unit=(a:V):V=>{const n=Math.hypot(...a);return n?a.map(v=>v/n) as V:[0,0,0];};
const interpolate=(a:V,b:V,t:number):V=>a.map((v,i)=>v+(b[i]-v)*t) as V;

/** Connect world-space knots by a shortest connected section of the actual
 * surface. Each section passes through both anchors and the local surface
 * normal, so orbiting the camera cannot move a cut onto a different sheet.
 * Intersections remain barycentric face segments, not mesh-edge stair steps. */
export function surfaceCurveSegments(surface:Surface,points:XYZ[],closed:boolean,owner:string,regions?:string[]):FaceCut[]{
 if(points.length<(closed?3:2)||points.length>400)throw Error('INVALID_CUT');
 if(points.length*surface.faces.length>20000000)throw Error('CUT_PROCESSING_LIMIT');
 const vertices=new Map(surface.vertices.map(p=>[p.id,vec(p)]));
 const faces=surface.faces.filter(f=>!regions?.length||regions.includes(f.region)).map(face=>{
  const triangle=face.vertices.map(id=>vertices.get(id)!) as [V,V,V];
  return {face,triangle,normal:unit(cross(sub(triangle[1],triangle[0]),sub(triangle[2],triangle[0])))};
 });
 const weights=(p:V,t:[V,V,V]):Bary=>{const u=sub(t[1],t[0]),v=sub(t[2],t[0]),d=sub(p,t[0]),uu=dot(u,u),uv=dot(u,v),vv=dot(v,v),den=uu*vv-uv*uv;if(den<=0)return [NaN,NaN,NaN];const b=(dot(d,u)*vv-dot(d,v)*uv)/den,c=(dot(d,v)*uu-dot(d,u)*uv)/den;return [1-b-c,b,c];};
 const locate=(p:V,direction:V)=>{let best:typeof faces[number]|undefined,distance=Infinity,tangentError=Infinity;const forward=unit(direction);for(const f of faces){const w=weights(p,f.triangle),d=Math.abs(dot(sub(p,f.triangle[0]),f.normal)),error=Math.abs(dot(forward,f.normal));if(w.every(v=>Number.isFinite(v)&&v>=-1e-6&&v<=1+1e-6)&&(d<distance-1e-8||Math.abs(d-distance)<=1e-8&&error<tangentError)){best=f;distance=d;tangentError=error;}}if(!best||distance>.01)throw Error('CUT_OUTSIDE_SURFACE');return best;};
 const result:FaceCut[]=[];
 for(let index=0;index<points.length-(closed?0:1);index++){
  const a=vec(points[index]),b=vec(points[(index+1)%points.length]),direction=sub(b,a);
  if(Math.hypot(...direction)<1e-7)continue;
  // A boundary anchor belongs to several triangles. Prefer the face tangent
  // to the requested chord, rather than letting face-array order choose a
  // perpendicular wall and force a detour around a planar patch.
  const fa=locate(a,direction),fb=locate(b,direction),average=unit(fa.normal.map((v,i)=>v+fb.normal[i]) as V);
  let normal=unit(cross(direction,average));
  if(Math.hypot(...normal)<.5)normal=unit(cross(direction,fa.normal));
  if(Math.hypot(...normal)<.5)throw Error('CUT_AMBIGUOUS_SURFACE');
  type Link={to:string;length:number;cut:FaceCut};
  const graph=new Map<string,Link[]>();
  const link=(from:string,to:string,p:V,q:V,cut:FaceCut)=>{const length=Math.hypot(...sub(p,q));if(length<1e-9)return;const forward=graph.get(from)??[],back=graph.get(to)??[];forward.push({to,length,cut});back.push({to:from,length,cut:{...cut,a:cut.b,b:cut.a}});graph.set(from,forward);graph.set(to,back);};
  for(const f of faces){
   const distances=f.triangle.map(p=>dot(sub(p,a),normal));
   type Station={key:string;p:V;w:Bary};
   const stations:Station[]=[];
   for(let i=0;i<3;i++){const j=(i+1)%3,di=distances[i],dj=distances[j];
    if(Math.abs(di)<1e-7){const w:Bary=[0,0,0];w[i]=1;stations.push({key:f.face.vertices[i],p:f.triangle[i],w});}
    if(di*dj<0&&Math.abs(di)>=1e-7&&Math.abs(dj)>=1e-7){const t=di/(di-dj),w:Bary=[0,0,0];w[i]=1-t;w[j]=t;stations.push({key:[f.face.vertices[i],f.face.vertices[j]].sort().join(':'),p:interpolate(f.triangle[i],f.triangle[j],t),w});}
   }
   const unique=stations.filter((p,i)=>!stations.slice(0,i).some(q=>q.key===p.key));
   if(unique.length!==2)continue;
   const [s,e]=unique,d=sub(e.p,s.p),length=dot(d,d),ordered:{t:number;station:Station}[]=[{t:0,station:s},{t:1,station:e}];
   for(const [key,p] of [['start',a],['end',b]] as const){const t=dot(sub(p,s.p),d)/length,w=weights(p,f.triangle);if(t>=-1e-7&&t<=1+1e-7&&w.every(n=>n>=-1e-6)&&Math.hypot(...sub(p,interpolate(s.p,e.p,t)))<1e-5)ordered.push({t:Math.max(0,Math.min(1,t)),station:{key,p,w}});}
   ordered.sort((x,y)=>x.t-y.t);
   // Zero-length connections at shared vertices must still connect the anchor.
   for(let i=1;i<ordered.length;i++){const p=ordered[i-1].station,q=ordered[i].station;if(Math.hypot(...sub(p.p,q.p))<1e-9){const x=graph.get(p.key)??[],y=graph.get(q.key)??[];x.push({to:q.key,length:0,cut:{faceId:f.face.id,a:p.w,b:q.w,owner}});y.push({to:p.key,length:0,cut:{faceId:f.face.id,a:q.w,b:p.w,owner}});graph.set(p.key,x);graph.set(q.key,y);}else link(p.key,q.key,p.p,q.p,{faceId:f.face.id,a:p.w,b:q.w,owner});}
  }
  const distances=new Map([['start',0]]),previous=new Map<string,{from:string;link:Link}>(),pending=new Set(['start']);
  while(pending.size){let current='';let best=Infinity;for(const key of pending){const distance=distances.get(key)!;if(distance<best){best=distance;current=key;}}pending.delete(current);if(current==='end')break;for(const edge of graph.get(current)??[]){const distance=best+edge.length;if(distance<(distances.get(edge.to)??Infinity)){distances.set(edge.to,distance);previous.set(edge.to,{from:current,link:edge});pending.add(edge.to);}}}
  if(!previous.has('end'))throw Error('CUT_PATH_DISCONNECTED');
  const path:FaceCut[]=[];let key='end';while(key!=='start'){const step=previous.get(key)!;if(step.link.length>1e-9)path.push(step.link.cut);key=step.from;}result.push(...path.reverse());
 }
 if(!result.length)throw Error('INVALID_CUT');return result;
}
