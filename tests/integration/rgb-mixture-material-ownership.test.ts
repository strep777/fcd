import {mkdirSync,writeFileSync} from 'node:fs';
import {afterAll,expect,it} from 'vitest';
import sharp from 'sharp';
import {illustrationRegions,pigmentFamily} from '../../packages/reference/illustration';
import {ambiguousCompact,nameOf,observedSource,sampledSource,sourceRibbon,type Fixture} from '../fixtures/rgb-observable-policy';
import {assertCompactOwnership,assertObservedStripe,assertUniqueCoverage} from '../fixtures/rgb-observable-assertions';

type XY={x:number;y:number};
type Material='blue'|'yellow'|'white';
type Kind='straight'|'diagonal'|'tip'|'white-line'|'white-hole'|'junction'|'transparent'|'illumination';
type Spec={name:string;kind:Kind;blur:number;palette:'complementary'|'artwork';whiteWidth?:number};
const width=96,height=80,aa=6,white=[246,246,242];
const palettes={complementary:{blue:[35,100,230],yellow:[245,220,50]},artwork:{blue:[4,163,240],yellow:[249,227,60]}};
const tip=[{x:16.2,y:12.4},{x:80.1,y:40.7},{x:18.3,y:69.2}],records:unknown[]=[];
const stage=process.env.FPCAD_RGB_MIX_STAGE??'diagnostic';if(!/^[a-z0-9-]+$/.test(stage))throw Error('INVALID_RGB_MIX_STAGE');
const directory='test-results/contour-repair/rgb-mixture-material/'+stage;
const compactPolicyNames=new Set(ambiguousCompact.map(nameOf)),linePolicyNames=new Set(['true-white-line-1px-blur3','true-white-line-2px-blur3']);
const cases:Spec[]=[];
for(const palette of['complementary','artwork']as const)for(const kind of['straight','diagonal','tip']as const)for(const blur of[.6,1.5,3])cases.push({name:`${palette}-${kind}-blur${blur}`,kind,blur,palette});
for(const kind of['white-line','white-hole']as const)for(const whiteWidth of[1,2,4])for(const blur of[.6,1.5,3])cases.push({name:`true-${kind}-${whiteWidth}px-blur${blur}`,kind,whiteWidth,blur,palette:'complementary'});
for(const kind of['junction','transparent','illumination']as const)for(const blur of[.6,1.5,3])cases.push({name:`${kind}-blur${blur}`,kind,blur,palette:'complementary'});

const segmentDistance=(p:XY,a:XY,b:XY)=>{const dx=b.x-a.x,dy=b.y-a.y,t=Math.max(0,Math.min(1,((p.x-a.x)*dx+(p.y-a.y)*dy)/(dx*dx+dy*dy)));return Math.hypot(p.x-a.x-t*dx,p.y-a.y-t*dy);};
const insideTip=(p:XY)=>{let inside=false;for(let i=0,j=tip.length-1;i<tip.length;j=i++){const a=tip[i],b=tip[j];if((a.y>p.y)!==(b.y>p.y)&&p.x<(b.x-a.x)*(p.y-a.y)/(b.y-a.y)+a.x)inside=!inside;}return inside;};
const hole=(size:number)=>[{x:20,y:36},{x:20+size,y:36},{x:20+size,y:36+size},{x:20,y:36+size}];
function material(p:XY,s:Spec):Material{
 if(s.kind==='illumination')return'blue';
 if(s.kind==='white-line')return p.x<48?'blue':p.x<48+s.whiteWidth!?'white':'yellow';
 if(s.kind==='white-hole'&&p.x>=20&&p.x<20+s.whiteWidth!&&p.y>=36&&p.y<36+s.whiteWidth!)return'white';
 if(s.kind==='junction')return p.x<48.3?'blue':p.y<40.2?'yellow':'white';
 if(s.kind==='tip')return insideTip(p)?'yellow':'blue';
 return p.x<(s.kind==='diagonal'?34.2+.37*p.y:48.3)?'blue':'yellow';
}
function boundaryDistance(p:XY,s:Spec){
 if(s.kind==='illumination')return Infinity;
 if(s.kind==='tip')return Math.min(...tip.map((a,i)=>segmentDistance(p,a,tip[(i+1)%tip.length])));
 if(s.kind==='diagonal')return Math.abs(p.x-34.2-.37*p.y)/Math.hypot(1,.37);
 if(s.kind==='white-line')return Math.min(Math.abs(p.x-48),Math.abs(p.x-48-s.whiteWidth!));
 if(s.kind==='white-hole'){const ring=hole(s.whiteWidth!);return Math.min(Math.abs(p.x-48.3),...ring.map((a,i)=>segmentDistance(p,a,ring[(i+1)%ring.length])));}
 if(s.kind==='junction')return Math.min(Math.abs(p.x-48.3),p.x>=48.3?Math.abs(p.y-40.2):Infinity);
 return Math.abs(p.x-48.3);
}
function rgb(p:XY,s:Spec){
 const paint=material(p,s),palette=palettes[s.palette],base=paint==='white'?white:palette[paint];
 if(s.kind!=='illumination')return base;
 const shade=.65+.35*p.y/height,reflection=.74*Math.exp(-((p.x-58)**2+(p.y-35)**2)/(2*18**2));
 return base.map((v,c)=>v*shade+(white[c]-v*shade)*reflection);
}
const residualToSegment=(rgb:number[],blue:number[],yellow:number[])=>{const delta=yellow.map((v,c)=>v-blue[c]),t=Math.max(0,Math.min(1,delta.reduce((s,v,c)=>s+v*(rgb[c]-blue[c]),0)/delta.reduce((s,v)=>s+v*v,0)));return Math.hypot(...rgb.map((v,c)=>v-blue[c]-t*delta[c]));};
function seeds(s:Spec):Partial<Record<Material,XY>>{
 if(s.kind==='illumination')return{blue:{x:8.5,y:8.5}};
 if(s.kind==='tip')return{blue:{x:5.5,y:40.5},yellow:{x:40.5,y:40.5}};
 if(s.kind==='junction')return{blue:{x:14.5,y:40.5},yellow:{x:82.5,y:18.5},white:{x:82.5,y:64.5}};
 return{blue:{x:12.5,y:20.5},yellow:{x:82.5,y:40.5},...(s.kind==='white-line'?{white:{x:48+s.whiteWidth!/2,y:40.5}}:s.kind==='white-hole'?{white:{x:20+s.whiteWidth!/2,y:36+s.whiteWidth!/2}}:{})};
}

it.each(cases)('$name retains source materials without inventing a neutral mixture material',async s=>{
 // Fixed geometry/material identity precedes all AA and Gaussian operations.
 // A white stripe/hole has its own non-collinear RGB vertex. In the two-colour
 // cases every source sample is a convex combination of only blue and yellow.
 const source=new Uint8Array(width*height*4);
 for(let y=0;y<height;y++)for(let x=0;x<width;x++){const sum=[0,0,0];for(let j=0;j<aa;j++)for(let i=0;i<aa;i++){const value=rgb({x:x+(i+.5)/aa,y:y+(j+.5)/aa},s);for(let c=0;c<3;c++)sum[c]+=value[c]/(aa*aa);}source.set([...sum.map(Math.round),255],(y*width+x)*4);}
 // Float convolution and explicit final rounding make the fixture's two
 // quantization steps independent of libvips' integer-kernel approximation.
 const blurred=await sharp(source,{raw:{width,height,channels:4}}).blur({sigma:s.blur,precision:'float'}).raw({depth:'float'}).toBuffer(),rgba=Uint8Array.from({length:source.length},(_,i)=>Math.round(Math.max(0,Math.min(255,blurred.readFloatLE(i*4)))));
 // Missing observations are introduced after RGB rendering, so arbitrary
 // hidden white values cannot be confused with a measured white material.
 if(s.kind==='transparent')for(let y=0;y<height;y++)for(let x=42;x<54;x++)rgba.set([246,246,242,0],(y*width+x)*4);
 // Fix the source support before consulting production output.
 const policy=compactPolicyNames.has(s.name)?'compact':linePolicyNames.has(s.name)?'line':undefined;
 const observedSupport=policy==='line'?sourceRibbon(rgba):undefined;
 const preserved=rgba.slice(),result=illustrationRegions(width,height,rgba,false,'head'),labels=new Int32Array(width*height).fill(-1);result.regions.forEach((r,id)=>r.indices.forEach(i=>labels[i]=id));
 const at=(p:XY)=>labels[Math.floor(p.y)*width+Math.floor(p.x)],sourceSeeds=seeds(s),owners=Object.fromEntries(Object.entries(sourceSeeds).map(([key,p])=>[key,at(p!)]))as Partial<Record<Material,number>>,expectedOwners=new Set(policy==='compact'?[owners.blue!,owners.yellow!]:policy==='line'?[owners.blue!,owners.yellow!,...observedSupport!.map(i=>labels[i])]:Object.values(owners)),extraRegions=result.regions.flatMap((r,id)=>expectedOwners.has(id)?[]:[{id,color:r.color,family:pigmentFamily(r.color),pixels:r.indices.length}]),extraWhite=extraRegions.filter(r=>r.family===0),wrongDeep:unknown[]=[],missingClaimed:number[]=[];
 const corridor=3*s.blur+2;
 for(let y=6.7;y<height-5;y+=6.3)for(let x=6.3;x<width-5;x+=6.3){const p={x,y},i=Math.floor(y)*width+Math.floor(x);if(rgba[i*4+3]<128||boundaryDistance(p,s)<=corridor)continue;const key=material(p,s);if(at(p)!==owners[key])wrongDeep.push({p,material:key,expected:owners[key],actual:at(p)});}
 for(let i=0;i<labels.length;i++)if(rgba[i*4+3]<128&&labels[i]>=0)missingClaimed.push(i);
 const palette=palettes[s.palette],residuals=Array.from({length:labels.length},(_,i)=>rgba[i*4+3]<128?0:residualToSegment(Array.from(rgba.subarray(i*4,i*4+3)),palette.blue,palette.yellow)),twoColour=['straight','diagonal','tip','transparent'].includes(s.kind),maxConvexResidual=Math.max(...residuals),whiteSourcePixels=s.kind==='white-line'?height*s.whiteWidth!:s.kind==='white-hole'?s.whiteWidth!**2:undefined;
 const record={spec:s,width,height,aa,sourceSeeds,owners,deepProbeCorridorPx:corridor,wrongDeep,extraRegions,extraWhite,missingClaimed:missingClaimed.length,whiteSourcePixels,maxConvexResidualRGB:maxConvexResidual,regions:result.regions.map((r,id)=>({id,color:r.color,family:pigmentFamily(r.color),pixels:r.indices.length}))};records.push(record);
 mkdirSync(directory,{recursive:true});await sharp(rgba,{raw:{width,height,channels:4}}).png().toFile(directory+'/'+s.name+'-source.png');writeFileSync(directory+'/'+s.name+'-labels.json',JSON.stringify({width,height,labels:Array.from(labels),regions:record.regions}));
 expect(Buffer.from(rgba).equals(Buffer.from(preserved)),'classification cannot modify observed source RGB/alpha').toBe(true);
 for(const[key,p]of Object.entries(sourceSeeds)){expect.soft(material(p!,s),'source probes are specified from geometry, not output').toBe(key);expect.soft(owners[key as Material],'every prescribed source core is retained').toBeGreaterThanOrEqual(0);}
 if(!policy)expect.soft(new Set(Object.values(owners)).size,'independently painted material cores must stay distinct').toBe(Object.keys(sourceSeeds).length);
 // The2/8 revised cases replace the latent identity requirement with stronger
 // source-observable continuity, neighboring ownership and exact-pair checks.
 if(policy==='line')assertObservedStripe(result,labels,observedSupport!);
 if(policy==='compact'){
  const spec:Fixture={kind:'hole',size:s.whiteWidth!,blur:s.blur};
  expect(sampledSource(spec,'paint'),'independent fixture renderer matches original unchanged6xAA source').toEqual(source);
  expect(sampledSource(spec,'reflection'),'bounded reflection forward model matches every AA sample average').toEqual(source);
  const reflection=await observedSource(spec,'reflection');
  expect(reflection,'entire reflectionRGBA equals original observedRGBA; interpretation is never an API input').toEqual(rgba);
  assertCompactOwnership(result,labels,spec);
 }
 assertUniqueCoverage(rgba,result);
 expect.soft(wrongDeep,'deep independent source probes keep the correct material owner').toEqual([]);
 expect.soft(extraWhite,'a mixed RGB/AA band cannot introduce an unsupported white material').toEqual([]);
 expect.soft(extraRegions,'only independently specified materials may own the selection').toEqual([]);
 expect.soft(missingClaimed,'transparent missing observations cannot become material pixels').toEqual([]);
 if(twoColour)expect.soft(maxConvexResidual,'AA and Gaussian retain the two-RGB convex span up to two8bit rounding steps').toBeLessThanOrEqual(Math.sqrt(3)+1e-6);
 if(!policy&&owners.white!==undefined)expect.soft(pigmentFamily(result.regions[owners.white]?.color??'#000000'),'independently painted white stays a neutral material').toBe(0);
});

afterAll(()=>{mkdirSync(directory,{recursive:true});writeFileSync(directory+'/metrics.json',JSON.stringify({scope:'Synthetic production illustration classification only. Material geometry and non-collinear white RGB exist before6xAA and specifiedGaussian blur. Source masks/production results are never material truth.',limits:['Exactly8 compact blurred fixtures use byte-identical paint/reflection observations and the authorized surrounding-owner preference;2 extended lines retain their continuous third-source owner rather than latent white family/center. Remaining35 original cases keep their previous contracts.','The3sigma+2px corridor excludes source-boundary ambiguity only for deep probes;unsupported extra-white/material regions are checked across the full observed image.','No geometry/native/desktop/fullJPEG pipeline and no fixed shared diagnostic output.'],records},null,2));});
