import {pigmentInstances} from './region-instances';
import {mergeUnsupportedInstanceLabels} from './instance-boundaries';

/** A saturated brown or pink stroke can separate pads. Only add divisions
 * inside existing instances: changing seed bands must not merge known pads.
 * Every added interface needs a sustained two-sided source darkness valley;
 * a narrow neck or bright reflection alone is not a fabric separator. */
export function splitStrongPinkInstances(width:number,height:number,groups:number[][],ink:Uint8Array,strongBand:Uint8Array,light:Float32Array){
 if(groups.length&&(ink.length!==width*height||strongBand.length!==width*height||light.length!==width*height))throw Error('IMAGE_LIMIT');
 return groups.flatMap(group=>{
  if(!group.length)return [];
  // Pixels outside this group's bounds cannot participate in its flood or
  // supply separator evidence. Preserve raster order in the smaller frame.
  let minX=width,minY=height,maxX=0,maxY=0;
  for(const i of group){const x=i%width,y=Math.floor(i/width);minX=Math.min(minX,x);minY=Math.min(minY,y);maxX=Math.max(maxX,x);maxY=Math.max(maxY,y);}
  const w=maxX-minX+1,h=maxY-minY+1,size=w*h,local=new Uint8Array(size),localInk=new Uint8Array(size),localBand=new Uint8Array(size),localLight=new Float32Array(size);
  const index=(i:number)=>(Math.floor(i/width)-minY)*w+i%width-minX,global=(i:number)=>(Math.floor(i/w)+minY)*width+i%w+minX;
  for(const i of group){const j=index(i);local[j]=1;localInk[j]=ink[i];localBand[j]=strongBand[i];localLight[j]=light[i];}
  const split=pigmentInstances(w,h,local,localInk,localBand,localLight);if(split.length<2)return split.map(g=>g.map(global));
  const ids=new Int32Array(size).fill(-1);split.forEach((g,id)=>g.forEach(i=>ids[i]=id));
  mergeUnsupportedInstanceLabels(w,h,ids,localInk,localLight,split.length,{support:.65,contrast:.04});
  const merged=new Map<number,number[]>();for(const i of group){const id=ids[index(i)],list=merged.get(id)??[];list.push(i);merged.set(id,list);}
  return [...merged.values()];
 });
}
