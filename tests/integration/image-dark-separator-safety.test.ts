import {expect,it} from 'vitest';
import {recoverDarkReflections} from '../../packages/reference/image-dark-materials';

type Pixel={rgb:number[];label:number;foreground?:number};
function fixture(width:number,height:number,at:(x:number,y:number)=>Pixel){
 const rgba=new Uint8Array(width*height*4),foreground=new Uint8Array(width*height),labels=new Int8Array(width*height),saturation=new Float32Array(width*height),value=new Float32Array(width*height);
 for(let y=0;y<height;y++)for(let x=0;x<width;x++){const i=y*width+x,p=at(x,y),hi=Math.max(...p.rgb),lo=Math.min(...p.rgb);rgba.set([...p.rgb,255],i*4);foreground[i]=p.foreground??1;labels[i]=p.label;saturation[i]=hi?(hi-lo)/hi:0;value[i]=hi/255;}
 return {width,height,rgba,foreground,labels,saturation,value};
}
const run=(f:ReturnType<typeof fixture>)=>recoverDarkReflections(f.width,f.height,f.rgba,f.foreground,f.labels,f.saturation,f.value);
const white=[245,245,245],shoulder=[210,210,210],antialias=[145,145,145],dark=[20,20,20];

// Independent source oracle: an internal narrow dark feature connects two
// separately supported dark-material ends. Geometry supplies original RGB
// antialiasing; the endpoint labels supply the material evidence. A single
// dark-ended optical stroke alone is only an outline, not a black fabric.
function separator(horizontal=false,seed:'both'|'start'|'none'='both',mirror=false,middleSeed=false){
 const width=48,height=48,subpixels=16;
 const covers=(cross:number,along:number)=>{
  if(along<3||along>(seed==='start'?41:43))return false;
  const anchors=seed==='start'?[[3,5]]:middleSeed?[[3,5],[20,22],[41,43]]:[[3,5],[41,43]],distance=Math.min(...anchors.map(([a,b])=>Math.max(a-along,0,along-b))),halfWidth=Math.max(.22,.5-distance*.28/8);
  return Math.abs(cross-24.5)<halfWidth;
 };
 return fixture(width,height,(x,y)=>{
  const cross=horizontal?y:x,along=mirror?47-(horizontal?x:y):horizontal?x:y;
  let covered=0;for(let sy=0;sy<subpixels;sy++)for(let sx=0;sx<subpixels;sx++)if(covers(cross+(sx+.5)/subpixels,along+(sy+.5)/subpixels))covered++;
  const coverage=covered/subpixels**2,rgb=white.map((v,c)=>Math.round(v*(1-coverage)+dark[c]*coverage));
  const isSeed=seed!=='none'&&(along>=3&&along<=4||seed==='both'&&(along>=41&&along<=42||middleSeed&&along>=20&&along<=21));
  return{rgb,label:cross===24&&isSeed?6:0};
 });
}
it.each([false,true].flatMap(horizontal=>[false,true].map(mirror=>({horizontal,mirror}))))('recovers an internal antialiased feature supported at both dark-material ends at horizontal=$horizontal mirror=$mirror',({horizontal,mirror})=>{
 const f=separator(horizontal,'both',mirror),before={rgba:f.rgba.slice(),foreground:f.foreground.slice(),saturation:f.saturation.slice(),value:f.value.slice()},changed=run(f);
 expect(changed).toBeGreaterThan(0);
 for(let along=5;along<=40;along++){
  const native=mirror?47-along:along,at=(cross:number)=>horizontal?cross*f.width+native:native*f.width+cross;
  expect(f.labels[at(24)],`separator sample ${along}`).toBe(6);
  for(const cross of [21,22,23,25,26,27])expect(f.labels[at(cross)],`bright side ${cross}/${along}`).toBe(0);
 }
 expect({rgba:f.rgba,foreground:f.foreground,saturation:f.saturation,value:f.value}).toEqual(before);
});
it.each([false,true])('does not promote the original one-ended 38-pixel antialiased outline to black fabric at horizontal=%s',horizontal=>{
 const f=separator(horizontal,'start'),before=f.labels.slice();expect(run(f)).toBe(0);expect(f.labels).toEqual(before);
});

it.each([128,145].flatMap(level=>[false,true].map(horizontal=>({level,horizontal}))))('preserves a separately painted grey $level bar hard-connected to black at horizontal=$horizontal',({level,horizontal})=>{
 const f=fixture(48,48,(x,y)=>{
  const cross=horizontal?y:x,along=horizontal?x:y;
  if(cross===24&&along>=3&&along<=4)return{rgb:dark,label:6};
  if(along>=5&&along<=40){if(cross===24)return{rgb:[level,level,level],label:0};if(cross===23||cross===25)return{rgb:shoulder,label:0};}
  return{rgb:white,label:0};
 }),before=f.labels.slice();
 // Direct 20->128/145 RGB jumps are also consistent with two distinct
 // painted materials. Seed adjacency alone cannot establish a black stroke.
 expect(run(f)).toBe(0);expect(f.labels).toEqual(before);
});

it.each([false,true])('does not invent a dark owner for a two-sided valley with no seed at horizontal=%s',horizontal=>{
 const f=separator(horizontal,'none'),before=f.labels.slice();expect(run(f)).toBe(0);expect(f.labels).toEqual(before);
});

it.each([
 {name:'white painted glint',rgb:[252,252,252],label:0},
 {name:'saturated green painted patch',rgb:[25,150,55],label:3},
 {name:'saturated blue painted patch',rgb:[35,70,160],label:4}
])('preserves $name without inferring either interrupted one-ended material segment',({rgb,label})=>{
 const f=separator(),i=20*f.width+24,hi=Math.max(...rgb),lo=Math.min(...rgb);f.rgba.set([...rgb,255],i*4);f.labels[i]=label;f.value[i]=hi/255;f.saturation[i]=(hi-lo)/hi;
 const before={rgba:f.rgba.slice(),foreground:f.foreground.slice(),saturation:f.saturation.slice(),value:f.value.slice()};expect(run(f)).toBe(0);
 expect(f.labels[i]).toBe(label);
 for(let y=5;y<=40;y++)if(y!==20)expect(f.labels[y*f.width+24],'neither disconnected segment has independent dark material at both ends').toBe(0);
 expect({rgba:f.rgba,foreground:f.foreground,saturation:f.saturation,value:f.value}).toEqual(before);
});

it('does not use a foreground break to infer either interrupted one-ended material segment',()=>{
 const f=separator(),i=20*f.width+24;f.foreground[i]=0;f.labels[i]=-1;const before=f.foreground.slice();expect(run(f)).toBe(0);
 expect(f.labels[i]).toBe(-1);expect(f.foreground).toEqual(before);
 for(let y=5;y<=40;y++)if(y!==20)expect(f.labels[y*f.width+24]).toBe(0);
});

it('recovers only the independently bracketed segment while retaining a painted interruption and unsupported tails',()=>{
 const f=separator(false,'both',false,true),rgb=[25,150,55],i=31*f.width+24;f.rgba.set([...rgb,255],4*i);f.labels[i]=3;f.value[i]=150/255;f.saturation[i]=(150-25)/150;
 const before={rgba:f.rgba.slice(),foreground:f.foreground.slice(),saturation:f.saturation.slice(),value:f.value.slice()};expect(run(f)).toBeGreaterThan(0);
 for(let y=5;y<=19;y++)expect(f.labels[y*f.width+24],'upper segment joins two independently supported material seeds').toBe(6);
 for(let y=22;y<=40;y++)if(y!==31)expect(f.labels[y*f.width+24],'the painted interruption leaves each tail supported at only one end').toBe(0);
 expect(f.labels[i]).toBe(3);expect({rgba:f.rgba,foreground:f.foreground,saturation:f.saturation,value:f.value}).toEqual(before);
});

it.each([0,1,6,7])('does not wrap or expand an unsupported separator on border column %s',column=>{
 const f=fixture(8,12,(x,y)=>x===column?y===2?{rgb:dark,label:6}:{rgb:antialias,label:0}:{rgb:white,label:0}),before=f.labels.slice();
 expect(run(f)).toBe(0);expect(f.labels).toEqual(before);
});

it('cannot borrow connectivity from a separate nearby dark seed across bright source pixels',()=>{
 const f=fixture(32,28,(x,y)=>x===12&&y===4?{rgb:dark,label:6}:x===16&&y>=7&&y<=22?{rgb:antialias,label:0}:{rgb:white,label:0}),before=f.labels.slice();
 expect(run(f)).toBe(0);expect(f.labels).toEqual(before);
});
