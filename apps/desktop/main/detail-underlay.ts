import type {Project,Marking,Piece} from '../../../packages/schema/index';
import {placedPoint} from '../../../packages/reference/placement-transform';
import {analyze} from './worker';
import {clip,positive,area,type XY} from './markings';

/** A printed island inside a source colour hole needs cloth underneath it.
 * Fill only a complete source hole covered by attached detail artwork in the
 * same reference frame. Real surface holes and uncertain/partial gaps remain.
 * This returns derived cut geometry, never edits the saved library artwork. */
export async function detailUnderlaySources(worker:string,project:Project){
 const regions=new Map((project.patternLibrary??[]).map(r=>[r.piece.id,r])),sources=new Map<string,Piece>();
 const details=(project.markings??[]).filter(m=>m.fabrication==='detail'&&m.sourcePieceId&&regions.has(m.sourcePieceId)&&m.editMode!=='uv-manual'&&!m.surfaceShape&&!m.inference);
 if(!details.length)return sources;
 const sameFrame=(a:Marking,b:Marking)=>a.view===b.view&&[[0,0],[1,0],[0,1]].every(([xMm,yMm])=>{
  const p=a.placement?placedPoint({xMm,yMm},a.placement,a.offsetXmm,a.offsetYmm):{xMm:xMm+a.offsetXmm,yMm:yMm+a.offsetYmm},q=b.placement?placedPoint({xMm,yMm},b.placement,b.offsetXmm,b.offsetYmm):{xMm:xMm+b.offsetXmm,yMm:yMm+b.offsetYmm};
  return Math.hypot(p.xMm-q.xMm,p.yMm-q.yMm)<=1e-8;
 });
 const cloth=(project.markings??[]).filter(m=>m.fabrication!=='detail'&&m.sourcePieceId&&regions.get(m.sourcePieceId)?.piece.holes?.length),pieces=[...new Map([...details,...cloth].map(m=>[m.sourcePieceId!,regions.get(m.sourcePieceId!)!.piece])).values()],geometry=await analyze(worker,{...project,pieces}),measured=new Map(geometry.map(g=>[g.id,g])),shapes=new Map(pieces.map(piece=>{const g=measured.get(piece.id)!;return[piece.id,[positive((g.seam??piece.nodes).map(p=>[p.xMm,p.yMm] as XY)),...(g.seamHoles??piece.holes??[]).map(r=>positive(r.map(p=>[p.xMm,p.yMm] as XY)).reverse())]];}));
 for(const marking of project.markings??[]){
  if(marking.fabrication==='detail'||!marking.sourcePieceId||marking.editMode==='uv-manual'||marking.surfaceShape||marking.inference)continue;
  const region=regions.get(marking.sourcePieceId);if(!region?.piece.holes?.length)continue;
  const matching=details.filter(m=>regions.get(m.sourcePieceId!)!.referenceId===region.referenceId&&sameFrame(marking,m));if(!matching.length)continue;
  // Union each source separately so nested detail holes do not cancel other
  // painted regions through even-odd parity or a reversed source winding.
  const detailRings=(await clip(worker,matching.map(m=>({subjects:shapes.get(m.sourcePieceId!)!,union:true})),9)).flat();
  const holes=region.piece.holes,contours=measured.get(region.piece.id)?.seamHoles;if(!contours||contours.length!==holes.length)continue;
  const remaining=await clip(worker,contours.map(h=>({subjects:[positive(h.map(p=>[p.xMm,p.yMm] as XY))],subtract:detailRings})),9);
  const retained=holes.filter((_,i)=>Math.abs(remaining[i].reduce((s,r)=>s+area(r),0))>Math.max(1e-6,Math.abs(area(contours[i].map(p=>[p.xMm,p.yMm])))*1e-8));
  if(retained.length!==holes.length){const nodes=new Set([...region.piece.nodes,...retained.flat()].map(n=>n.id));sources.set(marking.id,{...region.piece,holes:retained,...(region.piece.curves?{curves:region.piece.curves.filter(c=>nodes.has(c.startNodeId)&&nodes.has(c.endNodeId))}:{})});}
 }
 return sources;
}
