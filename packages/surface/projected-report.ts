import type {Surface,SurfaceReport} from '../schema/index';
import {edgeKey} from './refine';
import {simplifyReportBoundary} from './planar';
import {numericalTriangleArea} from './numerical';

/** Stable geometric chart candidate. A simple boundary and positive orientation
 * on every triangle make this disk projection injective; all physical stretch
 * metrics are measured before it may replace the conformal solution. */
export function projectedReport(mesh:Surface):SurfaceReport|undefined{
 const vertices=new Map(mesh.vertices.map(v=>[v.id,v])),xyz=(id:string)=>{const v=vertices.get(id)!;return [v.xMm,v.yMm,v.zMm];},sub=(a:number[],b:number[])=>a.map((v,i)=>v-b[i]),dot=(a:number[],b:number[])=>a.reduce((s,v,i)=>s+v*b[i],0),cross=(a:number[],b:number[])=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]],unit=(a:number[])=>{const l=Math.hypot(...a);return a.map(v=>v/l);};
 const used=new Set(mesh.faces.flatMap(f=>f.vertices)),edges=new Map<string,{a:string;b:string;count:number}>(),normals=mesh.faces.map(f=>{const [a,b,c]=f.vertices.map(xyz);return cross(sub(b,a),sub(c,a));}),normal=unit(normals.reduce((s,n)=>s.map((v,i)=>v+n[i]),[0,0,0]));
 if(!normal.every(Number.isFinite)||normals.some((n,i)=>numericalTriangleArea(mesh.faces[i].vertices.map(id=>xyz(id) as [number,number,number]))===undefined||dot(n,normal)<=64*Number.EPSILON*Math.hypot(...n)))return;
 mesh.faces.forEach(f=>f.vertices.forEach((a,i)=>{const b=f.vertices[(i+1)%3],key=edgeKey(a,b),e=edges.get(key)??{a,b,count:0};e.count++;edges.set(key,e);}));
 const outgoing=new Map<string,string>(),incoming=new Set<string>();for(const e of edges.values())if(e.count===1){if(outgoing.has(e.a)||incoming.has(e.b))return;outgoing.set(e.a,e.b);incoming.add(e.b);}if(!outgoing.size)return;
 const start=outgoing.keys().next().value!,boundary:string[]=[];let id=start;do{if(boundary.includes(id)||!outgoing.has(id))return;boundary.push(id);id=outgoing.get(id)!;}while(id!==start);
 if(boundary.length!==outgoing.size||used.size+mesh.faces.length!==edges.size+1)return;
 const origin=xyz(start),u=unit(cross(Math.abs(normal[0])<.8?[1,0,0]:[0,1,0],normal)),v=cross(normal,u),uv=new Map([...used].map(id=>{const d=sub(xyz(id),origin);return [id,[dot(d,u),dot(d,v)]];}));
 const orient=(a:number[],b:number[],c:number[])=>(b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]);
 // Reject crossings and non-adjacent contacts, including duplicated slit tips.
 for(let i=0;i<boundary.length;i++)for(let j=i+2;j<boundary.length;j++){if(i===0&&j===boundary.length-1)continue;const a=uv.get(boundary[i])!,b=uv.get(boundary[(i+1)%boundary.length])!,c=uv.get(boundary[j])!,d=uv.get(boundary[(j+1)%boundary.length])!,ab=[orient(a,b,c),orient(a,b,d)],cd=[orient(c,d,a),orient(c,d,b)];if(ab[0]*ab[1]<0&&cd[0]*cd[1]<0)return;const on=(p:number[],x:number[],y:number[])=>Math.abs(orient(x,y,p))<=1e-8*Math.hypot(y[0]-x[0],y[1]-x[1])&&p[0]>=Math.min(x[0],y[0])-1e-8&&p[0]<=Math.max(x[0],y[0])+1e-8&&p[1]>=Math.min(x[1],y[1])-1e-8&&p[1]<=Math.max(x[1],y[1])+1e-8;if(on(a,c,d)||on(b,c,d)||on(c,a,b)||on(d,a,b))return;}
 const faceDistortion:NonNullable<SurfaceReport['faceDistortion']>=[],errors:number[]=[];let weighted=0,total=0;
 const angle=(a:number,b:number,c:number)=>Math.acos(Math.max(-1,Math.min(1,(a*a+b*b-c*c)/(2*a*b))));
 for(let i=0;i<mesh.faces.length;i++){const f=mesh.faces[i],p=f.vertices.map(id=>uv.get(id)!),q=f.vertices.map(xyz),area=Math.hypot(...normals[i])/2,areaError=Math.abs(orient(p[0],p[1],p[2])/2/area-1),l3=q.map((a,j)=>Math.hypot(...sub(a,q[(j+1)%3]))),l2=p.map((a,j)=>Math.hypot(...sub(a,p[(j+1)%3]))),edgeError=Math.max(...l3.map((l,j)=>Math.abs(l2[j]/l-1))),angleError=Math.max(...l3.map((l,j)=>Math.abs(angle(l,l3[(j+1)%3],l3[(j+2)%3])-angle(l2[j],l2[(j+1)%3],l2[(j+2)%3]))/Math.PI)),distortion=.4*areaError+.4*edgeError+.2*angleError;faceDistortion.push({faceId:f.id,areaError,edgeError,angleError,distortion});errors.push(distortion);total+=area;weighted+=distortion*area;}
 errors.sort((a,b)=>a-b);return simplifyReportBoundary({faceIds:mesh.faces.map(f=>f.id),uv:[...uv].map(([vertexId,[xMm,yMm]])=>({vertexId,xMm,yMm})),boundary,areaErrorMax:Math.max(...faceDistortion.map(f=>f.areaError)),edgeErrorMax:Math.max(...faceDistortion.map(f=>f.edgeError)),distortionMean:weighted/total,distortionP95:errors[Math.ceil(errors.length*.95)-1],distortionMax:errors.at(-1)!,faceDistortion,status:'needsReview'});
}
