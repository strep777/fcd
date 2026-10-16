import {expect,it} from 'vitest';
import {refineSourceMaterialOwnership} from '../../packages/reference/source-material-ownership';
import type {IllustrationRegion} from '../../packages/reference/illustration';

const palette=['#e24438','#304bdc','#ffffff','#10101a','#27bb50'];
const rgb=(owner:number)=>[1,3,5].map(c=>parseInt(palette[owner].slice(c,c+2),16));
type Scene=ReturnType<typeof scene>;
function scene(width:number,height:number,owner:(x:number,y:number)=>number,source=owner,count=5){
 const rgba=new Uint8Array(width*height*4),regions=palette.slice(0,count).map((color,i):IllustrationRegion=>({color,part:i===0?'head':'unknown',side:'center',confidence:.7,indices:[],contexts:[{part:'head',side:'center',confidence:.7}]}));
 for(let y=0;y<height;y++)for(let x=0;x<width;x++){const i=y*width+x,id=owner(x,y),actual=source(x,y);if(id>=0)regions[id].indices.push(i);rgba.set([...(actual>=0?rgb(actual):[255,255,255]),actual>=0?255:0],i*4);}
 return {width,height,rgba,regions};
}
function labels(input:Scene,regions=input.regions){
 const result=new Int32Array(input.width*input.height).fill(-1);
 for(const [owner,r]of regions.entries())for(const i of r.indices){expect(result[i],`overlap at ${i}`).toBe(-1);result[i]=owner;}
 return result;
}
// Independent flood fills use all image pixels and explicit coordinate bounds.
// They do not duplicate the production local eight-neighbor simple-point test.
function topology(width:number,height:number,pixels:Int32Array,owner:number){
 const count=(equal:boolean,eight:boolean)=>{
  const seen=new Uint8Array(width*height);let components=0,holes=0;
  for(let start=0;start<pixels.length;start++){
   if(seen[start]||(pixels[start]===owner)!==equal)continue;components++;const queue=[start];seen[start]=1;let border=false;
   for(let q=0;q<queue.length;q++){const i=queue[q],x=i%width,y=Math.floor(i/width);border ||= x===0||x===width-1||y===0||y===height-1;
    for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){if(!dx&&!dy||!eight&&Math.abs(dx)+Math.abs(dy)!==1||x+dx<0||x+dx>=width||y+dy<0||y+dy>=height)continue;const j=(y+dy)*width+x+dx;if(!seen[j]&&(pixels[j]===owner)===equal){seen[j]=1;queue.push(j);}}
   }if(!border)holes++;
  }return {components,holes};
 };
 return {components:count(true,false).components,holes:count(false,true).holes};
}
function checkConservation(input:Scene,actual:IllustrationRegion[]){
 const before=labels(input),after=labels(input,actual);
 expect(actual).toHaveLength(input.regions.length);
 for(let i=0;i<before.length;i++)expect(after[i]>=0,`foreground pixel ${i}`).toBe(before[i]>=0);
 for(let owner=0;owner<input.regions.length;owner++){
  expect(topology(input.width,input.height,after,owner),`topology owner ${owner}`).toEqual(topology(input.width,input.height,before,owner));
  const {indices:_a,...metadata}=actual[owner],{indices:_b,...original}=input.regions[owner];expect(metadata).toEqual(original);
 }
 return after;
}

it.each([
 {width:0,height:2,length:0},{width:-1,height:2,length:0},{width:2.5,height:2,length:20},
 {width:2,height:NaN,length:0},{width:Infinity,height:2,length:0},{width:4097,height:4096,length:0},
 {width:2,height:2,length:15},{width:2,height:2,length:17}
])('rejects malformed dimensions or buffer $width x $height / $length bytes',({width,height,length})=>{
 expect(()=>refineSourceMaterialOwnership(width,height,new Uint8Array(length),[])).toThrow('IMAGE_LIMIT');
});
it.each([-1,4,.5,NaN,Infinity])('rejects invalid pixel index %s without changing source regions',index=>{
 const input=scene(2,2,()=>0,()=>0,1);input.regions[0].indices=[index];const before=structuredClone(input.regions);
 expect(()=>refineSourceMaterialOwnership(2,2,input.rgba,input.regions)).toThrow('INVALID_MASK');expect(input.regions).toEqual(before);
});
it.each(['same-owner','different-owner']as const)('rejects overlapping %s indices atomically',mode=>{
 const input=scene(3,3,x=>x===0?0:1,undefined,2);if(mode==='same-owner')input.regions[0].indices.push(0);else input.regions[1].indices.push(0);
 const before=structuredClone(input.regions);expect(()=>refineSourceMaterialOwnership(3,3,input.rgba,input.regions)).toThrow('INVALID_MASK');expect(input.regions).toEqual(before);
});

it('returns empty ownership safely and retains empty regions plus their metadata',()=>{
 const rgba=new Uint8Array(16);expect(refineSourceMaterialOwnership(2,2,rgba,[])).toEqual({regions:[],moved:0});
 const input=scene(5,5,()=>0,()=>0,2),result=refineSourceMaterialOwnership(5,5,input.rgba,input.regions);expect(result.moved).toBe(0);expect(result.regions).toEqual(input.regions);
});

it.each([false,true])('corrects a locally wrong color boundary with exact coverage and unchanged topology at mirror=%s',mirror=>{
 const width=48,height=36,toNative=(x:number)=>mirror?width-1-x:x,input=scene(width,height,x=>toNative(x)<26?0:1,x=>toNative(x)<24?0:1,2),before=structuredClone(input);
 const result=refineSourceMaterialOwnership(width,height,input.rgba,input.regions),after=checkConservation(input,result.regions);
 expect(input).toEqual(before);expect(result.moved).toBeGreaterThan(0);
 for(let y=7;y<height-7;y++)for(const nx of [22,24,25,27])expect(after[y*width+(mirror?width-1-nx:nx)],`source x=${nx} y=${y}`).toBe(nx<24?0:1);
 for(let x=0;x<width;x++){expect(after[x]).toBe(labels(input)[x]);expect(after[(height-1)*width+x]).toBe(labels(input)[(height-1)*width+x]);}
});

it('retains a one-pixel articulation and two disconnected components despite competing local color evidence',()=>{
 const body=(x:number,y:number)=>x>=5&&x<=16&&y>=7&&y<=25||x>=25&&x<=36&&y>=7&&y<=25||x>=17&&x<=24&&y===16||x>=40&&x<=43&&y>=28&&y<=31;
 const input=scene(48,38,(x,y)=>body(x,y)?0:1,(x,y)=>y===16&&x>=17&&x<=24?1:body(x,y)?0:1,2),before=labels(input),result=refineSourceMaterialOwnership(input.width,input.height,input.rgba,input.regions),after=checkConservation(input,result.regions);
 expect(topology(input.width,input.height,before,0).components).toBe(2);
 for(let x=17;x<=24;x++)expect(after[16*input.width+x],'the sole bridge cannot be deleted').toBe(0);
});

it('preserves small white holes, an exterior thin slit, and strongly painted compact islands',()=>{
 const owner=(x:number,y:number)=>{
  if(x<3||x>46||y<3||y>36||x===24&&y<=21)return -1;
  if(x>=10&&x<=11&&y>=11&&y<=12)return 2;
  if(x>=31&&x<=34&&y>=11&&y<=14)return 4;
  if(x>=32&&x<=37&&y>=26&&y<=31)return 3;
  return 0;
 };
 const input=scene(50,40,owner),before=structuredClone(input),result=refineSourceMaterialOwnership(input.width,input.height,input.rgba,input.regions),after=checkConservation(input,result.regions);
 expect(input).toEqual(before);expect(result.moved).toBe(0);
 for(const [x,y,id]of [[10,11,2],[11,12,2],[24,15,-1],[24,21,-1],[31,11,4],[34,14,4],[35,29,3]])expect(after[y*input.width+x]).toBe(id);
 expect(topology(input.width,input.height,after,0).holes).toBe(3);
});

it('keeps complete three-owner junction membership when source colors already support it',()=>{
 const owner=(x:number,y:number)=>x<24?0:y<18?1:4,input=scene(48,36,owner),before=structuredClone(input),result=refineSourceMaterialOwnership(48,36,input.rgba,input.regions),after=checkConservation(input,result.regions);
 expect(input).toEqual(before);expect(result.moved).toBe(0);
 for(let y=15;y<=20;y++)for(let x=21;x<=26;x++)expect(after[y*48+x]).toBe(owner(x,y));
});

it.each([false,true])('corrects a displaced three-material junction without merging owners at reversed order=%s',reverse=>{
 const owner=(x:number,y:number)=>x<26?0:y<18?1:4,source=(x:number,y:number)=>x<24?0:y<18?1:4,input=scene(48,36,owner,source);
 if(reverse)input.regions.reverse();const before=structuredClone(input),result=refineSourceMaterialOwnership(48,36,input.rgba,input.regions),after=checkConservation(input,result.regions);
 expect(input).toEqual(before);expect(result.moved).toBeGreaterThan(0);
 for(let y=12;y<=23;y++)for(const x of [22,24,25,27]){
  const originalOwner=source(x,y),expected=input.regions.findIndex(r=>r.color===palette[originalOwner]);
  expect(after[y*48+x],`junction x=${x} y=${y}`).toBe(expected);
 }
});

it('makes no ownership claim from an RGB image with no local material contrast',()=>{
 const input=scene(40,30,x=>x<20?0:1,()=>2,3),before=structuredClone(input),result=refineSourceMaterialOwnership(40,30,input.rgba,input.regions);
 expect(input).toEqual(before);checkConservation(input,result.regions);expect(result.moved).toBe(0);expect(result.regions).toEqual(input.regions);
});

it('does not merge two owners separated by an unowned one-pixel channel or reassign channel pixels',()=>{
 const input=scene(44,34,x=>x===22?-1:x<22?0:1,()=>0,2),result=refineSourceMaterialOwnership(44,34,input.rgba,input.regions),after=checkConservation(input,result.regions);
 for(let y=0;y<34;y++)expect(after[y*44+22]).toBe(-1);
 expect(topology(44,34,after,0).components).toBe(1);expect(topology(44,34,after,1).components).toBe(1);
});

it.each([false,true])('preserves distinct same-color owners across ink and a local illumination change at mirror=%s',mirror=>{
 const width=48,height=36,toNative=(x:number)=>mirror?width-1-x:x,input=scene(width,height,x=>toNative(x)<26?0:1,undefined,2);
 input.regions.forEach(r=>{r.color='#f9e33c';});
 for(let y=0;y<height;y++)for(let x=0;x<width;x++){
  const nativeX=toNative(x),color=nativeX===25?[28,24,22]:nativeX<24?[240,210,40]:[185,158,70];
  input.rgba.set([...color,255],(y*width+x)*4);
 }
 // The same source fabric is shaded differently on either side of an ink
 // separator. RGB preference alone must not exchange these separate owners.
 const before=structuredClone(input),result=refineSourceMaterialOwnership(width,height,input.rgba,input.regions);
 expect(input).toEqual(before);checkConservation(input,result.regions);expect(result.moved).toBe(0);expect(result.regions).toEqual(input.regions);
});

it('returns complete original ownership when a valid dense mask exceeds the boundary sampling budget',()=>{
 const input=scene(512,400,(x,y)=>(x+y)%2,()=>0,2),before=structuredClone(input);
 const result=refineSourceMaterialOwnership(input.width,input.height,input.rgba,input.regions);
 // Every checkerboard pixel is a boundary sample. Exact unchanged indices
 // certify its many components and holes without an expensive flood per pixel.
 expect(result.moved).toBe(0);expect(result.regions).toEqual(before.regions);expect(input).toEqual(before);
 expect(result.regions.reduce((n,r)=>n+r.indices.length,0)).toBe(input.width*input.height);
});
it('does not use the dense-mask budget to bypass validation of a late overlapping index',()=>{
 const input=scene(512,400,(x,y)=>(x+y)%2,()=>0,2);input.regions[1].indices.push(input.regions[0].indices.at(-1)!);const before=structuredClone(input.regions);
 expect(()=>refineSourceMaterialOwnership(input.width,input.height,input.rgba,input.regions)).toThrow('INVALID_MASK');expect(input.regions).toEqual(before);
});

it.each([{pair:[0,1]as const},{pair:[1,0]as const}])('preserves protected material pair $pair while correcting another adjacent pair',({pair})=>{
 const input=scene(64,36,x=>x<22?0:x<44?1:4,x=>x<20?0:x<42?1:4),before=structuredClone(input),protectedPairs=[pair]as const;
 const result=refineSourceMaterialOwnership(input.width,input.height,input.rgba,input.regions,protectedPairs),after=checkConservation(input,result.regions);
 expect(input).toEqual(before);expect(protectedPairs).toEqual([pair]);expect(result.moved).toBeGreaterThan(0);
 expect(result.regions[0].indices,'the protected red/blue boundary stays unchanged').toEqual(input.regions[0].indices);
 for(let y=7;y<29;y++){
  for(const x of [20,21])expect(after[y*64+x],'protected pair must not exchange ownership').toBe(0);
  for(const x of [42,43])expect(after[y*64+x],'unprotected blue/green evidence still corrects ownership').toBe(4);
 }
});
it('retains default behavior with no protected pairs and with a nonadjacent unrelated protected pair',()=>{
 const input=scene(64,36,x=>x<22?0:x<44?1:4,x=>x<20?0:x<42?1:4),before=structuredClone(input);
 const standard=refineSourceMaterialOwnership(input.width,input.height,input.rgba,input.regions),explicitEmpty=refineSourceMaterialOwnership(input.width,input.height,input.rgba,input.regions,[]),unrelated=refineSourceMaterialOwnership(input.width,input.height,input.rgba,input.regions,[[0,4]]);
 expect(input).toEqual(before);expect(explicitEmpty).toEqual(standard);expect(unrelated).toEqual(standard);
 const after=checkConservation(input,standard.regions);expect(standard.moved).toBeGreaterThan(0);
 for(let y=7;y<29;y++){for(const x of [20,21])expect(after[y*64+x]).toBe(1);for(const x of [42,43])expect(after[y*64+x]).toBe(4);}
});
