import {createHash} from 'node:crypto';
import {mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import sharp from 'sharp';
import {afterAll,expect,it} from 'vitest';
import {recoverBlueHighlights} from '../../packages/reference/blue-pigments';
import {illustrationRegions} from '../../packages/reference/illustration';

const sourceWidth=64,sourceHeight=48,blue=[135,170,200],neutral=[170,186,200],black=[20,20,20];
type Orientation='identity'|'mirror'|'rotate90'|'rotate180';
type Spec={name:string;kind:'painted-step'|'reflection';noise:'none'|'scalar'|'channels';amplitude:number;orientation?:Orientation;blur?:number;barrier?:'transparent'|'third'|'ink';profileGap?:boolean};
const records:unknown[]=[],files=['packages/reference/blue-pigments.ts','packages/reference/illustration.ts'];
const fingerprints=()=>Object.fromEntries(files.map(file=>[file,createHash('sha256').update(readFileSync(file)).digest('hex')]));
const loadedFingerprints=fingerprints();

async function fixture(spec:Spec){
 const orientation=spec.orientation??'identity',width=orientation==='rotate90'?sourceHeight:sourceWidth,height=orientation==='rotate90'?sourceWidth:sourceHeight;
 const index=(x:number,y:number)=>orientation==='mirror'?y*width+sourceWidth-1-x:orientation==='rotate90'?x*width+sourceHeight-1-y:orientation==='rotate180'?(sourceHeight-1-y)*width+sourceWidth-1-x:y*width+x;
 let rgba=new Uint8Array(width*height*4);
 const labels=new Int8Array(width*height),foreground=new Uint8Array(width*height).fill(1),ink=new Uint8Array(width*height),missing:number[]=[];
 // Fixed materials are prescribed before rasterization/noise/blur. The same
 // two rectangles are distinct paint in the step case; the reflection case
 // prescribes one blue material under continuously changing illumination.
 for(let y=0;y<sourceHeight;y++)for(let x=0;x<sourceWidth;x++){
  const inside=x>=8&&x<48&&y>=8&&y<40,i=index(x,y),separator=inside&&x>=24&&x<26&&spec.barrier;
  let label=!inside?6:x<24?4:0;
  let base=!inside?black:x<24?blue:spec.kind==='painted-step'?neutral:blue.map((v,c)=>v+[70,50,35][c]*(x-24+.5)/24);
  if(separator==='third'){label=1;base=[240,100,150];}
  if(separator==='ink'){label=6;base=black;ink[i]=1;}
  const absent=separator==='transparent'||!!spec.profileGap&&y===20&&x>=17&&x<=22;
  if(absent){label=-1;base=x%2?[255,0,0]:[0,255,0];foreground[i]=0;missing.push(i);}
  labels[i]=label;
  const rgb=base.map((v,c)=>{
   const perturbation=spec.noise==='none'||!inside||separator||absent?0:spec.amplitude*((spec.noise==='scalar'?(x*19+y*31)%7:(x*(19+c*4)+y*(31+c*6)+c*2)%7)-3)/3;
   return Math.max(0,Math.min(255,Math.round(v+perturbation)));
  });rgba.set([...rgb,absent?0:255],4*i);
 }
 if(spec.blur)rgba=new Uint8Array(await sharp(rgba,{raw:{width,height,channels:4}}).blur(spec.blur).raw().toBuffer());
 const hue=new Float32Array(width*height),saturation=new Float32Array(width*height),value=new Float32Array(width*height);
 for(let i=0;i<labels.length;i++){
  const [r,g,b]=rgba.subarray(4*i,4*i+3),hi=Math.max(r,g,b),lo=Math.min(r,g,b),d=hi-lo;
  hue[i]=d?((hi===r?((g-b)/d)%6:hi===g?(b-r)/d+2:(r-g)/d+4)*60+360)%360:0;saturation[i]=hi?d/hi:0;value[i]=hi/255;
 }
 return{width,height,rgba,labels,foreground,ink,hue,saturation,value,index,missing};
}

async function measure(spec:Spec){
 const f=await fixture(spec),before={rgba:f.rgba.slice(),foreground:f.foreground.slice(),ink:f.ink.slice(),hue:f.hue.slice(),saturation:f.saturation.slice(),value:f.value.slice()},originalLabels=f.labels.slice();
 const moved=recoverBlueHighlights(f.width,f.height,f.rgba,f.foreground,f.ink,f.labels,f.hue,f.saturation,f.value);
 expect({rgba:f.rgba,foreground:f.foreground,ink:f.ink,hue:f.hue,saturation:f.saturation,value:f.value},'recovery may change only labels').toEqual(before);
 const classified=illustrationRegions(f.width,f.height,f.rgba,false),owners=new Int32Array(f.width*f.height).fill(-1),counts=new Uint8Array(owners.length);
 classified.regions.forEach((r,k)=>r.indices.forEach(i=>{owners[i]=k;counts[i]++;}));
 expect(f.rgba,'classification must preserve source RGBA').toEqual(before.rgba);
 expect(Math.max(...counts),'classified materials have unique pixel ownership').toBeLessThanOrEqual(1);
 const blueCore=f.index(16,20),neutralCore=f.index(36,20),darkCore=f.index(2,2),probes=[blueCore,neutralCore,darkCore];
 const metrics={spec,moved,directCoreLabels:probes.map(i=>f.labels[i]),fullCoreOwners:probes.map(i=>owners[i]),probeRGB:probes.map(i=>Array.from(f.rgba.subarray(4*i,4*i+4))),regions:classified.regions.map(r=>({color:r.color,pixels:r.indices.length})),neutralCorePixelsRecoloured:0,missingRecoloured:f.missing.filter(i=>f.labels[i]!==-1).length};
 for(let y=12;y<36;y++)for(let x=32;x<44;x++)metrics.neutralCorePixelsRecoloured+=+(f.labels[f.index(x,y)]!==0);
 records.push(metrics);
 return{f,moved,owners,originalLabels,blueCore,neutralCore,darkCore,metrics,message:JSON.stringify(metrics)};
}

const painted:Spec[]=[
 {name:'exact unperturbed painted boundary',kind:'painted-step',noise:'none',amplitude:0},
 ...([1,2]as const).flatMap(amplitude=>(['scalar','channels']as const).map(noise=>({name:`painted boundary ${noise} noise ${amplitude}`,kind:'painted-step' as const,noise,amplitude}))),
 ...(['mirror','rotate90','rotate180']as const).map(orientation=>({name:`painted boundary scalar noise 1 ${orientation}`,kind:'painted-step' as const,noise:'scalar' as const,amplitude:1,orientation})),
 ...([.5,.8,1.2,2]as const).map(blur=>({name:`painted boundary scalar noise 1 blur ${blur}`,kind:'painted-step' as const,noise:'scalar' as const,amplitude:1,blur})),
 {name:'painted boundary scalar noise 1 missing bilateral profile',kind:'painted-step',noise:'scalar',amplitude:1,profileGap:true}
];
it.each(painted.map((spec,i)=>({...spec,caseId:i+1})))('painted case $caseId: $name preserves both independently prescribed material cores',async spec=>{
 const r=await measure(spec),{f,owners,message}=r;
 // Blur/AA permits ownership adjustment in the transition band, never in
 // these two deep material cores. No raw-mask distance supplies this truth.
 expect.soft(f.labels[r.blueCore],message).toBe(4);expect.soft(f.labels[r.neutralCore],message).toBe(0);
 expect.soft(r.metrics.neutralCorePixelsRecoloured,message).toBe(0);
 expect.soft(owners[r.blueCore],message).toBeGreaterThanOrEqual(0);expect.soft(owners[r.neutralCore],message).toBeGreaterThanOrEqual(0);
 expect.soft(owners[r.blueCore],message).not.toBe(owners[r.neutralCore]);
 for(const i of f.missing){expect.soft(f.labels[i],message).toBe(-1);expect.soft(owners[i],message).toBe(-1);}
});

const reflections:Spec[]=[
 {name:'continuous reflection with no perturbation',kind:'reflection',noise:'none',amplitude:0},
 {name:'continuous reflection with scalar noise 1',kind:'reflection',noise:'scalar',amplitude:1},
 {name:'continuous reflection with independent-channel noise 1',kind:'reflection',noise:'channels',amplitude:1},
 {name:'continuous reflection with scalar noise 1 rotated',kind:'reflection',noise:'scalar',amplitude:1,orientation:'rotate90'}
];
it.each(reflections.map((spec,i)=>({...spec,caseId:i+1})))('reflection case $caseId: $name remains the same illuminated blue material',async spec=>{
 const r=await measure(spec),{f,owners,message}=r,sourceOwner=owners[r.blueCore];
 let wrongDirect=0,wrongOwner=0;for(let y=8;y<40;y++)for(let x=8;x<48;x++){const i=f.index(x,y);wrongDirect+=+(f.labels[i]!==4);wrongOwner+=+(owners[i]!==sourceOwner);}
 Object.assign(r.metrics,{wrongDirect,wrongOwner});expect.soft(sourceOwner,message).toBeGreaterThanOrEqual(0);
 expect.soft({wrongDirect,wrongOwner},message).toEqual({wrongDirect:0,wrongOwner:0});
 expect.soft(owners[r.darkCore],message).not.toBe(sourceOwner);expect.soft(f.labels[r.darkCore],message).toBe(6);
 expect.soft(r.moved,message).toBeGreaterThan(0);expect.soft(new Set(Array.from(owners)).size,message).toBe(2);
});

it.each(['transparent','third','ink']as const)('a noisy reflection cannot expand across a prescribed %s separator',async barrier=>{
 const r=await measure({name:'noisy reflected surface behind '+barrier,kind:'reflection',noise:'scalar',amplitude:1,barrier}),{f,owners,message}=r;
 let directCrossing=0;for(let y=12;y<36;y++)for(let x=32;x<44;x++)directCrossing+=+(f.labels[f.index(x,y)]!==0);
 Object.assign(r.metrics,{directCrossing});expect.soft(directCrossing,message).toBe(0);
 expect.soft(owners[r.blueCore],message).not.toBe(owners[r.neutralCore]);
 for(let y=8;y<40;y++)for(let x=24;x<26;x++){const i=f.index(x,y);expect.soft(f.labels[i],message).toBe(r.originalLabels[i]);if(barrier==='transparent')expect.soft(owners[i],message).toBe(-1);else expect.soft(owners[i],message).not.toBe(owners[r.blueCore]);}
});

afterAll(()=>{
 const directory='test-results/contour-repair/blue-highlight-noise-safety';mkdirSync(directory,{recursive:true});
 const stage=process.env.FPCAD_BLUE_NOISE_STAGE??'diagnostic';if(!/^[a-z0-9-]+$/.test(stage))throw Error('INVALID_BLUE_NOISE_STAGE');
 writeFileSync(directory+'/'+stage+'-metrics.json',JSON.stringify({stage,oracle:'Independent fixed blue/neutral material rectangles with boundary x=24 before deterministic bounded RGB noise and blur; continuous illumination is a separate prescribed single-material positive control. Mirrors and rotations transform all source geometry and probes together. Deep material ownership, transparent/third-material barriers and immutable evidence are required. No saved production output or prototype supplies expected results.',loadedFingerprints,savedFingerprints:fingerprints(),records},null,2));
});
