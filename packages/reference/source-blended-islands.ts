
function observedMixture(rgb:number[],endpoints:number[][],models:{samples:{rgb:number[]}[]}[]){
 const near=endpoints.map((color,k)=>models[k].samples.map((sample,i)=>({rgb:sample.rgb,i,error:Math.hypot(...color.map((v,c)=>v-sample.rgb[c]))})).sort((a,b)=>a.error-b.error).slice(0,8));
 const pairs:{a:number;b:number;error:number;side:number}[]=[];
 for(const a of near[0])for(const b of near[1]){const delta=b.rgb.map((v,c)=>v-a.rgb[c]),contrast=Math.hypot(...delta);if(contrast<60)continue;const t=rgb.reduce((s,v,c)=>s+(v-a.rgb[c])*delta[c],0)/(contrast*contrast),error=Math.hypot(...rgb.map((v,c)=>v-a.rgb[c]-t*delta[c]));if(t>=.12&&t<=.88&&error<=Math.min(4,contrast*.02))pairs.push({a:a.i,b:b.i,error,side:t<.5?0:1});}
 if(!pairs.length||pairs.some(p=>p.side!==pairs[0].side))return;const a=new Set<number>(),b=new Set<number>();for(const pair of pairs.sort((p,q)=>p.error-q.error))if(!a.has(pair.a)&&!b.has(pair.b)){a.add(pair.a);b.add(pair.b);}return a.size>=3?pairs[0].side:undefined;
}
function solve(matrix:number[][],rhs:number[]){const a=matrix.map((r,i)=>[...r,rhs[i]]);for(let i=0;i<3;i++){let k=i;for(let j=i+1;j<3;j++)if(Math.abs(a[j][i])>Math.abs(a[k][i]))k=j;if(Math.abs(a[k][i])<1e-8)return;[a[i],a[k]]=[a[k],a[i]];const d=a[i][i];for(let j=i;j<=3;j++)a[i][j]/=d;for(let k=0;k<3;k++)if(k!==i){const d=a[k][i];for(let j=i;j<=3;j++)a[k][j]-=d*a[i][j];}}return a.map(r=>r[3]);}
/** A tiny neutral component between two coloured cores may be the colour
 * mixture at a blurred tip, where a one-dimensional profile cannot reach a
 * plateau on both sides. Require actual nearby interior samples and the same
 * strict RGB convex-span evidence as the ordinary profile check. */
export function blendedIslandProposals(width:number,height:number,rgba:Uint8Array,foreground:Uint8Array,before:Int8Array){
 if(!Number.isInteger(width)||!Number.isInteger(height)||width<1||height<1||width*height>4096*4096||before.length!==width*height||foreground.length!==width*height||rgba.length!==width*height*4)return[];
 const seen=new Uint8Array(before.length),output:{i:number;label:number;error:number}[]=[];let work=0;
 const neutral=(i:number)=>i>=0&&i<before.length&&foreground[i]!==0&&before[i]===0&&!seen[i];
 for(let seed=0;seed<before.length;seed++){
  if(!neutral(seed))continue;const stack=[seed],group:number[]=[];let count=0;
  // Scan-line flooding keeps broad white interiors out of the queue.
  while(stack.length){const i=stack.pop()!;if(!neutral(i))continue;const y=Math.floor(i/width);let left=i;while(left%width&&neutral(left-1))left--;let above=false,below=false;
   for(let p=left;p<(y+1)*width&&neutral(p);p++){seen[p]=1;count++;if(count<=16)group.push(p);const a=y>0&&neutral(p-width),b=y+1<height&&neutral(p+width);if(a&&!above)stack.push(p-width);if(b&&!below)stack.push(p+width);above=a;below=b;}
  }
  if(count>16||!group.length||group.some(i=>rgba[4*i+3]!==255))continue;
  const adjacent=new Set<number>();let opaque=true;for(const i of group){const x=i%width,y=Math.floor(i/width);for(const j of[x?i-1:-1,x+1<width?i+1:-1,y?i-width:-1,y+1<height?i+width:-1])if(j>=0){if(rgba[4*j+3]!==255)opaque=false;if(foreground[j]&&before[j]!==0)adjacent.add(before[j]);}}
  if(!opaque||adjacent.size!==2||[...adjacent].some(v=>v<=0||v===6))continue;const owners=[...adjacent],cx=group.reduce((s,i)=>s+i%width,0)/count,cy=group.reduce((s,i)=>s+Math.floor(i/width),0)/count,models=owners.map(()=>({samples:[] as {rgb:number[];basis:number[];weight:number}[],weight:0,count:0,sum:[0,0,0],matrix:Array.from({length:3},()=>[0,0,0]),rhs:Array.from({length:3},()=>[0,0,0])}));
  for(let y=Math.max(2,Math.floor(cy)-16);y<=Math.min(height-3,Math.ceil(cy)+16);y++)for(let x=Math.max(2,Math.floor(cx)-16);x<=Math.min(width-3,Math.ceil(cx)+16);x++){
   if(++work>200000)return[];const i=y*width+x,index=owners.indexOf(before[i]);if(rgba[4*i+3]!==255){opaque=false;continue;}if(index<0||!foreground[i])continue;
   let core=true;for(let dy=-2;dy<=2&&core;dy++)for(let dx=-2;dx<=2;dx++){const j=i+dy*width+dx;if(!foreground[j]||before[j]!==before[i]||rgba[4*j+3]!==255){core=false;break;}}if(!core)continue;
   const m=models[index],weight=1/(4+(x-cx)**2+(y-cy)**2);m.weight+=weight;m.count++;for(let c=0;c<3;c++)m.sum[c]+=weight*rgba[4*i+c];const basis=[1,(x-cx)/16,(y-cy)/16];m.samples.push({rgb:[0,1,2].map(c=>rgba[4*i+c]),basis,weight});for(let a=0;a<3;a++)for(let b=0;b<3;b++){m.matrix[a][b]+=weight*basis[a]*basis[b];m.rhs[a][b]+=weight*basis[b]*rgba[4*i+a];}
  }
  if(!opaque||models.some(m=>m.count<9))continue;
  if(models.some(m=>{const xx=m.matrix[1][1]-m.matrix[0][1]**2/m.weight,yy=m.matrix[2][2]-m.matrix[0][2]**2/m.weight,xy=m.matrix[1][2]-m.matrix[0][1]*m.matrix[0][2]/m.weight;return xx*yy-xy*xy<.01*(xx+yy)**2;}))continue;
  const planes=models.map(m=>m.rhs.map(rhs=>solve(m.matrix,rhs)));if(planes.some(p=>p.some(v=>!v)))continue;
  const proposals=group.map(i=>{const x=i%width,y=Math.floor(i/width),basis=[1,(x-cx)/16,(y-cy)/16],colors=planes.map(p=>p.map(v=>v!.reduce((s,c,k)=>s+c*basis[k],0))),[a,b]=colors,delta=b.map((v,c)=>v-a[c]),contrast=Math.hypot(...delta),rgb=[0,1,2].map(c=>rgba[4*i+c]),t=rgb.reduce((s,v,c)=>s+(v-a[c])*delta[c],0)/(contrast*contrast),error=Math.hypot(...rgb.map((v,c)=>v-a[c]-t*delta[c]));const side=observedMixture(rgb,colors,models);return{i,label:side===undefined?-1:owners[side],error:error/contrast,t,contrast,physical:colors.flat().every(v=>v>=0&&v<=255)&&colors.every((color,k)=>models[k].samples.filter(s=>Math.hypot(...color.map((v,c)=>v-s.rgb[c]))<=Math.min(4,contrast*.02)).length>=3)};});
  if(proposals.some(p=>p.label<0||!p.physical||p.contrast<60||p.t<.12||p.t>.88||p.error>Math.min(4,p.contrast*.02)/p.contrast))continue;output.push(...proposals);
 }
 return output;
}
