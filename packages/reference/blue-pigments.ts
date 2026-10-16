import {rasterComponents} from './raster';
/** A continuous cyan/blue reflection remains the same fabric even when its
 * saturation falls below the initial family threshold. Trace its observed RGB
 * gradient from an existing blue interior, stopping at ink, white plateaus,
 * abrupt colour steps or another hue. No geometric closing is performed. */
export function recoverBlueHighlights(width:number,height:number,rgba:Uint8Array,foreground:Uint8Array,ink:Uint8Array,labels:Int8Array,hue:Float32Array,saturation:Float32Array,value:Float32Array){
 const neighbours=(i:number)=>{const x=i%width,y=Math.floor(i/width);return[x?i-1:-1,x+1<width?i+1:-1,y?i-width:-1,y+1<height?i+width:-1].filter(j=>j>=0);};
 const highlight=(i:number)=>foreground[i]&&!ink[i]&&labels[i]===0&&hue[i]>=165&&hue[i]<=250&&saturation[i]>=.04&&value[i]>.45;
 // A pale component wholly enclosed by blue may continue its illumination.
 // Touching white fur, ink, another pigment or the image border disqualifies
 // it. The gradient and painted-step checks below still decide each pixel.
 const enclosed=new Uint8Array(labels.length);
 for(const group of rasterComponents(width,height,Uint8Array.from(labels,(v,i)=>v===0&&foreground[i]?1:0))){
  let valid=group.every(i=>rgba[4*i+3]===255&&hue[i]>=165&&hue[i]<=250&&saturation[i]>=.04&&value[i]>.45),contact=0;
  for(const i of group){
   const x=i%width,y=Math.floor(i/width);
   if(!x||!y||x===width-1||y===height-1)valid=false;
   for(const j of neighbours(i))if(labels[j]!==0){if(labels[j]!==4||!foreground[j]||ink[j])valid=false;else contact++;}
  }
  if(valid&&contact>=8)for(const i of group)enclosed[i]=1;
 }
 const queue:number[]=[];
 // A bounded blue interior beside independently established dark material
 // supports a painted detail (for example an iris). A large blue coat next
 // to white fur does not authorize recolouring its pale border or backdrop.
 for(const group of rasterComponents(width,height,Uint8Array.from(labels,(label,i)=>foreground[i]&&label===4?1:0))){
  if(group.length<8)continue;
  let boundary=0,darkContact=0;for(const i of group)for(const j of neighbours(i))if(labels[j]!==4){boundary++;if(labels[j]===6)darkContact++;}
  if(group.length>1024||darkContact<4||darkContact<boundary*.2){
   for(const i of group)if(neighbours(i).some(j=>enclosed[j]&&highlight(j)))queue.push(i);
   continue;
  }
  for(const i of group)if(neighbours(i).some(highlight))queue.push(i);
 }
 let recovered=0;
 for(let q=0;q<queue.length;q++){const i=queue[q];for(const j of neighbours(i))if(highlight(j)){
  const difference=Math.hypot(...[0,1,2].map(c=>rgba[4*i+c]-rgba[4*j+c]));
  // A flat neutral plateau provides no evidence of a continuing reflection.
  // Do not flood it merely because one ambiguous boundary pixel was reached.
  if(difference<.5||difference>45||Math.abs(hue[i]-hue[j])>20||Math.abs(saturation[i]-saturation[j])>.22||Math.abs(value[i]-value[j])>.18)continue;
  const stride=j-i,stepX=j%width-i%width,stepY=Math.floor(j/width)-Math.floor(i/width);
  let paintedStep=false;
  for(const radius of[1,2,3,4,6]){
   const x=i%width,y=Math.floor(i/width),lx=x-radius*stepX,ly=y-radius*stepY,rx=j%width+radius*stepX,ry=Math.floor(j/width)+radius*stepY;
   if(Math.min(lx,rx)<0||Math.max(lx,rx)>=width||Math.min(ly,ry)<0||Math.max(ly,ry)>=height)continue;
   const left=i-radius*stride,right=j+radius*stride,innerLeft=left+stride,innerRight=right-stride;
   // Estimate the source colour on each side from a short tangent profile.
   // Normalized RGB suppresses brightness noise; several original samples
   // distinguish a painted step from a continuous reflection. This measures
   // colour evidence only: no pixels or contour coordinates are averaged.
   const chroma=(k:number)=>{
    const sum=[0,0,0];let count=0;
    for(const t of[0,-1,1,-2,2,-3,3,-4,4,-5,5,-6,6]){
     const xx=k%width-t*stepY,yy=Math.floor(k/width)+t*stepX;
     if(xx<0||xx>=width||yy<0||yy>=height)continue;
     const q=yy*width+xx;
     if(!foreground[q]||ink[q]||(labels[q]!==0&&labels[q]!==4))continue;
     for(let c=0;c<3;c++)sum[c]+=rgba[4*q+c];
     if(++count===7)break;
    }
    if(count<3)return[NaN,NaN,NaN];
    const total=sum.reduce((s,v)=>s+v,0)||1;
    return sum.map(v=>v/total);
   },chromaDelta=(a:number,b:number)=>{const x=chroma(a),y=chroma(b);return Math.hypot(...x.map((v,c)=>v-y[c]));},chromaContrast=chromaDelta(left,right);
   if(chromaContrast>.01&&chromaDelta(left,innerLeft)<chromaContrast*.04&&chromaDelta(right,innerRight)<chromaContrast*.04){paintedStep=true;break;}
   if([left,right,innerLeft,innerRight].some(k=>!foreground[k]||ink[k]||(labels[k]!==0&&labels[k]!==4)))continue;
   const delta=(a:number,b:number)=>Math.hypot(...[0,1,2].map(c=>rgba[4*a+c]-rgba[4*b+c]));
   const contrast=delta(left,right);
   // Look beyond the antialiasing / blur band. A transition connecting two
   // locally flat but different colours remains a painted material edge.
   // A continuous reflection has a nonzero slope on at least one side.
   if(contrast>12&&delta(left,innerLeft)<contrast*.04&&delta(right,innerRight)<contrast*.04){paintedStep=true;break;}
  }
  if(paintedStep)continue;
  labels[j]=4;queue.push(j);recovered++;
 }}
 return recovered;
}
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
