import {components,encode,type Mask} from './mask';
export type ClusterOptions={space:'lab'|'hsv';clusters:number;minRegionPixels:number};
export type ClusterReport=ClusterOptions&{iterations:number;selectedCluster:number;discardedPixels:number;quantizationBits:5;palette:string[]};
type Triple=[number,number,number];
// sRGB transfer, XYZ D65, Bradford D50 and CIELab formulas: W3C CSS Color 4 §19.
// https://www.w3.org/TR/css-color-4/#color-conversion-code
export function lab(rgb:Triple):Triple{
 const c=rgb.map(v=>{v/=255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4;});
 const x=506752/1228815*c[0]+87881/245763*c[1]+12673/70218*c[2],y=87098/409605*c[0]+175762/245763*c[1]+12673/175545*c[2],z=7918/409605*c[0]+87881/737289*c[1]+1001167/1053270*c[2];
 const xyz=[1.0479297925449969*x+.022946870601609652*y-.05019226628920524*z,.02962780877005599*x+.9904344267538799*y-.017073799063418826*z,-.009243040646204504*x+.015055191490298152*y+.7518742814281371*z],white=[.3457/.3585,1,(1-.3457-.3585)/.3585],f=xyz.map((v,i)=>{v/=white[i];return v>216/24389?Math.cbrt(v):(24389/27*v+16)/116;});return [116*f[1]-16,500*(f[0]-f[1]),200*(f[1]-f[2])];
}
export function hsvVector(rgb:Triple):Triple{const [r,g,b]=rgb.map(v=>v/255),hi=Math.max(r,g,b),lo=Math.min(r,g,b),d=hi-lo,s=hi?d/hi:0;let h=0;if(d)h=hi===r?((g-b)/d)%6:hi===g?(b-r)/d+2:(r-g)/d+4;const a=h*Math.PI/3;return [100*s*Math.cos(a),100*s*Math.sin(a),100*hi];}
const distance=(a:Triple,b:Triple)=>(a[0]-b[0])**2+(a[1]-b[1])**2+(a[2]-b[2])**2;
/** Weighted deterministic k-means over a five-bit RGB histogram; opaque pixels only. */
function clusterSelection(width:number,height:number,rgba:Uint8Array,seed:{x:number;y:number},options:ClusterOptions,all=false):{mask:Mask;color:string;report:ClusterReport}[]{
 if(!Number.isInteger(width)||!Number.isInteger(height)||width<1||height<1||width>512||height>512||width*height>512*512||rgba.length!==width*height*4||!['lab','hsv'].includes(options.space)||!Number.isInteger(options.clusters)||options.clusters<2||options.clusters>16||!Number.isInteger(options.minRegionPixels)||options.minRegionPixels<4||options.minRegionPixels>1000)throw Error('IMAGE_LIMIT');
 const sx=Math.floor(seed.x),sy=Math.floor(seed.y);if(!Number.isFinite(seed.x)||!Number.isFinite(seed.y)||sx<0||sy<0||sx>=width||sy>=height)throw Error('INVALID_SEED');const selectedPixel=sy*width+sx;if(rgba[selectedPixel*4+3]<128)throw Error('TRANSPARENT_SEED');
 const bins=new Map<number,{key:number;n:number;rgb:Triple;feature:Triple}>(),keyAt=(i:number)=>((rgba[i*4]>>3)<<10)|((rgba[i*4+1]>>3)<<5)|(rgba[i*4+2]>>3);
 for(let i=0;i<width*height;i++){if(rgba[i*4+3]<128)continue;const key=keyAt(i),bin=bins.get(key)??{key,n:0,rgb:[0,0,0] as Triple,feature:[0,0,0] as Triple};bin.n++;for(let j=0;j<3;j++)bin.rgb[j]+=rgba[i*4+j];bins.set(key,bin);}
 const feature=options.space==='lab'?lab:hsvVector,rows=[...bins.values()].sort((a,b)=>a.key-b.key);for(const row of rows){row.rgb=row.rgb.map(v=>v/row.n) as Triple;row.feature=feature(row.rgb);}
 const first=rows.reduce((best,row)=>row.n>best.n?row:best,rows[0]),centres:Triple[]=[[...first.feature]],count=Math.min(options.clusters,rows.length);
 while(centres.length<count){let best=rows[0],score=-1;for(const row of rows){const d=Math.min(...centres.map(c=>distance(c,row.feature)));if(d>score){score=d;best=row;}}if(score<1e-12)break;centres.push([...best.feature]);}
 const closest=(v:Triple)=>{let index=0,best=Infinity;for(let i=0;i<centres.length;i++){const d=distance(v,centres[i]);if(d<best){best=d;index=i;}}return index;};let iterations=0;
 for(;iterations<20;iterations++){const sums=centres.map(()=>[0,0,0] as Triple),weights=centres.map(()=>0);for(const row of rows){const i=closest(row.feature);weights[i]+=row.n;for(let j=0;j<3;j++)sums[i][j]+=row.feature[j]*row.n;}let change=0;for(let i=0;i<centres.length;i++)if(weights[i]){const next=sums[i].map(v=>v/weights[i]) as Triple;change=Math.max(change,distance(next,centres[i]));centres[i]=next;}if(change<1e-8){iterations++;break;}}
 const labels=new Map(rows.map(row=>[row.key,closest(row.feature)])),selectedCluster=labels.get(keyAt(selectedPixel))!,data=new Uint8Array(width*height),sumRGB=centres.map(()=>[0,0,0] as Triple),sizes=centres.map(()=>0);
 for(let i=0;i<data.length;i++){if(rgba[i*4+3]<128)continue;const label=labels.get(keyAt(i))!;sizes[label]++;for(let j=0;j<3;j++)sumRGB[label][j]+=rgba[i*4+j];if(label===selectedCluster)data[i]=1;}
 const palette=sumRGB.map((rgb,i)=>'#'+rgb.map(v=>Math.round(sizes[i]?v/sizes[i]:0).toString(16).padStart(2,'0')).join(''));
 const selections=all?centres.map((_,i)=>i):[selectedCluster];
 return selections.map(selected=>{
  const pixels=all?new Uint8Array(width*height):data;let discardedPixels=0;
  if(all)for(let i=0;i<pixels.length;i++)if(rgba[i*4+3]>=128&&labels.get(keyAt(i))===selected)pixels[i]=1;
  for(const group of components(encode(width,height,pixels)))if(group.length<options.minRegionPixels){if(!all&&group.includes(selectedPixel))throw Error('REGION_TOO_SMALL');for(const i of group)pixels[i]=0;discardedPixels+=group.length;}
  return {mask:encode(width,height,pixels),color:palette[selected],report:{...options,iterations,selectedCluster:selected,discardedPixels,quantizationBits:5 as const,palette}};
 });
}
export function clusterMask(width:number,height:number,rgba:Uint8Array,seed:{x:number;y:number},options:ClusterOptions){return clusterSelection(width,height,rgba,seed,options)[0];}
export function clusterMasks(width:number,height:number,rgba:Uint8Array,options:ClusterOptions){const pixel=rgba.findIndex((v,i)=>i%4===3&&v>=128);if(pixel<0)throw Error('EMPTY_MASK');const index=(pixel-3)/4;return clusterSelection(width,height,rgba,{x:index%width,y:Math.floor(index/width)},options,true);}
