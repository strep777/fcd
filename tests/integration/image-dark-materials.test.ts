import {expect,it} from 'vitest';
import {createHash} from 'node:crypto';
import {existsSync,mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import sharp from 'sharp';
import {recoverDarkReflections} from '../../packages/reference/image-dark-materials';
import {illustrationRegions,pigmentFamily} from '../../packages/reference/illustration';

type Pixel={rgb:number[];label:number;foreground?:number};
function fixture(width:number,height:number,at:(x:number,y:number)=>Pixel){const rgba=new Uint8Array(width*height*4),foreground=new Uint8Array(width*height),labels=new Int8Array(width*height),saturation=new Float32Array(width*height),value=new Float32Array(width*height);for(let y=0;y<height;y++)for(let x=0;x<width;x++){const i=y*width+x,p=at(x,y),hi=Math.max(...p.rgb),lo=Math.min(...p.rgb);rgba.set([...p.rgb,255],i*4);foreground[i]=p.foreground??1;labels[i]=p.label;saturation[i]=hi?(hi-lo)/hi:0;value[i]=hi/255;}return{width,height,rgba,foreground,labels,saturation,value};}
const run=(f:ReturnType<typeof fixture>)=>recoverDarkReflections(f.width,f.height,f.rgba,f.foreground,f.labels,f.saturation,f.value);
const dark=[20,20,24],grey=[91,91,91],pink=[110,55,70],white=[248,248,248];
const index=(x:number,y:number,width=49)=>y*width+x;

it('recovers a continuous dark-pigment reflection but leaves source pixels and evidence arrays intact',()=>{
 const f=fixture(49,41,(x)=>{const t=Math.exp(-(((x-24)/4)**2)/2),rgb=dark.map((v,c)=>Math.round(v+[70,55,68][c]*t));return{rgb,label:t>.12?0:6};}),original={rgba:f.rgba.slice(),foreground:f.foreground.slice(),saturation:f.saturation.slice(),value:f.value.slice()},changed=run(f);
 expect(changed).toBeGreaterThan(0);expect(f.labels[index(24,20)]).toBe(6);expect({rgba:f.rgba,foreground:f.foreground,saturation:f.saturation,value:f.value}).toEqual(original);
});

it.each([{name:'bright white painted hole',rgb:white,label:0},{name:'abrupt grey material stripe',rgb:grey,label:0},{name:'abrupt pink material stripe',rgb:pink,label:1}])('preserves $name between dark materials',({rgb,label})=>{
 const f=fixture(49,41,(x)=>x>=21&&x<28?{rgb,label}:{rgb:dark,label:6}),before=f.labels.slice();expect(run(f)).toBe(0);expect(f.labels).toEqual(before);
});

it('does not borrow a dark label from only one side of a pale region',()=>{
 const f=fixture(49,41,(x)=>{const t=Math.min(1,Math.max(0,(x-6)/7));return{rgb:dark.map((v,c)=>Math.round(v+([91,84,92][c]-v)*t)),label:x<=6?6:0};}),before=f.labels.slice();expect(run(f)).toBe(0);expect(f.labels).toEqual(before);
});

it('does not traverse or relabel pixels outside the foreground',()=>{
 const f=fixture(49,41,(x)=>{const t=Math.exp(-(((x-24)/4)**2)/2);return{rgb:dark.map(v=>Math.round(v+60*t)),foreground:x>=22&&x<=26?0:1,label:x>=22&&x<=26?-1:t>.12?0:6};}),before=f.labels.slice();run(f);for(let y=0;y<f.height;y++)for(let x=22;x<=26;x++)expect(f.labels[index(x,y)]).toBe(before[index(x,y)]);
 // The foreground interruption also blocks opposed paths for both flanks.
 for(let y=0;y<f.height;y++)for(const x of[20,28])expect(f.labels[index(x,y)]).toBe(before[index(x,y)]);
});

it.each([{width:1,height:1},{width:1,height:7},{width:7,height:1},{width:2,height:2}])('handles tiny $width by $height rasters without inventing a dark seed',({width,height})=>{
 const f=fixture(width,height,()=>({rgb:grey,label:0})),before=f.labels.slice();expect(run(f)).toBe(0);expect(f.labels).toEqual(before);
});

it.each([{name:'zero width',width:0,height:2},{name:'negative height',width:2,height:-1},{name:'fractional width',width:1.5,height:2},{name:'nonfinite height',width:2,height:Infinity},{name:'NaN width',width:NaN,height:2},{name:'oversize raster',width:4097,height:4096}])('rejects $name before mutating labels',({width,height})=>{
 const f=fixture(2,2,()=>({rgb:grey,label:0})),before=f.labels.slice();expect(()=>recoverDarkReflections(width,height,f.rgba,f.foreground,f.labels,f.saturation,f.value)).toThrow('IMAGE_LIMIT');expect(f.labels).toEqual(before);
});
it.each(['rgba','foreground','labels','saturation','value']as const)('rejects mismatched $0 array before mutating labels',key=>{
 const f=fixture(2,2,()=>({rgb:grey,label:0})),before=f.labels.slice();if(key==='rgba')f.rgba=f.rgba.subarray(0,15);else if(key==='foreground')f.foreground=f.foreground.subarray(0,3);else if(key==='labels')f.labels=f.labels.subarray(0,3);else if(key==='saturation')f.saturation=f.saturation.subarray(0,3);else f.value=f.value.subarray(0,3);const expected=key==='labels'?before.subarray(0,3):before;expect(()=>run(f)).toThrow('IMAGE_LIMIT');expect(f.labels).toEqual(expected);
});

it.each([{name:'white hole',rgb:white,family:0},{name:'grey stripe',rgb:grey,family:0},{name:'pink stripe',rgb:[225,130,145],family:1}])('the full classifier preserves a real $name inside dark material',({rgb,family})=>{
 const f=fixture(80,64,(x,y)=>x>=34&&x<46&&y>=20&&y<44?{rgb,label:0}:{rgb:dark,label:6}),result=illustrationRegions(f.width,f.height,f.rgba,false,'head'),owner=result.regions.find(r=>r.indices.includes(32*80+40));expect(owner).toBeDefined();expect(pigmentFamily(owner!.color)).toBe(family);const exterior=result.regions.find(r=>r.indices.includes(10*80+10));expect(pigmentFamily(exterior!.color)).toBe(6);
});

it('records classification-only change in the original screenshot eye while preserving original bright glint anchors',async()=>{
 const directory=resolve('test-results/contour-repair/dark-classification');mkdirSync(directory,{recursive:true});
 const files=['packages/reference/image-dark-materials.ts','packages/reference/illustration.ts'],fingerprints=()=>Object.fromEntries(files.map(f=>[f,createHash('sha256').update(readFileSync(f)).digest('hex')])),loadedFingerprints=fingerprints(),source='tests/fixtures/character-front-back.jpg',width=666,height=750,left=609;
 const rgba=await sharp(source).extract({left,top:0,width,height}).ensureAlpha().raw().toBuffer(),result=illustrationRegions(width,height,rgba,true,'character'),labels=new Int32Array(width*height).fill(-1);result.regions.forEach((r,id)=>r.indices.forEach(i=>labels[i]=id));
 const baseline='test-results/contour-repair/before/classified-pixels.json';
 const before=existsSync(baseline)?(JSON.parse(readFileSync(baseline,'utf8')) as {view:string;labels:number[];regions:{color:string}[]}[]).find(v=>v.view==='front'):undefined;
 const familyBefore=(i:number)=>before?(before.labels[i]<0?-1:pigmentFamily(before.regions[before.labels[i]].color)):undefined,familyAfter=(i:number)=>labels[i]<0?-1:pigmentFamily(result.regions[labels[i]].color),roi={left:830,top:155,width:70,height:60},transitions:Record<string,number>={},changed:{x:number;y:number;from:number;to:number;rgb:number[]}[]=[];
 for(let y=roi.top;y<roi.top+roi.height;y++)for(let x=roi.left;x<roi.left+roi.width;x++){const i=y*width+x-left,a=familyBefore(i),b=familyAfter(i);transitions[`${a??'baseline-unavailable'}->${b}`]=(transitions[`${a??'baseline-unavailable'}->${b}`]??0)+1;if(a!==undefined&&a!==b)changed.push({x,y,from:a,to:b,rgb:Array.from(rgba.subarray(i*4,i*4+3))});}
 const anchors=[[850,178],[849,180],[876,176],[875,177],[858,190]].map(([x,y])=>{const i=y*width+x-left;return{x,y,rgb:Array.from(rgba.subarray(i*4,i*4+3)),before:familyBefore(i),after:familyAfter(i)};});
 const mask=(families:(i:number)=>number)=>{const colors=[[237,231,234],[250,178,179],[249,227,60],[70,190,80],[4,163,240],[170,80,220],[8,6,10]],data=Buffer.alloc(roi.width*roi.height*4,255);for(let y=0;y<roi.height;y++)for(let x=0;x<roi.width;x++){const i=(roi.top+y)*width+roi.left+x-left,f=families(i),color=colors[f]??[255,255,255];data.set([...color,255],(y*roi.width+x)*4);}return sharp(data,{raw:{width:roi.width,height:roi.height,channels:4}}).resize(roi.width*8,roi.height*8,{kernel:'nearest'}).png().toBuffer();};
 const oldPNG=before?await mask(i=>familyBefore(i)!):undefined,newPNG=await mask(familyAfter),original=await sharp(source).extract(roi).resize(roi.width*8,roi.height*8).png().toBuffer();if(oldPNG)writeFileSync(resolve(directory,'eye-before-classified.png'),oldPNG);writeFileSync(resolve(directory,'eye-after-classified.png'),newPNG);writeFileSync(resolve(directory,'eye-original.png'),original);const panels=[original,...(oldPNG?[oldPNG]:[]),newPNG];await sharp({create:{width:roi.width*8*panels.length,height:roi.height*8,channels:4,background:'#ffffff'}}).composite(panels.map((input,i)=>({input,left:roi.width*8*i,top:0}))).png().toFile(resolve(directory,oldPNG?'eye-original-before-after.png':'eye-original-after.png'));
 writeFileSync(resolve(directory,'classified-front.json'),JSON.stringify({width,height,labels:Array.from(labels),regions:result.regions}));writeFileSync(resolve(directory,'audit.json'),JSON.stringify({loadedFingerprints,savedFingerprints:fingerprints(),baselineAvailable:!!before,sourceHash:createHash('sha256').update(readFileSync(source)).digest('hex'),route:'illustrationRegions only; no contour recovery, saved geometry, desktop or user library',roi,transitions,changed:before?changed:null,anchors,limitation:'The optional prior generated classification is diagnostic only. Fixed high-intensity original glint anchors are checked even without a baseline. A changed family is not independent proof of semantic material correctness. Old family indices are translated through their own palette.'},null,2));
 expect(fingerprints()).toEqual(loadedFingerprints);for(const anchor of anchors.slice(0,4))expect(anchor.after,JSON.stringify(anchor)).toBe(0);
},30000);

