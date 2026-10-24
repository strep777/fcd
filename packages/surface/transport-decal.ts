import type {CutProjection} from '../schema/index';
import type {Shape,World} from './attached-edit';
type Vector=[number,number,number];
const dot=(a:number[],b:number[])=>a.reduce((sum,n,i)=>sum+n*b[i],0);
const cross=(a:number[],b:number[])=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
/** Transport the original pose relative to the picked surface, not relative to
 * the decal normal. Zero displacement is an identity even on a tilted decal. */
export function transportSurfaceShape(shape:Shape,start:World,startNormal:Vector,end:World,endNormal:Vector,region?:string,faceId?:string):Shape{
 const normalize=(v:number[])=>{const length=Math.hypot(...v);if(!Number.isFinite(length)||length<1e-12)throw Error('MARKING_EDIT_FRAME');return v.map(n=>n/length);};
 const from=normalize(startNormal),to=normalize(endNormal),axis=cross(from,to),cos=Math.max(-1,Math.min(1,dot(from,to)));
 const oppositeAxis=normalize(cross(from,Math.abs(from[0])<.8?[1,0,0]:[0,1,0]));
 const rotate=(v:number[])=>{if(cos<-1+1e-8)return oppositeAxis.map((n,i)=>2*n*dot(oppositeAxis,v)-v[i]);const a=cross(axis,v),b=cross(axis,a);return v.map((n,i)=>n+a[i]+b[i]/(1+cos));};
 const a=[start.xMm,start.yMm,start.zMm],b=[end.xMm,end.yMm,end.zMm],offset=rotate(shape.origin.map((n,i)=>n-a[i]));
 return {...shape,...(faceId?{anchorFaceId:faceId}:{}),...(shape.regions&&region&&!shape.regions.includes(region)?{regions:[region]}:{}),origin:b.map((n,i)=>n+offset[i]) as Vector,axes:shape.axes.map(rotate) as CutProjection['axes']};
}
