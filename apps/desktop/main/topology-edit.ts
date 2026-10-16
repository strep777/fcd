import {randomUUID,createHash} from 'node:crypto';
import {splitEdge,edgeArcPoints} from '../../../packages/pattern/edit';
import {projectSchema,type Project,type Seam,type Piece} from '../../../packages/schema/index';
import {markingFingerprint} from './marking-fingerprint';
const geometryHash=(p:Piece)=>createHash('sha256').update(JSON.stringify({nodes:p.nodes,holes:p.holes??[],curves:p.curves??[]})).digest('hex');
/** Exact subdivision retains the physical contour and remaps both sides of every affected seam. */
export function splitProjectEdge(project:Project,pieceId:string,nodeId:string,t:number):Project{
 const before=project.pieces.find(p=>p.id===pieceId);if(!before)throw Error('ENTITY_MISSING');const i=before.nodes.findIndex(n=>n.id===nodeId);if(i<0||!before.closed&&i===before.nodes.length-1)throw Error('ENTITY_MISSING');
 const after=splitEdge(before,nodeId,t),inserted=after.nodes[i+1],end=before.nodes[(i+1)%before.nodes.length],length=(id:string)=>{const points=edgeArcPoints(after,id);return points.slice(1).reduce((s,p,i)=>s+Math.hypot(p.xMm-points[i].xMm,p.yMm-points[i].yMm),0);},fraction=length(nodeId)/(length(nodeId)+length(inserted.id)),oldHash=geometryHash(before),newHash=geometryHash(after);
 const affected=(s:Seam['a'])=>s.pieceId===pieceId&&s.nodeId===nodeId&&s.endNodeId===end.id;
 const at=(side:Seam['a'],u:number)=>side.reverse?side.end-u*(side.end-side.start):side.start+u*(side.end-side.start);
 const sub=(side:Seam['a'],lo:number,hi:number):Seam['a']=>{const a=at(side,lo),b=at(side,hi),start=Math.min(a,b),finish=Math.max(a,b);if(!affected(side))return {...side,start,end:finish};if((start+finish)/2<fraction)return {...side,endNodeId:inserted.id,start:Math.max(0,start/fraction),end:Math.min(1,finish/fraction)};return {...side,nodeId:inserted.id,start:Math.max(0,(start-fraction)/(1-fraction)),end:Math.min(1,(finish-fraction)/(1-fraction))};};
 const seamChildren=new Map<string,Seam[]>();const seams=project.seams?.flatMap(seam=>{const cuts=[0,1];for(const side of [seam.a,seam.b])if(affected(side)&&fraction>side.start&&fraction<side.end)cuts.push(side.reverse?(side.end-fraction)/(side.end-side.start):(fraction-side.start)/(side.end-side.start));cuts.sort((a,b)=>a-b);const stops=cuts.filter((n,i)=>i===0||n-cuts[i-1]>1e-10);const children=stops.slice(1).map((hi,i)=>{const lo=stops[i];return {...seam,id:i===0?seam.id:randomUUID(),name:stops.length>2?(seam.name+' '+(i+1)).slice(0,120):seam.name,a:sub(seam.a,lo,hi),b:sub(seam.b,lo,hi),expectedEaseMm:seam.expectedEaseMm*(hi-lo),toleranceMm:seam.toleranceMm*(hi-lo)};});seamChildren.set(seam.id,children);return children;});
 const bindings=project.bindings?.map(b=>b.pieceId===pieceId&&b.geometryHash===oldHash?{...b,geometryHash:newHash}:b),markings=project.markings?.map(m=>({...m,sourceHash:m.sourcePieceId===pieceId&&m.sourceHash===oldHash?newHash:m.sourceHash,paths:m.paths.map(p=>p.pieceId===pieceId&&p.geometryHash===oldHash?{...p,geometryHash:newHash}:p)}));
 // Subdivision changes path identities, but preserves the painted geometry.
 // Rebase matching dependencies only; an already stale inference stays stale.
 const previousMarkings=new Map(project.markings?.map(m=>[m.id,m])),nextMarkings=new Map(markings?.map(m=>[m.id,m]));
 for(const marking of markings??[]){
  const inference=marking.inference;if(!inference)continue;
  const previous=previousMarkings.get(inference.sourceMarkingId),next=nextMarkings.get(inference.sourceMarkingId);
  if(previous&&!previous.inference&&next&&inference.sourceFingerprint===markingFingerprint(previous)){
   const fingerprint=markingFingerprint(next);
   if(fingerprint!==inference.sourceFingerprint)marking.inference={...inference,sourceFingerprint:fingerprint};
  }
 }
 const pieces=project.pieces.map(p=>p.id===pieceId?after:p).map(p=>({...p,notches:p.notches?.map(n=>{if(!n.sourceSeamId)return n;const source=project.seams?.find(s=>s.id===n.sourceSeamId);if(!source||![source.a,source.b].some(affected))return n;const candidates=seamChildren.get(source.id);const owner=candidates?.find(s=>[s.a,s.b].some(side=>side.pieceId===p.id&&side.nodeId===n.nodeId&&n.position>=side.start-1e-10&&n.position<=side.end+1e-10));return owner?{...n,sourceSeamId:owner.id}:n;})}));return projectSchema.parse({...project,pieces,seams,bindings,markings});
}
