import {afterAll,expect,it} from 'vitest';
import sharp from 'sharp';
import {randomUUID} from 'node:crypto';
import {mkdirSync,writeFileSync} from 'node:fs';
import {materialObservation,materialTips} from '../../packages/reference/image-material-observation';
import {shortMaterialBranches} from '../../packages/reference/image-short-material-branch';
import {inferTips} from '../../packages/reference/image-line-corners';
import {imageBoundaryFit} from '../../packages/reference/image-contour';
import {illustrationRegions,pigmentFamily} from '../../packages/reference/illustration';
import {recoverSharedContours} from '../../packages/reference/shared-contour';
import {traceMask,calibratedPoint} from '../../apps/desktop/main/reference-segmentation';
import type {Piece,Point} from '../../packages/schema/index';

type P={xMm:number;yMm:number};
type Kind='sharp'|'fillet'|'ellipse'|'flat';
const observations:unknown[]=[];
const rgb=(c:string)=>[1,3,5].map(i=>parseInt(c.slice(i,i+2),16));
const white='#ede7ea',pink='#e18291',yellow='#f9e33c',analyticForeground='#e0e0e0',analyticBackgrounds=['#e02020','#20e020','#2020e0'];
const center={xMm:48.25,yMm:48.1},apex={xMm:72.25,yMm:48.1},width=96,height=96,slope=Math.tan(22*Math.PI/180),jointX=58.25;
const distance=(a:P,b:P)=>Math.hypot(a.xMm-b.xMm,a.yMm-b.yMm);
function inside(p:P,ring:P[]){let hit=false;for(let i=0,j=ring.length-1;i<ring.length;j=i++){const a=ring[i],b=ring[j];if((a.yMm>p.yMm)!==(b.yMm>p.yMm)&&p.xMm<(b.xMm-a.xMm)*(p.yMm-a.yMm)/(b.yMm-a.yMm)+a.xMm)hit=!hit;}return hit;}
function denseRing(ring:P[]){const points:P[]=[];let travelled=0,next=0;for(let i=0;i<ring.length;i++){const a=ring[i],b=ring[(i+1)%ring.length],length=distance(a,b);while(next<travelled+length-1e-8){const t=(next-travelled)/length;points.push({xMm:a.xMm+(b.xMm-a.xMm)*t,yMm:a.yMm+(b.yMm-a.yMm)*t});next++;}travelled+=length;}return points;}
function vertices(kind:Kind){
 const top={xMm:24.25,yMm:center.yMm-48*slope},bottom={xMm:24.25,yMm:center.yMm+48*slope};
 if(kind==='sharp')return[top,apex,bottom];
 if(kind==='flat')return[top,{xMm:60.25,yMm:center.yMm-12*slope},{xMm:60.25,yMm:center.yMm+12*slope},bottom];
 if(kind==='ellipse')return[{xMm:24.25,yMm:center.yMm-14},...Array.from({length:129},(_,i)=>{const t=-Math.PI/2+i*Math.PI/128;return{xMm:center.xMm+24*Math.cos(t),yMm:center.yMm+14*Math.sin(t)};}),{xMm:24.25,yMm:center.yMm+14}];
 // A true circular fillet tangent to the two independently specified sides.
 // It is generated geometrically, without the fitter's cap integration.
 const r=3,theta=Math.atan(slope),cx=apex.xMm-r/Math.sin(theta),limit=Math.PI/2-theta;
 return[top,...Array.from({length:129},(_,i)=>{const a=-limit+2*limit*i/128;return{xMm:cx+r*Math.cos(a),yMm:center.yMm+r*Math.sin(a)};}),bottom];
}
async function fixture(kind:Kind='sharp',blur=1.5){
 const ring=vertices(kind),rgba=new Uint8Array(width*height*4),aa=6;
 for(let y=0;y<height;y++)for(let x=0;x<width;x++){
  const value=[0,0,0];for(let j=0;j<aa;j++)for(let i=0;i<aa;i++){
   const p={xMm:x+(i+.5)/aa,yMm:y+(j+.5)/aa},color=rgb(inside(p,ring)?yellow:p.xMm<jointX?white:pink);
   for(let c=0;c<3;c++)value[c]+=color[c]/aa**2;
  }rgba.set([...value.map(Math.round),255],4*(y*width+x));
 }
 return{ring,points:denseRing(ring),rgba:new Uint8Array(await sharp(rgba,{raw:{width,height,channels:4}}).blur(blur).raw().toBuffer())};
}
function uniform(bytes:number[],w=128,h=128){const image=new Uint8Array(w*h*4);for(let i=0;i<image.length;i+=4)image.set(bytes,i);return image;}
const observationPoints=Array.from({length:8},(_,i)=>({xMm:60+i,yMm:60+i%2}));
function sampleAt(observed:NonNullable<ReturnType<typeof materialObservation>>,x:number,y:number){return Array.from(observed.image.subarray(4*((y-observed.top)*observed.width+x-observed.left),4*((y-observed.top)*observed.width+x-observed.left)+4));}
function assertNoPointedCap(model:ReturnType<typeof materialTips>,kind:Kind,blur:number){
 expect(model).toBeDefined();
 const candidates=model!.candidates.filter(c=>c.accepted&&Math.abs(c.tip.yMm-center.yMm)<8);
 observations.push({stage:'cap-candidates',kind,blur,apex,truthNose:kind==='ellipse'?apex:kind==='flat'?{xMm:60.25,yMm:center.yMm}:{xMm:apex.xMm-3/Math.sin(Math.atan(slope))+3,yMm:center.yMm},candidates:candidates.map(c=>({tip:c.tip,accepted:c.accepted,error:c.error,fitError:c.fitError,contrast:c.contrast,sigma:c.sigma,n1:c.n1,n2:c.n2,params:c.params,alternatives:c.alternatives}))});
 if(kind==='flat')for(const c of candidates)expect(c.tip.xMm).toBeLessThanOrEqual(61.75);
 else{
  const nose=kind==='ellipse'?apex:{xMm:apex.xMm-3/Math.sin(Math.atan(slope))+3,yMm:center.yMm};
  expect(candidates.filter(c=>distance(c.tip,nose)<8)).toHaveLength(0);
 }
}

it('measures known coverage and annihilates every convex combination of three backgrounds',()=>{
 for(const alpha of[0,.25,.5,.75,1])for(const mixture of[[1,0,0],[0,1,0],[0,0,1],[.2,.3,.5]]){
  const background=[0,1,2].map(k=>mixture.reduce((s,v,i)=>s+v*rgb(analyticBackgrounds[i])[k],0));
  const bytes=rgb(analyticForeground).map((v,i)=>Math.round(alpha*v+(1-alpha)*background[i])),source=uniform([...bytes,255]),before=source.slice();
  const observed=materialObservation(observationPoints,analyticForeground,analyticBackgrounds,128,128,source);
  expect(observed).toBeDefined();const p=sampleAt(observed!,64,60);
  expect(p[0]).toBe(p[1]);expect(p[1]).toBe(p[2]);expect(Math.abs(p[0]-(64+128*alpha))).toBeLessThanOrEqual(observed!.quantizationError);
  expect(observed!.quantizationError).toBeCloseTo(1,10);expect(source).toEqual(before);
 }
});
it('preserves source alpha and crop coordinates, and never keeps a clipped measurement opaque',()=>{
 for(const alpha of[0,1,127,255]){
  const source=uniform([...rgb(analyticBackgrounds[0]),alpha]),observed=materialObservation(observationPoints,analyticForeground,analyticBackgrounds,128,128,source)!;
  expect(observed.left).toBe(28);expect(observed.top).toBe(28);expect(sampleAt(observed,64,60)).toEqual([64,64,64,alpha]);
 }
 const black=materialObservation(observationPoints,analyticForeground,analyticBackgrounds,128,128,uniform([0,0,0,255]))!;
 expect(sampleAt(black,64,60)[3]).toBe(0);
});
it('refuses a foreground in the background span, nearly dependent palettes and excessive byte amplification',()=>{
 for(const [foreground,backgrounds]of[['#808000',['#ff0000','#00ff00']],['#c0c0c0',['#200000','#800000','#e00000']],['#c0c0c0',['#200000','#800000','#800001']],['#808080',analyticBackgrounds]] as const){
  expect(materialObservation(observationPoints,foreground,[...backgrounds],128,128,uniform([128,128,128,255]))).toBeUndefined();
 }
});
it('validates palette, coordinates, dimensions, RGBA length and local crop budget',()=>{
 const source=uniform([224,224,224,255]);
 for(const backgrounds of[[],[analyticBackgrounds[0]],[...analyticBackgrounds,analyticBackgrounds[0]],['#gggggg',analyticBackgrounds[1]],['#12345',analyticBackgrounds[1]]])expect(materialObservation(observationPoints,analyticForeground,backgrounds,128,128,source)).toBeUndefined();
 for(const points of[observationPoints.slice(0,7),observationPoints.map(p=>({...p,xMm:NaN})),observationPoints.map(p=>({...p,yMm:-1}))])expect(materialObservation(points,analyticForeground,analyticBackgrounds,128,128,source)).toBeUndefined();
 for(const [w,h,bytes]of[[0,128,source],[128.5,128,source],[128,128,new Uint8Array(3)]] as const)expect(()=>materialObservation(observationPoints,analyticForeground,analyticBackgrounds,w,h,bytes)).toThrow('IMAGE_LIMIT');
 const far=Array.from({length:8},(_,i)=>({xMm:i%2?511:0,yMm:i%3?511:0}));
 expect(materialObservation(far,analyticForeground,analyticBackgrounds,512,512,uniform([224,224,224,255],512,512))).toBeUndefined();
});
for(const blur of[1.5,3])it(`recovers a true sharp material tip through neighboring backgrounds at blur ${blur}`,async()=>{
 const f=await fixture('sharp',blur),before=f.rgba.slice(),model=materialTips(f.points,true,yellow,[white,pink],width,height,f.rgba);
 expect(model).toBeDefined();expect(model!.candidates.some(c=>c.accepted&&distance(c.tip,apex)<=1.5)).toBe(true);expect(f.rgba).toEqual(before);
},30000);
for(const kind of['fillet','ellipse','flat'] as const)for(const blur of[1.5,3])it(`does not turn a true ${kind} into a sharp extension at blur ${blur}`,async()=>{
 const f=await fixture(kind,blur);assertNoPointedCap(materialTips(f.points,true,yellow,[white,pink],width,height,f.rgba,true),kind,blur);
},30000);
it('retains the ordinary RGB contract when no observation options are provided',async()=>{
 const f=await fixture('fillet');
 expect(inferTips(f.points,true,width,height,f.rgba)).toEqual(inferTips(f.points,true,width,height,f.rgba,{proposalRange:1.5,quantizationError:0}));
 for(const options of[{proposalRange:1.49},{proposalRange:4.01},{proposalRange:NaN},{quantizationError:-.1},{quantizationError:2.01},{quantizationError:Infinity}])expect(()=>inferTips(f.points,true,width,height,f.rgba,options)).toThrow('IMAGE_LIMIT');
},30000);

function rawBranch(a:P,through:P[],b:P,colors:string[],label:string){return{closed:false,colors,raw:[a,...through,b].map((p,i)=>({...p,id:`${label}-${i}`}))};}
function shortGraph(){
 const upper={xMm:jointX+.6,yMm:center.yMm-14*slope+.5},lower={xMm:jointX+.6,yMm:center.yMm+14*slope-.5};
 const top={xMm:24.25,yMm:center.yMm-48*slope},bottom={xMm:24.25,yMm:center.yMm+48*slope};
 return[rawBranch(upper,[{xMm:70.5,yMm:48.5}],lower,[yellow,pink],'short'),rawBranch(upper,[],top,[yellow,white],'upper'),rawBranch(lower,[],bottom,[yellow,white],'lower'),rawBranch(upper,[],{xMm:jointX,yMm:2},[white,pink],'top-bg'),rawBranch(lower,[],{xMm:jointX,yMm:94},[white,pink],'bottom-bg')];
}
function assertEndpointTopology(original:ReturnType<typeof shortGraph>,output:Point[][]){
 for(const [shortEnd,along,across]of[[0,1,3],[1,2,4]]){
  const p=shortEnd?output[0].at(-1)!:output[0][0];
  expect(distance(p,output[along][0])).toBeLessThan(1e-7);expect(distance(p,output[across][0])).toBeLessThan(1e-7);
  expect(distance(p,shortEnd?original[0].raw.at(-1)!:original[0].raw[0])).toBeLessThanOrEqual(8);
 }
 for(let i=1;i<output.length;i++)expect(output[i].at(-1)).toEqual(original[i].raw.at(-1));
}
it('moves every incident endpoint together when a short material branch is recovered',async()=>{
 const f=await fixture(),graph=shortGraph(),before=structuredClone(graph),bytes=f.rgba.slice(),result=shortMaterialBranches(graph,width,height,f.rgba);
 expect(result).toBeDefined();expect(result!.corners.some(p=>distance(p,apex)<=1.5)).toBe(true);assertEndpointTopology(graph,result!.output);
 expect(result!.output[0].some(p=>distance(p,apex)<=1.5)).toBe(true);expect(graph).toEqual(before);expect(f.rgba).toEqual(bytes);
});
it('rejects a wrong background owner and transparent short-branch evidence without partial edits',async()=>{
 const f=await fixture();
 for(const invalid of['different','one-owner','unknown'] as const){
  const wrong=shortGraph();if(invalid==='different')wrong[3].colors=[white,'#0f9be1'];else wrong[4].colors=invalid==='one-owner'?[white]:[];
  const before=structuredClone(wrong);expect(shortMaterialBranches(wrong,width,height,f.rgba)).toBeUndefined();expect(wrong).toEqual(before);
 }
 const graph=shortGraph(),original=structuredClone(graph);for(let y=36;y<60;y++)for(let x=54;x<78;x++)f.rgba[4*(y*width+x)+3]=0;
 expect(shortMaterialBranches(graph,width,height,f.rgba)).toBeUndefined();expect(graph).toEqual(original);
});
it('does not invade independently known opaque material cores beyond the three-sigma transition',async()=>{
 const blur=1.5,f=await fixture('sharp',blur),graph=shortGraph(),result=shortMaterialBranches(graph,width,height,f.rgba);
 expect(result).toBeDefined();
 const output=result!.output,yellowRing=[...[...output[1]].reverse().slice(0,-1),...output[0].slice(0,-1),...output[2]];
 let checked=0,foregroundCores=0;
 for(let y=3;y<93;y+=2)for(let x=3;x<93;x+=2){
  const p={xMm:x+.5,yMm:y+.5};
  const boundaryDistance=Math.min(...f.ring.map((a,i)=>{const b=f.ring[(i+1)%f.ring.length],dx=b.xMm-a.xMm,dy=b.yMm-a.yMm,t=Math.max(0,Math.min(1,((p.xMm-a.xMm)*dx+(p.yMm-a.yMm)*dy)/(dx*dx+dy*dy||1)));return Math.hypot(p.xMm-a.xMm-t*dx,p.yMm-a.yMm-t*dy);}));
  if(boundaryDistance<=3*blur||Math.abs(p.xMm-jointX)<=3*blur)continue;
  const expected=inside(p,f.ring),color=rgb(expected?yellow:p.xMm<jointX?white:pink),offset=4*(y*width+x);
  if(f.rgba[offset+3]!==255||color.some((v,k)=>Math.abs(v-f.rgba[offset+k])>2))continue;
  checked++;foregroundCores+=+expected;expect(inside(p,yellowRing)).toBe(expected);
 }
 observations.push({stage:'material-core-coverage',blur,checked,foregroundCores,guardCorridorPixels:3*blur});
 expect(checked).toBeGreaterThan(250);expect(foregroundCores).toBeGreaterThan(10);
});
function samplePiece(piece:Piece,scale:number){return piece.nodes.flatMap((a,i)=>{const b=piece.nodes[(i+1)%piece.nodes.length],curve=piece.curves?.find(c=>c.startNodeId===a.id&&c.endNodeId===b.id),u=curve?.c1??a,v=curve?.c2??b,n=Math.max(1,Math.ceil((distance(a,u)+distance(u,v)+distance(v,b))/(.1*scale)));return Array.from({length:n},(_,i)=>{const t=i/n,s=1-t;return{xMm:(s**3*a.xMm+3*s*s*t*u.xMm+3*s*t*t*v.xMm+t**3*b.xMm)/scale,yMm:height-(s**3*a.yMm+3*s*s*t*u.yMm+3*s*t*t*v.yMm+t**3*b.yMm)/scale};});});}
it('preserves the complete short-branch material network under three millimeter calibrations',async()=>{
 const f=await fixture(),classification=illustrationRegions(width,height,f.rgba,false,'head');
 for(const scale of[1,.05,10]){
  const c={a:{x:0,y:height},b:{x:0,y:0},distanceMm:height*scale},originals=classification.regions.map(r=>{const mask=new Uint8Array(width*height);for(const i of r.indices)mask[i]=1;return traceMask(width,height,mask,c,width,height,r.color,true).piece;});
  const fit=imageBoundaryFit(width,height,f.rgba,p=>({xMm:p.xMm/scale,yMm:height-p.yMm/scale}),p=>calibratedPoint(p.xMm,p.yMm,c)),result=recoverSharedContours(originals,.8*scale,randomUUID,fit),yellowPiece=result.pieces.find(p=>pigmentFamily(p.color!)===2)!;
  expect(yellowPiece).toBeDefined();const rings=result.pieces.map(p=>samplePiece(p,scale)),tipError=Math.min(...samplePiece(yellowPiece,scale).map(p=>distance(p,apex)));
  observations.push({stage:'full-network',scale,tipError,report:result.report,materials:result.pieces.map(p=>p.color),yellow:yellowPiece});
  expect(tipError).toBeLessThanOrEqual(1.5);
  let count=0;for(let y=5.317;y<91;y+=4.7)for(let x=5.731;x<91;x+=4.7){
   const p={xMm:x,yMm:y},near=f.ring.some((a,i)=>{const b=f.ring[(i+1)%f.ring.length],dx=b.xMm-a.xMm,dy=b.yMm-a.yMm,t=Math.max(0,Math.min(1,((x-a.xMm)*dx+(y-a.yMm)*dy)/(dx*dx+dy*dy||1)));return Math.hypot(x-a.xMm-t*dx,y-a.yMm-t*dy)<2;});if(near||Math.abs(x-jointX)<2)continue;
   count++;const owners=result.pieces.filter((_,i)=>inside(p,rings[i]));expect(owners).toHaveLength(1);expect(pigmentFamily(owners[0].color!)).toBe(inside(p,f.ring)?2:x<jointX?0:1);
  }expect(count).toBeGreaterThan(150);
 }
},60000);
afterAll(()=>{const directory='test-results/current-cutting/consolidated/material-independent-final';mkdirSync(directory,{recursive:true});writeFileSync(`${directory}/observations-${process.pid}.json`,JSON.stringify({diagnosticOnly:true,observations},null,2)+'\n');});
