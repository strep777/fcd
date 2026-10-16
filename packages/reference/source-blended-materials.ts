import {blendedIslandProposals} from './source-blended-islands';
/** A hue between two pigments can be their antialiased transition. Require
 * opaque source samples, two established plateaus and a monotone RGB mixture.
 * An independent third-colour contribution keeps its existing ownership. */
export function sourceBlendedMaterials(width:number,height:number,rgba:Uint8Array,foreground:Uint8Array,labels:Int8Array){
 const before=labels.slice();
 const directions=[[1,0],[1,1],[0,1],[-1,1],[2,1],[1,2],[-1,2],[-2,1]];
 const proposals:{i:number;label:number;error:number}[]=[];
 let probes=0;
 for(let i=0;i<labels.length;i++){
  if(before[i]===6||!foreground[i]||rgba[4*i+3]!==255)continue;
  const x=i%width,y=Math.floor(i/width);
  for(const [dx,dy]of directions){
   const length=Math.hypot(dx,dy),ux=dx/length,uy=dy/length,ids:number[]=[];
   const ax=Math.round(x-8*ux),ay=Math.round(y-8*uy),bx=Math.round(x+8*ux),by=Math.round(y+8*uy);
   if(Math.min(ax,bx)<0||Math.max(ax,bx)>=width||Math.min(ay,by)<0||Math.max(ay,by)>=height)continue;
   const left=before[ay*width+ax],right=before[by*width+bx];
   if(left<=0||right<=0||left===6||right===6||left===right||before[i]===left||before[i]===right)continue;
   for(let s=-8;s<=8;s++){
    const xx=Math.round(x+s*ux),yy=Math.round(y+s*uy);
    if(xx<0||xx>=width||yy<0||yy>=height){ids.length=0;break;}
    const j=yy*width+xx;
    if(!foreground[j]||rgba[4*j+3]!==255){ids.length=0;break;}
    ids.push(j);
   }
   if(ids.length!==17)continue;
   const a=before[ids[0]],b=before[ids[16]];
   if(before[i]===a||before[i]===b||a<=0||b<=0||a===b||a===6||b===6||!ids.slice(0,3).every(j=>before[j]===a)||!ids.slice(14).every(j=>before[j]===b))continue;
   // Count expensive, eligible profiles only. A large unrelated interior
   // must not exhaust the budget before a later edge is reached. Commit all
   // proposals together; exhaustion cannot leave a partly relabelled image.
   if(++probes>200000)return 0;
   const rgb=(j:number)=>[rgba[j*4],rgba[j*4+1],rgba[j*4+2]];
   const mean=(js:number[])=>[0,1,2].map(c=>js.reduce((sum,j)=>sum+rgba[4*j+c],0)/js.length);
   const ca=mean(ids.slice(0,3)),cb=mean(ids.slice(14)),v=cb.map((n,c)=>n-ca[c]),contrast=Math.hypot(...v);
   if(contrast<60)continue;
   const sample=ids.map(rgb),t=sample.map(p=>p.reduce((sum,n,c)=>sum+(n-ca[c])*v[c],0)/(contrast*contrast));
   const residual=sample.map((p,k)=>Math.hypot(...p.map((n,c)=>n-ca[c]-t[k]*v[c]))),error=Math.max(...residual);
   if(error>Math.min(4,contrast*.02)||t[8]<.12||t[8]>.88||t.some((n,k)=>k>0&&n<t[k-1]-.035)||Math.max(...t.slice(0,3))-Math.min(...t.slice(0,3))>.10||Math.max(...t.slice(14))-Math.min(...t.slice(14))>.10)continue;
   proposals.push({i,label:t[8]<.5?a:b,error:error/contrast});
  }
 }
 proposals.sort((a,b)=>a.error-b.error);let moved=0;
 for(const p of proposals)if(labels[p.i]===before[p.i]){labels[p.i]=p.label;moved++;}
 const islands=blendedIslandProposals(width,height,rgba,foreground,labels.slice());for(const p of islands)if(labels[p.i]===0){labels[p.i]=p.label;moved++;}return moved;
}
