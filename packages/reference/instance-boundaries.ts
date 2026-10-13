/** Candidate soft-ink bands can isolate shading interiors. Do not preserve an
 * invented interface when most of it has no two-sided source darkness valley.
 * Weak interfaces are joined simultaneously: an incomplete real crease does
 * not become a closed fabric division through another unsupported interface. */
export function mergeUnsupportedInstanceLabels(width:number,height:number,ids:Int32Array,ink:Uint8Array,light:Float32Array,count:number){
 const pairs=new Map<string,{a:number;b:number;total:number;supported:number;contrast:number}>();
 for(let y=0;y<height;y++)for(let x=0;x<width;x++){
  const i=y*width+x;if(ids[i]<0)continue;
  for(const [dx,dy]of [[1,0],[0,1]]){
   if(x+dx>=width||y+dy>=height)continue;const j=i+dx+dy*width;
   if(ids[j]<0||ids[i]===ids[j])continue;
   const a=Math.min(ids[i],ids[j]),b=Math.max(ids[i],ids[j]),key=a+':'+b,row=pairs.get(key)??{a,b,total:0,supported:0,contrast:0};
   let left=light[i],right=light[j];
   for(let step=1;step<=4;step++){
    const ax=x-step*dx,ay=y-step*dy,bx=x+(step+1)*dx,by=y+(step+1)*dy;
    if(ax>=0&&ay>=0&&ax<width&&ay<height&&ids[ay*width+ax]===ids[i])left=Math.max(left,light[ay*width+ax]);
    if(bx>=0&&by>=0&&bx<width&&by<height&&ids[by*width+bx]===ids[j])right=Math.max(right,light[by*width+bx]);
   }
   const contrast=Math.min(left,right)-(light[i]+light[j])/2;
   row.total++;row.contrast+=contrast;if(ink[i]||ink[j]||contrast>.04)row.supported++;
   pairs.set(key,row);
  }
 }
 const parent=Array.from({length:count},(_,i)=>i),root=(i:number):number=>{while(parent[i]!==i){parent[i]=parent[parent[i]];i=parent[i];}return i;};
 for(const row of pairs.values())if(row.supported<=row.total*.2&&row.contrast<=row.total*.015){const a=root(row.a),b=root(row.b);if(a!==b)parent[b]=a;}
 for(let i=0;i<ids.length;i++)if(ids[i]>=0)ids[i]=root(ids[i]);
}
