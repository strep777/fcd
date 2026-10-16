/** Recover diffuse reflections inside an independently seeded dark pigment.
 * The decision is made on opposed original RGB profiles, before any tracing.
 * Bright painted holes and an abrupt grey material step are not traversed. */
export function recoverDarkReflections(width:number,height:number,rgba:Uint8Array,foreground:Uint8Array,labels:Int8Array,saturation:Float32Array,value:Float32Array){
 const size=width*height;
 if(!Number.isInteger(width)||!Number.isInteger(height)||width<1||height<1||size>4096*4096||rgba.length!==size*4||[foreground,labels,saturation,value].some(v=>v.length!==size))throw Error('IMAGE_LIMIT');
 if(!labels.includes(6))return 0;
 const continuous=(a:number,b:number,limit=60)=>{const x=[0,1,2].map(c=>rgba[4*a+c]),y=[0,1,2].map(c=>rgba[4*b+c]),sx=x.reduce((s,v)=>s+v,0),sy=y.reduce((s,v)=>s+v,0);return Math.hypot(...x.map((v,c)=>v-y[c]))<=limit&&(Math.min(sx,sy)<120||Math.hypot(...x.map((v,c)=>v/sx-y[c]/sy))<=.02);};
 const moves:number[]=[],directions=[[1,0],[0,1],[1,1],[1,-1]];let profileWork=0;
 for(let i=0;i<size;i++){
  const luminance=.2126*rgba[4*i]+.7152*rgba[4*i+1]+.0722*rgba[4*i+2],lowLight=value[i]<=.32&&luminance<=61||value[i]<=.45&&luminance<=90&&saturation[i]<=.65;
  if(!foreground[i]||labels[i]===6||value[i]>.48||!lowLight&&saturation[i]>.55)continue;
  const x=i%width,y=Math.floor(i/width);
  for(const [dx,dy]of directions){
   let sides=0;
   for(const sign of [-1,1]){
    let previous=i;
    for(let distance=1;distance<=16;distance++){
     // Optional recovery must not monopolize a worker on a dense ambiguous
     // image. No labels have changed yet, so exhaustion is an exact fallback.
     if(++profileWork>2000000)return 0;
     const xx=x+sign*dx*distance,yy=y+sign*dy*distance;if(xx<0||xx>=width||yy<0||yy>=height)break;
     const j=yy*width+xx;
     if(!foreground[j]||value[j]>(lowLight?.45:.5)||!lowLight&&saturation[j]>.6||Math.hypot(...[0,1,2].map(c=>rgba[4*j+c]-rgba[4*previous+c]))>(lowLight?45:22)*Math.hypot(dx,dy))break;
     if(labels[j]===6&&(lowLight||value[j]<value[i]-.035)){sides++;break;}
     previous=j;
    }
   }
   if(sides===2){moves.push(i);break;}
  }
 }
 // Extend only an opposed-profile-confirmed separator through its connected
 // low-light observations. Existing dark seeds cannot start this expansion
 // on their own: a one-sided grey ramp remains a separate material.
 const seen=new Uint8Array(size);for(const i of moves)seen[i]=1;
 for(let q=0;q<moves.length;q++){
  const i=moves[q],x=i%width,y=Math.floor(i/width);
  for(const j of [x?i-1:-1,x+1<width?i+1:-1,y?i-width:-1,y+1<height?i+width:-1]){
   if(j<0||seen[j]||!foreground[j]||labels[j]===6)continue;
   const luminance=.2126*rgba[4*j]+.7152*rgba[4*j+1]+.0722*rgba[4*j+2],low=value[j]<=.32&&luminance<=61||value[j]<=.45&&luminance<=90&&saturation[j]<=.65;
   if(!low||!continuous(i,j))continue;
   seen[j]=1;moves.push(j);
  }
 }
 for(const i of moves)labels[i]=6;
 // A thin ink separator can be lighter than the dark seed after antialiasing
 // with white on both sides. Follow a measured luminance valley connected
 // to that seed, rather than requiring an absolute black threshold.
 const luminance=(i:number)=>.2126*rgba[4*i]+.7152*rgba[4*i+1]+.0722*rgba[4*i+2];
 const valley=new Uint8Array(size),work:number[]=[];
 for(let y=2;y<height-2;y++)for(let x=2;x<width-2;x++){
  const i=y*width+x;if(!foreground[i]||labels[i]===6||value[i]>.8||saturation[i]>.5)continue;
  const center=luminance(i);
  for(const [dx,dy]of directions){let supported=false;for(const radius of[1,2,3]){if(x-radius*Math.abs(dx)<0||x+radius*Math.abs(dx)>=width||y-radius*Math.abs(dy)<0||y+radius*Math.abs(dy)>=height)continue;const a=i-radius*(dy*width+dx),b=i+radius*(dy*width+dx);if(!foreground[a]||!foreground[b])continue;const side=Math.min(luminance(a),luminance(b));if(center<side*.78&&side-center>=30){supported=true;break;}}if(supported){valley[i]=1;break;}}
  if(valley[i]&&[i-1,i+1,i-width,i+width,i-width-1,i-width+1,i+width-1,i+width+1].some(j=>labels[j]===6&&continuous(i,j))){valley[i]=2;work.push(i);}
 }
 for(let q=0;q<work.length;q++){const i=work[q];for(const j of[i-1,i+1,i-width,i+width,i-width-1,i-width+1,i+width-1,i+width+1])if(valley[j]===1&&continuous(i,j)){valley[j]=2;work.push(j);}}
 // A single-ended valley may be an outline drawn over one light fabric.
 // Only a valley bracketed by already supported dark material at both ends
 // can complete an internal dark boundary. This does not infer fabric from
 // the mere presence of a long connected ink stroke.
 const visited=new Uint8Array(size),blocked=new Uint8Array(size);
 const neighbors=(i:number)=>{const x=i%width,y=Math.floor(i/width),out:number[]=[];for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++)if((dx||dy)&&x+dx>=0&&x+dx<width&&y+dy>=0&&y+dy<height)out.push(i+dy*width+dx);return out;};
 for(const start of work){
  if(visited[start])continue;
  const component=[start];visited[start]=1;
  for(let q=0;q<component.length;q++)for(const j of neighbors(component[q]))if(valley[j]===2&&!visited[j]&&continuous(component[q],j)){visited[j]=1;component.push(j);}
  const squared=(a:number,b:number)=>(a%width-b%width)**2+(Math.floor(a/width)-Math.floor(b/width))**2;
  const farthest=(from:number)=>component.reduce((a,b)=>squared(a,from)>squared(b,from)?a:b),a=farthest(start),b=farthest(a),length=Math.sqrt(squared(a,b));
  const dx=(b%width-a%width)/(length||1),dy=(Math.floor(b/width)-Math.floor(a/width))/(length||1),projection=(i:number)=>(i%width-a%width)*dx+(Math.floor(i/width)-Math.floor(a/width))*dy;
  const anchors=component.filter(i=>neighbors(i).some(j=>labels[j]===6&&continuous(i,j))).map(projection);
  if(length<3||!anchors.some(t=>t<=1)||!anchors.some(t=>t>=length-1))for(const i of component)blocked[i]=1;
 } let recovered=0;for(const i of work)if(!blocked[i]){labels[i]=6;recovered++;}
 return moves.length+recovered;
}
