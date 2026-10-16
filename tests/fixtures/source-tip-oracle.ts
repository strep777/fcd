type XY={x:number;y:number};
type Window={axis:'x'|'y';stations:readonly[number,number];range:readonly[number,number]};
// Independently selected on the original JPEG without viewing output paths.
// These fixed source windows are a fixture contract, not a general predictor.
export const sourceWindows=[
 {name:'crown',roi:'front-crown',windows:[{axis:'x',stations:[120,126],range:[814,823]},{axis:'x',stations:[120,126],range:[823,832]}]},
 {name:'leg-inner',roi:'front-legs',windows:[{axis:'x',stations:[495,508],range:[880,891]},{axis:'x',stations:[498,508],range:[893,904]}]},
 {name:'leg-outer',roi:'front-legs',windows:[{axis:'x',stations:[525,543],range:[932,943]},{axis:'y',stations:[944,955],range:[516,535]}]}
] as const;
export function sourceTipOracles(rgba:Uint8Array,width:number,height:number){
 if(width!==1275||height!==750||rgba.length!==width*height*4)throw Error('SOURCE_FIXTURE_DIMENSIONS');
 return sourceWindows.map(spec=>{
  const lines=spec.windows.map((window:Window)=>{
   const points:XY[]=[];
   for(let station=window.stations[0];station<=window.stations[1];station++){
    const profile=Array.from({length:window.range[1]-window.range[0]+1},(_,k)=>{
     const coordinate=window.range[0]+k,x=window.axis==='x'?coordinate:station,y=window.axis==='x'?station:coordinate,index=4*(y*width+x);
     if(rgba[index+3]!==255)throw Error('MISSING_SOURCE_SUPPORT');return{coordinate:coordinate+.5,rgb:Array.from(rgba.subarray(index,index+3))};
    });
    const a=[0,1,2].map(c=>(profile[0].rgb[c]+profile[1].rgb[c])/2),b=[0,1,2].map(c=>(profile.at(-1)!.rgb[c]+profile.at(-2)!.rgb[c])/2),d=b.map((v,c)=>v-a[c]),norm=d.reduce((s,v)=>s+v*v,0);
    if(norm<60**2)throw Error('WEAK_SOURCE_SUPPORT');
    const values=profile.map(p=>p.rgb.reduce((s,v,c)=>s+(v-a[c])*d[c],0)/norm),crossings:number[]=[];
    for(let i=0;i+1<profile.length;i++)if(values[i]<=.5&&values[i+1]>.5)crossings.push(profile[i].coordinate+(.5-values[i])/(values[i+1]-values[i]));
    if(crossings.length!==1)throw Error('AMBIGUOUS_SOURCE_SUPPORT');points.push({x:station+.5,y:crossings[0]});
   }
   const mx=points.reduce((s,p)=>s+p.x,0)/points.length,my=points.reduce((s,p)=>s+p.y,0)/points.length;
   const slope=points.reduce((s,p)=>s+(p.x-mx)*(p.y-my),0)/points.reduce((s,p)=>s+(p.x-mx)**2,0),intercept=my-slope*mx,residuals=points.map(p=>p.y-intercept-slope*p.x),rms=Math.sqrt(residuals.reduce((s,v)=>s+v*v,0)/points.length),range=Math.max(...residuals)-Math.min(...residuals);
   if(rms>.18||range>.5)throw Error('SOURCE_SIDE_IS_NOT_STRAIGHT');
   const abc=window.axis==='x'?{a:1,b:-slope,c:intercept}:{a:-slope,b:1,c:intercept};
   const station=window.stations[0]+.5,coordinate=intercept+slope*station,anchor=window.axis==='x'?{x:coordinate,y:station}:{x:station,y:coordinate};
   return{slope,intercept,points,rms,range,abc,anchor};
  });
  const [a,b]=lines.map(l=>l.abc),det=a.a*b.b-a.b*b.a;if(Math.abs(det)<.2)throw Error('SOURCE_SIDES_ARE_PARALLEL');
  const tip={x:(a.c*b.b-a.b*b.c)/det,y:(a.a*b.c-a.c*b.a)/det},anchors=lines.map(l=>l.anchor),vertices=[tip,...anchors];
  const bounds={left:Math.min(...vertices.map(p=>p.x))-1.05,top:Math.min(...vertices.map(p=>p.y))-1.05,right:Math.max(...vertices.map(p=>p.x))+1.05,bottom:Math.max(...vertices.map(p=>p.y))+1.05};
  const inCap=(p:XY)=>p.x>=bounds.left&&p.x<=bounds.right&&p.y>=bounds.top&&p.y<=bounds.bottom;
  const ends=anchors.map(a=>{
   const dx=a.x-tip.x,dy=a.y-tip.y,exit=Math.min(dx>0?(bounds.right-tip.x)/dx:dx<0?(bounds.left-tip.x)/dx:Infinity,dy>0?(bounds.bottom-tip.y)/dy:dy<0?(bounds.top-tip.y)/dy:Infinity);
   return{x:tip.x+dx*exit,y:tip.y+dy*exit};
  });
  // Clip in both directions to the same cap. Even an interior point can
  // project past a ray's exit, so an infinite-ray distance would be too lax.
  const distance=(p:XY)=>Math.min(...ends.map(a=>{const dx=a.x-tip.x,dy=a.y-tip.y,t=Math.max(0,Math.min(1,((p.x-tip.x)*dx+(p.y-tip.y)*dy)/(dx*dx+dy*dy)));return Math.hypot(p.x-tip.x-t*dx,p.y-tip.y-t*dy);}));
  const reference=ends.flatMap(a=>{
   const dx=a.x-tip.x,dy=a.y-tip.y,n=Math.ceil(Math.hypot(dx,dy)/.25);
   return Array.from({length:n+1},(_,j)=>({x:tip.x+dx*j/n,y:tip.y+dy*j/n}));
  });
  return{...spec,tip,anchors,ends,bounds,lines,inCap,distance,reference};
 });
}
