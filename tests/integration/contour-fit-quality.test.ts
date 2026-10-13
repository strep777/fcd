import {expect,it} from 'vitest';
import {traceMask} from '../../apps/desktop/main/reference-segmentation';
import {smoothContour} from '../../packages/reference/smooth-contour';
import {contourBoundaryError,safeContour} from '../../packages/reference/contour-topology';
import {edgeArcPoints} from '../../packages/pattern/edit';
import type {Piece} from '../../packages/schema/index';
import earFixture from '../fixtures/character-ear-contour.json';
import bodyFixture from '../fixtures/character-back-body-contour.json';
import thighFixture from '../fixtures/character-front-yellow-thigh-contour.json';

function trace(w:number,h:number,fill:(x:number,y:number)=>boolean,scale=1){const mask=new Uint8Array(w*h);for(let y=0;y<h;y++)for(let x=0;x<w;x++)if(fill(x+.5,y+.5))mask[y*w+x]=1;return traceMask(w,h,mask,{a:{x:0,y:h},b:{x:0,y:0},distanceMm:h*scale},w,h,'#0096dc',true).piece;}
const flatten=(p:Piece)=>p.nodes.flatMap(n=>edgeArcPoints(p,n.id).slice(0,-1));
const polygonArea=(p:Piece)=>{const r=flatten(p);return Math.abs(r.reduce((s,a,i)=>{const b=r[(i+1)%r.length];return s+a.xMm*b.yMm-b.xMm*a.yMm;},0)/2);};

function turnAt(piece:Piece,id:string){const i=piece.nodes.findIndex(n=>n.id===id),n=piece.nodes[i],before=piece.nodes[(i+piece.nodes.length-1)%piece.nodes.length],after=piece.nodes[(i+1)%piece.nodes.length],incoming=piece.curves?.find(c=>c.endNodeId===id),outgoing=piece.curves?.find(c=>c.startNodeId===id),a=incoming?.c2??before,b=outgoing?.c1??after;return Math.abs(Math.atan2((n.xMm-a.xMm)*(b.yMm-n.yMm)-(n.yMm-a.yMm)*(b.xMm-n.xMm),(n.xMm-a.xMm)*(b.xMm-n.xMm)+(n.yMm-a.yMm)*(b.yMm-n.yMm)));}

it.each([.05,1,10])('recovers real raster arcs within one pixel without imposing aesthetic tangent continuity at scale %s',scale=>{
 const raw=trace(220,180,(x,y)=>((x-110)/90)**2+((y-90)/65)**2<1,scale),result=smoothContour(raw,.8*scale,()=>crypto.randomUUID());
 expect(result.nodes.length).toBeLessThan(raw.nodes.length/5);expect(result.curves!.length).toBeGreaterThan(0);
 expect(contourBoundaryError(result,raw,.1*scale,1.05*scale)).toBeLessThanOrEqual(1.05*scale);
 expect(Math.abs(polygonArea(result)-polygonArea(raw))/polygonArea(raw)).toBeLessThan(.03);
 expect(Math.max(...result.curves!.map(c=>{const a=result.nodes.find(n=>n.id===c.startNodeId)!;return Math.hypot(c.c1.xMm-a.xMm,c.c1.yMm-a.yMm);}))).toBeGreaterThan(3*scale);
 // A line/arc mixture is legitimate at raster uncertainty. Forcing every
 // join to C1 would change real corners and was the reported diamond defect.
 expect(safeContour(result,raw,.8*scale)).toBe(true);
});

it('retains a pointed notch while smoothing the broad side',()=>{
 const raw=trace(160,140,(x,y)=>{const left=22+7*Math.sin((y-15)/100*Math.PI),right=120-(y-15)*.45;return y>=15&&y<120&&x>=left&&x<right&&!(y>=55&&y<=75&&x>right-12+Math.abs(y-65)*1.2);}),result=smoothContour(raw,.8,()=>crypto.randomUUID());
 expect(safeContour(result,raw,.8)).toBe(true);expect(result.nodes.length).toBeLessThan(raw.nodes.length/2);
 const notch=raw.nodes.filter(n=>Math.abs(n.yMm-(140-65))<2&&n.xMm>80).sort((a,b)=>a.xMm-b.xMm)[0];
 expect(notch).toBeDefined();const kept=result.nodes.find(n=>n.id===notch.id);expect(kept).toBeDefined();expect(Math.hypot(kept!.xMm-notch.xMm,kept!.yMm-notch.yMm)).toBeLessThanOrEqual(.91);expect(turnAt(result,kept!.id)).toBeGreaterThan(1);
 expect(contourBoundaryError(result,raw,.1,1.05)).toBeLessThanOrEqual(1.05);
});

it('protects the apex of a genuinely tapered stripe rather than rounding it off',()=>{
 const raw=trace(160,140,(x,y)=>y>=15&&y<125&&x>=20+(y-15)*.7+5*Math.sin((y-15)/110*Math.PI)&&x<130-(y-15)*.3),result=smoothContour(raw,.8,()=>crypto.randomUUID()),minimum=Math.min(...raw.nodes.map(n=>n.yMm)),tip=raw.nodes.filter(n=>n.yMm===minimum);
 const kept=result.nodes.reduce((a,b)=>a.yMm<b.yMm?a:b);expect(Math.min(...tip.map(t=>Math.hypot(kept.xMm-t.xMm,kept.yMm-t.yMm)))).toBeLessThanOrEqual(1);expect(turnAt(result,kept.id)).toBeGreaterThan(1);
 expect(safeContour(result,raw,.8)).toBe(true);expect(result.nodes.length).toBeLessThan(raw.nodes.length/3);
});

it('keeps a curved narrow band and its enclosed hole separate',()=>{
 const raw=trace(160,160,(x,y)=>{const r=Math.hypot((x-80)*.8,y-80);return r<60&&r>56;}),result=smoothContour(raw,.8,()=>crypto.randomUUID());
 expect(raw.holes).toHaveLength(1);expect(result.holes).toHaveLength(1);expect(safeContour(result,raw,.8)).toBe(true);
 expect(result.nodes.length).toBeLessThan(raw.nodes.length/3);expect(result.holes![0].length).toBeLessThan(raw.holes![0].length/3);
 expect(contourBoundaryError(result,raw,.1,1.05)).toBeLessThanOrEqual(1.05);
});

it('rejects a same-area translation and an erased indentation against the original boundary',()=>{
 const raw=trace(80,80,(x,y)=>x>=10&&x<70&&y>=10&&y<70&&!(x>60&&y>=32&&y<48));
 const translated={...raw,nodes:raw.nodes.map(p=>({...p,xMm:p.xMm+3}))};expect(safeContour(translated,raw,.8)).toBe(false);
 const rectangle=trace(80,80,(x,y)=>x>=10&&x<70&&y>=10&&y<70);expect(safeContour(rectangle,raw,.8)).toBe(false);
});

it('preserves native bevels where a hole almost touches the exterior',()=>{
 const raw=trace(30,30,(x,y)=>x>=2&&x<28&&y>=2&&y<28&&!(x>=12&&x<27&&y>=12&&y<27)&&!(x>=27&&y>=27)),result=smoothContour(raw,.8,()=>crypto.randomUUID());
 expect(safeContour(result,raw,.8)).toBe(true);expect(result.holes?.length).toBe(raw.holes?.length);
 const contacts=raw.nodes.filter((p,i)=>Math.hypot(p.xMm-raw.nodes[(i+1)%raw.nodes.length].xMm,p.yMm-raw.nodes[(i+1)%raw.nodes.length].yMm)<.04);for(const p of contacts)expect(result.nodes.find(n=>n.id===p.id)).toEqual(p);
});

it('fits the real front-view yellow ear stripe with curves rather than keeping its JPEG staircase',()=>{
 // Native boundary extracted by illustrationRegions from the 110x180 crop
 // at (880,15) of character-front-back.jpg. Store the traced pixels' boundary,
 // rather than adding a JPEG decoder dependency to the test runner.
 const point=([xMm,yMm]:number[],i:number)=>({id:`ear-${i}`,xMm,yMm}),raw:Piece={id:'ear',name:'Yellow ear stripe',nodes:earFixture.nodes.map(point),holes:(earFixture.holes as number[][][]).map((h,j)=>h.map((p,i)=>({...point(p,i),id:`hole-${j}-${i}`}))),closed:true,allowanceMm:0,cutQty:1,mirror:false,material:'毛皮',furRad:0,color:earFixture.color};
 const result=smoothContour(raw,earFixture.pixelMm,()=>crypto.randomUUID());
 expect(raw.nodes).toHaveLength(164);expect(result.nodes.length).toBeLessThanOrEqual(15);expect(result.curves!.length).toBeGreaterThan(0);
 expect(safeContour(result,raw,earFixture.pixelMm)).toBe(true);expect(contourBoundaryError(result,raw,.1,1.05)).toBeLessThanOrEqual(1.05);
 expect(Math.abs(polygonArea(result)-polygonArea(raw))/polygonArea(raw)).toBeLessThan(.03);
});

it('bounds cubic bulges even at a scale smaller than the general display flattening tolerance',()=>{
 const raw:Piece={id:'small',name:'Small',nodes:[{id:'a',xMm:0,yMm:0},{id:'b',xMm:.1,yMm:0},{id:'c',xMm:.1,yMm:.1},{id:'d',xMm:0,yMm:.1}],closed:true,allowanceMm:0,cutQty:1,mirror:false,material:'毛皮',furRad:0,color:'#0096dc'};
 const curved={...raw,curves:[{id:'bow',startNodeId:'a',endNodeId:'b',c1:{id:'c1',xMm:.03,yMm:-.009},c2:{id:'c2',xMm:.07,yMm:-.009}}]};
 expect(contourBoundaryError(curved,raw,.00025,.00175)).toBeGreaterThan(.00175);expect(safeContour(curved,raw,.001)).toBe(false);
});

it('a real back-body small hole does not force the broad outer marking back to jittery polygons',()=>{
 const point=([xMm,yMm]:number[],i:number)=>({id:`body-${i}`,xMm,yMm}),raw:Piece={id:'body',name:'Blue back-body',nodes:bodyFixture.nodes.map(point),holes:bodyFixture.holes.map((h,j)=>h.map((p,i)=>({...point(p,i),id:`body-hole-${j}-${i}`}))),closed:true,allowanceMm:0,cutQty:1,mirror:false,material:'毛皮',furRad:0,color:bodyFixture.color};
 const result=smoothContour(raw,bodyFixture.pixelMm,()=>crypto.randomUUID());
 expect(raw.nodes).toHaveLength(1764);expect(result.nodes.length).toBeLessThan(250);expect(result.curves!.length).toBeGreaterThan(0);
 expect(safeContour(result,raw,bodyFixture.pixelMm)).toBe(true);expect(contourBoundaryError(result,raw,.1,1.05)).toBeLessThanOrEqual(1.05);
 expect(result.holes).toHaveLength(1);expect(Math.abs(polygonArea(result)-polygonArea(raw))/polygonArea(raw)).toBeLessThan(.03);
 // Its tiny hole is kept, while the broad exterior remains compact and
 // bounded to original pixels instead of reverting all 1764 raster vertices.
 const tip=raw.nodes.find(n=>n.xMm===543&&n.yMm===252)!;
 expect(Math.min(...result.nodes.map(n=>Math.hypot(n.xMm-tip.xMm,n.yMm-tip.yMm)))).toBeLessThanOrEqual(1);
});

it('the actual front yellow thigh does not retain short raster-driven curvature spikes on its broad lower edge',()=>{
 const point=([xMm,yMm]:number[],i:number)=>({id:`thigh-${i}`,xMm,yMm}),raw:Piece={id:'thigh',name:'Yellow front thigh',nodes:thighFixture.nodes.map(point),holes:thighFixture.holes.map((h,j)=>h.map((p,i)=>({...point(p,i),id:`thigh-hole-${j}-${i}`}))),closed:true,allowanceMm:0,cutQty:1,mirror:false,material:'毛皮',furRad:0,color:thighFixture.color},result=smoothContour(raw,thighFixture.pixelMm,()=>crypto.randomUUID());
 expect(raw.nodes).toHaveLength(470);expect(result.curves!.every(c=>result.nodes.some(n=>n.id===c.startNodeId)&&result.nodes.some(n=>n.id===c.endNodeId))).toBe(true);expect(result.nodes.length).toBeLessThan(raw.nodes.length/3);expect(safeContour(result,raw,.8)).toBe(true);expect(contourBoundaryError(result,raw,.1,1.05)).toBeLessThanOrEqual(1.05);expect(result.holes).toHaveLength(raw.holes!.length);
 // The original lower painted edge is continuous. Check the actual
 // reconstructed geometry against source pixels, not a requirement that
 // every straight interval receive a smoothing cubic.
 const index=new Map(raw.nodes.map((n,i)=>[n.id,i]));
 const edge=result.nodes.filter(n=>{const i=index.get(n.id)!;return i>=268&&i<=323;});
 expect(edge.length).toBeGreaterThan(1);expect(edge.length).toBeLessThan(12);
 const fold=raw.nodes.slice(142,146);
 const kept=result.nodes.filter(n=>fold.some(t=>n.id===t.id));expect(kept.length).toBeGreaterThan(0);
 expect(Math.max(...kept.map(n=>turnAt(result,n.id)))).toBeGreaterThan(.9);
 // Control handles may fit an observed bend but must not invent a bulge.
 expect(contourBoundaryError(result,raw,.05,1.05)).toBeLessThanOrEqual(1.05);
});


