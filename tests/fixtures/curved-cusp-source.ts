import {calibratedPoint,segmentPixels,traceMask} from '../../apps/desktop/main/reference-segmentation';
import {pixels,components,encode} from '../../packages/reference/mask';
import type {Point,Calibration} from '../../packages/schema/index';
export type XY={x:number;y:number};
export type Case={name:string;kind:'crescent'|'stadium'|'half-disc'|'circle'|'annulus';cx:number;cy:number;R:number;r?:number;d?:number;rotation:number;scale:number;worldRotation:number};
export const cases:Case[]=[
 {name:'original two-circle crescent',kind:'crescent',cx:96.313,cy:96.271,R:61.44,r:61.44*.83,d:61.44*.47,rotation:0,scale:1,worldRotation:0},
 {name:'same crescent translated and source-rotated',kind:'crescent',cx:93.683,cy:99.041,R:61.44,r:61.44*.83,d:61.44*.47,rotation:.63,scale:.05,worldRotation:.37},
 {name:'narrow two-circle crescent',kind:'crescent',cx:97.173,cy:94.731,R:60,r:54,d:15,rotation:-.47,scale:1,worldRotation:0},
 {name:'wide two-circle crescent',kind:'crescent',cx:95.733,cy:97.193,R:54,r:40.5,d:35.1,rotation:1.07,scale:8,worldRotation:1.07},
 {name:'stadium with genuine semicircle end caps',kind:'stadium',cx:96.313,cy:96.271,R:16,d:30,rotation:0,scale:1,worldRotation:0},
 {name:'rotated half-disc with genuine circular nose',kind:'half-disc',cx:88.173,cy:96.731,R:34,rotation:.57,scale:1,worldRotation:.37},
 {name:'circle has no inferred sharp tip',kind:'circle',cx:96.313,cy:96.271,R:43.4,rotation:.31,scale:1,worldRotation:0},
 {name:'annulus keeps two round boundaries and its real hole',kind:'annulus',cx:96.313,cy:96.271,R:51.4,r:27.3,rotation:-.43,scale:.1,worldRotation:.63}
];
export function sourceFixture(c:Case){
 const size=192,co=Math.cos(c.rotation),si=Math.sin(c.rotation),toLocal=(p:XY):XY=>{if(c.rotation===0)return p;const x=p.x-c.cx,y=p.y-c.cy;return{x:c.cx+x*co+y*si,y:c.cy-x*si+y*co};},toNative=(p:XY):XY=>{if(c.rotation===0)return p;const x=p.x-c.cx,y=p.y-c.cy;return{x:c.cx+x*co-y*si,y:c.cy+x*si+y*co};};
 const signed=(p:XY)=>{const q=toLocal(p),x=q.x-c.cx,y=q.y-c.cy,outer=Math.hypot(x,y)-c.R;
  if(c.kind==='crescent')return Math.max(outer,c.r!-Math.hypot(x-c.d!,y));
  if(c.kind==='annulus')return Math.max(outer,c.r!-Math.hypot(x,y));
  if(c.kind==='half-disc')return Math.max(outer,-x);
  if(c.kind==='stadium'){const closest=Math.max(-c.d!,Math.min(c.d!,x));return Math.hypot(x-closest,y)-c.R;}
  return outer;
 };
 const rgba=new Uint8Array(size*size*4),colors=['#0a9dd6','#fae234'],rgb=[[10,157,214],[250,226,52]];
 // Same fixed two-pixel signed-distance RGB transition as the original
 // formal crescent; no production classification or fit defines this source.
 for(let y=0;y<size;y++)for(let x=0;x<size;x++){const t=Math.max(0,Math.min(1,.5+signed({x:x+.5,y:y+.5})/2)),i=y*size+x;for(let k=0;k<3;k++)rgba[i*4+k]=Math.round(rgb[0][k]*(1-t)+rgb[1][k]*t);rgba[i*4+3]=255;}
 const calibration:Calibration={a:{x:13,y:size-9},b:{x:13+size*Math.sin(c.worldRotation),y:size-9-size*Math.cos(c.worldRotation)},distanceMm:size*c.scale};
 const fromPixel=(p:{xMm:number;yMm:number})=>calibratedPoint(p.xMm,p.yMm,calibration),toPixel=(p:Pick<Point,'xMm'|'yMm'>)=>{const dx=calibration.b.x-calibration.a.x,dy=calibration.b.y-calibration.a.y;return{xMm:calibration.a.x+(-dy*p.xMm+dx*p.yMm)/calibration.distanceMm,yMm:calibration.a.y+(dx*p.xMm+dy*p.yMm)/calibration.distanceMm};};
 const seedLocal=c.kind==='half-disc'?{x:c.cx+c.R*.45,y:c.cy}:c.kind==='stadium'?{x:c.cx,y:c.cy}:{x:c.cx-c.R*.7,y:c.cy},nativeSeed=toNative(seedLocal),seed={x:Math.floor(nativeSeed.x),y:Math.floor(nativeSeed.y)},tolerance=Math.hypot(...rgb[0].map((v,k)=>v-rgb[1][k]))/2;
 const selected=segmentPixels(size,size,rgba,seed,tolerance,calibration,size,size,false,true),mask=pixels(selected.mask),complement=mask.map(v=>v?0:1),yellow=components(encode(size,size,complement)).map((group,i)=>{const m=new Uint8Array(mask.length);for(const j of group)m[j]=1;return{...traceMask(size,size,m,calibration,size,size,colors[1],true).piece,name:'yellow-'+i};}),originals=[{...selected.piece,name:'blue'},...yellow];
 return{c,size,rgba,mask,originals,colors,calibration,fromPixel,toPixel,toLocal,toNative,signed,toOracle:(p:Pick<Point,'xMm'|'yMm'>)=>{const q=toPixel(p),r=toLocal({x:q.xMm,y:q.yMm});return{xMm:r.x,yMm:r.y};}};
}
