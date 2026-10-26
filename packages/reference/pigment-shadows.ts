import {rasterComponents} from './raster';

/** A quiet material interior and a distinct, quiet exterior are evidence of
 * a painted step even when neither pigment is saturated. A hue threshold
 * alone cannot distinguish pale fabric from a lighting cast. */
export function hasMeasuredMaterialStep(width:number,height:number,rgba:Uint8Array,foreground:Uint8Array,labels:Int8Array,group:number[]){
 if(group.length<16)return false;
 const label=labels[group[0]],neighbors=(i:number)=>{const x=i%width,y=Math.floor(i/width);return [x?i-1:-1,x+1<width?i+1:-1,y?i-width:-1,y+1<height?i+width:-1];};
 const rgb=(i:number)=>{const sum=rgba[i*4]+rgba[i*4+1]+rgba[i*4+2];return [0,1,2].map(c=>rgba[i*4+c]/(sum||1));};
 const light=(i:number)=>(rgba[i*4]+rgba[i*4+1]+rgba[i*4+2])/765;
 const mean=[0,0,0];let coreCount=0,squares=0,lightSum=0,lightSquares=0;
 for(const i of group)if(neighbors(i).every(j=>j>=0&&foreground[j]&&labels[j]===label)){
  const c=rgb(i),l=light(i);coreCount++;lightSum+=l;lightSquares+=l*l;for(let k=0;k<3;k++){mean[k]+=c[k];squares+=c[k]*c[k];}
 }
 if(coreCount<4)return false;
 for(let k=0;k<3;k++)mean[k]/=coreCount;
 const deviation=(c:number[])=>Math.hypot(...c.map((v,k)=>v-mean[k]));
 const variance=Math.max(0,squares/coreCount-mean.reduce((sum,v)=>sum+v*v,0));
 const meanLight=lightSum/coreCount,lightVariance=Math.max(0,lightSquares/coreCount-meanLight*meanLight);
 // Broad varying shadows do not supply a stable material plateau.
 if(variance>.008**2)return false;
 let borders=0,supported=0;
 for(const i of group)for(const j of neighbors(i)){
  if(j<0||!foreground[j]||labels[j]===label)continue;
  borders++;const step=j-i,owner=labels[j];let far=j,previous=j;
  // JPEG chroma subsampling spreads a sharp material step across several
  // pixels. Measure the quiet exterior beyond that transition, rather than
  // mistaking its second/third mixed pixels for an illumination gradient.
  // Stop at another owner or the silhouette; the plateau variance, contrast
  // and required proportion of supported edges remain unchanged.
  for(let k=2;k<=5;k++){const next=i+step*k;if(next<0||next>=labels.length||Math.abs(step)===1&&Math.floor(next/width)!==Math.floor(i/width)||!foreground[next]||labels[next]!==owner)break;previous=far;far=next;}
  const a=rgb(far),b=rgb(previous),contrast=deviation(a),variation=Math.hypot(...a.map((v,k)=>v-b[k]));
  const chromaticStep=contrast>=Math.max(.025,Math.sqrt(variance)*4)&&variation<=.008&&contrast>variation*4;
  // Normalized chroma cannot distinguish white paint from black material.
  // Preserve that boundary only with two stable, strongly separated light
  // plateaux; this does not promote weak brightness shading into pigment.
  const achromaticStep=label===0&&owner===6&&lightVariance<=.01**2&&Math.abs(meanLight-light(far))>=.2&&Math.abs(light(far)-light(previous))<=.02;
  if(chromaticStep||achromaticStep)supported++;
 }
 return borders>=8&&supported/borders>=.8;
}

/** Re-evaluate evidence after every material reassignment. Warm yellow shade
 * can temporarily support a connected pink candidate; after recovering it,
 * its low-chroma fringe must not inherit that stale material classification.
 * Dark saturated pink remains valid without a bright-highlight requirement. */
export function suppressUnsupportedWarmShadows(width:number,height:number,foreground:Uint8Array,labels:Int8Array,saturation:Float32Array,value:Float32Array,rgba?:Uint8Array){
 const candidates=Uint8Array.from(labels,(label,i)=>foreground[i]&&label===1?1:0);let recovered=0;
 for(const group of rasterComponents(width,height,candidates)){
  const strong=group.reduce((count,i)=>count+(saturation[i]>=.32&&value[i]>=.35?1:0),0);
  if(strong<Math.max(16,group.length*.03)&&!(rgba&&hasMeasuredMaterialStep(width,height,rgba,foreground,labels,group)))for(const i of group){labels[i]=0;recovered++;}
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
