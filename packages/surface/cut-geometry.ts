import type {Surface,CutProjection} from '../schema/index';
import {surfaceSpline,type Knot} from './spline';
import type {Bary,FaceCut} from './refine';
type XYZ={xMm:number;yMm:number;zMm:number};
const dot=(a:number[],b:number[])=>a.reduce((s,n,i)=>s+n*b[i],0);
export function planeSegments(surface:Surface,axis:'x'|'y'|'z',positionMm:number,owner:string,regions?:string[]):FaceCut[]{
 const vertices=new Map(surface.vertices.map(v=>[v.id,v])),result:FaceCut[]=[],key=(axis+'Mm') as 'xMm'|'yMm'|'zMm';
 for(const face of surface.faces){if(regions&&!regions.includes(face.region))continue;const d=face.vertices.map(id=>vertices.get(id)![key]-positionMm),points:Bary[]=[];
  for(let i=0;i<3;i++){const j=(i+1)%3;if(Math.abs(d[i])<1e-7){const w=[0,0,0] as Bary;w[i]=1;points.push(w);}if(d[i]*d[j]<0){const t=d[i]/(d[i]-d[j]),w=[0,0,0] as Bary;w[i]=1-t;w[j]=t;points.push(w);}}
  const unique=points.filter((p,i)=>!points.slice(0,i).some(q=>Math.hypot(...p.map((n,j)=>n-q[j]))<1e-8));if(unique.length===2)result.push({faceId:face.id,a:unique[0],b:unique[1],owner});else if(unique.length===3)for(let i=0;i<3;i++)result.push({faceId:face.id,a:unique[i],b:unique[(i+1)%3],owner});
 }if(!result.length)throw Error('SECTION_NO_INTERSECTION');return result;
}
function openSpline(knots:Knot[],tension:number,tolerance:number){
 const out=[knots[0]],gain=(1-tension)/6,mid=(a:Knot,b:Knot)=>({xMm:(a.xMm+b.xMm)/2,yMm:(a.yMm+b.yMm)/2}),distance=(p:Knot,a:Knot,b:Knot)=>{const d=[b.xMm-a.xMm,b.yMm-a.yMm],length=d[0]**2+d[1]**2,t=length?Math.max(0,Math.min(1,((p.xMm-a.xMm)*d[0]+(p.yMm-a.yMm)*d[1])/length)):0;return Math.hypot(p.xMm-a.xMm-t*d[0],p.yMm-a.yMm-t*d[1]);};
 const flatten=(a:Knot,b:Knot,c:Knot,d:Knot,depth=0)=>{if(out.length>=2000||depth>24)throw Error('SPLINE_LIMIT');if(Math.max(distance(b,a,d),distance(c,a,d))<=tolerance){out.push(d);return;}const ab=mid(a,b),bc=mid(b,c),cd=mid(c,d),abc=mid(ab,bc),bcd=mid(bc,cd),center=mid(abc,bcd);flatten(a,ab,abc,center,depth+1);flatten(center,bcd,cd,d,depth+1);};
 for(let i=0;i<knots.length-1;i++){const a=knots[i],d=knots[i+1],prev=knots[Math.max(0,i-1)],next=knots[Math.min(knots.length-1,i+2)];if(Math.hypot(d.xMm-a.xMm,d.yMm-a.yMm)<1e-8)throw Error('INVALID_SPLINE');flatten(a,{xMm:a.xMm+(d.xMm-prev.xMm)*gain,yMm:a.yMm+(d.yMm-prev.yMm)*gain},{xMm:d.xMm-(next.xMm-a.xMm)*gain,yMm:d.yMm-(next.yMm-a.yMm)*gain},d);}return out;
}
export function curveKnots(points:XYZ[],projection:CutProjection,tension:number,closed:boolean,kind:'pen'|'freehand'){
 const {origin,axes}=projection;for(const a of axes)if(Math.abs(Math.hypot(...a)-1)>1e-6)throw Error('INVALID_PROJECTION');if(Math.abs(dot(axes[0],axes[1]))>1e-6||Math.abs(dot(axes[0],axes[2]))>1e-6||Math.abs(dot(axes[1],axes[2]))>1e-6)throw Error('INVALID_PROJECTION');
 const knots=points.map(p=>{const v=[p.xMm-origin[0],p.yMm-origin[1],p.zMm-origin[2]];return {xMm:dot(v,axes[0]),yMm:dot(v,axes[1])};});if(closed&&points.length<3)throw Error('INVALID_SPLINE');
 const path=kind==='freehand'?knots:closed?surfaceSpline(knots,tension,.1):openSpline(knots,tension,.1);return closed?[...path,path[0]]:path;
}
/** Orthographic projected cuts choose the frontmost surface on each interval. No hidden-face cutting. */
export function projectedCurveSegments(surface:Surface,points:XYZ[],projection:CutProjection,tension:number,closed:boolean,kind:'pen'|'freehand',owner:string,regions?:string[]):FaceCut[]{
 const knots=curveKnots(points,projection,tension,closed,kind);if(knots.length*surface.faces.length>20000000)throw Error('CUT_PROCESSING_LIMIT');
 const vertices=new Map(surface.vertices.map(v=>{const d=[v.xMm-projection.origin[0],v.yMm-projection.origin[1],v.zMm-projection.origin[2]];return [v.id,projection.axes.map(a=>dot(d,a))];}));
 const faces=surface.faces.filter(f=>!regions?.length||regions.includes(f.region)).map(f=>{const t=f.vertices.map(id=>vertices.get(id)!);return {id:f.id,t,minX:Math.min(...t.map(p=>p[0])),maxX:Math.max(...t.map(p=>p[0])),minY:Math.min(...t.map(p=>p[1])),maxY:Math.max(...t.map(p=>p[1]))};}),result:FaceCut[]=[];
 const bary=(p:Knot,t:number[][]):Bary|undefined=>{const a=t[0],b=t[1],c=t[2],den=(b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]);if(Math.abs(den)<1e-9)return;const v=((p.xMm-a[0])*(c[1]-a[1])-(p.yMm-a[1])*(c[0]-a[0]))/den,w=((b[0]-a[0])*(p.yMm-a[1])-(b[1]-a[1])*(p.xMm-a[0]))/den;return [1-v-w,v,w];};
 // A path on a shared edge has a zero barycentric coordinate at both ends.
 // Cancellation on refined slivers can give it a tiny spurious slope; snap
 // only that collinear coordinate before clipping, using the existing edge
 // tolerance. Otherwise -epsilon/delta can exclude the entire valid face.
 for(let i=1;i<knots.length;i++){const a=knots[i-1],b=knots[i];if(Math.hypot(a.xMm-b.xMm,a.yMm-b.yMm)<.001)continue;const candidates:{face:typeof faces[number];a:Bary;b:Bary;low:number;high:number}[]=[];
  for(const face of faces){if(face.maxX<Math.min(a.xMm,b.xMm)-1e-7||face.minX>Math.max(a.xMm,b.xMm)+1e-7||face.maxY<Math.min(a.yMm,b.yMm)-1e-7||face.minY>Math.max(a.yMm,b.yMm)+1e-7)continue;const wa=bary(a,face.t),wb=bary(b,face.t);if(!wa||!wb)continue;let low=0,high=1;for(let j=0;j<3;j++){if(Math.abs(wa[j])<=1e-8&&Math.abs(wb[j])<=1e-8){wa[j]=0;wb[j]=0;continue;}const delta=wb[j]-wa[j];if(Math.abs(delta)<1e-12){if(wa[j]<-1e-8){high=-1;break;}}else if(delta>0)low=Math.max(low,-wa[j]/delta);else high=Math.min(high,-wa[j]/delta);}if(high-low>1e-8)candidates.push({face,a:wa,b:wb,low,high});}
  const stations=[0,1,...candidates.flatMap(c=>[c.low,c.high])].sort((a,b)=>a-b).filter((n,i,list)=>!i||n-list[i-1]>1e-8);
  for(let j=1;j<stations.length;j++){const low=stations[j-1],high=stations[j],t=(low+high)/2;if(high-low<1e-8)continue;const active=candidates.filter(c=>t>=c.low-1e-8&&t<=c.high+1e-8).sort((a,b)=>{const depth=(c:typeof a)=>c.a.reduce((s,n,k)=>s+(n+t*(c.b[k]-n))*c.face.t[k][2],0);return depth(b)-depth(a);});if(!active.length)throw Error('CUT_OUTSIDE_SURFACE');const c=active[0],at=(t:number)=>{const raw=c.a.map((n,k)=>Math.max(0,Math.min(1,n+t*(c.b[k]-n)))),sum=raw.reduce((s,n)=>s+n,0);return raw.map(n=>n/sum) as Bary;};result.push({faceId:c.face.id,a:at(low),b:at(high),owner});}
 }if(!result.length)throw Error('INVALID_CUT');return result;
}
export function scopeFaces(surface:Surface){
 const scope=surface.cutScope;if(!scope||scope.side==='full')return surface.faces;const key=(scope.axis+'Mm') as keyof XYZ,vertices=new Map(surface.vertices.map(v=>[v.id,v]));return surface.faces.filter(f=>{const values=f.vertices.map(id=>vertices.get(id)![key]-scope.positionMm);if(Math.min(...values)<-1e-6&&Math.max(...values)>1e-6)throw Error('MIDLINE_NOT_REFINED');return scope.side==='right'?values.reduce((a,b)=>a+b,0)>1e-7:values.reduce((a,b)=>a+b,0)<-1e-7;});
}
