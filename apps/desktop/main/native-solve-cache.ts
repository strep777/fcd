import type {Surface,SurfaceReport} from '../../../packages/schema/index';
import {hash} from './repository';

type SolveInput={protocolVersion:number;operation:string;mesh:{vertices:Surface['vertices'];faces:Surface['faces'];repair_cuts:boolean;method:string;iterations:number;initial_uv?:SurfaceReport['uv']}};
/** IDs label stations; the native equations use their array indices. Preserve
 * the complete ordered topology, exact coordinates and seed in the identity.
 * Coincident stations on opposite sides of a dart remain distinct indices. */
export function nativeSolveIdentity(input:SolveInput){
 const mesh=input.mesh,vertices=new Map(mesh.vertices.map((v,i)=>[v.id,i])),faces=new Set(mesh.faces.map(f=>f.id));
 if(vertices.size!==mesh.vertices.length||faces.size!==mesh.faces.length||mesh.faces.some(f=>f.vertices.some(id=>!vertices.has(id))))return hash(JSON.stringify(input));
 const seed=mesh.initial_uv?new Map(mesh.initial_uv.map(p=>[p.vertexId,p])):undefined;
 if(seed&&(seed.size!==mesh.initial_uv!.length||seed.size!==vertices.size||[...seed].some(([id,p])=>!vertices.has(id)||!Number.isFinite(p.xMm)||!Number.isFinite(p.yMm))))return hash(JSON.stringify(input));
 const regions=new Map<string,number>();
 const indexed={protocolVersion:input.protocolVersion,operation:input.operation,mesh:{vertices:mesh.vertices.map(v=>[v.xMm,v.yMm,v.zMm]),faces:mesh.faces.map(f=>{if(!regions.has(f.region))regions.set(f.region,regions.size);return[f.vertices.map(id=>vertices.get(id)!),regions.get(f.region)!];}),repair_cuts:mesh.repair_cuts,method:mesh.method,iterations:mesh.iterations,...(seed?{initial_uv:mesh.vertices.map(v=>{const p=seed.get(v.id)!;return[p.xMm,p.yMm];})}:{})}};
 return hash(JSON.stringify(indexed));
}
export function restoreCachedReports(patches:SurfaceReport[],previous:{vertices:string[];faces:string[]},mesh:{vertices:Surface['vertices'];faces:Surface['faces']}){
 const vertices=new Map(previous.vertices.map((id,i)=>[id,mesh.vertices[i].id])),faces=new Map(previous.faces.map((id,i)=>[id,mesh.faces[i].id]));
 return patches.map(p=>({...p,...(p.arap?{arap:{...p.arap}}:{}),faceIds:p.faceIds.map(id=>faces.get(id)!),uv:p.uv.map(v=>({...v,vertexId:vertices.get(v.vertexId)!})),boundary:p.boundary.map(id=>vertices.get(id)!),...(p.holes?{holes:p.holes.map(r=>r.map(id=>vertices.get(id)!))}:{}),...(p.faceDistortion?{faceDistortion:p.faceDistortion.map(f=>({...f,faceId:faces.get(f.faceId)!}))}:{})}));
}
