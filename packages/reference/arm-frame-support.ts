import {rasterComponents} from './raster';
type Box={minX:number;minY:number;maxX:number;maxY:number};
/** Registration evidence only: never clips or relabels a source pigment. */
export function armFrameSupport(width:number,height:number,indices:number[],top:number,span:number,paws:Box[]){
 const mask=new Uint8Array(width*height);for(const i of indices)mask[i]=1;
 const shoulderEnd=top+span*.45,upperLimbEnd=top+span*.53,minimum=Math.max(64,span*span*.0003),margin=span*.05;
 const supported:number[]=[];
 for(const group of rasterComponents(width,height,mask)){
  if(group.reduce((n,i)=>n+(Math.floor(i/width)<shoulderEnd?1:0),0)<minimum)continue;
  let minX=width,maxX=0,maxY=0;for(const i of group){minX=Math.min(minX,i%width);maxX=Math.max(maxX,i%width+1);maxY=Math.max(maxY,Math.floor(i/width)+1);}
  // A substantial shoulder-connected arm can extend below the torso/tail
  // transition. Keep that extension only when its wrist reaches a paw;
  // a separate low hip or horizontal tail supplies no shoulder evidence.
  const wrist=paws.some(b=>b.minY>upperLimbEnd&&Math.abs(maxY-b.minY)<=margin&&(b.minX+b.maxX)/2>=minX-margin&&(b.minX+b.maxX)/2<=maxX+margin);
  for(const i of group)if(wrist||Math.floor(i/width)<=upperLimbEnd)supported.push(i);
 }
 return supported;
}
