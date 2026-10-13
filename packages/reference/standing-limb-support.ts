/** Registration-only evidence for a bilateral, downward-arm standing pose.
 * Neutral two-sided valleys identify drawn limb seams; source pixels are never
 * recoloured, split, removed or used as newly manufactured fabric boundaries. */
type Box={minX:number;minY:number;maxX:number;maxY:number};
type Row={y:number;left:number;right:number};
export function standingLimbSupport(width:number,height:number,foreground:Uint8Array,saturation:Float32Array,value:Float32Array,top:number,span:number,head:Box,paws:Box[]){
 const center=(head.minX+head.maxX)/2,headWidth=head.maxX-head.minX;
 const pair=paws.flatMap(a=>paws.filter(b=>{const ax=(a.minX+a.maxX)/2,bx=(b.minX+b.maxX)/2,ay=(a.minY+a.maxY)/2,by=(b.minY+b.maxY)/2;return ax<center&&bx>center&&ay>top+span*.45&&by>top+span*.45&&Math.abs(ay-by)<span*.07&&Math.abs((ax+bx)/2-center)<headWidth*.2;}).map(b=>[a,b] as const))[0];
 if(!pair)return;
 const step=Math.max(1,Math.round(span*.001)),radius=Math.max(1,Math.round(span*.003));
 const rows=(start:number,end:number,minDelta:number,maxDelta:number)=>{
  const result:Row[]=[];let prior:Row|undefined;
  for(let y=Math.ceil(start);y<=Math.min(height-1,end);y+=step){const hits:number[]=[];
   for(let x=Math.max(radius+1,Math.floor(center-maxDelta));x<Math.min(width-radius-1,center+maxDelta);x++){
    const i=y*width+x;if(!foreground[i]||saturation[i]>.2||value[i]<.12)continue;
    if([radius,Math.max(1,radius-1),radius+1].some(d=>foreground[i-d]&&foreground[i+d]&&saturation[i-d]<.2&&saturation[i+d]<.2&&value[i-d]-value[i]>.07&&value[i+d]-value[i]>.07))hits.push(x);
   }
   const choose=(side:-1|1)=>hits.filter(x=>side*(x-center)>=minDelta&&side*(x-center)<=maxDelta).sort((a,b)=>prior?Math.abs(a-(side<0?prior.left:prior.right))-Math.abs(b-(side<0?prior.left:prior.right)):Math.abs(a-center)-Math.abs(b-center))[0];
   const left=choose(-1),right=choose(1);if(left===undefined||right===undefined)continue;
   if(prior&&y-prior.y<=span*.02&&(Math.abs(left-prior.left)>span*.03||Math.abs(right-prior.right)>span*.03))continue;
   prior={y,left,right};result.push(prior);
  }
  return result;
 };
 const runs=(samples:Row[])=>{const result:Row[][]=[];for(const row of samples){let last=result.at(-1);if(!last||row.y-last.at(-1)!.y>span*.02){last=[];result.push(last);}last.push(row);}return result.filter(r=>r.at(-1)!.y-r[0].y>=span*.055&&r.length*step/(r.at(-1)!.y-r[0].y+step)>.45);};
 const pawY=pair.reduce((s,b)=>s+(b.minY+b.maxY)/2,0)/2;
 const hip=runs(rows(pawY-span*.10,pawY+span*.15,span*.002,headWidth*.23)).map(r=>{const start=r.findIndex(v=>center-v.left>headWidth*.035&&v.right-center>headWidth*.035);return start<0?[]:r.slice(start);}).find(r=>r.length&&r.at(-1)!.y-r[0].y>=span*.055);
 const shoulders=runs(rows(head.maxY+span*.03,Math.min(pair[0].minY,pair[1].minY)-span*.025,headWidth*.17,headWidth*.8)).sort((a,b)=>b.length-a.length)[0];
 if(!hip||!shoulders)return;
 // The upper seam is extrapolated only through the short shoulder cap above
 // its first visible drawn valley. Lower rows use their actual supported seam.
 const shoulderAt=(y:number)=>{if(y<shoulders[0].y)return shoulders[0];let best=shoulders[0];for(const r of shoulders){if(r.y>y)break;best=r;}return best;};
 return {hipY:hip[0].y,shoulderTop:head.maxY+span*.02,shoulderBottom:shoulders.at(-1)!.y,shoulderAt,
  // This bounded bilateral pose frame rejects a laterally departing tail.
  // The source remains continuous; this is only a target-limb registration.
  legHalfWidth:headWidth*.55};
}

