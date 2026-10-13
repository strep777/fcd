import {validateSurface} from './surface';
import type {Project,Surface,Marking} from '../../../packages/schema/index';
import {resizeSurface} from '../../../packages/surface/resize';
import {mapShapeContour} from '../../../packages/surface/shape-contour';
import {DomainError,hash} from './repository';
import {markingFingerprint,staleMarkingIds} from './markings';
import {assertModelDetach} from './project-lifecycle';
type V=[number,number,number];
const dot=(a:V,b:V)=>a.reduce((n,v,i)=>n+v*b[i],0);
const cross=(a:V,b:V):V=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
const unit=(a:V):V=>{const n=Math.hypot(...a);if(n<1e-12)throw new DomainError('MODEL_SIZE_INVALID');return a.map(v=>v/n) as V;};
function affine(old:Surface,next:Surface){
 const axes=['xMm','yMm','zMm'] as const;
 const limits=(s:Surface)=>axes.map(axis=>{let min=Infinity,max=-Infinity;for(const v of s.vertices){min=Math.min(min,v[axis]);max=Math.max(max,v[axis]);}return {min,max,centre:(min+max)/2};});
 const a=limits(old),b=limits(next),f=a.map((v,i)=>v.max-v.min>1e-10?(b[i].max-b[i].min)/(v.max-v.min):1);
 return {vector:(v:V)=>v.map((x,i)=>x*f[i]) as V,point:(v:V)=>v.map((x,i)=>b[i].centre+(x-a[i].centre)*f[i]) as V};
}
/** Transform an oblique paint plane exactly under a positive affine mesh resize. */
export function resizeShape(shape:NonNullable<Marking['surfaceShape']>,old:Surface,next:Surface):NonNullable<Marking['surfaceShape']>{
 const t=affine(old,next),u=t.vector(shape.axes[0]),v=t.vector(shape.axes[1]),right=unit(u),normal=unit(cross(u,v)),up=unit(cross(normal,right));
 const map=<T extends {xMm:number;yMm:number}>(p:T):T=>{const q=u.map((x,i)=>x*p.xMm+v[i]*p.yMm) as V;return {...p,xMm:dot(q,right),yMm:dot(q,up)};};
 return {...mapShapeContour(shape,map),origin:t.point(shape.origin),axes:[right,up,normal]};
}
export function resizeProject(project:Project,input:Parameters<typeof resizeSurface>[1]){
 const previous=project.surface;if(!previous)throw new DomainError('SURFACE_MISSING');
 if(project.markings?.some(m=>m.locked))throw new DomainError('MARKING_LOCKED');
 if(staleMarkingIds(project,false).size)throw new DomainError('STALE_MARKING');
 let next:Surface;try{next=resizeSurface(previous,input);validateSurface(next);}catch{throw new DomainError('MODEL_SIZE_INVALID');}
 const removed=new Set(project.bindings?.filter(b=>b.surfaceId===previous.id).map(b=>b.pieceId));assertModelDetach(project,removed);
 // A projected marking may explicitly use a bound cut as its source. Removing
 // that cut would orphan the source hash even though its 3D fragments survive.
 if(project.markings?.some(m=>m.sourcePieceId&&removed.has(m.sourcePieceId)))throw new DomainError('MARKING_SOURCE_BOUND');
 if(project.seams?.some(s=>s.locked&&(removed.has(s.a.pieceId)||removed.has(s.b.pieceId))))throw new DomainError('SEAM_LOCKED');
 project.pieces=project.pieces.filter(p=>!removed.has(p.id));project.seams=project.seams?.filter(s=>!removed.has(s.a.pieceId)&&!removed.has(s.b.pieceId));project.bindings=[];
 project.surface=next;const surfaceHash=hash(JSON.stringify(next));
 project.markings=project.markings?.map(m=>{const shape=m.surfaceShape?resizeShape(m.surfaceShape,previous,next):undefined;return {...m,surfaceHash,topologyVersion:next.topologyVersion,paths:[],...(shape?{surfaceShape:shape,sourceHash:hash(JSON.stringify(shape))}:{}),...(m.placement?{placement:{...m.placement,reviewed:false}}:{})};});
 for(const m of project.markings??[])if(m.inference){const parent=project.markings?.find(p=>p.id===m.inference!.sourceMarkingId);if(!parent)throw new DomainError('STALE_MARKING');m.inference={...m.inference,sourceFingerprint:markingFingerprint(parent),reviewed:false};}
 project.surfaceRun=undefined;project.previewMarkings=undefined;project.nesting=undefined;project.activeCutId=undefined;
}
