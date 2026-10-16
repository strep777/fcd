import {createHash} from 'node:crypto';
import {mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {afterAll,expect,it} from 'vitest';
import {refineSmallBrightDetails} from '../../packages/reference/image-small-details';
import type {IllustrationRegion} from '../../packages/reference/illustration';

const width=32,height=32,cx=16.2,cy=15.7,radius=5.2,aa=8;
const records:unknown[]=[],source='packages/reference/image-small-details.ts';
const fingerprint=()=>createHash('sha256').update(readFileSync(source)).digest('hex');
const loadedSource=fingerprint();
type AlphaLocation='opaque'|'candidate-core'|'candidate-edge'|'surround';

function fixture(location:AlphaLocation,antialias=true){
 const rgba=new Uint8Array(width*height*4),coverage=new Float64Array(width*height),bright:number[]=[],dark:number[]=[];
 // The circle and subpixel coverage are specified before either mask or RGB.
 // Opaque RGB represents white/black pixel coverage. With nonopaque samples,
 // that same RGB no longer proves that mixing model, so correction abstains.
 for(let y=0;y<height;y++)for(let x=0;x<width;x++){
  const i=y*width+x;let count=0;
  for(let sy=0;sy<aa;sy++)for(let sx=0;sx<aa;sx++)count+=+(Math.hypot(x+(sx+.5)/aa-cx,y+(sy+.5)/aa-cy)<radius);
  coverage[i]=antialias?count/(aa*aa):+(Math.hypot(x+.5-cx,y+.5-cy)<radius);
  (coverage[i]>0?bright:dark).push(i);const value=Math.round(255*coverage[i]);rgba.set([value,value,value,255],4*i);
 }
 let alphaIndex:number|undefined;
 if(location==='candidate-core')alphaIndex=bright.find(i=>coverage[i]===1);
 if(location==='candidate-edge')alphaIndex=bright.find(i=>coverage[i]>0&&coverage[i]<.5);
 if(location==='surround')alphaIndex=dark.find(i=>[i-1,i+1,i-width,i+width].some(j=>bright.includes(j)));
 if(alphaIndex!==undefined)rgba[4*alphaIndex+3]=128;
 const metadata={part:'head' as const,side:'center' as const,confidence:.94,contexts:[{part:'arm' as const,side:'left' as const,confidence:.61}]};
 const regions:IllustrationRegion[]=[{...structuredClone(metadata),color:'#ffffff',indices:bright},{...structuredClone(metadata),color:'#000000',indices:dark}];
 return{rgba,coverage,regions,alphaIndex};
}

function run(location:AlphaLocation,antialias=true){
 const f=fixture(location,antialias),before={rgba:f.rgba.slice(),regions:structuredClone(f.regions)},result=refineSmallBrightDetails(width,height,f.rgba,f.regions),remaining=new Set(result.regions[0].indices),dropped=f.regions[0].indices.filter(i=>!remaining.has(i));
 records.push({location,antialias,alphaIndex:f.alphaIndex,before:f.regions.map(r=>r.indices.length),after:result.regions.map(r=>r.indices.length),dropped:dropped.map(i=>({index:i,coverage:f.coverage[i],alpha:f.rgba[4*i+3]})),removed:result.removed});
 expect(f.rgba,'the original source pixels are immutable').toEqual(before.rgba);
 expect(f.regions,'caller-owned material masks and metadata are immutable').toEqual(before.regions);
 expect(result.removed,'all transferred pixels have the existing opaque dark owner').toBe(0);
 expect(result.regions).toHaveLength(before.regions.length);
 for(let k=0;k<result.regions.length;k++){
  const {indices:afterIndices,...afterMetadata}=result.regions[k],{indices:beforeIndices,...beforeMetadata}=before.regions[k];
  expect(afterMetadata).toEqual(beforeMetadata);expect(new Set(afterIndices).size).toBe(afterIndices.length);expect(beforeIndices.length).toBeGreaterThan(0);
 }
 const owners=new Uint8Array(width*height);for(const r of result.regions)for(const i of r.indices){expect(Number.isInteger(i)&&i>=0&&i<owners.length).toBe(true);owners[i]++;}
 expect(Array.from(owners),'every source pixel retains exactly one material owner').toEqual(Array(width*height).fill(1));
 return{f,result,dropped};
}

it('opaque antialiased white-on-black coverage contracts to the independently rendered half-coverage boundary',()=>{
 const {f,result,dropped}=run('opaque');
 const expected=f.regions[0].indices.filter(i=>f.coverage[i]>=.5);
 expect(dropped.length,'the positive control must actually exercise coverage correction').toBeGreaterThan(0);
 expect([...result.regions[0].indices].sort((a,b)=>a-b)).toEqual(expected);
 for(const i of f.regions[0].indices.filter(i=>f.coverage[i]===1))expect(result.regions[0].indices).toContain(i);
});

it.each(['candidate-core','candidate-edge']as const)('a translucent %s cannot certify opaque RGB coverage or contract its material',location=>{
 const {f,result,dropped}=run(location);expect(f.alphaIndex).toBeDefined();expect(f.rgba[4*f.alphaIndex!+3]).toBe(128);
 expect.soft(dropped,'candidate opacity is required even when only an interior pixel is translucent').toHaveLength(0);
 expect(result.regions).toEqual(f.regions);
});

it('a translucent surrounding material cannot supply the opaque dark plateau',()=>{
 const {f,result,dropped}=run('surround');expect(f.alphaIndex).toBeDefined();expect(f.rgba[4*f.alphaIndex!+3]).toBe(128);
 expect(dropped).toHaveLength(0);expect(result.regions).toEqual(f.regions);
});

it('a fully painted opaque hard edge retains its prescribed material and all metadata',()=>{
 const {f,result,dropped}=run('opaque',false);expect(dropped).toHaveLength(0);expect(result.regions).toEqual(f.regions);
});

afterAll(()=>{
 const directory='test-results/contour-repair/alpha-small-details-review';mkdirSync(directory,{recursive:true});
 const stage=process.env.FPCAD_ALPHA_STAGE??'diagnostic';
 if(!/^[a-z0-9-]+$/.test(stage))throw Error('INVALID_ALPHA_STAGE');
 writeFileSync(directory+'/'+stage+'-metrics.json',JSON.stringify({stage,oracle:'Fixed analytic circle before 8x AA rendering. Opaque RGB is a known white/black mixture; any candidate or surround translucency invalidates that coverage interpretation. No old production output supplies the expected labels.',loadedSource,savedSource:fingerprint(),records},null,2));
});
