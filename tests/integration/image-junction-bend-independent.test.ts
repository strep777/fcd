import {expect,it} from 'vitest';
import sharp from 'sharp';
import {randomUUID} from 'node:crypto';
import {measureJunctionBend} from '../../packages/reference/image-junction-bend';
import {sourceJunctions} from '../../packages/reference/image-tip-junctions';
import {illustrationRegions,pigmentFamily} from '../../packages/reference/illustration';
import {imageBoundaryFit} from '../../packages/reference/image-contour';
import {recoverSharedContours} from '../../packages/reference/shared-contour';
import {traceMask,calibratedPoint} from '../../apps/desktop/main/reference-segmentation';
import type {Piece} from '../../packages/schema/index';

type P={xMm:number;yMm:number};
type Kind='sharp'|'circle'|'parabola';
const width=128,height=128,corner={xMm:40.2,yMm:60.2},split=63.2,slope=.45;
const palette=['#0f9be1','#ede7ea','#f9e33c'];
const colors=palette.map(c=>[1,3,5].map(i=>parseInt(c.slice(i,i+2),16)));
function boundary(y:number,kind:Kind){return kind==='sharp'?corner.xMm+Math.abs(y-corner.yMm)/slope:kind==='circle'?80.2-Math.sqrt(40**2-(y-corner.yMm)**2):corner.xMm+(y-corner.yMm)**2/24;}
function chain(poly:P[]){const out:P[]=[];for(let i=0;i<poly.length-1;i++){const a=poly[i],b=poly[i+1],n=Math.max(1,Math.ceil(Math.hypot(b.xMm-a.xMm,b.yMm-a.yMm)));for(let j=0;j<n;j++)out.push({xMm:a.xMm+(b.xMm-a.xMm)*j/n,yMm:a.yMm+(b.yMm-a.yMm)*j/n});}return[...out,poly.at(-1)!];}
async function fixture(kind:Kind='sharp'){
 const origin={xMm:boundary(split,kind),yMm:split};
 const upper=kind==='sharp'?[origin,corner,{xMm:111,yMm:corner.yMm-slope*(111-corner.xMm)}]:Array.from({length:101},(_,i)=>{const y=split+(24-split)*i/100;return{xMm:boundary(y,kind),yMm:y};});
 const lower=kind==='sharp'?[origin,{xMm:111,yMm:corner.yMm+slope*(111-corner.xMm)}]:Array.from({length:101},(_,i)=>{const y=split+(96-split)*i/100;return{xMm:boundary(y,kind),yMm:y};});
 const rays=[{points:chain([origin,{xMm:5,yMm:split}]),colors:palette.slice(0,2),line:{n:{xMm:0,yMm:1},d:split}},{points:chain(upper),colors:[palette[0],palette[2]]},{points:chain(lower),colors:[palette[1],palette[2]]}];
 const aa=6,rgba=new Uint8Array(width*height*4);
 for(let y=0;y<height;y++)for(let x=0;x<width;x++){
  const rgb=[0,0,0];for(let j=0;j<aa;j++)for(let i=0;i<aa;i++){
   const px=x+(i+.5)/aa,py=y+(j+.5)/aa,inside=kind==='circle'?Math.hypot(px-80.2,py-corner.yMm)<40:px>=boundary(py,kind),owner=inside?2:py<split?0:1;
   for(let c=0;c<3;c++)rgb[c]+=colors[owner][c]/aa**2;
  }rgba.set([...rgb.map(Math.round),255],4*(y*width+x));
 }
 return{origin,rays,rgba:new Uint8Array(await sharp(rgba,{raw:{width,height,channels:4}}).blur(1.5).raw().toBuffer())};
}
function distance(a:P,b:P){return Math.hypot(a.xMm-b.xMm,a.yMm-b.yMm);}
function sampled(piece:Piece,scale=1){return piece.nodes.flatMap((a,i)=>{const b=piece.nodes[(i+1)%piece.nodes.length],curve=piece.curves?.find(c=>c.startNodeId===a.id&&c.endNodeId===b.id),u=curve?.c1??a,v=curve?.c2??b,n=Math.max(1,Math.ceil((distance(a,u)+distance(u,v)+distance(v,b))/(.05*scale)));return Array.from({length:n},(_,j)=>{const t=j/n,s=1-t;return{xMm:(s**3*a.xMm+3*s*s*t*u.xMm+3*s*t*t*v.xMm+t**3*b.xMm)/scale,yMm:height-(s**3*a.yMm+3*s*s*t*u.yMm+3*s*t*t*v.yMm+t**3*b.yMm)/scale};});});}
function inside(p:P,ring:P[]){let hit=false;for(let i=0,j=ring.length-1;i<ring.length;j=i++){const a=ring[i],b=ring[j];if((a.yMm>p.yMm)!==(b.yMm>p.yMm)&&p.xMm<(b.xMm-a.xMm)*(p.yMm-a.yMm)/(b.yMm-a.yMm)+a.xMm)hit=!hit;}return hit;}

it('recovers the continuous yellow corner across a blue/white junction without changing inputs',async()=>{
 const f=await fixture(),before=structuredClone(f.rays),saved=f.rgba.slice(),result=measureJunctionBend(f.origin,f.rays,width,height,f.rgba);
 expect(result).toBeDefined();expect(distance(result!.corner,corner)).toBeLessThan(.6);expect(distance(result!.tip,f.origin)).toBeLessThan(.6);
 expect(result!.paths).toHaveLength(3);expect(result!.paths.filter(p=>p.points.length===3)).toHaveLength(1);
 expect(f.rays).toEqual(before);expect(f.rgba).toEqual(saved);
});
for(const kind of['circle','parabola'] as const)it(`does not replace a real ${kind} boundary with an inferred sharp corner`,async()=>{
 const f=await fixture(kind);expect(measureJunctionBend(f.origin,f.rays,width,height,f.rgba)).toBeUndefined();
});
it('rejects the wrong material ownership even when the third carrier remains straight',async()=>{
 const f=await fixture();f.rays[1].colors=[palette[1],palette[2]];
 expect(measureJunctionBend(f.origin,f.rays,width,height,f.rgba)).toBeUndefined();
});
it('declines nonfinite carrier or ray inputs without returning an invalid path',async()=>{
 const f=await fixture();f.rays[0].line!.n.xMm=NaN;
 expect(measureJunctionBend(f.origin,f.rays,width,height,f.rgba)).toBeUndefined();
 const g=await fixture();g.rays[1].points[10].xMm=NaN;
 expect(measureJunctionBend(g.origin,g.rays,width,height,g.rgba)).toBeUndefined();
});
it('validates image dimensions, RGBA length, colors, origins and normalized carrier input',async()=>{
 const f=await fixture();
 for(const [w,h,bytes]of[[0,height,f.rgba],[1.5,height,f.rgba],[width,height,new Uint8Array(3)],[4097,4097,new Uint8Array()]] as const)expect(()=>measureJunctionBend(f.origin,f.rays,w,h,bytes)).toThrow('IMAGE_LIMIT');
 for(const mutate of[(r:typeof f.rays)=>{r[0].line!.d=Infinity;},(r:typeof f.rays)=>{r[0].line!.n.yMm=2;},(r:typeof f.rays)=>{r[1].colors[0]='#gggggg';},(r:typeof f.rays)=>{r[1].points[3].yMm=-1;}]){
  const rays=structuredClone(f.rays);mutate(rays);const original=structuredClone(rays);
  expect(measureJunctionBend(f.origin,rays,width,height,f.rgba)).toBeUndefined();expect(rays).toEqual(original);
 }
 expect(measureJunctionBend({xMm:NaN,yMm:2},f.rays,width,height,f.rgba)).toBeUndefined();
});
it('keeps the same material bend under branch permutation and carrier normal reversal',async()=>{
 const f=await fixture();
 for(const order of[[0,1,2],[2,0,1],[1,2,0]]){
  const rays=order.map(i=>structuredClone(f.rays[i])),carrier=rays.find(r=>r.line)!.line!;
  carrier.n={xMm:-carrier.n.xMm,yMm:-carrier.n.yMm};carrier.d=-carrier.d;
  const result=measureJunctionBend(f.origin,rays,width,height,f.rgba);
  expect(result).toBeDefined();expect(distance(result!.corner,corner)).toBeLessThan(.6);expect(distance(result!.tip,f.origin)).toBeLessThan(.6);
  for(const path of result!.paths)expect(distance(path.points[0],result!.tip)).toBeLessThan(1e-8);
 }
});
it('does not infer a corner with its complete source neighborhood transparent',async()=>{
 const f=await fixture();for(let y=45;y<76;y++)for(let x=25;x<56;x++)f.rgba[4*(y*width+x)+3]=0;
 const saved=f.rgba.slice();expect(measureJunctionBend(f.origin,f.rays,width,height,f.rgba)).toBeUndefined();expect(f.rgba).toEqual(saved);
});
it('preserves the inferred through corner after shared-network production fitting',async()=>{
 const f=await fixture(),branches=f.rays.map((r,i)=>({closed:false,colors:r.colors,raw:r.points.map((p,j)=>({...p,id:`b${i}-${j}`}))}));
 const prepared=sourceJunctions(branches,width,height,f.rgba);expect(prepared).toBeDefined();
 expect(prepared!.evidence.some(e=>'bend' in (e as object))).toBe(true);
 expect(Math.min(...prepared!.output[1].map(p=>distance(p,corner)))).toBeLessThan(.6);
 const classified=illustrationRegions(width,height,f.rgba,false,'head');
 for(const scale of[1,.05,10]){
  const calibration={a:{x:0,y:height},b:{x:0,y:0},distanceMm:height*scale};
  const originals=classified.regions.map(r=>{const mask=new Uint8Array(width*height);for(const index of r.indices)mask[index]=1;return traceMask(width,height,mask,calibration,width,height,r.color,true).piece;});
  const fit=imageBoundaryFit(width,height,f.rgba,p=>({xMm:p.xMm/scale,yMm:height-p.yMm/scale}),p=>calibratedPoint(p.xMm,p.yMm,calibration));
  const result=recoverSharedContours(originals,.8*scale,randomUUID,fit),yellow=result.pieces.find(p=>pigmentFamily(p.color!)===2)!;
  expect(yellow).toBeDefined();expect(result.report.sourceJunctions).toBe(true);
  expect(Math.min(...sampled(yellow,scale).map(p=>distance(p,corner)))).toBeLessThanOrEqual(.6);
  expect(Math.min(...yellow.nodes.map(p=>distance({xMm:p.xMm/scale,yMm:height-p.yMm/scale},corner)))).toBeLessThanOrEqual(.6);
  const rings=result.pieces.map(p=>sampled(p,scale));let probes=0;
  for(let y=6.317;y<122;y+=5.7)for(let x=6.731;x<122;x+=5.7){
   if(Math.abs(x-boundary(y,'sharp'))/Math.hypot(1,1/slope)<2||Math.abs(y-split)<2)continue;
   probes++;const owners=result.pieces.filter((_,i)=>inside({xMm:x,yMm:y},rings[i]));
   expect(owners).toHaveLength(1);expect(pigmentFamily(owners[0].color!)).toBe(x>=boundary(y,'sharp')?2:y<split?4:0);
  }
  expect(probes).toBeGreaterThan(250);
 }
},30000);
