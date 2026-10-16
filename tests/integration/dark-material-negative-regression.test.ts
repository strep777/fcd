import {afterAll,expect,it} from 'vitest';
import {createHash} from 'node:crypto';
import {mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {recoverDarkReflections} from '../../packages/reference/image-dark-materials';

type Observation={rgb:number[];initial:number;truth:number;role:string};
const source='packages/reference/image-dark-materials.ts',hash=()=>createHash('sha256').update(readFileSync(source)).digest('hex'),loadedHash=hash(),records:unknown[]=[];
const white=[248,248,248],black=[20,20,20];
function run(name:string,width:number,height:number,observe:(x:number,y:number)=>Observation){
 const rgba=new Uint8Array(width*height*4),foreground=new Uint8Array(width*height).fill(1),labels=new Int8Array(width*height),saturation=new Float32Array(width*height),value=new Float32Array(width*height),truth=new Int8Array(width*height),roles:string[]=[];
 for(let y=0;y<height;y++)for(let x=0;x<width;x++){const i=y*width+x,p=observe(x,y),hi=Math.max(...p.rgb),lo=Math.min(...p.rgb);rgba.set([...p.rgb,255],i*4);labels[i]=p.initial;truth[i]=p.truth;roles[i]=p.role;saturation[i]=hi?(hi-lo)/hi:0;value[i]=hi/255;}
 const before=labels.slice(),moved=recoverDarkReflections(width,height,rgba,foreground,labels,saturation,value),byRole:Record<string,{pixels:number;changed:number;wrong:number;examples:unknown[]}>={};
 for(let i=0;i<labels.length;i++){const r=byRole[roles[i]]??={pixels:0,changed:0,wrong:0,examples:[]};r.pixels++;if(labels[i]!==before[i])r.changed++;if(labels[i]!==truth[i]){r.wrong++;if(r.examples.length<8)r.examples.push({x:i%width,y:Math.floor(i/width),rgb:Array.from(rgba.subarray(i*4,i*4+3)),before:before[i],after:labels[i],truth:truth[i]});}}
 const evidence={name,width,height,moved,byRole,loadedHash,savedHash:hash()},directory=resolve('test-results/contour-repair/dark-material-negatives');mkdirSync(directory,{recursive:true});writeFileSync(resolve(directory,name+'.json'),JSON.stringify({evidence,rgba:Array.from(rgba),initial:Array.from(before),expected:Array.from(truth),actual:Array.from(labels)},null,2));records.push(evidence);return{...evidence,labels,width};
}

it.each([1,2,3])('keeps a genuine grey material strip $0 px wide with one hard-step black contact',width=>{
 // Material geometry is fixed first: grey strip and black patch are distinct
 // painted regions. The source contains a clear hard RGB step at their contact.
 const x0=31,record=run('grey-strip-'+width,64,80,(x,y)=>x>=x0&&x<x0+width&&y>=16&&y<72?{rgb:[128,128,128],initial:0,truth:0,role:'grey-strip'}:x>=28&&x<=36&&y>=7&&y<16?{rgb:black,initial:6,truth:6,role:'black-patch'}:{rgb:white,initial:0,truth:0,role:'white-background'});
 expect.soft(record.byRole['grey-strip'].wrong,JSON.stringify(record.byRole)).toBe(0);expect.soft(record.byRole['white-background'].wrong).toBe(0);
});

it.each([1,2,3])('keeps grey128 strip $0 px wide when the adjacent dark seed is RGB60',width=>{
 const x0=31,record=run('grey128-dark60-strip-'+width,64,80,(x,y)=>x>=x0&&x<x0+width&&y>=16&&y<72?{rgb:[128,128,128],initial:0,truth:0,role:'grey-strip'}:x>=28&&x<=36&&y>=7&&y<16?{rgb:[60,60,60],initial:6,truth:6,role:'dark-patch'}:{rgb:white,initial:0,truth:0,role:'white-background'});
 expect.soft(record.byRole['grey-strip'].wrong,JSON.stringify(record.byRole)).toBe(0);expect.soft(record.byRole['dark-patch'].wrong).toBe(0);expect.soft(record.byRole['white-background'].wrong).toBe(0);
});

it('profile budget exhaustion preserves every original label, including an earlier recoverable reflection',()=>{
 const fixture=(width:number,height:number)=>{
  const rgba=new Uint8Array(width*height*4),foreground=new Uint8Array(width*height).fill(1),labels=new Int8Array(width*height),saturation=new Float32Array(width*height),value=new Float32Array(width*height);
  // The same small reflection is placed first in scan order. Outside it,
  // a broad neutral plateau supplies no opposing dark evidence. The larger
  // image exercises bounded optional work without any invalid input.
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){const i=y*width+x,inPatch=x>=12&&x<53&&y>=5&&y<25,t=inPatch?Math.exp(-((x-32)**2)/(2*4**2)):0,shade=Math.round(20+70*t),rgb=inPatch?[shade,shade,shade]:[100,90,85],hi=Math.max(...rgb),lo=Math.min(...rgb);rgba.set([...rgb,255],i*4);labels[i]=inPatch&&t<=.12?6:0;value[i]=hi/255;saturation[i]=(hi-lo)/hi;}
  return{width,height,rgba,foreground,labels,saturation,value};
 };
 const apply=(f:ReturnType<typeof fixture>)=>recoverDarkReflections(f.width,f.height,f.rgba,f.foreground,f.labels,f.saturation,f.value),digest=(f:ReturnType<typeof fixture>)=>Object.fromEntries(['rgba','foreground','labels','saturation','value'].map(k=>{const a=f[k as 'rgba'];return[k,createHash('sha256').update(new Uint8Array(a.buffer,a.byteOffset,a.byteLength)).digest('hex')];}));
 const small=fixture(64,40),smallMoved=apply(small);expect(smallMoved,'the early source reflection has independently demonstrated recoverable evidence').toBeGreaterThan(0);expect(small.labels[15*small.width+32]).toBe(6);
 const large=fixture(512,512),before=digest(large),initialCenter=large.labels[15*large.width+32],started=performance.now(),moved=apply(large),elapsedMs=performance.now()-started,after=digest(large);
 const evidence={name:'profile-budget-atomic-fallback',small:{width:small.width,height:small.height,moved:smallMoved,reflectionCenter:small.labels[15*small.width+32]},large:{width:large.width,height:large.height,moved,elapsedMs,initialCenter,finalCenter:large.labels[15*large.width+32],before,after},loadedHash,savedHash:hash()};records.push(evidence);
 expect(moved,'exhausted optional recovery reports exact fallback').toBe(0);expect(after,'no tentative labels or source evidence may leak on exhaustion').toEqual(before);expect(large.labels[15*large.width+32]).toBe(initialCenter);
});

it.each([1,2,3])('keeps a genuine grey material ring $0 px thick touching a black patch',thickness=>{
 const record=run('grey-ring-'+thickness,72,72,(x,y)=>{const r=Math.hypot(x+.5-36,y+.5-36);return r>=15-thickness&&r<15?{rgb:[128,128,128],initial:0,truth:0,role:'grey-ring'}:x>=10&&x<22&&y>=34&&y<38?{rgb:black,initial:6,truth:6,role:'black-patch'}:{rgb:white,initial:0,truth:0,role:'white-background'};});
 expect.soft(record.byRole['grey-ring'].wrong,JSON.stringify(record.byRole)).toBe(0);expect.soft(record.byRole['white-background'].wrong).toBe(0);
});

it('preserves a white highlight and its genuine grey painted rim inside black material',()=>{
 const record=run('highlight-grey-rim',64,64,(x,y)=>{const r=Math.hypot(x+.5-32,y+.5-32);return r<5?{rgb:white,initial:0,truth:0,role:'bright-highlight'}:r<7?{rgb:[128,128,128],initial:0,truth:0,role:'grey-highlight-rim'}:{rgb:black,initial:6,truth:6,role:'black-surround'};});
 expect.soft(record.byRole['bright-highlight'].wrong,JSON.stringify(record.byRole)).toBe(0);expect.soft(record.byRole['grey-highlight-rim'].wrong,JSON.stringify(record.byRole)).toBe(0);
});

it.each([{name:'grey',rgb:[95,85,90],family:0},{name:'dark-pink',rgb:[110,74,86],family:1}])('keeps a separate $name branch attached to an opposed-confirmed dark reflection',({name,rgb,family})=>{
 const record=run('reflection-with-'+name+'-branch',64,96,(x,y)=>{
  // The broad dark patch and its reflection have one intended material.
  // A different, fixed five-pixel material strip starts at y=28 and extends
  // beyond every dark patch. Its low RGB contrast is explicit source evidence;
  // the test does not claim that arbitrary illumination uniquely identifies it.
  if(x>=30&&x<35&&y>=28&&y<89)return{rgb,initial:family,truth:family,role:'separate-material-branch'};
  if(x>=12&&x<53&&y>=7&&y<28){const t=Math.exp(-((x-32)**2)/(2*4**2)),shade=Math.round(20+70*t);return{rgb:[shade,shade,shade],initial:t>.12?0:6,truth:6,role:t>.12?'dark-reflection':'dark-seed'};}
  return{rgb:white,initial:0,truth:0,role:'white-background'};
 });
 expect.soft(record.byRole['dark-reflection'].wrong,'the genuine reflection still recovers').toBe(0);expect.soft(record.byRole['separate-material-branch'].wrong,JSON.stringify(record.byRole)).toBe(0);expect.soft(record.byRole['white-background'].wrong).toBe(0);
});

it.each([1,2,3])('keeps a one-ended antialiased outline $0 px wide from becoming black fabric',width=>{
 // Preserve the original failed fixture's RGB and initial labels exactly.
 // Only its upper end has black support; the lower end meets white fabric.
 // An optical stroke alone does not establish a separate black material.
 const x0=31,record=run('one-ended-outline-'+width,64,80,(x,y)=>{
  if(x>=x0&&x<x0+width&&y>=16&&y<72){const shade=Math.min(140,40+18*(y-16)),initial=shade/255<.28?6:0;return{rgb:[shade,shade,shade],initial,truth:initial,role:'one-ended-outline'};}
  if(x>=28&&x<=36&&y>=7&&y<16)return{rgb:black,initial:6,truth:6,role:'black-seed'};
  return{rgb:white,initial:0,truth:0,role:'white-background'};
 });
 expect(record.moved).toBe(0);expect.soft(record.byRole['one-ended-outline'].wrong,JSON.stringify(record.byRole)).toBe(0);expect.soft(record.byRole['black-seed'].wrong).toBe(0);expect.soft(record.byRole['white-background'].wrong).toBe(0);
});

it.each([1,2,3])('recovers an antialiased dark material separator $0 px wide supported independently at both ends',width=>{
 // Material geometry includes two separate black patches. The narrow
 // connection has a continuous original RGB ramp at each painted endpoint;
 // its grey center is the antialiased observation of the same dark material.
 const x0=31,record=run('two-ended-dark-material-'+width,64,88,(x,y)=>{
  if(x>=x0&&x<x0+width&&y>=16&&y<72){const shade=Math.min(140,40+18*Math.min(y-16,71-y));return{rgb:[shade,shade,shade],initial:shade/255<.28?6:0,truth:6,role:'ink-separator'};}
  if(x>=28&&x<=36&&(y>=7&&y<16||y>=72&&y<81))return{rgb:black,initial:6,truth:6,role:y<16?'upper-black-material':'lower-black-material'};
  return{rgb:white,initial:0,truth:0,role:'white-background'};
 });
 expect(record.moved).toBeGreaterThan(0);expect.soft(record.byRole['upper-black-material'].wrong).toBe(0);expect.soft(record.byRole['lower-black-material'].wrong).toBe(0);
 expect.soft(record.byRole['ink-separator'].wrong,JSON.stringify(record.byRole)).toBe(0);expect.soft(record.byRole['white-background'].wrong).toBe(0);
});

afterAll(()=>{const directory=resolve('test-results/contour-repair/dark-material-negatives');mkdirSync(directory,{recursive:true});writeFileSync(resolve(directory,'summary.json'),JSON.stringify({scope:'Synthetic recoverDarkReflections only, no real JPEG or geometry. Truth is specified in source material geometry before the function runs. Grey hard steps and continuous ink observations are separate fixtures. The two low-contrast branch cases are intended-material stress tests; an error does not prove that arbitrary images uniquely distinguish paint from reflection.',loadedHash,savedHash:hash(),records},null,2));});
