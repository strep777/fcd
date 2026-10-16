import {it,expect} from 'vitest';
import sharp from 'sharp';
import {illustrationRegions,pigmentFamily} from '../../packages/reference/illustration';
import {traceMask} from '../../apps/desktop/main/reference-segmentation';
import {smoothContour} from '../../packages/reference/smooth-contour';
import {safeContour,contourBoundaryError} from '../../packages/reference/contour-topology';
function continuousTrunk(result:ReturnType<typeof illustrationRegions>,width:number){
 // These broad cyan interiors are independently supported by original JPEG
 // RGB values from the shoulder through the flank and thigh. They identify
 // the same material instance without relying on an old antialiasing count.
 const owner=(x:number,y:number)=>result.regions.find(r=>r.indices.includes(y*width+x)),source=owner(300,300);
 expect(source,'the original connected cyan thigh/body area must stay one source').toBeDefined();expect(pigmentFamily(source!.color)).toBe(4);
 for(const [x,y]of[[325,350],[310,400],[335,450],[360,490],[380,500]])expect(owner(x,y)).toBe(source);
 const remaining=new Set(source!.indices),queue=[source!.indices[0]];remaining.delete(queue[0]);for(let k=0;k<queue.length;k++){const i=queue[k],x=i%width;for(const n of[x?i-1:-1,x+1<width?i+1:-1,i-width,i+width])if(remaining.delete(n))queue.push(n);}expect(remaining.size).toBe(0);
 return source!;
}
async function front(){const {data,info}=await sharp('tests/fixtures/character-front-back.jpg').extract({left:609,top:0,width:666,height:750}).ensureAlpha().raw().toBuffer({resolveWithObject:true});return {width:info.width,height:info.height,rgba:new Uint8Array(data)};}
it('classifies a dominant back-head blue region with central lower-face support while preserving cross-body white ambiguity',async()=>{
 const width=609,height=750,rgba=new Uint8Array(await sharp('tests/fixtures/character-front-back.jpg').extract({left:0,top:0,width,height}).ensureAlpha().raw().toBuffer()),result=illustrationRegions(width,height,rgba),blue=result.regions.find(r=>pigmentFamily(r.color)===4&&r.indices.length>10000&&r.indices.every(i=>Math.floor(i/width)<240));
 expect(blue?.part).toBe('head');expect(blue?.side).toBe('center');
 const f=await front(),frontResult=illustrationRegions(f.width,f.height,f.rgba);expect(frontResult.regions.some(r=>pigmentFamily(r.color)===0&&r.part==='unknown'&&r.indices.some(i=>Math.floor(i/f.width)<230)&&r.indices.some(i=>Math.floor(i/f.width)>600))).toBe(true);
});
it('real standing-character anatomical bounds describe full context rather than tiny accepted pigment patches',async()=>{
 const {width,height,rgba}=await front(),result=illustrationRegions(width,height,rgba),body=result.partBounds.find(b=>b.part==='body')!,head=result.partBounds.find(b=>b.part==='head')!;
 expect(result.anatomical).toBe(true);expect(body.maxX-body.minX).toBeGreaterThan(140);expect(body.minX).toBeLessThan(210);expect(body.minY).toBeLessThan(280);expect(body.maxY).toBeGreaterThan(470);
 expect(head.minX).toBeGreaterThan(120);expect(head.maxX-head.minX).toBeLessThan(270);
 const arms=result.partBounds.filter(b=>b.part==='arm'&&b.side);expect(arms).toHaveLength(2);expect(new Set(arms.map(b=>b.side))).toEqual(new Set(['left','right']));for(const arm of arms){expect(arm.maxX-arm.minX).toBeGreaterThan(65);expect(Number.isFinite(arm.orientationRad)).toBe(true);}expect(arms[0].maxX).toBeLessThan(arms[1].minX);
});
it('retains golden shadow fur tips against sharp pink and white boundaries within a bounded contour error',()=>{
 const width=200,height=130,rgba=new Uint8Array(width*height*4).fill(255),truth=new Uint8Array(width*height),points=[[20,20],[120,20],[175,27],[130,38],[181,47],[132,57],[180,70],[127,80],[173,95],[120,105],[20,105]];
 const inside=(x:number,y:number)=>{let odd=false;for(let i=0,j=points.length-1;i<points.length;j=i++){const a=points[i],b=points[j];if((a[1]>y)!==(b[1]>y)&&x<(b[0]-a[0])*(y-a[1])/(b[1]-a[1])+a[0])odd=!odd;}return odd;};
 for(let y=0;y<height;y++)for(let x=0;x<width;x++){
  const i=y*width+x;if(inside(x+.5,y+.5)){truth[i]=1;const t=Math.max(0,Math.min(1,(x-120)/60)),v=235-110*t,h=(56-34*t)/60,c=v*.76,secondary=c*(1-Math.abs(h%2-1)),m=v-c;rgba.set([c+m,secondary+m,m,255].map(Math.round),i*4);}
  else if(y>=106&&y<122&&x>=25&&x<170)rgba.set([240,145,162,255],i*4);
 }
 const result=illustrationRegions(width,height,rgba,true,'head'),mask=new Uint8Array(width*height);for(const r of result.regions.filter(r=>pigmentFamily(r.color)===2))for(const i of r.indices)mask[i]=1;
 let intersection=0,union=0;for(let i=0;i<mask.length;i++){if(mask[i]&&truth[i])intersection++;if(mask[i]||truth[i])union++;}expect(intersection/union).toBeGreaterThan(.995);
 for(const [x,y] of [[172,27],[177,47],[176,70],[170,94]])expect(mask[y*width+x]).toBe(1);
 expect(mask[115*width+80]).toBe(0);expect(mask[40*width+190]).toBe(0);
 const raw=traceMask(width,height,mask,{a:{x:0,y:height},b:{x:0,y:0},distanceMm:height},width,height,'#efcc28',true).piece,fit=smoothContour(raw,.8,()=>crypto.randomUUID());expect(safeContour(fit,raw,.8)).toBe(true);expect(contourBoundaryError(fit,raw,.2,1.4)).toBeLessThanOrEqual(1.4);
});
it('real yellow lower-thigh fur retains gradual warm-shadow boundary pixels without consuming white or pink features',async()=>{
 const {width,height,rgba}=await front(),result=illustrationRegions(width,height,rgba),yellow=new Set(result.regions.filter(r=>pigmentFamily(r.color)===2).flatMap(r=>r.indices));
 // Hand-inspected original-image probes on golden-brown shading inside the yellow fur.
 const shadow=[[348,547],[350,556],[352,566],[331,573],[356,575]],retained=shadow.filter(([x,y])=>yellow.has(y*width+x));
 expect(retained.length).toBeGreaterThanOrEqual(4);
 for(const [x,y] of [[165,85],[217,310],[337,673],[45,243]])expect(yellow.has(y*width+x)).toBe(false);
 const all=result.regions.flatMap(r=>r.indices);expect(new Set(all).size).toBe(all.length);expect(all.length).toBe(result.foregroundPixels-result.discardedPixels);
});

it('keeps continuous trunk pigment intact and records placement candidates without artificial cut edges',async()=>{
 const {width,height,rgba}=await front(),result=illustrationRegions(width,height,rgba),continuous=continuousTrunk(result,width);
 expect(continuous!.contexts?.some(c=>c.part==='body'&&c.side==='center')).toBe(true);
 expect(continuous!.contexts?.some(c=>c.part==='arm')).toBe(true);
 expect(continuous!.contexts?.some(c=>c.part==='leg')).toBe(true);
 const all=result.regions.flatMap(r=>r.indices);expect(new Set(all).size).toBe(all.length);expect(all.length).toBe(result.foregroundPixels-result.discardedPixels);
});

it('full torso registration excludes raised-hand head-band outliers and the arm-to-leg band gap',async()=>{
 for(const [file,left,width,height,maxWidth] of [['character-front-back.jpg',609,666,750,250],['character-front-back.jpg',0,609,750,250],['character-blue-white-front-back.png',0,803,1024,250]] as const){
  const rgba=new Uint8Array(await sharp('tests/fixtures/'+file).extract({left,top:0,width,height}).ensureAlpha().raw().toBuffer()),result=illustrationRegions(width,height,rgba),body=result.partBounds.find(b=>b.part==='body')!,head=result.partBounds.find(b=>b.part==='head')!;
  expect(body,`${file}:${left} must retain a torso frame`).toBeDefined();expect(body.maxX-body.minX,`${file}:${left} no thin lateral strip may enlarge the torso frame`).toBeLessThan(maxWidth);
  if(left===0&&file==='character-front-back.jpg'){expect(head.maxX-head.minX).toBeLessThan(230);expect(head.maxX).toBeLessThan(530);}
 }
});

it('uses a true oriented full-silhouette limb frame instead of rotating an inflated axis-aligned box',async()=>{
 const {width,height,rgba}=await front(),result=illustrationRegions(width,height,rgba),arms=result.partBounds.filter(b=>b.part==='arm'&&b.side&&b.orientationRad!==undefined);
 expect(arms).toHaveLength(2);const ratios=arms.map(b=>{expect(b.frameCorners).toHaveLength(4);const c=Math.cos(b.orientationRad!),s=Math.sin(b.orientationRad!),frame=b.frameCorners!,thickness=Math.abs(-(frame[3].x-frame[0].x)*s+(frame[3].y-frame[0].y)*c),inflated=Math.abs(s)*(b.maxX-b.minX)+Math.abs(c)*(b.maxY-b.minY);
  expect(thickness).toBeGreaterThan(1);expect(thickness).toBeLessThanOrEqual(inflated+1e-8);return thickness/inflated;
 });expect(Math.min(...ratios)).toBeLessThan(.8);
});
it('real arm registration excludes detached tail and low hip while preserving both differently posed original and replacement arms',async()=>{
 for(const [file,left,width,height,probes,excluded] of [
  ['character-front-back.jpg',609,666,750,[[120,320],[390,335]],[[150,500],[520,396],[400,500]]],
  ['character-front-back.jpg',0,609,750,[[250,320],[530,310]],[[100,396],[240,500],[500,500]]],
  ['character-blue-white-front-back.png',0,803,1024,[[280,450],[580,450]],[[310,620],[560,640]]],
 ] as const){
  const rgba=new Uint8Array(await sharp('tests/fixtures/'+file).extract({left,top:0,width,height}).ensureAlpha().raw().toBuffer()),result=illustrationRegions(width,height,rgba),arms=result.partBounds.filter(b=>b.part==='arm'&&b.side);
  expect(arms,`${file}:${left} must retain both arms`).toHaveLength(2);
  const contains=(x:number,y:number)=>arms.some(b=>x>=b.minX&&x<b.maxX&&y>=b.minY&&y<b.maxY);
  for(const [x,y] of probes)expect(contains(x,y),`${file}:${left} visible arm ${x},${y}`).toBe(true);
  for(const [x,y] of excluded)expect(contains(x,y),`${file}:${left} tail/hip ${x},${y}`).toBe(false);
  if(file==='character-front-back.jpg'&&left===609)continuousTrunk(result,width);
 }
});
