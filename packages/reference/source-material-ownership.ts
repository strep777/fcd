import type {IllustrationRegion} from './illustration';

/** Local material models are estimated from the original image inside each
 * region. Hue thresholds only seed ownership: a pale or shadowed transition
 * competes with the neighbouring material on its actual local RGB evidence.
 * No mask filtering or geometric smoothing is used. */
export function refineSourceMaterialOwnership(width:number,height:number,rgba:Uint8Array,regions:IllustrationRegion[],protectedPairs:readonly (readonly [number,number])[]=[]){
 const size=width*height;
 if(!Number.isInteger(width)||!Number.isInteger(height)||width<1||height<1||size>4096*4096||rgba.length!==size*4)throw Error('IMAGE_LIMIT');
 const labels=new Int32Array(size).fill(-1),depth=new Uint8Array(size).fill(255),queue:number[]=[];
 for(const [owner,r]of regions.entries())for(const i of r.indices){if(!Number.isInteger(i)||i<0||i>=size||labels[i]>=0)throw Error('INVALID_MASK');labels[i]=owner;}
 const adjacent=(i:number)=>{const x=i%width,y=Math.floor(i/width);return[x?i-1:-1,x+1<width?i+1:-1,y?i-width:-1,y+1<height?i+width:-1].filter(j=>j>=0);};
 for(let i=0;i<size;i++)if(labels[i]>=0&&adjacent(i).some(j=>labels[j]!==labels[i])){depth[i]=0;queue.push(i);if(queue.length>200000)return{regions,moved:0};}
 for(let q=0;q<queue.length;q++){const i=queue[q];if(depth[i]>=3)continue;for(const j of adjacent(i))if(labels[j]===labels[i]&&depth[j]>depth[i]+1){depth[j]=depth[i]+1;queue.push(j);}}
 // Bounded optional evidence refinement: dense adversarial masks retain the
 // validated original ownership rather than consuming billions of RGB probes.
 if(queue.length>200000)return{regions,moved:0};
 const palette=regions.map(r=>[1,3,5].map(k=>parseInt(r.color.slice(k,k+2),16))),dark=palette.map(p=>Math.max(...p)<80),pairKey=(a:number,b:number)=>Math.min(a,b)+':'+Math.max(a,b),protectedEdges=new Set(protectedPairs.map(([a,b])=>pairKey(a,b)));
 const proposals:{i:number;owner:number;score:number}[]=[];
 for(const i of queue){
  if(depth[i]>2)continue;
  const x=i%width,y=Math.floor(i/width),models=new Map<number,{sum:number[];weight:number;count:number}>();
  for(let dy=-8;dy<=8;dy++)for(let dx=-8;dx<=8;dx++){
   const xx=x+dx,yy=y+dy;if(xx<0||xx>=width||yy<0||yy>=height)continue;
   const j=yy*width+xx,owner=labels[j];if(owner<0||depth[j]<2)continue;
   // Thin ink over a bright fabric does not estimate that fabric's color.
   const rgb=[rgba[4*j],rgba[4*j+1],rgba[4*j+2]];if(!dark[owner]&&Math.max(...rgb)<85)continue;
   const model=models.get(owner)??{sum:[0,0,0],weight:0,count:0},weight=1/(4+dx*dx+dy*dy);
   for(let c=0;c<3;c++)model.sum[c]+=weight*rgb[c];model.weight+=weight;model.count++;models.set(owner,model);
  }
  if(models.size<2||!models.has(labels[i]))continue;
  const useIntensity=[...models.keys()].some(owner=>dark[owner]),normalize=(rgb:number[])=>{const den=useIntensity?255:rgb.reduce((s,v)=>s+v,0)||1;return rgb.map(v=>v/den);},sample=normalize([rgba[4*i],rgba[4*i+1],rgba[4*i+2]]);
  const colorRay=!useIntensity&&[...models.keys()].every(owner=>{const p=palette[owner];return(Math.max(...p)-Math.min(...p))/Math.max(...p)>.23&&p[0]>=p[2]&&p[0]>=p[1]*.85;});
  const costs=[...models].filter(([,m])=>m.count>=3).map(([owner,m])=>{
   const color=normalize(m.sum.map(v=>v/m.weight)),e=color.map(v=>v-1/3),q=sample.map(v=>v-1/3),den=e.reduce((s,v)=>s+v*v,0);
   // A material's highlight moves its chromaticity toward the illuminant.
   // Compare against that observed colour ray, not only its mean saturation.
   // Neutral pairs stay protected by the dedicated bilateral edge models.
   const t=!colorRay||den<.0002?1:Math.max(.1,Math.min(1.5,e.reduce((s,v,c)=>s+v*q[c],0)/den));
   return{owner,cost:color.reduce((s,v,c)=>s+(!colorRay?v-sample[c]:t*e[c]-q[c])**2,0)};
  }).sort((a,b)=>a.cost-b.cost),best=costs[0],old=costs.find(c=>c.owner===labels[i]);
  if(!old||!best||best.owner===old.owner||protectedEdges.has(pairKey(old.owner,best.owner))||regions[best.owner].color===regions[old.owner].color||best.cost>=old.cost*.7||old.cost-best.cost<.00008)continue;
  const pixel=[rgba[4*i],rgba[4*i+1],rgba[4*i+2]],sat=(p:number[])=>(Math.max(...p)-Math.min(...p))/(Math.max(...p)||1);
  const chromaticShadow=sat(pixel)>=.18&&Math.max(...pixel)<Math.max(...palette[old.owner])*.95;
  if(sat(palette[old.owner])>.3&&sat(palette[best.owner])<.12&&(sat(pixel)>=.32||chromaticShadow)){
   const chroma=(p:number[])=>p.map(v=>v/(p.reduce((s,v)=>s+v,0)||1)-1/3),a=chroma(pixel),b=chroma(palette[old.owner]),alignment=a.reduce((s,v,c)=>s+v*b[c],0)/(Math.hypot(...a)*Math.hypot(...b));
   // A visibly chromatic cast shadow remains its pigment even when the
   // local bright-side mean lies farther away than the neighbouring white.
   if(alignment>.8)continue;
  }
  proposals.push({i,owner:best.owner,score:old.cost-best.cost});
 }
 const offsets=[[-1,-1],[0,-1],[1,-1],[-1,0],[1,0],[-1,1],[0,1],[1,1]];
 const components=(i:number,owner:number,equal:boolean,eight:boolean)=>{
  const on=offsets.map(([dx,dy])=>(labels[i+dy*width+dx]===owner)===equal),seen=new Uint8Array(8);let count=0;
  for(let a=0;a<8;a++){if(!on[a]||seen[a])continue;count++;const work=[a];seen[a]=1;for(let p=0;p<work.length;p++)for(let b=0;b<8;b++){const dx=Math.abs(offsets[work[p]][0]-offsets[b][0]),dy=Math.abs(offsets[work[p]][1]-offsets[b][1]);if(on[b]&&!seen[b]&&(eight?Math.max(dx,dy)===1:dx+dy===1)){seen[b]=1;work.push(b);}}}return count;
 };
 let moved=0;proposals.sort((a,b)=>b.score-a.score||a.i-b.i);
 // A junction may move without changing the connectivity of any material.
 // Testing the changed owners' simple points permits this; banning every
 // third owner in the neighbourhood freezes erroneous threshold junctions.
 for(let pass=0;pass<3;pass++)for(const p of proposals){const {i,owner}=p,x=i%width,y=Math.floor(i/width),old=labels[i];if(old===owner||x===0||y===0||x===width-1||y===height-1||!adjacent(i).some(j=>labels[j]===owner))continue;if([old,owner].every(v=>components(i,v,true,false)===1&&components(i,v,false,true)===1)){labels[i]=owner;moved++;}}
 const indices=regions.map(()=>[] as number[]);for(let i=0;i<size;i++)if(labels[i]>=0)indices[labels[i]].push(i);
 return{regions:regions.map((r,i)=>({...r,indices:indices[i]})),moved};
}
