import type {Surface} from '../schema/index';
export type ModelDimensions={width:number;height:number;depth:number};
export function surfaceDimensions(surface:Surface):ModelDimensions{
 const sizes=(['xMm','yMm','zMm'] as const).map(axis=>{let min=Infinity,max=-Infinity;for(const v of surface.vertices){min=Math.min(min,v[axis]);max=Math.max(max,v[axis]);}return max-min;});
 return {width:sizes[0],height:sizes[1],depth:sizes[2]};
}
