import type {IllustrationRegion,PixelBox} from './illustration';

/** A paired, compact dark eye with enclosed lighter pigments is a decoration
 * candidate. Keep uncertain, connected head/eyebrow/ear materials as cloth.
 * This classifies complete source regions only; no pixel or contour is erased. */
export function eyeDetailRegions(width:number,regions:IllustrationRegion[]):Set<number>{
 const box=(indices:number[]):PixelBox=>{let minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity;for(const i of indices){const x=i%width,y=Math.floor(i/width);minX=Math.min(minX,x);minY=Math.min(minY,y);maxX=Math.max(maxX,x+1);maxY=Math.max(maxY,y+1);}return{minX,minY,maxX,maxY};};
 const heads=regions.flatMap((region,id)=>region.part==='head'&&region.indices.length?[{id,region,box:box(region.indices)}]:[]);
 if(heads.length<2)return new Set();
 const bounds={minX:Math.min(...heads.map(r=>r.box.minX)),maxX:Math.max(...heads.map(r=>r.box.maxX)),minY:Math.min(...heads.map(r=>r.box.minY)),maxY:Math.max(...heads.map(r=>r.box.maxY))},w=bounds.maxX-bounds.minX,h=bounds.maxY-bounds.minY;
 const dark=heads.filter(({region,box:b})=>Math.max(...[1,3,5].map(i=>parseInt(region.color.slice(i,i+2),16)))<72&&region.indices.length>=8&&b.maxX-b.minX<w*.35&&b.maxY-b.minY<h*.25&&b.minY>bounds.minY+h*.35&&b.maxY<bounds.minY+h*.85);
 const pairs=dark.flatMap((a,i)=>dark.slice(i+1).flatMap(b=>{
  const ax=(a.box.minX+a.box.maxX)/2,bx=(b.box.minX+b.box.maxX)/2,ay=(a.box.minY+a.box.maxY)/2,by=(b.box.minY+b.box.maxY)/2,ha=a.box.maxY-a.box.minY,hb=b.box.maxY-b.box.minY;
  return Math.abs(ax-bx)>w*.15&&Math.abs(ax-bx)<w*.65&&Math.abs(ay-by)<Math.max(ha,hb)*.65&&Math.min(ha,hb)>Math.max(ha,hb)*.4?[{a,b,score:Math.abs(ay-by)/Math.max(ha,hb)}]:[];
 })).sort((a,b)=>a.score-b.score);
 if(!pairs.length)return new Set();
 const eyes=[pairs[0].a,pairs[0].b],result=new Set(eyes.map(e=>e.id));
 for(const row of heads)for(const eye of eyes){const b=eye.box,eh=b.maxY-b.minY,p=row.box;
  if(p.minX>=b.minX-1&&p.maxX<=b.maxX+1&&p.minY>=b.minY-1&&p.maxY<=b.maxY+eh*.5&&row.region.indices.length<=eye.region.indices.length*1.5)result.add(row.id);
 }
 return result;
}
