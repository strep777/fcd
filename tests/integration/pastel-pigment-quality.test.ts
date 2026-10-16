import {expect,it} from 'vitest';
import UPNG from '@pdf-lib/upng';
import {readFileSync} from 'node:fs';
import {pigmentInstances} from '../../packages/reference/region-instances';
import {illustrationRegions,pigmentFamily} from '../../packages/reference/illustration';
import {traceMask} from '../../apps/desktop/main/reference-segmentation';
import {smoothContour} from '../../packages/reference/smooth-contour';
import {safeContour,contourBoundaryError} from '../../packages/reference/contour-topology';

function fixture(name:'paw'|'ear'){
 const bytes=readFileSync(`tests/fixtures/character-${name}-native.png`),codec=(UPNG as unknown as {default?:typeof UPNG}).default??UPNG,image=codec.decode(Uint8Array.from(bytes).buffer);
 return {width:image.width,height:image.height,rgba:new Uint8Array(codec.toRGBA8(image)[0])};
}
function piece(width:number,height:number,indices:number[],color:string){const mask=new Uint8Array(width*height);for(const i of indices)mask[i]=1;return traceMask(width,height,mask,{a:{x:0,y:height},b:{x:0,y:0},distanceMm:height},width,height,color,true).piece;}
it('recovers six real paw pad instances including highlights rather than tracing saturated shadow islands',()=>{
 // Original-resolution crop (610,215,125,125), character-front-back.jpg.
 const {width,height,rgba}=fixture('paw'),result=illustrationRegions(width,height,rgba,true,'paw'),pads=result.regions.filter(r=>pigmentFamily(r.color)===1);
 expect(pads).toHaveLength(6);expect(pads.reduce((n,p)=>n+p.indices.length,0)).toBeGreaterThan(4000);
 const anchors=[[45,28],[72,28],[31,43],[65,70],[87,50],[38,73]],owners=anchors.map(([x,y])=>pads.findIndex(r=>r.indices.includes(y*width+x)));expect(owners.every(i=>i>=0)).toBe(true);expect(new Set(owners).size).toBe(6);
 // A real white fur point remains outside every pad. A light pink upper pad
 // point was formerly assigned to the global white/highlight component.
 expect(pads.some(r=>r.indices.includes(24*width+44))).toBe(true);expect(pads.some(r=>r.indices.includes(90*width+20))).toBe(false);
 for(const pad of pads){const raw=piece(width,height,pad.indices,pad.color),fit=smoothContour(raw,.8,()=>crypto.randomUUID());expect(safeContour(fit,raw,.8)).toBe(true);expect(contourBoundaryError(fit,raw,.2,1.4)).toBeLessThanOrEqual(1.4);expect(raw.holes??[]).toHaveLength(0);}
});

it('recovers the continuous real inner ear without splitting its crease shadows into fabric colors',()=>{
 // Original-resolution crop (880,15,110,180), character-front-back.jpg.
 const {width,height,rgba}=fixture('ear'),result=illustrationRegions(width,height,rgba,true,'head'),pinks=result.regions.filter(r=>pigmentFamily(r.color)===1),inner=pinks.filter(r=>r.indices.length>500);
 expect(inner).toHaveLength(1);
 // The former area minimum included the white fur tongue entering the ear.
 // Bound retained pigment by independent original-color interiors instead.
 const sourcePink=(i:number)=>{const r=rgba[i*4],g=rgba[i*4+1],b=rgba[i*4+2];return r-g>=35&&r-b>=30&&g<=b+15&&Math.max(r,g,b)>110;};
 const sourceCore:number[]=[];
 // Fixed original-image window inside the main ear, away from its outer ink
 // edge and the white-fur tongue. It does not follow a fitted/source mask.
 for(let y=25;y<=115;y++)for(let x=40;x<=70;x++){
  let pigment=true;for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++)if(!sourcePink((y+dy)*width+x+dx))pigment=false;
  if(pigment)sourceCore.push(y*width+x);
 }
 expect(sourceCore.length).toBeGreaterThan(1000);
 const retained=new Set(inner[0].indices);expect(sourceCore.every(i=>retained.has(i))).toBe(true);
 expect(inner[0].indices.length).toBeGreaterThanOrEqual(sourceCore.length);
 for(const [x,y] of [[36,92],[38,92],[39,92],[40,92]]){
  const i=y*width+x,rgb=[rgba[i*4],rgba[i*4+1],rgba[i*4+2]];
  expect(Math.max(...rgb)-Math.min(...rgb)).toBeLessThan(20);expect(Math.max(...rgb)).toBeGreaterThan(240);
  expect(retained.has(i)).toBe(false);
 }
 expect(inner[0].indices.includes(34*width+43)).toBe(true);expect(inner[0].indices.includes(74*width+59)).toBe(true);expect(inner[0].indices.includes(100*width+76)).toBe(false);
 const raw=piece(width,height,inner[0].indices,inner[0].color),fit=smoothContour(raw,.8,()=>crypto.randomUUID());expect(safeContour(fit,raw,.8)).toBe(true);expect(fit.nodes.length).toBeLessThan(raw.nodes.length/2);
});

it('fills a gradual enclosed pink glint but preserves a sharply painted white hole',()=>{
 const width=90,height=80,rgba=new Uint8Array(width*height*4).fill(255);
 for(let y=0;y<height;y++)for(let x=0;x<width;x++)if(((x-45)/36)**2+((y-40)/31)**2<1){const d=Math.hypot(x-28,y-29),mix=d<6?1:d<17?(17-d)/11:0;rgba.set([245+10*mix,150+105*mix,165+90*mix,255].map(Math.round),(y*width+x)*4);if(Math.hypot(x-61,y-44)<7)rgba.set([255,255,255,255],(y*width+x)*4);}
 const result=illustrationRegions(width,height,rgba,true,'paw'),pink=result.regions.filter(r=>pigmentFamily(r.color)===1);expect(pink).toHaveLength(1);expect(pink[0].indices.includes(29*width+28)).toBe(true);expect(pink[0].indices.includes(44*width+61)).toBe(false);
 const raw=piece(width,height,pink[0].indices,pink[0].color),fit=smoothContour(raw,.8,()=>crypto.randomUUID());expect(raw.holes).toHaveLength(1);expect(fit.holes).toHaveLength(1);expect(fit.holes![0].length).toBeGreaterThanOrEqual(3);expect(contourBoundaryError(fit,raw,.1,1.05)).toBeLessThanOrEqual(1.05);expect(safeContour(fit,raw,.8)).toBe(true);
});

it('does not split a gradual one-sided pink shadow or an incomplete ink crease into pad instances',()=>{
 const width=100,height=80,rgba=new Uint8Array(width*height*4).fill(255);
 for(let y=10;y<70;y++)for(let x=10;x<90;x++){const scale=.6+.4*(x-10)/80;rgba.set([245*scale,160*scale,175*scale,255].map(Math.round),(y*width+x)*4);if(x===45&&y<40)rgba.set([80,60,60,255],(y*width+x)*4);}
 const pink=illustrationRegions(width,height,rgba,true,'paw').regions.filter(r=>pigmentFamily(r.color)===1);expect(pink).toHaveLength(1);
});

it('does not infer a full character anatomy from an isolated multicolour ear crop',()=>{
 const {width,height,rgba}=fixture('ear'),result=illustrationRegions(width,height,rgba,true,'character');expect(result.anatomical).toBe(false);expect(result.regions.every(r=>r.part==='unknown'&&r.confidence===0)).toBe(true);
});

it('requires lower silhouette evidence for body bands and local compact pigment evidence for a paw',()=>{
 const width=120,height=220,rgba=new Uint8Array(width*height*4).fill(255),paint=(x0:number,y0:number,x1:number,y1:number,color:number[])=>{for(let y=y0;y<y1;y++)for(let x=x0;x<x1;x++)rgba.set([...color,255],(y*width+x)*4);};
 paint(45,30,75,175,[0,150,230]);paint(35,20,85,60,[0,150,230]);paint(30,8,40,25,[240,210,30]);paint(25,80,47,98,[0,150,230]);paint(10,70,30,90,[245,140,160]);paint(30,175,55,210,[170,170,180]);paint(65,175,90,210,[170,170,180]);
 const result=illustrationRegions(width,height,rgba,true);expect(result.anatomical).toBe(true);const pad=result.regions.find(r=>pigmentFamily(r.color)===1);expect(pad?.part).toBe('paw');expect(pad?.side).toBe('left');
});

it('does not promote isolated warm white-fur shading to a pink fabric component',()=>{
 const width=80,height=80,rgba=new Uint8Array(width*height*4).fill(255);for(let y=10;y<70;y++)for(let x=10;x<70;x++)rgba.set([245,220-(x-10)/6,225-(x-10)/8,255].map(Math.round),(y*width+x)*4);
 expect(illustrationRegions(width,height,rgba,true,'head').regions.every(r=>pigmentFamily(r.color)===0)).toBe(true);
});


it('places native paw instance dividers on darker separating strokes instead of scan-order staircases',()=>{
 const {width,height,rgba}=fixture('paw'),pads=illustrationRegions(width,height,rgba,true,'paw').regions.filter(r=>pigmentFamily(r.color)===1),owners=new Int16Array(width*height).fill(-1);
 pads.forEach((pad,id)=>pad.indices.forEach(i=>owners[i]=id));const edgeBrightness:number[]=[];
 for(let i=0;i<owners.length;i++)if(owners[i]>=0)for(const n of [i%width+1<width?i+1:-1,i+width<owners.length?i+width:-1])if(n>=0&&owners[n]>=0&&owners[n]!==owners[i])edgeBrightness.push((Math.max(rgba[i*4],rgba[i*4+1],rgba[i*4+2])+Math.max(rgba[n*4],rgba[n*4+1],rgba[n*4+2]))/(2*255));
 // The former 4-neighbor unweighted fill measured mean V=.779785 with
 // 51 bright (> .85 V) divider edges on this native fixture. The geodesic
 // fill measures .762216 and 38, with the same six anatomical pad interiors.
 expect(pads).toHaveLength(6);expect(edgeBrightness.length).toBeGreaterThan(150);expect(edgeBrightness.reduce((s,n)=>s+n,0)/edgeBrightness.length).toBeLessThan(.77);expect(edgeBrightness.filter(v=>v>.85).length).toBeLessThanOrEqual(40);
 const covered=pads.flatMap(p=>p.indices);expect(new Set(covered).size).toBe(covered.length);
});

it('grows two pigment interiors to a curved dark valley while preserving every foreground pixel exactly once',()=>{
 const width=80,height=48,mask=new Uint8Array(width*height).fill(1),ink=new Uint8Array(mask.length),band=new Uint8Array(mask.length),light=new Float32Array(mask.length).fill(.95),ridge=(y:number)=>35+Math.round(3*Math.sin(y*.14));
 for(let y=0;y<height;y++)for(let x=0;x<width;x++){const i=y*width+x;if(x>=27&&x<=51)band[i]=1;if(Math.abs(x-ridge(y))<=2)light[i]=.15;}
 const regions=pigmentInstances(width,height,mask,ink,band,light),owner=new Int16Array(mask.length).fill(-1);regions.forEach((r,id)=>r.forEach(i=>owner[i]=id));expect(regions).toHaveLength(2);expect(regions.flat().length).toBe(mask.length);expect(new Set(regions.flat()).size).toBe(mask.length);
 const errors:number[]=[];for(let y=0;y<height;y++)for(let x=0;x<width-1;x++)if(owner[y*width+x]!==owner[y*width+x+1])errors.push(Math.abs(x+.5-ridge(y)));
 expect(errors.length).toBe(height);expect(errors.reduce((s,n)=>s+n,0)/errors.length).toBeLessThan(3);
});
