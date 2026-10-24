import type {IllustrationRegion} from './illustration';

/** Broad hue families should not erase a hard red/orange or blue/cyan design
 * boundary. Split only separate, quiet chromatic plateaux. Continuous shading
 * remains connected, and brightness-only changes cannot invent a new fabric. */
export function splitFlatPigments(width:number,height:number,rgba:Uint8Array,regions:IllustrationRegion[]):IllustrationRegion[]{
 const size=width*height;
 if(rgba.length!==size*4)throw Error('IMAGE_LIMIT');
 const membership=new Int32Array(size).fill(-1);
 regions.forEach((region,id)=>region.indices.forEach(i=>membership[i]=id));
 const visited=new Uint8Array(size),rgb=(i:number)=>[rgba[4*i],rgba[4*i+1],rgba[4*i+2]],chroma=(c:number[])=>{const sum=c[0]+c[1]+c[2];return c.map(n=>n/(sum||1));};
 const distance=(a:number[],b:number[])=>Math.hypot(...a.map((n,i)=>n-b[i]));
 const adjacent=(i:number)=>[i%width?i-1:-1,i%width<width-1?i+1:-1,i>=width?i-width:-1,i<size-width?i+width:-1];
 return regions.flatMap((region,id)=>{
  if(region.indices.length<128)return [region];
  const groups:number[][]=[];
  for(const start of region.indices){
   if(visited[start])continue;
   const group=[start];visited[start]=1;
   for(let at=0;at<group.length;at++){
    const i=group[at],r=rgba[4*i],g=rgba[4*i+1],b=rgba[4*i+2];
    for(const j of adjacent(i)){
     if(j<0||membership[j]!==id||visited[j])continue;
     const dr=r-rgba[4*j],dg=g-rgba[4*j+1],db=b-rgba[4*j+2];
     if(dr*dr+dg*dg+db*db>36*36&&distance(chroma([r,g,b]),chroma(rgb(j)))>.055)continue;
     visited[j]=1;group.push(j);
    }
   }
   groups.push(group);
  }
  // Noise, narrow ink fragments and broad varying illumination provide no
  // reliable material plateau. Preserve the original partition in that case.
  if(groups.length<2||groups.length>8||groups.some(g=>g.length<64))return [region];
  const samples=groups.map(indices=>{
   const mean=[0,0,0],squares=[0,0,0];
   for(const i of indices)for(let c=0;c<3;c++){const n=rgba[4*i+c];mean[c]+=n;squares[c]+=n*n;}
   for(let c=0;c<3;c++)mean[c]/=indices.length;
   const deviation=Math.sqrt(squares.reduce((sum,n,c)=>sum+Math.max(0,n/indices.length-mean[c]**2),0));
   return {mean,deviation};
  });
  if(samples.some(({mean,deviation})=>deviation>12||Math.max(...mean)<77||(Math.max(...mean)-Math.min(...mean))/Math.max(...mean)<.35))return [region];
  for(let i=0;i<samples.length;i++)for(let j=0;j<i;j++)if(distance(samples[i].mean,samples[j].mean)<60||distance(chroma(samples[i].mean),chroma(samples[j].mean))<.07)return [region];
  // A blurred boundary can contain a quiet one-pixel color band. Require
  // two-dimensional interior support, not just many pixels along a long edge.
  // Reuse visited labels after the flood so no second image-sized map is needed.
  groups.forEach((indices,i)=>indices.forEach(p=>visited[p]=i+1));
  for(let group=0;group<groups.length;group++){
   const required=Math.max(64,Math.ceil(groups[group].length*.25));let interior=0;
   for(const p of groups[group]){
    const x=p%width,y=Math.floor(p/width);if(x<2||x>=width-2||y<2||y>=height-2)continue;
    let supported=true;
    for(let dy=-2;dy<=2&&supported;dy++)for(let dx=-2;dx<=2;dx++){const q=p+dy*width+dx;if(membership[q]!==id||visited[q]!==group+1){supported=false;break;}}
    if(supported&&++interior>=required)break;
   }
   if(interior<required)return [region];
  }
  return groups.map((indices,i)=>({...region,indices,color:'#'+samples[i].mean.map(n=>Math.round(n).toString(16).padStart(2,'0')).join('')}));
 });
}
