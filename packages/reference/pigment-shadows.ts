import {rasterComponents} from './raster';

/** Re-evaluate evidence after every material reassignment. Warm yellow shade
 * can temporarily support a connected pink candidate; after recovering it,
 * its low-chroma fringe must not inherit that stale material classification.
 * Dark saturated pink remains valid without a bright-highlight requirement. */
export function suppressUnsupportedWarmShadows(width:number,height:number,foreground:Uint8Array,labels:Int8Array,saturation:Float32Array,value:Float32Array){
 const candidates=Uint8Array.from(labels,(label,i)=>foreground[i]&&label===1?1:0);let recovered=0;
 for(const group of rasterComponents(width,height,candidates)){
  const strong=group.reduce((count,i)=>count+(saturation[i]>=.32&&value[i]>=.35?1:0),0);
  if(strong<Math.max(16,group.length*.03))for(const i of group){labels[i]=0;recovered++;}
 }
 return recovered;
}

/** Recover warm yellow-fur shadows only through gradual, chromatic image edges.
 * Ink, white highlights, neutral fur and strong pigment changes stop propagation. */
export function recoverYellowShadows(width:number,height:number,rgba:Uint8Array,foreground:Uint8Array,ink:Uint8Array,labels:Int8Array,hue:Float32Array,saturation:Float32Array,value:Float32Array){
 const neighbors=(i:number)=>{const x=i%width,y=Math.floor(i/width);return [x?i-1:-1,x+1<width?i+1:-1,y?i-width:-1,y+1<height?i+width:-1];};
 const candidate=(i:number)=>i>=0&&foreground[i]&&!ink[i]&&(labels[i]===0||labels[i]===1)&&hue[i]>=20&&hue[i]<=95&&saturation[i]>=.18&&value[i]>=.2;
 const queue:number[]=[];for(let i=0;i<labels.length;i++)if(labels[i]===2&&neighbors(i).some(candidate))queue.push(i);
 let recoveredPixels=0;
 for(let q=0;q<queue.length;q++)for(const n of neighbors(queue[q]))if(candidate(n)){
  const i=queue[q],distance=Math.hypot(rgba[i*4]-rgba[n*4],rgba[i*4+1]-rgba[n*4+1],rgba[i*4+2]-rgba[n*4+2]);
  if(distance>55||Math.abs(hue[i]-hue[n])>18||Math.abs(saturation[i]-saturation[n])>.22||Math.abs(value[i]-value[n])>.18)continue;
  labels[n]=2;queue.push(n);recoveredPixels++;
 }
 return recoveredPixels;
}
