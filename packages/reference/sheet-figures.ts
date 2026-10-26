import {components,encode} from './mask';
import {illustrationRegions,type PixelBox} from './illustration';
import {eyeDetailRegions} from './eye-details';

type Window={x:number;y:number;width:number;height:number};
/** Locate separated figures for recognition only. The stored image and all
 * returned pixel indices remain in the original, complete sheet coordinates. */
export function sheetFigureWindows(width:number,height:number,rgba:Uint8Array):Window[]{
 if(!Number.isInteger(width)||!Number.isInteger(height)||width<1||height<1||width*height>4096*4096||rgba.length!==width*height*4)throw Error('IMAGE_LIMIT');
 const whole=[{x:0,y:0,width,height}];
 const scale=Math.min(1,512/Math.max(width,height)),w=Math.max(1,Math.round(width*scale)),h=Math.max(1,Math.round(height*scale)),mask=new Uint8Array(w*h);
 for(let y=0;y<h;y++)for(let x=0;x<w;x++){const i=(Math.min(height-1,Math.floor(y*height/h))*width+Math.min(width-1,Math.floor(x*width/w)))*4;mask[y*w+x]=rgba[i+3]>=128&&Math.min(rgba[i],rgba[i+1],rgba[i+2])<238?1:0;}
 const connected=components(encode(w,h,mask)).sort((a,b)=>b.length-a.length),largest=connected[0]?.length??0;
 const boxes=connected.filter(g=>g.length>=Math.max(32,largest*.25)).map(g=>{const b={minX:w,minY:h,maxX:0,maxY:0};for(const i of g){const x=i%w,y=Math.floor(i/w);b.minX=Math.min(b.minX,x);b.maxX=Math.max(b.maxX,x+1);b.minY=Math.min(b.minY,y);b.maxY=Math.max(b.maxY,y+1);}return b;});
 if(boxes.length<2)return whole;
 for(const axis of ['X','Y'] as const){
  const min=axis==='X'?'minX':'minY',max=axis==='X'?'maxX':'maxY',length=axis==='X'?width:height,proxy=axis==='X'?w:h;
  // White fur can disconnect the dark head, arms and legs in the coarse
  // foreground mask. Combine their overlapping projections before looking
  // for a gutter; a connected pigment component is not a whole character.
  const groups:PixelBox[]=[];
  for(const box of [...boxes].sort((a,b)=>a[min]-b[min])){
   const previous=groups.at(-1);
   if(previous&&box[min]<=previous[max]){previous.minX=Math.min(previous.minX,box.minX);previous.minY=Math.min(previous.minY,box.minY);previous.maxX=Math.max(previous.maxX,box.maxX);previous.maxY=Math.max(previous.maxY,box.maxY);}
   else groups.push({...box});
  }
  const ordered=groups.filter(b=>b.maxY-b.minY>=h*.35);
  if(ordered.length<2||ordered.length>8)continue;
  if(ordered.some((b,i)=>i>0&&b[min]<=ordered[i-1][max]))continue;
  // Proxy pixels locate candidate gaps, but their rounded bounds can land on
  // a real antialiased claw. Refine each separator in the original pixels;
  // only a genuinely empty gutter can divide recognition windows.
  const separators=ordered.slice(1).map((b,i)=>{
   const start=Math.max(0,Math.floor((ordered[i][max]-1)*length/proxy)),end=Math.min(length,Math.ceil((b[min]+1)*length/proxy));
   let run=start,bestStart=start,bestEnd=start;
   for(let station=start;station<=end;station++){
    let occupied=station===end;
    if(!occupied)for(let other=0;other<(axis==='X'?height:width);other++){
     const index=(axis==='X'?other*width+station:station*width+other)*4;
     if(rgba[index+3]>=128&&Math.min(rgba[index],rgba[index+1],rgba[index+2])<238){occupied=true;break;}
    }
    if(occupied){if(station-run>bestEnd-bestStart){bestStart=run;bestEnd=station;}run=station+1;}
   }
   return bestEnd>bestStart?Math.floor((bestStart+bestEnd)/2):undefined;
  });
  if(separators.some(s=>s===undefined))continue;
  const stations=[0,...separators as number[],length];
  return ordered.map((_,i)=>axis==='X'?{x:stations[i],y:0,width:stations[i+1]-stations[i],height}:{x:0,y:stations[i],width,height:stations[i+1]-stations[i]});
 }
 return whole;
}

export function illustrationSheet(width:number,height:number,rgba:Uint8Array,excludeBackground:boolean,subject:'character'|'head'|'paw'|'foot'){
 const windows=subject==='character'?sheetFigureWindows(width,height,rgba):[{x:0,y:0,width,height}];
 const rows=windows.map(window=>{
  const pixels=new Uint8Array(window.width*window.height*4);
  for(let y=0;y<window.height;y++)pixels.set(rgba.subarray(((y+window.y)*width+window.x)*4,((y+window.y)*width+window.x+window.width)*4),y*window.width*4);
  const result=illustrationRegions(window.width,window.height,pixels,excludeBackground,subject,true,'median');
  return {window,result,details:eyeDetailRegions(window.width,result.regions)};
 });
 const box=(b:PixelBox,w:Window):PixelBox=>({minX:b.minX+w.x,minY:b.minY+w.y,maxX:b.maxX+w.x,maxY:b.maxY+w.y});
 const facing:(1|-1|undefined)[]=rows.map(r=>r.details.size>=2?1:undefined);
 // A separated pair with one detailed face gives a reviewable placement
 // hypothesis. More ambiguous layouts are never silently assigned a side.
 if(rows.length===2&&rows.every(r=>r.result.anatomical)&&facing.filter(n=>n===1).length===1)facing[facing[0]===1?1:0]=-1;
 if(rows.length===1)facing[0]=1;
 const figures=rows.map((r,sourceGroup)=>({sourceGroup,bounds:box(r.result.bounds,r.window),...(facing[sourceGroup]===undefined?{}:{normalZ:facing[sourceGroup] as 1|-1})}));
 const regions=rows.flatMap(({window,result,details},sourceGroup)=>result.regions.map((r,i)=>({...r,sourceGroup,detail:details.has(i),indices:r.indices.map(index=>(Math.floor(index/window.width)+window.y)*width+index%window.width+window.x)})));
 const partBounds=rows.flatMap(({window,result},sourceGroup)=>result.partBounds.map(b=>({...b,...box(b,window),sourceGroup,...(b.frameCorners?{frameCorners:b.frameCorners.map(p=>({x:p.x+window.x,y:p.y+window.y}))}:{})})));
 return {...rows[0].result,regions,figures,partBounds,bounds:{minX:Math.min(...figures.map(f=>f.bounds.minX)),minY:Math.min(...figures.map(f=>f.bounds.minY)),maxX:Math.max(...figures.map(f=>f.bounds.maxX)),maxY:Math.max(...figures.map(f=>f.bounds.maxY))},anatomical:rows.some(r=>r.result.anatomical),foregroundPixels:rows.reduce((n,r)=>n+r.result.foregroundPixels,0),discardedPixels:rows.reduce((n,r)=>n+r.result.discardedPixels,0),palette:[...new Set(regions.map(r=>r.color))]};
}
