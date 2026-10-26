import {markingSchema, surfaceBrushSchema, type Marking, type Project} from '../../../packages/schema/index';
import {sampleShapeContour} from '../../../packages/surface/shape-contour';
import {compactPaintContour} from '../../../packages/surface/paint-contour';
import {brushFootprint} from '../../../packages/surface/brush-footprint';
import {DomainError} from './repository';
import {area, clip, positive, staleMarkingIds, surfaceMarking, type XY} from './markings';
import {mappedMarking} from './fragment-mapping';

export function editableMarking(project:Project,id:string):Marking {
 const old=project.markings?.find(m=>m.id===id);
 if(!old)throw new DomainError('ENTITY_MISSING');
 if(old.locked||project.markings?.some(m=>m.locked&&m.inference?.sourceMarkingId===id))throw new DomainError('MARKING_LOCKED');
 if(staleMarkingIds(project).has(id))throw new DomainError('STALE_MARKING');
 return old;
}

/** Reproject and remap every manufacturing path before replacing a single record.
 * The caller commits only the returned result, making a drag/stroke one undo step. */
export async function editSurfaceMarking(worker:string,project:Project,id:string,shape:NonNullable<Marking['surfaceShape']>):Promise<Marking> {
 const old=editableMarking(project,id);
 // Editing an anatomical copy keeps its target until an explicit drag supplies
 // a new target. The independent surface shape owns this scope thereafter.
 const regions=shape.regions??old.surfaceShape?.regions??old.placement?.regions;
 if(regions)shape={...shape,regions:[...regions]};
 if(!shape.anchorFaceId&&old.surfaceShape?.anchorFaceId)shape={...shape,anchorFaceId:old.surfaceShape.anchorFaceId};
 const projected=await surfaceMarking(worker,project,shape,old.color,old.name);
 const next=markingSchema.parse({...projected,id:old.id,locked:old.locked,...(old.fabrication?{fabrication:old.fabrication}:{}),
  ...(old.inference?{inference:{...old.inference,reviewed:false}}:{})});
 return mappedMarking(worker,project,next);
}

/** A round brush sweeps capsules rather than disconnected sampled circles. */
export async function brushSurfaceMarking(worker:string,project:Project,id:string|undefined,input:unknown):Promise<Marking> {
 const old=id?editableMarking(project,id):undefined,stroke=surfaceBrushSchema.parse(input),shape=stroke.shape??old?.surfaceShape;
 if(old&&!shape||!old&&(!stroke.paint||stroke.mode!=='add'))throw new DomainError('MARKING_EDIT_FRAME');
 const swept:XY[][]=brushFootprint(stroke.points,stroke.radiusMm,stroke.brushShape).map(r=>r.map(p=>[p.xMm,p.yMm]));
 const brush=(await clip(worker,[{subjects:swept,union:true}]))[0];
 if(!old){
  const outers=brush.filter(r=>area(r)>0),holes=brush.filter(r=>area(r)<0),paint=stroke.paint!;
  if(outers.length!==1||brush.some(r=>r.length>2000)||holes.length>32)throw new DomainError('PROJECTION_LIMIT');
  const marking=await surfaceMarking(worker,project,compactPaintContour({...paint.frame,nodes:outers[0].map(([xMm,yMm])=>({xMm,yMm})),holes:holes.map(r=>r.map(([xMm,yMm])=>({xMm,yMm})))},.25),paint.color,paint.name);
  return project.bindings?.some(b=>b.trim)?mappedMarking(worker,project,marking):marking;
 }
 const outer=sampleShapeContour(shape!);
 const subjects=[positive(outer.map(p=>[p.xMm,p.yMm])),...(shape!.holes??[]).map(h=>positive(h.map(p=>[p.xMm,p.yMm] as XY)).reverse())];
 const rings=(await clip(worker,[stroke.mode==='add'?{subjects:[...subjects,...brush],union:true}:{subjects,union:true,subtract:brush}]))[0].filter(r=>Math.abs(area(r))>1e-6);
 if(!rings.length)throw new DomainError('EMPTY_MARKING');
 const outers=rings.filter(r=>area(r)>0),holes=rings.filter(r=>area(r)<0);
 // Never silently discard an island produced by an erasing stroke.
 if(outers.length!==1)throw new DomainError('MARKING_DISCONNECTED');
 if(rings.some(r=>r.length>2000)||holes.length>32)throw new DomainError('PROJECTION_LIMIT');
 // Leave room for polygon sampling and successive edits; a half-millimetre
 // fit on every stroke can visibly accumulate error along unchanged edges.
 return editSurfaceMarking(worker,project,old.id,compactPaintContour({...(shape!.regions?{regions:shape!.regions}:{}),...(shape!.anchorFaceId?{anchorFaceId:shape!.anchorFaceId}:{}),origin:shape!.origin,axes:shape!.axes,nodes:outers[0].map(([xMm,yMm])=>({xMm,yMm})),holes:holes.map(r=>r.map(([xMm,yMm])=>({xMm,yMm})))},.25));
}
