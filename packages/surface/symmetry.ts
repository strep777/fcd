import type {Surface,CutProjection} from '../schema/index';
import type {Shape} from './attached-edit';
import {mapShapeContour} from './shape-contour';
type XYZ={xMm:number;yMm:number;zMm:number};
export function mirrorSurfacePoint<T extends XYZ>(surface:Surface,p:T):T{const scope=surface.cutScope,axis=scope?.axis??'x',position=scope?.positionMm??0,key=`${axis}Mm` as keyof XYZ;return {...p,[key]:2*position-p[key]};}
export function mirrorSurfaceFrame(surface:Surface,frame:CutProjection):CutProjection{const axis=surface.cutScope?.axis??'x',index={x:0,y:1,z:2}[axis],position=surface.cutScope?.positionMm??0;return {origin:frame.origin.map((v,i)=>i===index?2*position-v:v) as CutProjection['origin'],axes:frame.axes.map(a=>a.map((v,i)=>i===index?-v:v)) as CutProjection['axes']};}
/** Reflect local X too, keeping the projection frame right-handed. */
export function mirrorPaintShape(surface:Surface,shape:Shape):Shape{const frame=mirrorSurfaceFrame(surface,shape),contour=mapShapeContour(shape,p=>({xMm:-p.xMm,yMm:p.yMm}));return {...contour,...frame,axes:[frame.axes[0].map(v=>-v) as [number,number,number],frame.axes[1],frame.axes[2]],regions:undefined,anchorFaceId:undefined};}
/** Model-space symmetry guide is independent of the current camera. */
export function surfaceSymmetryGuide(surface:Surface):{a:XYZ;b:XYZ}[]{
 const axis=surface.cutScope?.axis??'x',position=surface.cutScope?.positionMm??0,key=`${axis}Mm` as keyof XYZ,keys=['xMm','yMm','zMm'] as const;
 const min={xMm:Infinity,yMm:Infinity,zMm:Infinity},max={xMm:-Infinity,yMm:-Infinity,zMm:-Infinity};for(const p of surface.vertices)for(const k of keys){min[k]=Math.min(min[k],p[k]);max[k]=Math.max(max[k],p[k]);}
 const other=keys.filter(k=>k!==key),center={xMm:(min.xMm+max.xMm)/2,yMm:(min.yMm+max.yMm)/2,zMm:(min.zMm+max.zMm)/2};center[key]=position;
 return other.map(k=>({a:{...center,[k]:min[k]},b:{...center,[k]:max[k]}}));
}
