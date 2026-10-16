import {surfaceSchema,type Surface} from '../schema/index';
import {surfaceDimensions,type ModelDimensions} from './dimensions';
export {surfaceDimensions,type ModelDimensions} from './dimensions';
const axes=['xMm','yMm','zMm'] as const;
/** Positive affine scaling around the mesh centre preserves face identities and winding. */
export function resizeSurface(surface:Surface,input:{scale?:number;dimensionsMm?:ModelDimensions}):Surface{
 if((input.scale===undefined)===(input.dimensionsMm===undefined))throw Error('MODEL_SIZE_INVALID');
 const dimensions=surfaceDimensions(surface),current=[dimensions.width,dimensions.height,dimensions.depth],requested=input.dimensionsMm&&[input.dimensionsMm.width,input.dimensionsMm.height,input.dimensionsMm.depth];
 if(input.scale!==undefined&&(!Number.isFinite(input.scale)||input.scale<=0||input.scale>100000))throw Error('MODEL_SIZE_INVALID');
 const factors=requested?requested.map((size,i)=>{if(!Number.isFinite(size)||size<0||size>100000||current[i]>1e-10&&size<=0||current[i]<=1e-10&&size!==0)throw Error('MODEL_SIZE_INVALID');return current[i]<=1e-10?1:size/current[i];}):axes.map(()=>input.scale!);
 const centres=axes.map(axis=>{let min=Infinity,max=-Infinity;for(const v of surface.vertices){min=Math.min(min,v[axis]);max=Math.max(max,v[axis]);}return (min+max)/2;});
 const transform=<T extends {xMm:number;yMm:number;zMm:number}>(point:T):T=>({...point,...Object.fromEntries(axes.map((axis,i)=>[axis,centres[i]+(point[axis]-centres[i])*factors[i]]))});
 // Recipe parameters and measurements cannot describe arbitrary affine transforms.
 const {template,parameters,customTemplate,assembly,sculpt,...base}=surface;
 return surfaceSchema.parse({...base,source:surface.source==='glb'?'glb':'obj',topologyVersion:surface.topologyVersion+1,vertices:surface.vertices.map(transform),cutLines:surface.cutLines?.map(line=>({...line,controlPoints:line.controlPoints.map(transform),projection:undefined,section:undefined})),cutScope:surface.cutScope?{...surface.cutScope,positionMm:centres[axes.indexOf((surface.cutScope.axis+'Mm') as typeof axes[number])]+(surface.cutScope.positionMm-centres[axes.indexOf((surface.cutScope.axis+'Mm') as typeof axes[number])])*factors[axes.indexOf((surface.cutScope.axis+'Mm') as typeof axes[number])]}:undefined});
}
