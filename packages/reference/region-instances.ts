import {rasterComponents} from './raster';
import {mergeUnsupportedInstanceLabels} from './instance-boundaries';

/** Ink is a separator, not an extra fabric color. Grow independent pigment
 * interiors into the ink without joining them back together across the line.
 * Softer stroke evidence may separate exposed objects, but enclosed shading
 * interiors do not seed extra fabric instances. */
export function pigmentInstances(width:number,height:number,mask:Uint8Array,ink:Uint8Array,softInk?:Uint8Array,brightness?:Float32Array):number[][]{
 if(ink.length!==mask.length||softInk&&softInk.length!==mask.length||brightness&&brightness.length!==mask.length)throw Error('IMAGE_LIMIT');
 let seeds=rasterComponents(width,height,Uint8Array.from(mask,(v,i)=>v&&!ink[i]&&!softInk?.[i]?1:0)).filter(g=>g.length>=16);
 if(softInk){const boundary=(i:number)=>{const x=i%width;return [x?i-1:-1,x+1<width?i+1:-1,i>=width?i-width:-1,i+width<mask.length?i+width:-1].some(n=>n<0||!mask[n]||ink[n]);};const exterior=seeds.filter(g=>g.some(boundary));if(exterior.length)seeds=exterior;}
 if(seeds.length<2)return rasterComponents(width,height,mask);
 const ids=new Int32Array(mask.length).fill(-1),distance=new Uint32Array(mask.length).fill(0xffffffff);
 for(let id=0;id<seeds.length;id++)for(const i of seeds[id]){ids[i]=id;distance[i]=0;}
 // Multi-source geodesic distance: 8 directions remove Manhattan/raster-scan
 // seams; dark stroke pixels cost more so the divider follows the ink valley.
 // Integer weights (at most 56) permit a bounded 64-bucket Dijkstra queue.
 const buckets=Array.from({length:64},()=>[] as number[]),heads=new Uint32Array(64);let pending=0,current=0;
 const visit=(i:number,relax:(n:number,diagonal:boolean)=>void)=>{const x=i%width,y=Math.floor(i/width);for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){if(!dx&&!dy||x+dx<0||x+dx>=width||y+dy<0||y+dy>=height)continue;const n=i+dy*width+dx;if(!mask[n]||dx&&dy&&(!mask[i+dx]||!mask[i+dy*width]))continue;relax(n,!!(dx&&dy));}};
 const relax=(i:number,n:number,diagonal:boolean)=>{const light=brightness?Math.max(0,Math.min(1,(brightness[i]+brightness[n])/2)):1,cost=Math.round((diagonal?14:10)*(1+3*(1-light)**2)),next=distance[i]+cost;if(next>=distance[n])return;distance[n]=next;ids[n]=ids[i];buckets[next%64].push(n);pending++;};
 // Only seed frontiers enter the queue; large pigment interiors need no heap.
 for(const seed of seeds)for(const i of seed)visit(i,(n,diagonal)=>{if(distance[n])relax(i,n,diagonal);});
 while(pending){const bucket=current%64;if(heads[bucket]>=buckets[bucket].length){buckets[bucket]=[];heads[bucket]=0;current++;continue;}const i=buckets[bucket][heads[bucket]++];pending--;if(distance[i]!==current)continue;visit(i,(n,diagonal)=>relax(i,n,diagonal));}
 if(softInk&&brightness)mergeUnsupportedInstanceLabels(width,height,ids,ink,brightness,seeds.length);
 const groups=seeds.map(()=>[] as number[]),remaining=new Uint8Array(mask.length);
 for(let i=0;i<mask.length;i++)if(mask[i]){if(ids[i]>=0)groups[ids[i]].push(i);else remaining[i]=1;}
 return [...groups.filter(g=>g.length),...rasterComponents(width,height,remaining)];
}
