import type {Surface} from '../schema/index';

/** Conservative geometry hints for an upright T-pose. Other poses remain editable group assignments. */
export function bodyRegions(mesh:Surface,minY:number,maxY:number){
 const height=maxY-minY,vertices=new Map(mesh.vertices.map(v=>[v.id,v]));
 const section=(fraction:number)=>{
  const y=minY+height*fraction,intervals:[number,number][]=[];
  for(const face of mesh.faces){const triangle=face.vertices.map(id=>vertices.get(id)!),xs:number[]=[];
   for(let i=0;i<3;i++){const a=triangle[i],b=triangle[(i+1)%3];if((a.yMm<=y&&b.yMm>y)||(b.yMm<=y&&a.yMm>y))xs.push(a.xMm+(b.xMm-a.xMm)*(y-a.yMm)/(b.yMm-a.yMm));}
   if(xs.length>=2)intervals.push([Math.min(...xs),Math.max(...xs)]);
  }
  intervals.sort((a,b)=>a[0]-b[0]);const merged:[number,number][]=[];
  for(const interval of intervals){const last=merged.at(-1);if(last&&interval[0]<=last[1]+height*.002)last[1]=Math.max(last[1],interval[1]);else merged.push([...interval]);}return merged;
 };
 const middles=[.5,.55,.6].map(section).filter(s=>s.length===1).map(s=>s[0]).sort((a,b)=>(a[1]-a[0])-(b[1]-b[0])),middle=middles[Math.floor(middles.length/2)];
 if(!middle||height<=0)return {arm:false,leg:false,centerX:0,halfWidth:Infinity};
 const centerX=(middle[0]+middle[1])/2,halfWidth=(middle[1]-middle[0])/2,upper=[.7,.8,.9].flatMap(section),lower=section(.25);
 return {centerX,halfWidth,arm:halfWidth>height*.03&&upper.some(([a,b])=>Math.max(centerX-a,b-centerX)>halfWidth*1.8),leg:lower.length===2&&lower[0][1]<centerX-height*.008&&lower[1][0]>centerX+height*.008};
}
