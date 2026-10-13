import type {Surface,Binding} from '../schema/index';
import {bindingTriangles,triangleWeights,composeWeights,type Bary} from './triangles';
export type Vector3={xMm:number;yMm:number;zMm:number};
/** Exact affine map within an accepted triangle; no nearest-face fallback outside the UV domain. */
export function mapToSurface(surface:Surface,binding:Binding,point:{xMm:number;yMm:number}):{faceId:string;position:Vector3;barycentric:[number,number,number]}|null{
 if(binding.surfaceId!==surface.id||binding.topologyVersion!==surface.topologyVersion)return null;
 if(binding.trim){const candidates=[];for(const triangle of bindingTriangles(binding,surface)){const w=triangleWeights([point.xMm,point.yMm],triangle.uv);if(w.some(v=>!Number.isFinite(v))||Math.min(...w)<-1e-7)continue;const barycentric=composeWeights(w,triangle.barycentric),face=surface.faces.find(f=>f.id===triangle.faceId);if(!face)continue;const vertices=face.vertices.map(id=>surface.vertices.find(v=>v.id===id)!);candidates.push({faceId:face.id,barycentric,position:{xMm:barycentric.reduce((s,n,i)=>s+n*vertices[i].xMm,0),yMm:barycentric.reduce((s,n,i)=>s+n*vertices[i].yMm,0),zMm:barycentric.reduce((s,n,i)=>s+n*vertices[i].zMm,0)}});}return candidates.sort((a,b)=>a.faceId.localeCompare(b.faceId))[0]??null;}
 const vertices=new Map(surface.vertices.map(v=>[v.id,v])),uv=new Map(binding.report.uv.map(v=>[v.vertexId,v]));
 const candidates:{faceId:string;position:Vector3;barycentric:[number,number,number]}[]=[];
 const selectedFaces=new Set(binding.report.faceIds);for(const face of surface.faces.filter(f=>selectedFaces.has(f.id))){
  const p=face.vertices.map(id=>uv.get(id));if(p.some(p=>!p))continue;const [a,b,c]=p as NonNullable<typeof p[number]>[],den=(b.yMm-c.yMm)*(a.xMm-c.xMm)+(c.xMm-b.xMm)*(a.yMm-c.yMm);if(Math.abs(den)<1e-12)continue;
  const u=((b.yMm-c.yMm)*(point.xMm-c.xMm)+(c.xMm-b.xMm)*(point.yMm-c.yMm))/den,v=((c.yMm-a.yMm)*(point.xMm-c.xMm)+(a.xMm-c.xMm)*(point.yMm-c.yMm))/den,w=1-u-v;if(Math.min(u,v,w)<-1e-7)continue;
  const triangle=face.vertices.map(id=>vertices.get(id));if(triangle.some(v=>!v))continue;const [va,vb,vc]=triangle as Surface['vertices'];candidates.push({faceId:face.id,barycentric:[u,v,w],position:{xMm:u*va.xMm+v*vb.xMm+w*vc.xMm,yMm:u*va.yMm+v*vb.yMm+w*vc.yMm,zMm:u*va.zMm+v*vb.zMm+w*vc.zMm}});
 }
 if(!candidates.length)return null;
 const first=candidates[0];if(candidates.some(c=>Math.hypot(c.position.xMm-first.position.xMm,c.position.yMm-first.position.yMm,c.position.zMm-first.position.zMm)>1e-5))return null;return candidates.sort((a,b)=>a.faceId.localeCompare(b.faceId))[0];
}
export function mapFromSurface(binding:Binding,faceId:string,weights:[number,number,number],surface:Surface):{xMm:number;yMm:number}|null{
 if(binding.surfaceId!==surface.id||binding.topologyVersion!==surface.topologyVersion||!binding.report.faceIds.includes(faceId)||weights.some(w=>!Number.isFinite(w)||w<0)||Math.abs(weights.reduce((a,b)=>a+b,0)-1)>1e-7)return null;
 if(binding.trim){for(const triangle of bindingTriangles(binding,surface).filter(t=>t.faceId===faceId)){const w=triangleWeights([weights[1],weights[2]],triangle.barycentric.map(b=>[b[1],b[2]]));if(w.some(v=>!Number.isFinite(v))||Math.min(...w)<-1e-7)continue;return {xMm:w.reduce((s,n,i)=>s+n*triangle.uv[i][0],0),yMm:w.reduce((s,n,i)=>s+n*triangle.uv[i][1],0)};}return null;}
 const face=surface.faces.find(f=>f.id===faceId),uv=new Map(binding.report.uv.map(v=>[v.vertexId,v]));if(!face)return null;const vertices=face.vertices.map(id=>uv.get(id));if(vertices.some(v=>!v))return null;return {xMm:vertices.reduce((s,v,i)=>s+v!.xMm*weights[i],0),yMm:vertices.reduce((s,v,i)=>s+v!.yMm*weights[i],0)};
}
