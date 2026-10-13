import {rasterComponents} from './raster';
/** A distinct dark blue material needs a substantial interior and an abrupt
 * blue-to-blue boundary with a chroma change. Scalar darkening alone is not
 * independent material evidence. Gradual value changes and thin dark drawing strokes
 * remain in their original pigment. This changes only pigment labels, never
 * removes foreground pixels or inserts anatomical source cuts. */
export function recoverBluePigments(width:number,height:number,foreground:Uint8Array,labels:Int8Array,saturation:Float32Array,value:Float32Array){
 const occupied:number[]=[];for(let i=0;i<labels.length;i++)if(foreground[i])occupied.push(i);
 if(!occupied.length)return 0;
 let top=height,bottom=0;for(const i of occupied){const y=Math.floor(i/width);top=Math.min(top,y);bottom=Math.max(bottom,y+1);}const span=bottom-top;
 const candidates=Uint8Array.from(labels,(v,i)=>foreground[i]&&v===4&&saturation[i]>.5&&value[i]<.55?1:0),minimum=Math.max(16,span*span*.0002);
 let recovered=0;
 for(const group of rasterComponents(width,height,candidates)){
  if(group.length<minimum)continue;
  let core=0,contact=0,sharp=0;
  for(const i of group){const x=i%width,y=Math.floor(i/width);let deep=x>1&&x<width-2&&y>1&&y<height-2;
   for(let dy=-2;dy<=2&&deep;dy++)for(let dx=-2;dx<=2;dx++)if(!candidates[(y+dy)*width+x+dx]){deep=false;break;}
   if(deep)core++;
   let touches=false,abrupt=false;
   for(const [dx,dy]of[[1,0],[-1,0],[0,1],[0,-1]])for(let d=1;d<=3;d++){
    const xx=x+dx*d,yy=y+dy*d;if(xx<0||xx>=width||yy<0||yy>=height)continue;const j=yy*width+xx;
    if(foreground[j]&&labels[j]===4&&!candidates[j]){touches=true;if(value[j]>.65&&value[j]-value[i]>.18&&Math.abs(saturation[j]-saturation[i])>.12)abrupt=true;}
   }
   if(touches)contact++;if(abrupt)sharp++;
  }
  if(core<Math.max(12,group.length*.25)||contact<8||sharp/contact<.5)continue;
  for(const i of group){labels[i]=7;recovered++;}
 }
 // Splitting a supported pigment exposes the original antialiased/borrowed
 // ink fringe. A disconnected blue remnant without a 3x3 interior can inherit
 // its adjacent navy only when it is a small, mixed-value boundary remnant.
 // A flat bright painted island or a substantial blue interior stays blue.
 for(const group of rasterComponents(width,height,Uint8Array.from(labels,(v,i)=>foreground[i]&&v===4?1:0))){
  if(group.length>Math.max(64,span*span*.00015))continue;
  let core=0,navy=0,minValue=1,maxValue=0;
  for(const i of group){const x=i%width,y=Math.floor(i/width);minValue=Math.min(minValue,value[i]);maxValue=Math.max(maxValue,value[i]);
   const neighbors=[x?i-1:-1,x+1<width?i+1:-1,y?i-width:-1,y+1<height?i+width:-1];if(neighbors.some(j=>j>=0&&labels[j]===7))navy++;
   let deep=x>0&&x<width-1&&y>0&&y<height-1;for(let dy=-1;dy<=1&&deep;dy++)for(let dx=-1;dx<=1;dx++)if(labels[(y+dy)*width+x+dx]!==4||!foreground[(y+dy)*width+x+dx]){deep=false;break;}if(deep)core++;
  }
  if(core||navy/group.length<.5||maxValue-minValue<.1&&maxValue>.72)continue;
  for(const i of group){labels[i]=7;recovered++;}
 }
 return recovered;
}
