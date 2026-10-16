import {it,expect,vi} from 'vitest';
import sharp from 'sharp';
import {illustrationRegions,pigmentFamily} from '../../packages/reference/illustration';
import {pigmentInstances} from '../../packages/reference/region-instances';
import {structureInstances} from '../../packages/reference/structure-separation';
import * as imageEdges from '../../packages/reference/image-edge-evidence';
import type {IllustrationRegion} from '../../packages/reference/illustration';

async function image(view:'front'|'back'='front'){
 const width=view==='front'?666:609,height=750,left=view==='front'?609:0;
 const rgba=new Uint8Array(await sharp('tests/fixtures/character-front-back.jpg').extract({left,top:0,width,height}).ensureAlpha().raw().toBuffer());
 // structureInstances runs before image-edge ownership refinement in the
 // production pipeline. Capture that stage's region mask; replaying the
 // upstream separator on the final refined mask changes its input contract.
 let regions:IllustrationRegion[]|undefined;
 const refine=imageEdges.refineImageEdgeOwnership;
 const observe=vi.spyOn(imageEdges,'refineImageEdgeOwnership').mockImplementation((w,h,pixels,input)=>{regions=input;return refine(w,h,pixels,input);});
 try{illustrationRegions(width,height,rgba);}finally{observe.mockRestore();}
 expect(regions).toBeDefined();const mask=new Uint8Array(width*height);
 for(const r of regions!.filter(r=>pigmentFamily(r.color)===2))for(const i of r.indices)mask[i]=1;
 return {width,height,rgba,mask,ink:new Uint8Array(mask.length)};
}
const owner=(groups:number[][],width:number,x:number,y:number)=>groups.findIndex(g=>g.includes(y*width+x));
function preserves(groups:number[][],mask:Uint8Array){const ids=groups.flat(),unique=new Set(ids);expect(unique.size).toBe(ids.length);expect(ids.length).toBe(mask.reduce((s,v)=>s+(v?1:0),0));expect(ids.every(i=>mask[i]===1)).toBe(true);}

it('reproduces original-image horn/fur merges and separates their line-bounded interiors without losing pigment',async()=>{
 const {width,height,rgba,mask,ink}=await image(),before=pigmentInstances(width,height,mask,ink),after=structureInstances(width,height,mask,ink,rgba);
 // Manually inspected native pixels, used only as test observations. The
 // algorithm receives no coordinates, anatomical bands or semantic labels.
 expect(owner(before,width,188,80)).toBe(owner(before,width,218,140));
 expect(owner(before,width,249,90)).toBe(owner(before,width,265,125));
 for(const [horn,fur] of [[[188,80],[218,140]],[[249,90],[265,125]]]){
  const h=owner(after,width,horn[0],horn[1]),f=owner(after,width,fur[0],fur[1]);
  expect(h).toBeGreaterThanOrEqual(0);expect(f).toBeGreaterThanOrEqual(0);expect(h).not.toBe(f);
 }
 // Preserve independent ear fur as its own pigment; no horn classification.
 expect(owner(after,width,178,55)).not.toBe(owner(after,width,188,80));
 expect(owner(after,width,265,125)).toBe(owner(after,width,269,137));
 expect(after.length).toBe(before.length+3);preserves(after,mask);
});

it('does not split actual gradual tail/thigh shadows or any back-view yellow instance',async()=>{
 for(const view of ['front','back'] as const){
  const {width,height,rgba,mask,ink}=await image(view),before=pigmentInstances(width,height,mask,ink),after=structureInstances(width,height,mask,ink,rgba);
  // Every real body/tail component is pixel-identical, including recovered
  // golden thigh shadows. Only front head structures have interior line cuts.
  const comparison=view==='back'?before:before.filter(g=>g.some(i=>Math.floor(i/width)>200));
  const sets=after.map(g=>new Set(g));for(const g of comparison)expect(sets.some(a=>a.size===g.length&&g.every(i=>a.has(i)))).toBe(true);
  if(view==='back')expect(after.length).toBe(before.length);
  for(const [x,y] of view==='front'?[[348,547],[350,556],[352,566],[331,573],[356,575]]:[]){expect(owner(before,width,x,y)).toBeGreaterThanOrEqual(0);expect(owner(after,width,x,y)).toBeGreaterThanOrEqual(0);}
  preserves(after,mask);
 }
});

it('uses geometry and line evidence after a translated image crop',async()=>{
 const source=await image(),left=110,top=10,width=255,height=200,dx=31,dy=23,w=width+dx+17,h=height+dy+13,mask=new Uint8Array(w*h),rgba=new Uint8Array(w*h*4).fill(255);
 for(let y=0;y<height;y++)for(let x=0;x<width;x++){const from=(y+top)*source.width+x+left,to=(y+dy)*w+x+dx;mask[to]=source.mask[from];rgba.set(source.rgba.subarray(from*4,from*4+4),to*4);}
 const groups=structureInstances(w,h,mask,new Uint8Array(w*h),rgba),at=(x:number,y:number)=>owner(groups,w,x-left+dx,y-top+dy);
 expect(at(188,80)).toBeGreaterThanOrEqual(0);expect(at(218,140)).toBeGreaterThanOrEqual(0);expect(at(188,80)).not.toBe(at(218,140));expect(at(249,90)).toBeGreaterThanOrEqual(0);expect(at(265,125)).toBeGreaterThanOrEqual(0);expect(at(249,90)).not.toBe(at(265,125));preserves(groups,mask);
});

it('keeps the same real structure separation at half/double scale and mirrored orientation',async()=>{
 const source=await image(),crop={left:110,top:10,width:255,height:185};
 const original=new Uint8Array(await sharp(source.rgba,{raw:{width:source.width,height:source.height,channels:4}}).extract(crop).raw().toBuffer()),originalMask=new Uint8Array(await sharp(source.mask,{raw:{width:source.width,height:source.height,channels:1}}).extract(crop).extractChannel(0).raw().toBuffer());
 for(const [scale,mirror] of [[.5,false],[2,false],[1,true]] as const){
  const width=Math.round(crop.width*scale),height=Math.round(crop.height*scale),transform=(input:Uint8Array,channels:1|4)=>{let s=sharp(input,{raw:{width:crop.width,height:crop.height,channels}}).resize(width,height,{kernel:'nearest'});if(mirror)s=s.flop();if(channels===1)s=s.extractChannel(0);return s.raw().toBuffer();};
  const rgba=new Uint8Array(await transform(original,4)),mask=new Uint8Array(await transform(originalMask,1)),groups=structureInstances(width,height,mask,new Uint8Array(mask.length),rgba),at=(x:number,y:number)=>{const sx=Math.floor((x-crop.left)*scale),sy=Math.floor((y-crop.top)*scale);return owner(groups,width,mirror?width-1-sx:sx,sy);};
  expect(at(188,80)).toBeGreaterThanOrEqual(0);expect(at(218,140)).toBeGreaterThanOrEqual(0);expect(at(188,80)).not.toBe(at(218,140));expect(at(249,90)).toBeGreaterThanOrEqual(0);expect(at(265,125)).toBeGreaterThanOrEqual(0);expect(at(249,90)).not.toBe(at(265,125));preserves(groups,mask);
 }
});

it('keeps an enclosed horn crease and broad smooth shadow as one object',()=>{
 const width=130,height=120,mask=new Uint8Array(width*height),rgba=new Uint8Array(width*height*4).fill(255);
 for(let y=10;y<110;y++)for(let x=10;x<120;x++){
  const i=y*width+x;mask[i]=1;const shade=x>=63&&x<=66&&y>=25&&y<90?95:Math.round(235-(y-10)*.7);rgba.set([shade,Math.round(shade*.9),40,255],i*4);
 }
 const groups=structureInstances(width,height,mask,new Uint8Array(mask.length),rgba);expect(groups).toHaveLength(1);preserves(groups,mask);
});

it('separates a narrow brown internal stroke but retains small attached fur tips',()=>{
 const width=140,height=100,mask=new Uint8Array(width*height),rgba=new Uint8Array(width*height*4).fill(255);
 for(let y=15;y<85;y++)for(let x=10;x<130;x++){
  const i=y*width+x;mask[i]=1;rgba.set(x>=68&&x<=71?[130,115,35,255]:[242,221,52,255],i*4);
 }
 for(let y=30;y<38;y++)for(let x=130;x<137-(y-30)/2;x++){const i=y*width+x;mask[i]=1;rgba.set([210,193,47,255],i*4);}
 const groups=structureInstances(width,height,mask,new Uint8Array(mask.length),rgba);expect(groups).toHaveLength(2);expect(owner(groups,width,134,32)).toBe(owner(groups,width,110,50));expect(owner(groups,width,35,50)).not.toBe(owner(groups,width,110,50));preserves(groups,mask);
});

it('validates native image buffers',()=>{expect(()=>structureInstances(2,2,new Uint8Array(4),new Uint8Array(4),new Uint8Array(3))).toThrow('IMAGE_LIMIT');});
