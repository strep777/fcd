import type {IllustrationRegion} from './illustration';

/** A compact light mark on dark material has two directly observable colour
 * plateaus. Classify its antialiasing by coverage, not by the dark-ink cutoff.
 * Only a complete, single-colour surround qualifies; narrow slits, other
 * materials and translucent pixels cannot supply the outside plateau. */
export function refineSmallBrightDetails(width:number,height:number,rgba:Uint8Array,regions:IllustrationRegion[]){
 if(!Number.isInteger(width)||!Number.isInteger(height)||width<1||height<1||width*height>4096*4096||rgba.length!==width*height*4)throw Error('IMAGE_LIMIT');
 const candidates=regions.flatMap((r,owner)=>{if(r.indices.length<4||r.indices.length>576)return[];const color=[1,3,5].map(c=>parseInt(r.color.slice(c,c+2),16));return Math.max(...color)>=160&&color.reduce((a,b)=>a+b,0)>=300?[owner]:[];});
 if(!candidates.length)return{regions,removed:0};
 const labels=new Int32Array(width*height).fill(-1);regions.forEach((r,k)=>r.indices.forEach(i=>{if(!Number.isInteger(i)||i<0||i>=labels.length||labels[i]>=0)throw Error('INVALID_MASK');labels[i]=k;}));
 const result=[...regions],transfers=new Map<number,number[]>();let removed=0;
 const rgb=(i:number)=>[rgba[4*i],rgba[4*i+1],rgba[4*i+2]],value=(i:number)=>Math.max(...rgb(i));
 for(const owner of candidates){const r=regions[owner];
  // Coverage assumes two opaque painted colours. A translucent mark cannot
  // supply its own light plateau, even when every surrounding pixel is opaque.
  if(r.indices.some(i=>rgba[4*i+3]!==255))continue;
  const xs=r.indices.map(i=>i%width),ys=r.indices.map(i=>Math.floor(i/width)),x0=Math.min(...xs),x1=Math.max(...xs),y0=Math.min(...ys),y1=Math.max(...ys);
  if(x1-x0>24||y1-y0>24||x0<2||y0<2||x1>=width-2||y1>=height-2)continue;
  const outside:number[]=[],neighbours=new Set<number>();let opaque=true;
  for(const i of r.indices)for(const j of[i-1,i+1,i-width,i+width])if(labels[j]!==owner)neighbours.add(labels[j]);
  if(neighbours.size!==1)continue;
  const neighbour=[...neighbours][0];
  for(let y=y0-2;y<=y1+2;y++)for(let x=x0-2;x<=x1+2;x++){const i=y*width+x;if(labels[i]!==neighbour)continue;if(rgba[4*i+3]!==255)opaque=false;outside.push(i);}
  if(!opaque||outside.length<12)continue;
  // An excluded dark backdrop is still present in RGB. A white/transparent
  // backdrop cannot masquerade as a second dark material.
  if(outside.filter(i=>value(i)<80).length<outside.length*.6)continue;
  const light=[...r.indices].sort((a,b)=>value(b)-value(a)).slice(0,Math.max(1,Math.ceil(r.indices.length*.2))),dark=outside.filter(i=>value(i)<80);
  const mean=(ids:number[])=>[0,1,2].map(c=>ids.reduce((s,i)=>s+rgba[4*i+c],0)/ids.length),a=mean(light),b=mean(dark),delta=a.map((v,c)=>v-b[c]),norm=delta.reduce((s,v)=>s+v*v,0);
  if(norm<180**2)continue;
  const coverage=(i:number)=>rgb(i).reduce((s,v,c)=>s+(v-b[c])*delta[c],0)/norm;
  const keep=r.indices.filter(i=>coverage(i)>=.5),drop=r.indices.filter(i=>coverage(i)<.5);
  if(!drop.length||keep.length<4)continue;
  // Removal cannot split the mark or expose a new hole. Flood both digital
  // sides inside the bounded window, using the same 4/8 topology as tracing.
  const connected=(ids:number[],eight:boolean)=>{const remaining=new Set(ids),work=[ids[0]];remaining.delete(ids[0]);for(let q=0;q<work.length;q++){const i=work[q],x=i%width,y=Math.floor(i/width);for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){if(!dx&&!dy||!eight&&Math.abs(dx)+Math.abs(dy)!==1)continue;const j=(y+dy)*width+x+dx;if(remaining.delete(j))work.push(j);}}return remaining.size===0;};
  const complement:number[]=[];for(let y=y0-2;y<=y1+2;y++)for(let x=x0-2;x<=x1+2;x++)if(!keep.includes(y*width+x))complement.push(y*width+x);
  if(!connected(keep,false)||!connected(complement,true))continue;
  result[owner]={...r,indices:keep};
  if(neighbour>=0){const incoming=transfers.get(neighbour)??[];incoming.push(...drop);transfers.set(neighbour,incoming);}else removed+=drop.length;
 }
 // Several small marks commonly share one large dark owner. Append once per
 // receiving material instead of copying that large mask for every mark.
 for(const [owner,incoming]of transfers)result[owner]={...result[owner],indices:[...result[owner].indices,...incoming]};
 return{regions:result,removed};
}
