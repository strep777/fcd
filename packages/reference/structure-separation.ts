import {rasterComponents} from './raster';
import {pigmentInstances} from './region-instances';

/** Split same-pigment structures at narrow two-sided drawing strokes. This
 * provides geometric instances, not semantic horn/ear/fur classification.
 * Marker-controlled geodesic flooding keeps every original pigment pixel;
 * only meaningful interiors touching the original exterior may seed a split.
 * See https://docs.opencv.org/4.x/d3/db4/tutorial_py_watershed.html for the
 * marker-controlled segmentation and why unrestricted minima over-segment. */
export function structureInstances(width:number,height:number,mask:Uint8Array,ink:Uint8Array,rgba:Uint8Array,brightness?:Float32Array):number[][]{
 const size=width*height;
 if(!Number.isInteger(width)||!Number.isInteger(height)||width<1||height<1||size>4096*4096||mask.length!==size||ink.length!==size||rgba.length!==size*4||brightness&&brightness.length!==size)throw Error('IMAGE_LIMIT');
 const light=brightness??Float32Array.from(mask,(_,i)=>Math.max(rgba[i*4],rgba[i*4+1],rgba[i*4+2])/255);
 const groups=pigmentInstances(width,height,mask,ink,undefined,light),result:number[][]=[];
 for(const group of groups){
  // Very small islands cannot provide two reliable structure interiors.
  if(group.length<256){result.push(group);continue;}
  const scale=Math.max(1,Math.min(3,Math.sqrt(group.length)/60));
  const radii=[...new Set([Math.round(3*scale),Math.round(5*scale)])];
  // Components may be scattered over a large image. Repeated full-image
  // buffers and component scans make K small islands cost K * image area.
  // Padding retains the original radius/border tests and flooding geometry.
  const padding=Math.max(...radii);let minX=width,minY=height,maxX=0,maxY=0;
  for(const i of group){const x=i%width,y=Math.floor(i/width);minX=Math.min(minX,x);minY=Math.min(minY,y);maxX=Math.max(maxX,x);maxY=Math.max(maxY,y);}
  const left=Math.max(0,minX-padding),top=Math.max(0,minY-padding),localWidth=Math.min(width,maxX+padding+1)-left,localHeight=Math.min(height,maxY+padding+1)-top,localSize=localWidth*localHeight;
  const domain=new Uint8Array(localSize),localInk=new Uint8Array(localSize),localLight=new Float32Array(localSize),localGroup:number[]=[];
  let hasInk=false;
  for(const i of group){const j=(Math.floor(i/width)-top)*localWidth+i%width-left;localGroup.push(j);domain[j]=1;localInk[j]=ink[i];localLight[j]=light[i];hasInk||=!!ink[i];}
  const originalIndex=(i:number)=>(Math.floor(i/localWidth)+top)*width+i%localWidth+left;
  const adjacent=(i:number)=>{const x=i%localWidth;return [x?i-1:-1,x+1<localWidth?i+1:-1,i>=localWidth?i-localWidth:-1,i+localWidth<localSize?i+localWidth:-1];};
  const exterior=(i:number)=>adjacent(i).some(n=>n<0||!domain[n]||localInk[n]);
  const depth=new Float32Array(localSize);let maximumDepth=0;
  for(const i of localGroup){
   const x=i%localWidth,y=Math.floor(i/localWidth);
   for(const radius of radii)for(const [dx,dy] of [[radius,0],[0,radius],[radius,radius],[radius,-radius]]){
    if(x-dx<0||x+dx>=localWidth||y-dy<0||y+dy>=localHeight||y-dy>=localHeight||y+dy<0)continue;
    const a=i-dy*localWidth-dx,b=i+dy*localWidth+dx;
    if(domain[a]&&domain[b])depth[i]=Math.max(depth[i],Math.min(localLight[a],localLight[b])-localLight[i]);
   }
   maximumDepth=Math.max(maximumDepth,depth[i]);
  }
  // Flat pigment has no separator evidence, so it needs no marker scans.
  if(!hasInk&&maximumDepth<.12){result.push(group);continue;}
  let split:number[][]|undefined;
  // Prefer the strongest evidence that actually separates sizable exterior
  // interiors. The weaker pass is needed for JPEG-softened brown line art.
  for(const threshold of [.25,.18,.12]){
   if(!hasInk&&maximumDepth<threshold)continue;
   const barrier=new Uint8Array(localSize);for(const i of localGroup)barrier[i]=localInk[i]||depth[i]>=threshold?1:0;
   const seeds=rasterComponents(localWidth,localHeight,Uint8Array.from(domain,(v,i)=>v&&!barrier[i]?1:0)).filter(g=>g.length>=Math.max(64,group.length*.06)&&g.some(exterior));
   if(seeds.length<2)continue;
   // Treat rejected tiny/enclosed minima as uncertain pixels rather than
   // independent markers. They will be assigned during the geodesic fill.
   const uncertain=domain.slice();for(const seed of seeds)for(const i of seed)uncertain[i]=0;
   split=pigmentInstances(localWidth,localHeight,domain,new Uint8Array(localSize),uncertain,localLight).map(g=>g.map(originalIndex));
   break;
  }
  result.push(...(split??[group]));
 }
 return result;
}
