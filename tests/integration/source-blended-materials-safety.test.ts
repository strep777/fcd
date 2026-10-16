import assert from 'node:assert/strict';
import sharp from 'sharp';
import {it as test} from 'vitest';
import {sourceBlendedMaterials} from '../../packages/reference/source-blended-materials';

type RGB=readonly[number,number,number];
type Field={width:number;height:number;rgba:Uint8Array;foreground:Uint8Array;labels:Int8Array};
type Pixel={rgb:RGB;label:number;alpha?:number;foreground?:number};
type Transform='mirror'|'rotate90'|'rotate180'|'translate';
const blue:RGB=[35,100,230],yellow:RGB=[245,220,50],white:RGB=[246,246,242];
const clamp=(t:number)=>Math.max(0,Math.min(1,t));
const mixture=(t:number):RGB=>blue.map((value,c)=>Math.round(value+(yellow[c]-value)*t)) as [number,number,number];

function field(width:number,height:number,pixel:(x:number,y:number)=>Pixel):Field{
 const rgba=new Uint8Array(width*height*4),foreground=new Uint8Array(width*height),labels=new Int8Array(width*height);
 for(let y=0;y<height;y++)for(let x=0;x<width;x++){
  const i=y*width+x,p=pixel(x,y);rgba.set([...p.rgb,p.alpha??255],4*i);foreground[i]=p.foreground??1;labels[i]=p.label;
 }
 return{width,height,rgba,foreground,labels};
}

// RGB is prescribed from two source pigments before assigning an erroneous
// green3or neutral0fringe. A non-tie phase also makes mapped ownership unique.
function stripe(initialMixedLabel=3):Field{
 return field(64,48,x=>{const t=clamp((x-32.23+3)/6);return{rgb:mixture(t),label:t===0?4:t===1?2:initialMixedLabel};});
}
function tiled(width:number,height:number,initialMixedLabel=3):Field{
 return field(width,height,x=>{const t=clamp((x%17-5)/6);return{rgb:mixture(t),label:t===0?4:t===1?2:initialMixedLabel};});
}
function lateEdge(initialMixedLabel:number):Field{
 return field(512,512,(x,y)=>{
  if(y<488)return{rgb:blue,label:4};
  const t=clamp((x-256.23+3)/6);return{rgb:mixture(t),label:t===0?4:t===1?2:initialMixedLabel};
 });
}
function invoke(f:Field){
 const before={rgba:f.rgba.slice(),foreground:f.foreground.slice(),labels:f.labels.slice()};
 const moved=sourceBlendedMaterials(f.width,f.height,f.rgba,f.foreground,f.labels),changed:number[]=[];
 for(let i=0;i<f.labels.length;i++)if(f.labels[i]!==before.labels[i])changed.push(i);
 assert.deepEqual(f.rgba,before.rgba,'source RGBA must remain byte-identical');
 assert.deepEqual(f.foreground,before.foreground,'foreground ownership domain must remain immutable');
 assert.equal(moved,changed.length,'return value equals unique observable relabels');
 return{before,changed,moved};
}
const at=(f:Field,x:number,y:number)=>f.labels[y*f.width+x];
function correctedInterior(initialMixedLabel:number){
 const f=stripe(initialMixedLabel),r=invoke(f);assert(r.changed.length>0);
 assert.equal(at(f,31,24),4);assert.equal(at(f,33,24),2);assert.equal(at(f,12,24),4);assert.equal(at(f,52,24),2);
 for(const i of r.changed){assert.equal(r.before.labels[i],initialMixedLabel);assert([2,4].includes(f.labels[i]));}
}
function exhaustedBudgetIsAtomic(initialMixedLabel:number){
 // The smaller identical source prefix proves there are genuine proposals
 // before the large field reaches its200000eligible-profile budget.
 const prefix=tiled(340,96,initialMixedLabel),proof=invoke(prefix);assert(proof.changed.length>0);
 assert.equal(at(prefix,7,40),4);assert.equal(at(prefix,9,40),2);
 const full=tiled(340,800,initialMixedLabel),result=invoke(full);
 assert.equal(result.moved,0);assert.deepEqual(full.labels,result.before.labels);assert.equal(full.labels.length,272000);
}
function lateEdgeSurvivesPurePrefix(initialMixedLabel:number){
 const f=lateEdge(initialMixedLabel),r=invoke(f);assert(r.changed.length>0);
 assert.equal(at(f,255,508),4);assert.equal(at(f,257,508),2);
 for(let i=0;i<488*f.width;i++)assert.equal(f.labels[i],4);
 assert(r.changed.every(i=>Math.floor(i/f.width)>=488));
}

test('two prescribed source pigments correct a false green fringe without touching solid cores',()=>correctedInterior(3));
test('200k model-budget exhaustion commits no earlier valid correction and preserves every input byte',()=>exhaustedBudgetIsAtomic(3));
test('a262k image with an unrelated pure prefix still corrects its late supported fringe',()=>lateEdgeSurvivesPurePrefix(3));

for(const{alpha,hidden}of[
 {alpha:0,hidden:[255,0,255]},{alpha:0,hidden:[0,0,0]},{alpha:128,hidden:[140,160,140]}
] as const)test(`opacity barrier ${alpha} hiddenRGB ${hidden.join('/')} cannot supply a missing source profile`,()=>{
 const f=stripe();for(let y=0;y<f.height;y++){
  const i=y*f.width+32;f.rgba.set([...hidden,alpha],4*i);if(!alpha){f.foreground[i]=0;f.labels[i]=-1;}
 }
 const r=invoke(f);assert.equal(r.moved,0);assert.deepEqual(f.labels,r.before.labels);
});
test('a foreground gap with opaque hidden RGB cannot be bridged',()=>{
 const f=stripe();for(let y=0;y<f.height;y++){const i=y*f.width+32;f.foreground[i]=0;f.labels[i]=-1;}
 const r=invoke(f);assert.deepEqual(f.labels,r.before.labels);
});

for(const blur of[0,3])test(`a true1px white contribution remains distinct from the two-pigment mixture at blur ${blur}`,async()=>{
 const f=field(64,48,x=>({rgb:x<32?blue:x===32?white:yellow,label:x<32?4:x===32?0:2}));
 if(blur)f.rgba=new Uint8Array(await sharp(f.rgba,{raw:{width:f.width,height:f.height,channels:4}}).blur(blur).raw().toBuffer());
 const core=Array.from(f.rgba.subarray(4*(24*f.width+32),4*(24*f.width+32)+3)),vector=yellow.map((v,c)=>v-blue[c]);
 const t=core.reduce((sum,v,c)=>sum+(v-blue[c])*vector[c],0)/vector.reduce((sum,v)=>sum+v*v,0);
 const residual=Math.hypot(...core.map((v,c)=>v-blue[c]-t*vector[c]));
 assert(residual>Math.sqrt(3),'prescribed third RGB contribution exceeds8bit rounding uncertainty');
 const r=invoke(f);assert.deepEqual(f.labels,r.before.labels);assert.equal(at(f,32,24),0);
});
test('a clipped edge never wraps into the next row to invent its missing endpoint',()=>{
 const f=field(17,24,x=>({rgb:x<7?yellow:x<16?blue:mixture(.45),label:x<7?2:x<16?4:0})),r=invoke(f);
 assert.deepEqual(f.labels,r.before.labels);for(let y=0;y<f.height;y++)assert.equal(at(f,16,y),0);
});
for(const[w,h]of[[0,0],[1,1],[2,2],[8,8]] as const)test(`empty/short ${w}x${h} field keeps its original labels`,()=>{
 const f=field(w,h,()=>({rgb:mixture(.4),label:0})),r=invoke(f);assert.equal(r.moved,0);assert.deepEqual(f.labels,r.before.labels);
});

function transform(f:Field,kind:Transform){
 const width=kind==='rotate90'?f.height:kind==='translate'?f.width+23:f.width,height=kind==='rotate90'?f.width:kind==='translate'?f.height+21:f.height;
 const mapped:Field={width,height,rgba:new Uint8Array(width*height*4),foreground:new Uint8Array(width*height),labels:new Int8Array(width*height).fill(-1)},mapping=new Uint32Array(f.labels.length);
 for(let y=0;y<f.height;y++)for(let x=0;x<f.width;x++){
  const i=y*f.width+x,nx=kind==='mirror'?f.width-1-x:kind==='rotate90'?f.height-1-y:kind==='rotate180'?f.width-1-x:kind==='translate'?x+11:x;
  const ny=kind==='rotate90'?x:kind==='rotate180'?f.height-1-y:kind==='translate'?y+9:y,j=ny*width+nx;mapping[i]=j;
  mapped.rgba.set(f.rgba.subarray(4*i,4*i+4),4*j);mapped.foreground[j]=f.foreground[i];mapped.labels[j]=f.labels[i];
 }
 return{field:mapped,mapping};
}
for(const kind of['mirror','rotate90','rotate180','translate'] as const)test(`source-coordinate ownership is unchanged under ${kind} for a prescribed non-tie RGB phase`,()=>{
 const initial=stripe(),f:Field={...initial,rgba:initial.rgba.slice(),foreground:initial.foreground.slice(),labels:initial.labels.slice()},mapped=transform(initial,kind);
 const a=invoke(f),b=invoke(mapped.field);assert(a.changed.length>0);assert(b.changed.length>0);
 for(let i=0;i<f.labels.length;i++)assert.equal(mapped.field.labels[mapped.mapping[i]],f.labels[i],`mapped source index ${i}`);
 const indices=new Set(mapped.mapping);for(let j=0;j<mapped.field.labels.length;j++)if(!indices.has(j))assert.equal(mapped.field.labels[j],-1);
});

// These three original red cases must remain independent of the green3
// controls. A fully supported neutral band does not need an adjacent seed.
test('a5px neutral mixed band with two certified source platforms corrects its interior',()=>correctedInterior(0));
test('the neutral prefix is recoverable and its200k exhaustion remains fully atomic',()=>exhaustedBudgetIsAtomic(0));
test('a late neutral5px fringe after a pure262k image prefix remains eligible',()=>lateEdgeSurvivesPurePrefix(0));
