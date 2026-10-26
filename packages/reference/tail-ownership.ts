import {rasterComponents} from './raster';

type Box={minX:number;maxX:number;minY:number;maxY:number};
/** An occluding tail is supported by a lateral material lobe and its narrow
 * attachment. Recover that lobe first; stripes inside its envelope belong to
 * the same object. Material contours retain their original pixel boundaries. */
export function tailOwnership(width:number,height:number,foreground:Uint8Array,labels:Int8Array,top:number,span:number,feet:Box[]):Uint8Array|undefined{
 if(feet.length<2)return;
 // A long fur tip can touch the foot-height band. Use lobe centres, not the
 // extreme silhouette pixel, to keep that tail tip out of the foot frame.
 const left=Math.min(...feet.map(b=>(b.minX+b.maxX)/2))-span*.025,right=Math.max(...feet.map(b=>(b.minX+b.maxX)/2))+span*.025,size=width*height;
 const outside=(i:number)=>i%width<left-span*.04||i%width>right+span*.04;
 const meaningful=(g:number[])=>g.length>=Math.max(64,span*span*.0003);
 const lateral=(g:number[])=>g.reduce((n,i)=>n+(outside(i)?1:0),0)>g.length*.25;
 const mask=Uint8Array.from(foreground,(v,i)=>v&&labels[i]===2&&Math.floor(i/width)>top+span*.48?1:0),lobes:number[][]=[];
 for(const group of rasterComponents(width,height,mask)){
  if(group.length<span*span*.004||!lateral(group))continue;
  const original=new Uint8Array(size);for(const i of group)original[i]=1;
  let inner=original,seeds:number[][]|undefined;
  for(let radius=1;radius<=Math.max(4,Math.round(span*.012));radius++){
   const prior=inner;inner=Uint8Array.from(prior,(v,i)=>v&&i%width>0&&i%width<width-1&&i>=width&&i<size-width&&prior[i-1]&&prior[i+1]&&prior[i-width]&&prior[i+width]?1:0);
   const components=rasterComponents(width,height,inner).filter(meaningful);
   if(components.some(lateral)&&components.some(g=>!lateral(g))){seeds=components;break;}
  }
  if(!seeds){lobes.push(group);continue;}
  // Restore only the removed collar without reconnecting its two interiors.
  const owner=new Int8Array(size).fill(-1),queue:number[]=[];
  for(const seed of seeds){const label=lateral(seed)?1:0;for(const i of seed){owner[i]=label;queue.push(i);}}
  for(let q=0;q<queue.length;q++){const i=queue[q],x=i%width;for(const j of [x?i-1:-1,x+1<width?i+1:-1,i-width,i+width])if(j>=0&&j<size&&original[j]&&owner[j]<0){owner[j]=owner[i];queue.push(j);}}
  lobes.push(group.filter(i=>owner[i]===1));
 }
 if(!lobes.length)return;
 const result=new Uint8Array(size);
 for(const group of lobes){
  const points=group.map(i=>[i%width,Math.floor(i/width)] as [number,number]).sort((a,b)=>a[0]-b[0]||a[1]-b[1]);
  const cross=(a:number[],b:number[],c:number[])=>(b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]);
  const chain=(p:typeof points)=>{const out:typeof points=[];for(const v of p){while(out.length>1&&cross(out.at(-2)!,out.at(-1)!,v)<=0)out.pop();out.push(v);}return out;};
  const hull=[...chain(points).slice(0,-1),...chain([...points].reverse()).slice(0,-1)];
  if(hull.length<3)continue;
  const minX=Math.min(...hull.map(p=>p[0])),maxX=Math.max(...hull.map(p=>p[0])),minY=Math.min(...hull.map(p=>p[1])),maxY=Math.max(...hull.map(p=>p[1]));
  for(let y=minY;y<=maxY;y++)for(let x=minX;x<=maxX;x++){const i=y*width+x;if(foreground[i]&&(labels[i]===2||labels[i]===4||labels[i]===7)&&hull.every((a,j)=>cross(a,hull[(j+1)%hull.length],[x,y])>=0))result[i]=1;}
 }
 return result;
}
