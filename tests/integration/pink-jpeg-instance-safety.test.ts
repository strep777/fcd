import {createHash} from 'node:crypto';
import {mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {afterAll,expect,it} from 'vitest';
import sharp from 'sharp';
import {illustrationRegions,pigmentFamily} from '../../packages/reference/illustration';

const source='tests/fixtures/character-front-back.jpg';
const sourceSha256='ce2cad952e7efc4228ed236736b1d5370803aa5616b251a4bbffa164cd4ea768';
type View='front'|'back';
type Probe={name:string;x:number;y:number;rgba:number[]};
const topPads:Probe[]=[
 {name:'left outlined top pad',x:654,y:245,rgba:[255,169,170,255]},
 {name:'right outlined top pad',x:684,y:245,rgba:[255,173,173,255]}
];
const curl:Probe[]=[
 {name:'continuous curl upper highlight',x:309,y:684,rgba:[212,141,149,255]},
 {name:'continuous curl middle highlight',x:309,y:693,rgba:[226,163,171,255]},
 {name:'continuous curl shaded base',x:300,y:700,rgba:[136,67,72,255]}
];
const seamSides:Probe[]=[
 {name:'left pad interior beside visible dark seam',x:247,y:680,rgba:[183,129,143,255]},
 {name:'central pad interior beside visible dark seam',x:275,y:680,rgba:[166,105,120,255]}
];
const records:unknown[]=[],loaded=new Map<View,ReturnType<typeof load>>();
async function load(view:View){
 expect(createHash('sha256').update(readFileSync(source)).digest('hex'),'prescribed source JPEG is unchanged').toBe(sourceSha256);
 const left=view==='front'?609:0,width=view==='front'?666:609,height=750;
 const rgba=new Uint8Array(await sharp(source).extract({left,top:0,width,height}).ensureAlpha().raw().toBuffer()),preserved=rgba.slice();
 // The real import splits this source at x=609 and classifies each full view
 // in character context. Cropping to an output-selected pad would change that
 // context and would not reproduce the business workflow.
 const result=illustrationRegions(width,height,rgba,true,'character'),labels=new Int32Array(width*height).fill(-1);let duplicateOwners=0,owned=0;
 for(const[id,region]of result.regions.entries())for(const i of region.indices){duplicateOwners+=+(labels[i]>=0);labels[i]=id;owned++;}
 expect(Buffer.from(rgba).equals(Buffer.from(preserved)),'classification preserves original RGBA').toBe(true);expect(duplicateOwners).toBe(0);expect(owned).toBe(result.foregroundPixels-result.discardedPixels);
 return{left,width,rgba,result,labels};
}
function classified(view:View){let result=loaded.get(view);if(!result){result=load(view);loaded.set(view,result);}return result;}
async function owners(view:View,probes:Probe[]){
 const f=await classified(view);
 const observed=probes.map(p=>{const i=p.y*f.width+p.x-f.left;expect(Array.from(f.rgba.subarray(4*i,4*i+4)),`independently inspected source RGB: ${p.name}`).toEqual(p.rgba);const owner=f.labels[i];expect(owner,`${p.name} remains foreground`).toBeGreaterThanOrEqual(0);expect(pigmentFamily(f.result.regions[owner]?.color??'#ffffff'),`${p.name} remains pink material`).toBe(1);return{...p,owner};});
 records.push({view,observed,regionsDiagnosticOnly:f.result.regions.length});return observed.map(p=>p.owner);
}

// The fixed coordinates were chosen by direct review of the untouched JPEG:
// two separately outlined top pads, one continuous illuminated curled toe,
// and two back-pad cores separated by an independently visible dark seam.
// Neither old component IDs, region counts, fitted paths nor a prototype
// supplies the expected identity relation.
it('the original front JPEG keeps its two outlined top pads as distinct pink instances',async()=>{
 const[a,b]=await owners('front',topPads);expect(a).not.toBe(b);
},30000);
it('the original back JPEG does not cut the continuous highlighted curl into extra pink pieces',async()=>{
 const observed=await owners('back',curl);expect(new Set(observed).size).toBe(1);
},30000);
it('the original back JPEG preserves the true dark separator between the left and central pad cores',async()=>{
 const[a,b]=await owners('back',seamSides);expect(a).not.toBe(b);
},30000);

afterAll(()=>{
 const stage=process.env.FPCAD_PINK_JPEG_STAGE??'diagnostic';if(!/^[a-z0-9-]+$/.test(stage))throw Error('INVALID_PINK_JPEG_STAGE');
 const directory='test-results/contour-repair/pink-jpeg-instance/'+stage;mkdirSync(directory,{recursive:true});writeFileSync(directory+'/metrics.json',JSON.stringify({source,sourceSha256,oracle:'Fixed original RGB probes and source-reviewed material-instance relations. Full front609/back split, excludeBackground=true, subject=character. Region count and numeric IDs are diagnostic only. No raw contour or fitted geometry supplies the expected relation.',records},null,2));
});
