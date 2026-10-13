import type {Marking,Project,SurfaceRun} from '../../../packages/schema/index';
import {area,clip,markingFingerprint,staleMarkingIds} from './markings';
import {pieceGeometryHash} from './surface';
import {DomainError,hash} from './repository';
import {fragmentPatternRings} from './fragment-mapping';
import {continuousFragments} from './fragment-continuity';
import {boundedMarkingRings} from './marking-path-budget';

/** Reuse saved barycentric fragments, so editing cut lines does not require repainting. */
export async function unwrapMarkings(worker:string,project:Project,run:SurfaceRun,precisionDigits=4,fragmentTolerance=.0002){
 if(staleMarkingIds(project,false).size)throw new DomainError('STALE_MARKING');
 const mesh=project.surface!;
 const faces=new Map(mesh.faces.map(f=>[f.id,f]));
 const result:Marking[]=[];
 for(const marking of project.markings??[]){
  if(marking.surfaceId!==mesh.id||marking.surfaceHash!==hash(JSON.stringify(mesh)))throw new DomainError('STALE_MARKING');
  const rings=new Map<string,[number,number][][]>(),fragments=continuousFragments(mesh,marking,fragmentTolerance);
  for(const binding of run.bindings){
   if(binding.trim){const mapped=await fragmentPatternRings(worker,mesh,binding,fragments,precisionDigits);if(mapped.length)rings.set(binding.pieceId,mapped);continue;}
   const bound=new Set(binding.report.faceIds),uv=new Map(binding.report.uv.map(v=>[v.vertexId,v]));
   for(const fragment of fragments){
    if(!bound.has(fragment.faceId))continue;
    const face=faces.get(fragment.faceId);if(!face)throw new DomainError('STALE_MARKING');
    const triangle=face.vertices.map(id=>uv.get(id));if(triangle.some(v=>!v))throw new DomainError('STALE_BINDING');
    const mapped=fragment.rings.map(r=>r.map(w=>[w.reduce((s,v,i)=>s+v*triangle[i]!.xMm,0),w.reduce((s,v,i)=>s+v*triangle[i]!.yMm,0)] as [number,number]));
    if(area(mapped[0])<0)mapped.forEach(r=>r.reverse());
    rings.set(binding.pieceId,[...(rings.get(binding.pieceId)??[]),...mapped]);
   }
  }
  const entries=[...rings],merged=await clip(worker,entries.map(([,subjects])=>({subjects,union:true})),precisionDigits);
  const paths:Marking['paths']=[];
  for(let i=0;i<entries.length;i++){const [pieceId]=entries[i],bounded=await boundedMarkingRings(merged[i],precisionDigits,jobs=>clip(worker,jobs,precisionDigits));paths.push({pieceId,geometryHash:pieceGeometryHash(run.pieces.find(p=>p.id===pieceId)!),rings:bounded.map(r=>r.map(([xMm,yMm])=>({xMm,yMm})))});}
  result.push({...marking,paths});
 }
 for(const m of result)if(m.inference){const parent=result.find(p=>p.id===m.inference!.sourceMarkingId);if(parent)m.inference={...m.inference,sourceFingerprint:markingFingerprint(parent)};}
 for(const piece of run.pieces){
  if(run.bindings.find(b=>b.pieceId===piece.id)?.trim)continue;
  const coverage=result.flatMap(m=>m.paths.filter(p=>p.pieceId===piece.id).map(p=>({color:m.color,size:Math.abs(p.rings.reduce((sum,r)=>sum+area(r.map(v=>[v.xMm,v.yMm])),0))})));
  piece.color=coverage.sort((a,b)=>b.size-a.size)[0]?.color??'#d4d4d4';
  const binding=run.bindings.find(b=>b.pieceId===piece.id)!;binding.geometryHash=pieceGeometryHash(piece);
 }
 return result;
}
