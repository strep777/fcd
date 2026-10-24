import type {Shape,Point} from './attached-edit';
import {mapShapeContour,sampleShapeContour} from './shape-contour';
import {pointBounds} from '../pattern/edit';
export type TransformHandle='nw'|'n'|'ne'|'e'|'se'|'s'|'sw'|'w'|'rotate'|'move';
const rotate=(p:Point,center:Point,angle:number):Point=>{const x=p.xMm-center.xMm,y=p.yMm-center.yMm,c=Math.cos(angle),s=Math.sin(angle);return {xMm:center.xMm+x*c-y*s,yMm:center.yMm+x*s+y*c};};
const signs:Record<Exclude<TransformHandle,'rotate'|'move'>,[number,number]>={nw:[-1,1],n:[0,1],ne:[1,1],e:[1,0],se:[1,-1],s:[0,-1],sw:[-1,-1],w:[-1,0]};
export function setShapeTransform(shape:Shape,width:number,height:number,angleRad:number,initialAngleRad=0):Shape{
 if(![width,height,angleRad,initialAngleRad].every(Number.isFinite)||width<=0||height<=0)throw Error('INVALID_GEOMETRY');
 const frame=transformFrame(shape,initialAngleRad),center=frame.center;
 if(frame.width<=0||frame.height<=0)throw Error('INVALID_GEOMETRY');
 return mapShapeContour(shape,p=>{const q=rotate(p,center,-initialAngleRad);return rotate({xMm:center.xMm+(q.xMm-center.xMm)*width/frame.width,yMm:center.yMm+(q.yMm-center.yMm)*height/frame.height},center,angleRad);});
}
export function transformFrame(shape:Shape,angleRad=0){
 const points=sampleShapeContour(shape),world=pointBounds(points),origin={xMm:(world.minX+world.maxX)/2,yMm:(world.minY+world.maxY)/2},box=pointBounds(points.map(p=>rotate(p,origin,-angleRad))),local={xMm:(box.minX+box.maxX)/2,yMm:(box.minY+box.maxY)/2},center=rotate(local,origin,angleRad),width=box.maxX-box.minX,height=box.maxY-box.minY;
 const handles:{id:TransformHandle;point:Point}[]=Object.entries(signs).map(([id,[x,y]])=>({id:id as TransformHandle,point:rotate({xMm:center.xMm+x*width/2,yMm:center.yMm+y*height/2},center,angleRad)}));
 handles.push({id:'rotate',point:rotate({xMm:center.xMm,yMm:center.yMm+height/2+Math.max(width,height)*.18},center,angleRad)});
 return {width,height,center,handles};
}
/** A drag is always evaluated from its starting snapshot. Opposite handles stay
 * fixed, positive scales forbid accidental flips, and every hole/curve follows. */
export function dragShapeTransform(shape:Shape,handle:TransformHandle,start:Point,current:Point,options:{uniform?:boolean;angleRad?:number}={}){
 const angle=options.angleRad??0,frame=transformFrame(shape,angle),center=frame.center;
 if(handle==='move')return {shape:mapShapeContour(shape,p=>({xMm:p.xMm+current.xMm-start.xMm,yMm:p.yMm+current.yMm-start.yMm})),width:frame.width,height:frame.height,angleRad:angle};
 if(handle==='rotate'){let delta=Math.atan2(current.yMm-center.yMm,current.xMm-center.xMm)-Math.atan2(start.yMm-center.yMm,start.xMm-center.xMm);if(options.uniform)delta=Math.round(delta/(Math.PI/12))*Math.PI/12;return {shape:mapShapeContour(shape,p=>rotate(p,center,delta)),width:frame.width,height:frame.height,angleRad:angle+delta};}
 const [sx,sy]=signs[handle],a=rotate(start,center,-angle),b=rotate(current,center,-angle),anchor={xMm:center.xMm-sx*frame.width/2,yMm:center.yMm-sy*frame.height/2};
 let scaleX=sx?Math.max(.01,(frame.width+sx*(b.xMm-a.xMm))/Math.max(.01,frame.width)):1,scaleY=sy?Math.max(.01,(frame.height+sy*(b.yMm-a.yMm))/Math.max(.01,frame.height)):1;
 if(options.uniform){const scale=sx&&sy?(Math.abs(scaleX-1)>Math.abs(scaleY-1)?scaleX:scaleY):sx?scaleX:scaleY;scaleX=scaleY=scale;}
 const transformed=mapShapeContour(shape,p=>{const q=rotate(p,center,-angle);return rotate({xMm:anchor.xMm+(q.xMm-anchor.xMm)*scaleX,yMm:anchor.yMm+(q.yMm-anchor.yMm)*scaleY},center,angle);});
 return {shape:transformed,width:frame.width*scaleX,height:frame.height*scaleY,angleRad:angle};
}
