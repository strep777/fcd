import sharp from 'sharp';
import {sourcePolygonContains,type TipPoint} from './line-tip-source';

export type AdversarialTipSpec={name:string;kind:'rounded'|'flat'|'concave'|'sharp'|'weak'|'transparent'|'crop';angle?:number;rotation?:number;phase?:number[];blur:number;cut?:number;truncate?:number;kernel?:'box'|'motion';requiresTip?:boolean};
let state=0x71c0ffee;
const random=()=>{state=(Math.imul(state,1664525)+1013904223)>>>0;return state/2**32;};
export const adversarialTipCases:AdversarialTipSpec[]=[
 {name:'rounded-triangle-cut8',kind:'rounded',cut:8,blur:2},
 {name:'rounded-triangle-cut12',kind:'rounded',cut:12,blur:2},
 {name:'true-short-flat3.5',kind:'flat',truncate:3.5,blur:2},
 {name:'true-short-flat5',kind:'flat',truncate:5,blur:2},
 {name:'concave-chevron',kind:'concave',blur:2},
 ...[31,53,77].map(angle=>({name:'phase-sharp-'+angle,kind:'sharp' as const,angle,rotation:Math.floor(random()*150)+5,phase:[random()-.5,random()-.5],blur:2,requiresTip:true})),
 {name:'weak-rgb-two-materials',kind:'weak',blur:2},
 {name:'sharp-box-blur',kind:'sharp',kernel:'box',blur:0,requiresTip:true},
 {name:'rounded-box-blur',kind:'rounded',cut:12,kernel:'box',blur:0},
 {name:'sharp-horizontal-motion',kind:'sharp',kernel:'motion',blur:0},
 {name:'missing-upper-support',kind:'transparent',blur:2},
 {name:'rotated-image-crop',kind:'crop',rotation:-32,blur:2}
];
function clip(ring:TipPoint[],axis:'x'|'y',limit:number,less:boolean){const out:TipPoint[]=[];for(let i=0;i<ring.length;i++){const a=ring[i],b=ring[(i+1)%ring.length],aInside=less?a[axis]<=limit:a[axis]>=limit,bInside=less?b[axis]<=limit:b[axis]>=limit;if(aInside)out.push(a);if(aInside!==bInside){const t=(limit-a[axis])/(b[axis]-a[axis]);out.push({x:a.x+t*(b.x-a.x),y:a.y+t*(b.y-a.y)});}}return out;}
function rounded(ring:TipPoint[],cut:number){return ring.flatMap((p,i)=>{const a=ring[(i+ring.length-1)%ring.length],b=ring[(i+1)%ring.length],da=Math.hypot(a.x-p.x,a.y-p.y),db=Math.hypot(b.x-p.x,b.y-p.y),u={x:p.x+(a.x-p.x)*cut/da,y:p.y+(a.y-p.y)*cut/da},v={x:p.x+(b.x-p.x)*cut/db,y:p.y+(b.y-p.y)*cut/db};return Array.from({length:65},(_,k)=>{const t=k/64,s=1-t;return{x:s*s*u.x+2*s*t*p.x+t*t*v.x,y:s*s*u.y+2*s*t*p.y+t*t*v.y};});});}
const hex=(rgb:number[])=>'#'+rgb.map(v=>v.toString(16).padStart(2,'0')).join('');

/** Physical geometry precedes the image. The observed half-contrast selection
 * is solely the pipeline input; no expected boundary is derived from it. */
export async function adversarialTipSource(spec:AdversarialTipSpec){
 const width=112,height=112,aa=4,angle=spec.angle??44,slope=Math.tan(angle*Math.PI/360),halfHeight=48*slope,cx=(spec.kind==='crop'?99:56.25)+(spec.phase?.[0]??0),cy=56.1+(spec.phase?.[1]??0),theta=(spec.rotation??0)*Math.PI/180,c=Math.cos(theta),s=Math.sin(theta);
 const world=(p:TipPoint):TipPoint=>({x:cx+c*p.x-s*p.y,y:cy+s*p.x+c*p.y}),local=(p:TipPoint):TipPoint=>({x:c*(p.x-cx)+s*(p.y-cy),y:-s*(p.x-cx)+c*(p.y-cy)});
 const triangle=[{x:-24,y:-halfHeight},{x:24,y:0},{x:-24,y:halfHeight}];let ring=triangle;
 if(spec.kind==='rounded')ring=rounded(triangle,spec.cut!);
 if(spec.kind==='flat')ring=clip(triangle,'x',24-spec.truncate!,true);
 if(spec.kind==='concave')ring=[{x:-24,y:-18},{x:24,y:0},{x:-24,y:18},{x:-10,y:0}];
 const foregroundRGB=spec.kind==='weak'?[172,184,196]:[249,227,60],backgroundRGB=spec.kind==='weak'?[180,188,200]:[237,231,234];let rgba=new Uint8Array(width*height*4);
 for(let y=0;y<height;y++)for(let x=0;x<width;x++){let n=0;for(let sy=0;sy<aa;sy++)for(let sx=0;sx<aa;sx++)n+=+sourcePolygonContains(local({x:x+(sx+.5)/aa,y:y+(sy+.5)/aa}),ring);const coverage=n/aa**2,noise=spec.kind==='weak'?((x*19+y*31)%5-2):0;rgba.set([...foregroundRGB.map((v,k)=>Math.round(backgroundRGB[k]+(v-backgroundRGB[k])*coverage+noise)),255],4*(y*width+x));}
 if(spec.kernel){const size=spec.kernel==='box'?7:9,kernel=Array.from({length:size*size},(_,i)=>spec.kernel==='box'||Math.floor(i/size)===Math.floor(size/2)?1:0);rgba=new Uint8Array(await sharp(rgba,{raw:{width,height,channels:4}}).convolve({width:size,height:size,kernel,scale:kernel.reduce<number>((a,b)=>a+b,0)}).raw().toBuffer());}
 else rgba=new Uint8Array(await sharp(rgba,{raw:{width,height,channels:4}}).blur(spec.blur).raw().toBuffer());
 const missingAt=(p:TipPoint)=>{const q=local(p);return spec.kind==='transparent'&&q.x>=-18&&q.x<=16&&Math.abs(q.y+(24-q.x)*slope)<5;};
 if(spec.kind==='transparent')for(let y=0;y<height;y++)for(let x=0;x<width;x++)if(missingAt({x:x+.5,y:y+.5}))rgba.set([...(x%2?[255,0,0]:[0,255,0]),0],4*(y*width+x));
 // The deliberately unobserved strip cuts through the upper side. Its
 // visible-material notch is fixed analytically, not read back from alpha.
 const visibleRing=spec.kind==='transparent'?[triangle[0],{x:-18,y:-42*slope},{x:-18,y:-42*slope+5},{x:16,y:-8*slope+5},{x:16,y:-8*slope},triangle[1],triangle[2]]:ring;
 const physical=visibleRing.map(world),truthRing=clip(clip(clip(clip(physical,'x',0,false),'x',width,true),'y',0,false),'y',height,true),delta=foregroundRGB.map((v,k)=>v-backgroundRGB[k]),norm=delta.reduce((sum,v)=>sum+v*v,0);
 const observedMask=Uint8Array.from({length:width*height},(_,i)=>rgba[4*i+3]>=128&&delta.reduce((sum,d,k)=>sum+(rgba[4*i+k]-backgroundRGB[k])*d,0)/norm>=.5?1:0);
 const nose=truthRing.reduce((best,p)=>local(p).x>local(best).x?p:best,truthRing[0]);
 return{spec,width,height,aa,rgba,observedMask,truthRing,tip:world({x:24,y:0}),nose,notch:world({x:-18,y:0}),world,local,missingAt,foregroundColor:hex(foregroundRGB),backgroundColor:hex(backgroundRGB),png:await sharp(rgba,{raw:{width,height,channels:4}}).png().toBuffer()};
}
