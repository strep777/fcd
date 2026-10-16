import {smoothContour} from '../../../packages/reference/smooth-contour';
import {components,encode,type Mask} from '../../../packages/reference/mask';
import type {Calibration,Point,Piece,ContourRepair} from '../../../packages/schema/index';
import {randomUUID} from 'node:crypto';
import {DomainError} from './repository';
export function calibratedPoint(x:number,y:number,c:Calibration){const dx=c.b.x-c.a.x,dy=c.b.y-c.a.y,length=Math.hypot(dx,dy);if(![x,y,c.a.x,c.a.y,c.b.x,c.b.y,c.distanceMm].every(Number.isFinite)||length<1e-6||c.distanceMm<=0)throw new DomainError('INVALID_CALIBRATION');const factor=c.distanceMm/(length*length),px=x-c.a.x,py=y-c.a.y;return {xMm:(-dy*px+dx*py)*factor,yMm:(dx*px+dy*py)*factor};}
/** Seeded colour-distance segmentation of a single four-connected region. No AI model is implied. */
export function segmentPixels(width:number,height:number,rgba:Uint8Array,seed:{x:number;y:number},tolerance:number,calibration:Calibration,originalWidth:number,originalHeight:number,smooth=false,native=false):{piece:Piece;contourRepair?:ContourRepair;pixelCount:number;mask:Mask}{
 if(![width,height,originalWidth,originalHeight].every(v=>Number.isInteger(v)&&v>0)||width>(native?4096:512)||height>(native?4096:512)||width*height>(native?16777216:262144)||rgba.length!==width*height*4||!Number.isFinite(tolerance)||tolerance<0||tolerance>442)throw new DomainError('IMAGE_LIMIT');
 const sx=Math.floor(seed.x*width/originalWidth),sy=Math.floor(seed.y*height/originalHeight);if(!Number.isFinite(seed.x)||!Number.isFinite(seed.y)||sx<0||sy<0||sx>=width||sy>=height)throw new DomainError('INVALID_SEED');const at=(sy*width+sx)*4;if(rgba[at+3]<128)throw new DomainError('TRANSPARENT_SEED');const color=Array.from(rgba.slice(at,at+3)),mask=new Uint8Array(width*height),seen=new Uint8Array(width*height),queue=[sy*width+sx];seen[queue[0]]=1;let count=0;
 for(let index=0;index<queue.length;index++){
  const i=queue[index],offset=i*4;if(rgba[offset+3]<128||Math.hypot(rgba[offset]-color[0],rgba[offset+1]-color[1],rgba[offset+2]-color[2])>tolerance)continue;mask[i]=1;count++;
  const x=i%width,y=Math.floor(i/width);for(const n of [x>0?i-1:-1,x+1<width?i+1:-1,y>0?i-width:-1,y+1<height?i+width:-1])if(n>=0&&!seen[n]){seen[n]=1;queue.push(n);}
 }
 const traced=traceMask(width,height,mask,calibration,originalWidth,originalHeight,'#'+color.map(c=>c.toString(16).padStart(2,'0')).join(''),native);
 const pixelMm=.8*Math.max(originalWidth/width,originalHeight/height)*calibration.distanceMm/Math.hypot(calibration.a.x-calibration.b.x,calibration.a.y-calibration.b.y);
 return {...traced,piece:smooth?smoothContour(traced.piece,pixelMm,randomUUID):traced.piece,pixelCount:count,mask:encode(width,height,mask)};
}
/** Retain raster pixels; separate diagonal boundary contacts by a disclosed <=0.01 mm bevel. */
export function traceMask(width:number,height:number,mask:Uint8Array,calibration:Calibration,originalWidth:number,originalHeight:number,color:string,native=false):{piece:Piece;contourRepair?:ContourRepair}{
 if(mask.reduce((s,v)=>s+v,0)<4)throw new DomainError('REGION_TOO_SMALL');
 const stride=width+1,outgoing=new Map<number,number[]>(),incoming=new Map<number,number[]>(),edges:[number,number][]=[];
 const add=(a:number,b:number)=>{edges.push([a,b]);outgoing.set(a,[...(outgoing.get(a)??[]),b]);incoming.set(b,[...(incoming.get(b)??[]),a]);};
 for(let y=0;y<height;y++)for(let x=0;x<width;x++){const i=y*width+x;if(!mask[i])continue;const tl=y*stride+x,tr=tl+1,bl=(y+1)*stride+x,br=bl+1;
  if(y===0||!mask[i-width])add(tl,tr);if(x+1===width||!mask[i+1])add(tr,br);if(y+1===height||!mask[i+width])add(br,bl);if(x===0||!mask[i-1])add(bl,tl);
 }
 const contacts=new Set([...outgoing].filter(([,list])=>list.length===2).map(([v])=>v)),point=(v:number)=>({x:v%stride,y:Math.floor(v/stride)}),scale=calibration.distanceMm/Math.hypot(calibration.b.x-calibration.a.x,calibration.b.y-calibration.a.y),sx=originalWidth/width*scale,sy=originalHeight/height*scale;
 if(!Number.isFinite(scale)||scale<=0)throw new DomainError('INVALID_CALIBRATION');
 const ex=Math.min(.25,.01/sx),ey=Math.min(.25,.01/sy),coordinates=new Map<string,{x:number;y:number}>(),next=new Map<string,string>();
 const endpoint=(v:number,other:number,start:boolean)=>{const key=contacts.has(v)?v+':'+(start?'out':'in')+':'+other:String(v),p=point(v),q=point(other);coordinates.set(key,contacts.has(v)?{x:p.x+(q.x-p.x)*ex,y:p.y+(q.y-p.y)*ey}:p);return key;};
 for(const [a,b] of edges)next.set(endpoint(a,b,true),endpoint(b,a,false));
 for(const v of contacts){const ins=incoming.get(v)!,outs=outgoing.get(v)!;if(ins.length!==2)throw new DomainError('AMBIGUOUS_MASK');const used=new Set<number>(),p=point(v);for(const a of ins){const from=point(a),dx=p.x-from.x,dy=p.y-from.y;const b=[...outs].sort((u,w)=>{const x=point(u),y=point(w);return (dx*(y.y-p.y)-dy*(y.x-p.x))-(dx*(x.y-p.y)-dy*(x.x-p.x));})[0];if(used.has(b))throw new DomainError('AMBIGUOUS_MASK');used.add(b);next.set(endpoint(v,a,false),endpoint(v,b,true));}}
 const loops:{x:number;y:number}[][]=[];
 while(next.size){const start=next.keys().next().value!,ring:{x:number;y:number}[]=[];let current=start;
  do{ring.push(coordinates.get(current)!);const target=next.get(current);if(target===undefined)throw new DomainError('AMBIGUOUS_MASK');next.delete(current);current=target;}while(current!==start);
  const simple=ring.filter((p,i)=>{const a=ring[(i+ring.length-1)%ring.length],b=ring[(i+1)%ring.length];return Math.abs((p.x-a.x)*(b.y-p.y)-(p.y-a.y)*(b.x-p.x))>1e-12;});if(simple.length>(native?32000:2000))throw new DomainError('REGION_COMPLEXITY');loops.push(simple);
 }
 const area=(r:{x:number;y:number}[])=>r.reduce((s,a,i)=>{const b=r[(i+1)%r.length];return s+a.x*b.y-b.x*a.y;},0)/2,outer=loops.filter(r=>area(r)>0),holes=loops.filter(r=>area(r)<0);if(outer.length!==1)throw new DomainError('AMBIGUOUS_MASK');if(holes.length>32)throw new DomainError('REGION_COMPLEXITY');
 const points=(r:{x:number;y:number}[]):Point[]=>r.map(p=>({id:randomUUID(),...calibratedPoint(p.x*originalWidth/width,p.y*originalHeight/height,calibration)}));
 return {piece:{id:randomUUID(),name:'Reference region',nodes:points(outer[0]),holes:holes.map(points),closed:true,allowanceMm:0,cutQty:1,mirror:false,material:'毛皮',furRad:Math.PI/2,color},...(contacts.size?{contourRepair:{algorithm:'raster-diagonal-bevel-1' as const,corners:contacts.size,maxDeviationMm:Math.min(.01,Math.max(ex*sx,ey*sy)),areaLossMm2:contacts.size*ex*ey*sx*sy}}:{})};
}

export function maskPieces(mask:Mask,c:Calibration,originalWidth:number,originalHeight:number,color:string,smooth=true): {pieces:Piece[];pixelCount:number;discardedPixels?:number;contourRepair?:ContourRepair}{const all=components(mask);if(!all.length)throw new DomainError('EMPTY_MASK');const groups=all.filter(g=>g.length>=4),discardedPixels=all.reduce((n,g)=>n+(g.length<4?g.length:0),0);if(!groups.length)throw new DomainError('REGION_TOO_SMALL');if(groups.length>100)throw new DomainError('REGION_COMPLEXITY');const results=groups.map(g=>{const pixels=new Uint8Array(mask.width*mask.height);for(const i of g)pixels[i]=1;const result=traceMask(mask.width,mask.height,pixels,c,originalWidth,originalHeight,color,true);if(smooth)result.piece=smoothContour(result.piece,.8*Math.max(originalWidth/mask.width,originalHeight/mask.height)*c.distanceMm/Math.hypot(c.a.x-c.b.x,c.a.y-c.b.y),randomUUID);return result;}),repairs=results.flatMap(r=>r.contourRepair?[r.contourRepair]:[]);return {...(discardedPixels?{discardedPixels}:{}),pixelCount:groups.reduce((sum,g)=>sum+g.length,0),pieces:results.map(r=>r.piece),...(repairs.length?{contourRepair:{algorithm:'raster-diagonal-bevel-1' as const,corners:repairs.reduce((s,r)=>s+r.corners,0),maxDeviationMm:Math.max(...repairs.map(r=>r.maxDeviationMm)),areaLossMm2:repairs.reduce((s,r)=>s+r.areaLossMm2,0)}}:{})};}




