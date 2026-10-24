import type {Binding,Marking,Surface,Project} from '../../../packages/schema/index';
import {bindingTriangles,triangleWeights,type XY} from '../../../packages/surface/triangles';
import {clip,positive,markingFingerprint} from './markings';
import {pieceGeometryHash} from './surface';
import {boundedMarkingRings} from './marking-path-budget';
import {DomainError} from './repository';

/** A color cut has its own clipped triangles, including fractional mesh boundaries. */
export async function fragmentPatternRings(worker:string,surface:Surface,binding:Binding,fragments:Marking['fragments'],precisionDigits=4,signal?:AbortSignal){
 if(signal?.aborted)throw new DomainError('CANCELLED');
 const compact=(rings:XY[][])=>boundedMarkingRings(rings,precisionDigits,jobs=>clip(worker,jobs,precisionDigits,signal));
 if(!binding.trim){const faces=new Map(surface.faces.map(f=>[f.id,f])),bound=new Set(binding.report.faceIds),uv=new Map(binding.report.uv.map(v=>[v.vertexId,v]));const subjects=fragments.filter(f=>bound.has(f.faceId)).flatMap(f=>{const points=faces.get(f.faceId)!.vertices.map(id=>uv.get(id)!);return f.rings.map(r=>r.map(w=>[w.reduce((s,n,j)=>s+n*points[j].xMm,0),w.reduce((s,n,j)=>s+n*points[j].yMm,0)] as XY));});return subjects.length?compact((await clip(worker,[{subjects,union:true}],precisionDigits,signal))[0]):[];}
 // A face may have several independent fragments (occlusion or separate paint
 // islands). A Map(faceId, rings) silently discarded every fragment but the last.
 // Intersect each fragment separately so its own even-odd holes remain intact,
 // then union the mapped pieces below.
 const byFace=new Map<string,Marking['fragments']>();for(const fragment of fragments){const list=byFace.get(fragment.faceId)??[];list.push(fragment);byFace.set(fragment.faceId,list);}
 const entries=bindingTriangles(binding,surface).flatMap(triangle=>(byFace.get(triangle.faceId)??[]).map(fragment=>({triangle,fragment}))),triangles=entries.map(e=>e.triangle);
 const jobs=entries.map(({triangle:t,fragment})=>({subjects:fragment.rings.map(r=>r.map(w=>[w[1]*1000,w[2]*1000] as XY)),clips:[positive(t.barycentric.map(w=>[w[1]*1000,w[2]*1000]))]}));
 const results=await clip(worker,jobs,precisionDigits,signal),mapped=results.flatMap((rings,i)=>{const t=triangles[i],bary=t.barycentric.map(w=>[w[1]*1000,w[2]*1000] as XY);return rings.map(r=>r.map(p=>{const w=triangleWeights(p,bary);return [w.reduce((s,n,j)=>s+n*t.uv[j][0],0),w.reduce((s,n,j)=>s+n*t.uv[j][1],0)] as XY;}));});
 if(!mapped.length)return [];
 return compact((await clip(worker,[{subjects:mapped,union:true}],precisionDigits,signal))[0]);
}
export async function mappedMarking(worker:string,project:Project,marking:Marking,signal?:AbortSignal){if(signal?.aborted)throw new DomainError('CANCELLED');const paths:Marking['paths']=[];for(const binding of project.bindings??[]){if(signal?.aborted)throw new DomainError('CANCELLED');const piece=project.pieces.find(p=>p.id===binding.pieceId);if(!piece)continue;const rings=await fragmentPatternRings(worker,project.surface!,binding,marking.fragments,4,signal);if(rings.length)paths.push({pieceId:piece.id,geometryHash:pieceGeometryHash(piece),rings:rings.map(r=>r.map(([xMm,yMm])=>({xMm,yMm})))});}return {...marking,paths};}
export async function mapProjectMarkings(worker:string,project:Project,markings:Marking[]){const result=[];for(const m of markings)result.push(await mappedMarking(worker,project,m));for(const m of result)if(m.inference){const parent=result.find(p=>p.id===m.inference!.sourceMarkingId);if(parent)m.inference={...m.inference,sourceFingerprint:markingFingerprint(parent)};}return result;}
