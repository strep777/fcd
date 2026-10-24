import type {Surface,SurfaceRun} from '../schema/index';
import {designQualityFailure} from './design-partition';
import {edgeKey} from './refine';
type XY={xMm:number;yMm:number};
type Segment=[XY,XY];
/** Cover the full segment by capsules around the other polyline. This is a
 * finite-segment distance test: a short mesh edge must not extrapolate the
 * direction of a long simplified edge. */
function covered([a,b]:Segment,segments:Segment[],tolerance:number){
 const dx=b.xMm-a.xMm,dy=b.yMm-a.yMm,length=Math.hypot(dx,dy);
 if(!(length>0))return false;
 const intervals: [number,number][]=[];
 const circle=(p:XY)=>{
  const x=a.xMm-p.xMm,y=a.yMm-p.yMm,t=-(x*dx+y*dy)/(length*length);
  const distance=Math.abs(x*dy-y*dx)/length;
  if(distance>tolerance)return;
  const span=Math.sqrt(Math.max(0,tolerance*tolerance-distance*distance))/length;
  intervals.push([Math.max(0,t-span),Math.min(1,t+span)]);
 };
 for(const [p,q]of segments){
  circle(p);circle(q);
  const ex=q.xMm-p.xMm,ey=q.yMm-p.yMm,l=Math.hypot(ex,ey);if(!(l>0))continue;
  let lo=0,hi=1;
  const clip=(origin:number,slope:number,min:number,max:number)=>{
   if(Math.abs(slope)<1e-30)return origin>=min&&origin<=max;
   const t1=(min-origin)/slope,t2=(max-origin)/slope;
   lo=Math.max(lo,Math.min(t1,t2));hi=Math.min(hi,Math.max(t1,t2));return lo<=hi;
  };
  const x=a.xMm-p.xMm,y=a.yMm-p.yMm;
  if(clip((x*ex+y*ey)/l,(dx*ex+dy*ey)/l,0,l)&&clip((x*ey-y*ex)/l,(dx*ey-dy*ex)/l,-tolerance,tolerance))intervals.push([lo,hi]);
 }
 intervals.sort((a,b)=>a[0]-b[0]);let end=0;
 for(const [from,to]of intervals){if(from>to)continue;if(from>end+1e-12)return false;end=Math.max(end,to);if(end>=1-1e-12)return true;}
 return false;
}

/** Recompute from the stored source correspondence at acceptance. A report
 * alone cannot authorize sewing lengths after a candidate has been modified. */
export function sewingQualityFailure(surface:Surface,run:SurfaceRun):boolean{
 if(run.algorithm!=='lscm-arap-seamed-1')return false;
 if(!run.pieces.length||run.bindings.length!==run.pieces.length||new Set(run.pieces.map(p=>p.id)).size!==run.pieces.length||new Set(run.bindings.map(b=>b.pieceId)).size!==run.bindings.length)return true;
 const sourceVertices=new Map(surface.vertices.map(v=>[v.id,v])),sourceFaces=new Map(surface.faces.map(f=>[f.id,f]));
 for(const binding of run.bindings){
  const report=binding.report,trim=binding.trim,piece=run.pieces.find(p=>p.id===binding.pieceId);
   if(!trim||!piece||piece.curves?.length||report.seamErrorMax===undefined||report.seamLengthErrorMm===undefined||designQualityFailure(report))return true;
  const uv=new Map(trim.vertices.map(v=>[v.id,v])),points=new Map<string,[number,number,number]>(),edges=new Map<string,{a:string;b:string;count:number}>(),triangles=new Set<string>();
  if(uv.size!==trim.vertices.length||!trim.triangles.length)return true;
  // Generated candidates store one exact trim station for every exported
  // outline node. Editing a candidate invalidates that correspondence.
  const rings=[piece.nodes,...piece.holes??[]],boundaries=[trim.boundary,...trim.holes??[]];
  if(rings.length!==boundaries.length||rings.some((ring,k)=>ring.length!==boundaries[k].length||ring.some((p,i)=>{
   const q=uv.get(boundaries[k][i]);return !q||Math.hypot(p.xMm-q.xMm,p.yMm-q.yMm)>1e-6;
  })))return true;
  for(const triangle of trim.triangles){
   const identity=[...triangle.vertices].sort().join(':');
   if(new Set(triangle.vertices).size!==3||triangles.has(identity))return true;triangles.add(identity);
   const face=sourceFaces.get(triangle.faceId);if(!face)return true;
   const vertices=face.vertices.map(id=>sourceVertices.get(id));if(vertices.some(v=>!v))return true;
   for(let i=0;i<3;i++){
    const id=triangle.vertices[i],bary=triangle.barycentric[i];
    if(Math.abs(bary.reduce((sum,w)=>sum+w,0)-1)>1e-6)return true;
    const point=[0,1,2].map(axis=>bary.reduce((sum,w,k)=>sum+w*[vertices[k]!.xMm,vertices[k]!.yMm,vertices[k]!.zMm][axis],0)) as [number,number,number];
    if(point.some(v=>!Number.isFinite(v))||!uv.has(id))return true;
    const previous=points.get(id);if(previous&&Math.hypot(...point.map((v,k)=>v-previous[k]))>1e-5)return true;
    points.set(id,point);
    const next=triangle.vertices[(i+1)%3],key=edgeKey(id,next),edge=edges.get(key)??{a:id,b:next,count:0};edge.count++;if(edge.count>2||edge.count===2&&edge.a===id)return true;edges.set(key,edge);
   }
   const [a,b,c]=triangle.vertices.map(id=>points.get(id)!),[p,q,r]=triangle.vertices.map(id=>uv.get(id)!);
   const u=b.map((n,i)=>n-a[i]),v=c.map((n,i)=>n-a[i]);
   const area3=Math.hypot(u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0]);
   const area2=(q.xMm-p.xMm)*(r.yMm-p.yMm)-(q.yMm-p.yMm)*(r.xMm-p.xMm);
   if(!(area3>0&&area2>0))return true;
   const xyz=[a,b,c],xy=[p,q,r],l3=xyz.map((a,i)=>Math.hypot(...a.map((n,k)=>n-xyz[(i+1)%3][k]))),l2=xy.map((a,i)=>Math.hypot(a.xMm-xy[(i+1)%3].xMm,a.yMm-xy[(i+1)%3].yMm));
   const angle=(a:number,b:number,c:number)=>Math.acos(Math.max(-1,Math.min(1,(a*a+b*b-c*c)/(2*a*b))));
   const areaError=Math.abs(area2/area3-1),edgeError=Math.max(...l3.map((n,i)=>Math.abs(l2[i]/n-1))),angleError=Math.max(...l3.map((n,i)=>Math.abs(angle(n,l3[(i+1)%3],l3[(i+2)%3])-angle(l2[i],l2[(i+1)%3],l2[(i+2)%3]))/Math.PI));
   if(![areaError,edgeError,angleError].every(Number.isFinite)||areaError>.150001||edgeError>.100001||.4*areaError+.4*edgeError+.2*angleError>.150001)return true;
  }
  const actual:Segment[]=[...edges.values()].filter(e=>e.count===1).map(e=>[uv.get(e.a)!,uv.get(e.b)!]);
  const stated:Segment[]=boundaries.flatMap(r=>r.map((id,i)=>[uv.get(id)!,uv.get(r[(i+1)%r.length])!] as Segment));
  const tolerance=Math.max(1e-6,Math.min(1e-4,report.boundaryToleranceMm??0));
  if(!actual.length||stated.some(e=>!covered(e,actual,tolerance))||actual.some(e=>!covered(e,stated,tolerance)))return true;
  let relative=0,absolute=0;
  for(const edge of edges.values())if(edge.count===1){
   const a=points.get(edge.a)!,b=points.get(edge.b)!,p=uv.get(edge.a)!,q=uv.get(edge.b)!;
   const length=Math.hypot(...a.map((v,k)=>v-b[k]));
   if(!(length>0))return true;
   const error=Math.abs(Math.hypot(p.xMm-q.xMm,p.yMm-q.yMm)-length);
   relative=Math.max(relative,error/length);absolute+=error;
  }
  if(!Number.isFinite(relative)||relative>.0005+1e-9||absolute>.25+1e-7)return true;
 }
 return false;
}
