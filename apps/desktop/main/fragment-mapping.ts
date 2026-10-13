import type {Binding,Marking,Surface,Project} from '../../../packages/schema/index';
import {bindingTriangles,triangleWeights,type XY} from '../../../packages/surface/triangles';
import {clip,positive,markingFingerprint} from './markings';
import {pieceGeometryHash} from './surface';
import {boundedMarkingRings} from './marking-path-budget';

/** A color cut has its own clipped triangles, including fractional mesh boundaries. */
export async function fragmentPatternRings(worker:string,surface:Surface,binding:Binding,fragments:Marking['fragments'],precisionDigits=4){
 const compact=(rings:XY[][])=>boundedMarkingRings(rings,precisionDigits,jobs=>clip(worker,jobs,precisionDigits));
 if(!binding.trim){const faces=new Map(surface.faces.map(f=>[f.id,f])),bound=new Set(binding.report.faceIds),uv=new Map(binding.report.uv.map(v=>[v.vertexId,v]));const subjects=fragments.filter(f=>bound.has(f.faceId)).flatMap(f=>{const points=faces.get(f.faceId)!.vertices.map(id=>uv.get(id)!);return f.rings.map(r=>r.map(w=>[w.reduce((s,n,j)=>s+n*points[j].xMm,0),w.reduce((s,n,j)=>s+n*points[j].yMm,0)] as XY));});return subjects.length?compact((await clip(worker,[{subjects,union:true}],precisionDigits))[0]):[];}
 const byFace=new Map(fragments.map(f=>[f.faceId,f.rings])),triangles=bindingTriangles(binding,surface).filter(t=>byFace.has(t.faceId));
 const jobs=triangles.map(t=>({subjects:byFace.get(t.faceId)!.map(r=>r.map(w=>[w[1]*1000,w[2]*1000] as XY)),clips:[positive(t.barycentric.map(w=>[w[1]*1000,w[2]*1000]))]}));
 const results=await clip(worker,jobs,precisionDigits),mapped=results.flatMap((rings,i)=>{const t=triangles[i],bary=t.barycentric.map(w=>[w[1]*1000,w[2]*1000] as XY);return rings.map(r=>r.map(p=>{const w=triangleWeights(p,bary);return [w.reduce((s,n,j)=>s+n*t.uv[j][0],0),w.reduce((s,n,j)=>s+n*t.uv[j][1],0)] as XY;}));});
 if(!mapped.length)return [];
 return compact((await clip(worker,[{subjects:mapped,union:true}],precisionDigits))[0]);
}
export async function mappedMarking(worker:string,project:Project,marking:Marking){const paths:Marking['paths']=[];for(const binding of project.bindings??[]){const piece=project.pieces.find(p=>p.id===binding.pieceId);if(!piece)continue;const rings=await fragmentPatternRings(worker,project.surface!,binding,marking.fragments);if(rings.length)paths.push({pieceId:piece.id,geometryHash:pieceGeometryHash(piece),rings:rings.map(r=>r.map(([xMm,yMm])=>({xMm,yMm})))});}return {...marking,paths};}
export async function mapProjectMarkings(worker:string,project:Project,markings:Marking[]){const result=[];for(const m of markings)result.push(await mappedMarking(worker,project,m));for(const m of result)if(m.inference){const parent=result.find(p=>p.id===m.inference!.sourceMarkingId);if(parent)m.inference={...m.inference,sourceFingerprint:markingFingerprint(parent)};}return result;}
