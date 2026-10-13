import {markingSchema, surfaceBrushSchema, type Marking, type Project} from '../../../packages/schema/index';
import {sampleShapeContour} from '../../../packages/surface/shape-contour';
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
 const projected=await surfaceMarking(worker,project,shape,old.color,old.name);
 const next=markingSchema.parse({...projected,id:old.id,locked:old.locked,
  ...(old.inference?{inference:{...old.inference,reviewed:false}}:{})});
 return mappedMarking(worker,project,next);
}

/** A round brush sweeps capsules rather than disconnected sampled circles. */
export async function brushSurfaceMarking(worker:string,project:Project,id:string,input:unknown):Promise<Marking> {
 const old=editableMarking(project,id),stroke=surfaceBrushSchema.parse(input),shape=stroke.shape??old.surfaceShape;
 if(!shape)throw new DomainError('MARKING_EDIT_FRAME');
 const radius=stroke.radiusMm;
 // Sagitta stays below 0.05 mm at ordinary brush sizes; cap input work explicitly.
 const count=Math.max(16,Math.min(128,Math.ceil(Math.PI/Math.acos(Math.max(-1,1-.05/radius)))));
 const swept:XY[][]=[];
 for(let i=0;i<stroke.points.length;i++){
  const p=stroke.points[i];
  swept.push(Array.from({length:count},(_,j)=>[p.xMm+radius*Math.cos(j*2*Math.PI/count),p.yMm+radius*Math.sin(j*2*Math.PI/count)] as XY));
  if(i){const a=stroke.points[i-1],dx=p.xMm-a.xMm,dy=p.yMm-a.yMm,d=Math.hypot(dx,dy);if(d>1e-9){const x=-dy*radius/d,y=dx*radius/d;swept.push(positive([[a.xMm+x,a.yMm+y],[a.xMm-x,a.yMm-y],[p.xMm-x,p.yMm-y],[p.xMm+x,p.yMm+y]]));}}
 }
 const brush=(await clip(worker,[{subjects:swept,union:true}]))[0];
 const outer=sampleShapeContour(shape);
 const subjects=[positive(outer.map(p=>[p.xMm,p.yMm])),...(shape.holes??[]).map(h=>positive(h.map(p=>[p.xMm,p.yMm] as XY)).reverse())];
 const rings=(await clip(worker,[stroke.mode==='add'?{subjects:[...subjects,...brush],union:true}:{subjects,union:true,subtract:brush}]))[0].filter(r=>Math.abs(area(r))>1e-6);
 if(!rings.length)throw new DomainError('EMPTY_MARKING');
 const outers=rings.filter(r=>area(r)>0),holes=rings.filter(r=>area(r)<0);
 // Never silently discard an island produced by an erasing stroke.
 if(outers.length!==1)throw new DomainError('MARKING_DISCONNECTED');
 if(rings.some(r=>r.length>2000)||holes.length>32)throw new DomainError('PROJECTION_LIMIT');
 return editSurfaceMarking(worker,project,id,{...(shape.regions?{regions:shape.regions}:{}),origin:shape.origin,axes:shape.axes,nodes:outers[0].map(([xMm,yMm])=>({xMm,yMm})),holes:holes.map(r=>r.map(([xMm,yMm])=>({xMm,yMm})))});
}
