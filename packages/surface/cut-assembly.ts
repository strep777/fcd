import type {Surface,SurfaceRun,Marking,Piece,Binding} from '../schema/index';
import {bindingTriangles} from './triangles';
export type AssemblyTriangle={pieceId:string;faceId:string;color:string;points:[number,number,number][]};
export function assemblyArea(points:number[][]){const [a,b,c]=points,u=b.map((v,i)=>v-a[i]),v=c.map((n,i)=>n-a[i]);return Math.hypot(u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0])/2;}
/** A saved model fit must never silently stand in for an edited 2D pattern. */
export function assemblyAvailability(surface:Surface,run:SurfaceRun,pieces:Piece[]=run.pieces,bindings:Binding[]=run.bindings){
 const current=new Map(pieces.map(p=>[p.id,p])),bound=new Map(bindings.map(b=>[b.pieceId,b])),missing:string[]=[],stale:string[]=[];
 const shape=(p:Piece)=>JSON.stringify([p.nodes,p.holes??[],p.curves??[],p.closed]);
 const valid=run.pieces.flatMap(saved=>{const p=current.get(saved.id),b=bound.get(saved.id);if(!p){missing.push(saved.id);return [];}if(!b||b.adjusted||b.surfaceId!==surface.id||b.topologyVersion!==surface.topologyVersion||shape(p)!==shape(saved)){stale.push(saved.id);return [];}return [p];});
 return {missing,stale,run:{...run,pieces:valid,bindings:bindings.filter(b=>valid.some(p=>p.id===b.pieceId))}};
}
export function assemblySummary(surface:Surface,triangles:AssemblyTriangle[],chosen?:readonly string[]){
 const vertices=new Map(surface.vertices.map(v=>[v.id,[v.xMm,v.yMm,v.zMm]])),selected=chosen?new Set(chosen):undefined,areas=new Map<string,number>();let modelAreaMm2=0;
 for(const f of surface.faces){const points=f.vertices.map(id=>vertices.get(id)!);if(points.every(Boolean))modelAreaMm2+=assemblyArea(points);}
 for(const t of triangles)if(!selected||selected.has(t.pieceId))areas.set(t.pieceId,(areas.get(t.pieceId)??0)+assemblyArea(t.points));
 const boundAreaMm2=[...areas.values()].reduce((a,b)=>a+b,0);return {pieceCount:areas.size,triangleCount:triangles.filter(t=>!selected||selected.has(t.pieceId)).length,modelAreaMm2,boundAreaMm2,coverage:modelAreaMm2?boundAreaMm2/modelAreaMm2:0,areas};
}
/** Reassemble saved UV triangles on their original physical model. This is a
 * geometric fit preview, independent of fabric stretch and sewing simulation. */
export function cutAssembly(surface:Surface,run:SurfaceRun):AssemblyTriangle[]{
 const vertices=new Map(surface.vertices.map(v=>[v.id,v])),faces=new Map(surface.faces.map(f=>[f.id,f])),pieces=new Map(run.pieces.map(p=>[p.id,p]));
 const triangles:AssemblyTriangle[]=[];
 for(const binding of run.bindings){
  const piece=pieces.get(binding.pieceId);if(!piece||binding.surfaceId!==surface.id||binding.topologyVersion!==surface.topologyVersion)continue;
  for(const triangle of bindingTriangles(binding,surface)){
   const face=faces.get(triangle.faceId);if(!face)continue;
   const source=face.vertices.map(id=>vertices.get(id));if(source.some(v=>!v))continue;
   triangles.push({pieceId:piece.id,faceId:triangle.faceId,color:piece.color,points:triangle.barycentric.map(w=>[0,1,2].map(axis=>w.reduce((sum,n,i)=>sum+n*[source[i]!.xMm,source[i]!.yMm,source[i]!.zMm][axis],0)) as [number,number,number])});
  }
 }
 return triangles;
}

/** Clip even-odd source rings to each real binding triangle. A design cut may
 * have a trim mesh without baking its marking colors into separate pieces. */
export function cutAssemblyMarkings(surface:Surface,run:SurfaceRun,markings:Marking[]){
 const vertices=new Map(surface.vertices.map(v=>[v.id,v])),faces=new Map(surface.faces.map(f=>[f.id,f])),pieces=new Set(run.pieces.map(p=>p.id)),owners=new Map<string,{pieceId:string;triangle?:number[][]}[]>();
 for(const binding of run.bindings){if(!pieces.has(binding.pieceId)||binding.surfaceId!==surface.id||binding.topologyVersion!==surface.topologyVersion)continue;if(binding.trim&&run.options?.colorBoundaryCuts===true)continue;
  if(binding.trim){for(const triangle of binding.trim.triangles){const owner={pieceId:binding.pieceId,triangle:triangle.barycentric.map(w=>[w[1],w[2]])};owners.set(triangle.faceId,[...(owners.get(triangle.faceId)??[]),owner]);}}
  else for(const id of binding.report.faceIds)owners.set(id,[...(owners.get(id)??[]),{pieceId:binding.pieceId}]);
 }
 return markings.filter(m=>m.surfaceId===surface.id&&m.topologyVersion===surface.topologyVersion).flatMap(m=>m.fragments.flatMap(fragment=>{
  const face=faces.get(fragment.faceId);if(!face)return [];const source=face.vertices.map(id=>vertices.get(id));if(source.some(v=>!v))return [];
  return (owners.get(fragment.faceId)??[]).flatMap(owner=>{const rings=owner.triangle?fragment.rings.map(r=>clipTriangle(r.map(w=>[w[1],w[2]]),owner.triangle!)).filter(r=>r.length>=3).map(r=>r.map(([u,v])=>[1-u-v,u,v])):fragment.rings;
   if(!rings.length)return [];const depthWeights=owner.triangle?.map(([u,v])=>[1-u-v,u,v])??[[1,0,0],[0,1,0],[0,0,1]],depthPoints=depthWeights.map(w=>[0,1,2].map(axis=>w.reduce((sum,n,i)=>sum+n*[source[i]!.xMm,source[i]!.yMm,source[i]!.zMm][axis],0)));return [{pieceId:owner.pieceId,faceId:face.id,color:m.color,depthPoints,rings:rings.map(r=>r.map(w=>[0,1,2].map(axis=>w.reduce((sum,n,i)=>sum+n*[source[i]!.xMm,source[i]!.yMm,source[i]!.zMm][axis],0)) as [number,number,number]))}];});
 }));
}
function clipTriangle(subject:number[][],triangle:number[][]){let ring=subject;const cross=(a:number[],b:number[],p:number[])=>(b[0]-a[0])*(p[1]-a[1])-(b[1]-a[1])*(p[0]-a[0]),orientation=Math.sign(cross(triangle[0],triangle[1],triangle[2]));
 for(let i=0;i<3&&ring.length;i++){const a=triangle[i],b=triangle[(i+1)%3],output:number[][]=[];let previous=ring.at(-1)!,pd=cross(a,b,previous)*orientation;
  for(const point of ring){const d=cross(a,b,point)*orientation;if((d>=-1e-12)!==(pd>=-1e-12)){const t=pd/(pd-d);output.push(previous.map((v,j)=>v+(point[j]-v)*t));}if(d>=-1e-12)output.push(point);previous=point;pd=d;}ring=output;
 }
 const area=ring.reduce((sum,p,i)=>{const q=ring[(i+1)%ring.length];return sum+p[0]*q[1]-q[0]*p[1];},0);return Math.abs(area)>1e-14?ring:[];
}
