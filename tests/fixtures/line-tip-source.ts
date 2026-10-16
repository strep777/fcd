import sharp from 'sharp';

export type TipPoint={x:number;y:number};
export type TipSourceKind='sharp'|'round-cap'|'flat-cap'|'one-straight-side'|'third-material'|'thin-strip'|'cropped-tip';
export type TipSourceOptions={angle?:number;rotation?:number;blur?:number};
const yellow=[249,227,60],neutral=[237,231,234],blue=[15,155,225],pink=[225,130,145];
export const tipSourceKinds:TipSourceKind[]=['sharp','round-cap','flat-cap','one-straight-side','third-material','thin-strip','cropped-tip'];
export function sourcePolygonContains(p:TipPoint,ring:TipPoint[]){let hit=false;for(let i=0,j=ring.length-1;i<ring.length;j=i++){const a=ring[i],b=ring[j];if((a.y>p.y)!==(b.y>p.y)&&p.x<(b.x-a.x)*(p.y-a.y)/(b.y-a.y)+a.x)hit=!hit;}return hit;}
export function sourceSegmentDistance(p:TipPoint,a:TipPoint,b:TipPoint){const dx=b.x-a.x,dy=b.y-a.y,t=Math.max(0,Math.min(1,((p.x-a.x)*dx+(p.y-a.y)*dy)/(dx*dx+dy*dy||1)));return Math.hypot(p.x-a.x-t*dx,p.y-a.y-t*dy);}
export function sourceBoundaryDistance(p:TipPoint,ring:TipPoint[]){return Math.min(...ring.map((a,i)=>sourceSegmentDistance(p,a,ring[(i+1)%ring.length])));}
function clip(ring:TipPoint[],axis:'x'|'y',limit:number,less:boolean){const out:TipPoint[]=[];for(let i=0;i<ring.length;i++){const a=ring[i],b=ring[(i+1)%ring.length],aInside=less?a[axis]<=limit:a[axis]>=limit,bInside=less?b[axis]<=limit:b[axis]>=limit;if(aInside)out.push(a);if(aInside!==bInside){const t=(limit-a[axis])/(b[axis]-a[axis]);out.push({x:a.x+t*(b.x-a.x),y:a.y+t*(b.y-a.y)});}}return out;}
const bezier=(a:TipPoint,b:TipPoint,c:TipPoint,d:TipPoint,t:number)=>{const s=1-t;return{x:s**3*a.x+3*s*s*t*b.x+3*s*t*t*c.x+t**3*d.x,y:s**3*a.y+3*s*s*t*b.y+3*s*t*t*c.y+t**3*d.y};};

/** Independent source geometry for line-intersection acceptance. Side support
 * is oracle metadata only: never pass it to the production boundary fitter. */
export async function lineTipSource(kind:TipSourceKind,options:TipSourceOptions={}){
 const width=96,height=96,angle=options.angle??44,rotation=options.rotation??0,blur=options.blur??2,aa=6;
 const tangent=Math.tan(angle*Math.PI/360),halfHeight=48*tangent,cx=kind==='cropped-tip'?84.25:48.25,cy=48.1,theta=rotation*Math.PI/180,c=Math.cos(theta),s=Math.sin(theta);
 const world=(p:TipPoint):TipPoint=>({x:cx+c*p.x-s*p.y,y:cy+s*p.x+c*p.y}),local=(p:TipPoint):TipPoint=>({x:c*(p.x-cx)+s*(p.y-cy),y:-s*(p.x-cx)+c*(p.y-cy)});
 const triangle=[{x:-24,y:-halfHeight},{x:24,y:0},{x:-24,y:halfHeight}];
 let shape=triangle,maximumX=24;
 if(kind==='round-cap')shape=[{x:-24,y:-14},...Array.from({length:129},(_,i)=>{const t=-Math.PI/2+i*Math.PI/128;return{x:24*Math.cos(t),y:14*Math.sin(t)};}),{x:-24,y:14}];
 if(kind==='flat-cap'){maximumX=12;shape=[{x:-24,y:-halfHeight},{x:12,y:-12*tangent},{x:12,y:12*tangent},{x:-24,y:halfHeight}];}
 if(kind==='one-straight-side')shape=[{x:-24,y:-14},...Array.from({length:65},(_,i)=>bezier({x:12,y:-8},{x:20,y:-8},{x:24,y:-4},{x:24,y:0},i/64)),...Array.from({length:65},(_,i)=>bezier({x:24,y:0},{x:24,y:10},{x:0,y:25},{x:-24,y:16},i/64))];
 if(kind==='third-material'){maximumX=10;shape=clip(triangle,'x',10,true);}
 if(kind==='thin-strip'){maximumX=18;shape=[{x:-24,y:-1.75},{x:18,y:-1.75},{x:18,y:1.75},{x:-24,y:1.75}];}
 const physicalRing=shape.map(world),truthRing=kind==='cropped-tip'?clip(clip(clip(clip(physicalRing,'x',0,false),'x',width,true),'y',0,false),'y',height,true):physicalRing;
 const materialAt=(p:TipPoint)=>{const q=local(p);if(kind==='third-material'&&sourcePolygonContains(q,triangle)&&q.x>=10)return 1;if(sourcePolygonContains(q,shape))return 2;return p.y<8?4:0;};
 const rgba=new Uint8Array(width*height*4);
 for(let y=0;y<height;y++)for(let x=0;x<width;x++){const sum=[0,0,0];for(let sy=0;sy<aa;sy++)for(let sx=0;sx<aa;sx++){const family=materialAt({x:x+(sx+.5)/aa,y:y+(sy+.5)/aa}),color=family===2?yellow:family===1?pink:family===4?blue:neutral;for(let k=0;k<3;k++)sum[k]+=color[k]/aa**2;}rgba.set([...sum.map(Math.round),255],4*(y*width+x));}
 const blurred=new Uint8Array(await sharp(rgba,{raw:{width,height,channels:4}}).blur(blur).raw().toBuffer()),png=await sharp(blurred,{raw:{width,height,channels:4}}).png().toBuffer();
 const sides=kind==='sharp'||kind==='cropped-tip'?[-1,1].map(sign=>[world({x:24-48*.35,y:sign*halfHeight*.35}),world({x:24-48*.8,y:sign*halfHeight*.8})]):kind==='one-straight-side'?[[world({x:-20,y:-14+4/6}),world({x:8,y:-14+32/6})]]:[];
 return{kind,width,height,angle,rotation,blur,aa,rgba:blurred,png,truthRing,tip:world({x:24,y:0}),seed:world({x:-8,y:0}),nose:world({x:maximumX,y:0}),world,local,materialAt,reliableSideSegments:sides,clipped:kind==='cropped-tip',sourceColors:{yellow,neutral,blue,pink},thirdProbe:world({x:17,y:0})};
}
