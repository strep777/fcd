import {materialFor} from './material';
import type {Project,Geometry,Seam,Issue} from '../schema/index';
export interface SeamReport {id:string;aMm:number;bMm:number;easeMm:number;residualMm:number;toleranceMm:number;status:'valid'|'mismatch'|'stale'}
/** Validate both sides of any seam touching the output selection, using the full project's geometry. */
export function outputSeamIssues(project:Project,geometry:Geometry[],pieceIds:string[]):Issue[]{const selected=new Set(pieceIds),related=new Set(project.seams?.filter(s=>selected.has(s.a.pieceId)||selected.has(s.b.pieceId)).map(s=>s.id));return seamIssues(project,geometry).filter(i=>selected.has(i.entityId)||related.has(i.ruleId.split(':')[0]));}
export function seamReports(project:Project,geometry:Geometry[]):SeamReport[]{
 const sideLength=(s:Seam['a'])=>{
  const piece=project.pieces.find(p=>p.id===s.pieceId),i=piece?.nodes.findIndex(n=>n.id===s.nodeId)??-1;
  if(!piece||i<0||piece.nodes[(i+1)%piece.nodes.length].id!==s.endNodeId)return null;
  const edge=geometry.find(g=>g.id===s.pieceId)?.edgeLengths?.find(e=>e.nodeId===s.nodeId&&e.endNodeId===s.endNodeId);
  return edge?edge.lengthMm*(s.end-s.start):null;
 };
 return (project.seams??[]).map(seam=>{const a=sideLength(seam.a),b=sideLength(seam.b),residual=a===null||b===null?0:Math.abs(a-b-seam.expectedEaseMm);const tolerance=Math.min(seam.toleranceMm,...[seam.a,seam.b].flatMap(s=>{const p=project.pieces.find(p=>p.id===s.pieceId),m=p?materialFor(project,p):undefined;return m?[m.seamToleranceMm]:[];}));return {id:seam.id,aMm:a??0,bMm:b??0,easeMm:seam.expectedEaseMm,residualMm:residual,toleranceMm:tolerance,status:a===null||b===null?'stale':residual>tolerance?'mismatch':'valid'};});
}
export function seamIssues(project:Project,geometry:Geometry[]):Issue[]{
 const reports=seamReports(project,geometry),issues:Issue[]=reports.filter(r=>r.status!=='valid').map(r=>({ruleId:`${r.id}:seam`,entityId:project.pieces.some(p=>p.id===project.seams!.find(s=>s.id===r.id)!.a.pieceId)?project.seams!.find(s=>s.id===r.id)!.a.pieceId:project.pieces[0]?.id??project.id,severity:'error',messageKey:r.status==='stale'?'STALE_SEAM':'SEAM_LENGTH_MISMATCH'}));
 const seamIds=new Set(project.seams?.map(s=>s.id));
 for(const piece of project.pieces)if(piece.notches?.some(n=>n.sourceSeamId&&!seamIds.has(n.sourceSeamId)))issues.push({ruleId:piece.id+':orphan-notches',entityId:piece.id,severity:'error',messageKey:'STALE_SEAM_NOTCHES'});
 for(const seam of project.seams??[]){
  const sides=[seam.a,seam.b],generated=project.pieces.flatMap(p=>(p.notches??[]).filter(n=>n.sourceSeamId===seam.id).map(n=>({pieceId:p.id,...n})));
  if(!generated.length)continue;
  const groups=sides.map(s=>generated.filter(n=>n.pieceId===s.pieceId&&n.nodeId===s.nodeId&&n.position>=s.start-1e-10&&n.position<=s.end+1e-10).map(n=>({u:(s.reverse?s.end-n.position:n.position-s.start)/(s.end-s.start),depth:n.depthMm})).sort((a,b)=>a.u-b.u));
  const [a,b]=groups,r=reports.find(r=>r.id===seam.id)!,tolerance=.01/Math.max(1,r.aMm,r.bMm)+1e-7;
  if(!a.length||a.length!==b.length||a.length+b.length!==generated.length||a.some((n,i)=>Math.abs(n.u-b[i].u)>tolerance||Math.abs(n.depth-b[i].depth)>1e-6))issues.push({ruleId:seam.id+':notches',entityId:seam.a.pieceId,severity:'error',messageKey:'STALE_SEAM_NOTCHES'});
 }
 return issues;
}
