import {randomUUID} from 'node:crypto';
import {mkdirSync,writeFileSync} from 'node:fs';
import sharp from 'sharp';
import {afterAll,expect,it} from 'vitest';
import {recoverBlueHighlights} from '../../packages/reference/blue-pigments';
import {illustrationRegions,pigmentFamily} from '../../packages/reference/illustration';
import {splitReferences} from '../../apps/desktop/main/automatic-reference';
import type {Piece,Reference} from '../../packages/schema/index';

type Pixel={rgb:number[];label:number;ink?:number};
const records:unknown[]=[],width=64,height=48,blue=[135,170,200],neutral=[170,186,200],black=[20,20,20];
function field(at:(x:number,y:number)=>Pixel){
 const rgba=new Uint8Array(width*height*4),foreground=new Uint8Array(width*height).fill(1),ink=new Uint8Array(width*height),labels=new Int8Array(width*height),hue=new Float32Array(width*height),saturation=new Float32Array(width*height),value=new Float32Array(width*height);
 for(let y=0;y<height;y++)for(let x=0;x<width;x++){const i=y*width+x,p=at(x,y),[r,g,b]=p.rgb,hi=Math.max(r,g,b),lo=Math.min(r,g,b),d=hi-lo;rgba.set([r,g,b,255],i*4);labels[i]=p.label;ink[i]=p.ink??0;hue[i]=d?((hi===r?((g-b)/d)%6:hi===g?(b-r)/d+2:(r-g)/d+4)*60+360)%360:0;saturation[i]=hi?d/hi:0;value[i]=hi/255;}
 return{rgba,foreground,ink,labels,hue,saturation,value};
}
const apply=(f:ReturnType<typeof field>)=>recoverBlueHighlights(width,height,f.rgba,f.foreground,f.ink,f.labels,f.hue,f.saturation,f.value);
const blueFixture=(kind:'step'|'gradient'|'ink'|'third')=>field((x,y)=>{
 if(x<8||x>=48||y<8||y>=40)return{rgb:black,label:6};
 if(x<24)return{rgb:blue,label:4};
 if((kind==='ink'||kind==='third')&&x<26)return kind==='ink'?{rgb:black,label:6,ink:1}:{rgb:[240,100,150],label:1};
 if(kind==='step')return{rgb:neutral,label:0};
 const t=(x-24+.5)/24;return{rgb:blue.map((v,c)=>Math.round(v+[70,50,35][c]*t)),label:0};
});
const target=Array.from({length:width*height},(_,i)=>i).filter(i=>i%width>=26&&i%width<48&&Math.floor(i/width)>=8&&Math.floor(i/width)<40);

it('does not recolour the prescribed neutral plateau across a constant blue/neutral source step',()=>{
 const f=blueFixture('step'),before=f.labels.slice(),moved=apply(f);records.push({name:'direct constant painted step',moved,neutralAfter:Array.from(f.labels).filter(v=>v===0).length});expect(moved).toBe(0);expect(f.labels).toEqual(before);
});
it('full classification retains both independently prescribed constant blue and neutral materials',()=>{
 const f=blueFixture('step'),result=illustrationRegions(width,height,f.rgba,false),owners=new Int32Array(width*height).fill(-1);result.regions.forEach((r,k)=>r.indices.forEach(i=>owners[i]=k));const a=owners[20*width+16],b=owners[20*width+36];records.push({name:'classified constant painted step',regions:result.regions.map(r=>({color:r.color,pixels:r.indices.length})),blueOwner:a,neutralOwner:b});expect(a).not.toBe(b);expect(pigmentFamily(result.regions[a].color)).toBe(4);expect(pigmentFamily(result.regions[b].color)).toBe(0);
});
it('recovers the prescribed continuous blue reflection without an arbitrary propagation distance cutoff',()=>{
 const f=blueFixture('gradient'),before={rgba:f.rgba.slice(),foreground:f.foreground.slice(),ink:f.ink.slice()},moved=apply(f);records.push({name:'direct smooth blue reflection',moved});expect(moved).toBe(768);for(let y=8;y<40;y++)for(let x=8;x<48;x++)expect(f.labels[y*width+x]).toBe(4);expect({rgba:f.rgba,foreground:f.foreground,ink:f.ink}).toEqual(before);
});
it('full classification keeps a long smooth blue reflection with its independently supported blue core',()=>{
 const f=blueFixture('gradient'),result=illustrationRegions(width,height,f.rgba,false),owners=new Int32Array(width*height).fill(-1);result.regions.forEach((r,k)=>r.indices.forEach(i=>owners[i]=k));const owner=owners[20*width+16],dark=owners[2*width+2];records.push({name:'classified smooth blue reflection',regions:result.regions.map(r=>({color:r.color,pixels:r.indices.length})),sourceOwner:owner,darkOwner:dark});
 // The existing palette samples bright observations. Reclassifying that
 // representative colour is not an independent material-ownership oracle.
 expect(result.regions).toHaveLength(2);expect(owner).not.toBe(dark);expect(result.regions[owner].indices).toHaveLength(1280);expect(result.regions[dark].indices).toHaveLength(1792);expect(pigmentFamily(result.regions[dark].color)).toBe(6);
 for(let y=0;y<height;y++)for(let x=0;x<width;x++)expect(owners[y*width+x],`source material at ${x}/${y}`).toBe(x>=8&&x<48&&y>=8&&y<40?owner:dark);
});
it.each(['ink','third']as const)('cannot reach a neutral reflection across a prescribed %s separator',kind=>{
 const f=blueFixture(kind),before=f.labels.slice(),moved=apply(f);expect(moved).toBe(0);expect(f.labels).toEqual(before);const result=illustrationRegions(width,height,f.rgba,false),neutralPixels=new Set(result.regions.filter(r=>pigmentFamily(r.color)===0).flatMap(r=>r.indices)),wrong=target.filter(i=>!neutralPixels.has(i));records.push({name:'blocked '+kind,moved,wrongTarget:wrong.length,regions:result.regions.map(r=>({color:r.color,pixels:r.indices.length}))});expect(wrong).toHaveLength(0);
});

it.each([.5,.8,1.2,2])('preserves two prescribed painted material cores after ordinary source blur %s',async blur=>{
 const original=blueFixture('step'),rgba=new Uint8Array(await sharp(original.rgba,{raw:{width,height,channels:4}}).blur(blur).raw().toBuffer()),f=field((x,y)=>{const i=y*width+x;return{rgb:Array.from(rgba.subarray(4*i,4*i+3)),label:original.labels[i]};}),a=20*width+16,b=20*width+36;
 // The source has two fixed painted materials, not an illumination ramp.
 // Blur affects only its measured edge band; these deep core probes still
 // observe their independent plateaus. Boundary pixels may be reassigned.
 const moved=apply(f),result=illustrationRegions(width,height,rgba,false),owners=new Int32Array(width*height).fill(-1);result.regions.forEach((r,k)=>r.indices.forEach(i=>owners[i]=k));const metrics={name:'blurred painted material step',blur,moved,sourceProbeRGB:[Array.from(rgba.subarray(4*a,4*a+3)),Array.from(rgba.subarray(4*b,4*b+3))],directCoreLabels:[f.labels[a],f.labels[b]],classifiedCoreOwners:[owners[a],owners[b]],regions:result.regions.map(r=>({color:r.color,pixels:r.indices.length}))};records.push(metrics);const message=JSON.stringify(metrics);
 expect.soft(f.labels[a],message).toBe(4);expect.soft(f.labels[b],message).toBe(0);expect.soft(owners[a],message).toBeGreaterThanOrEqual(0);expect.soft(owners[b],message).toBeGreaterThanOrEqual(0);expect.soft(owners[a],message).not.toBe(owners[b]);
 const dir='test-results/contour-repair/compact-source-review';mkdirSync(dir,{recursive:true});await sharp(rgba,{raw:{width,height,channels:4}}).png().toFile(dir+'/highlight-painted-step-blur-'+blur+'-source.png');
});

it.each(['same-blue','alternating']as const)('missing source profiles at a transparent hole cannot erase neutral material with hidden RGB %s',hidden=>{
 const base=blueFixture('step'),f=field((x,y)=>{const i=y*width+x,hole=y===20&&x>=17&&x<=22;return{rgb:hole?(hidden==='same-blue'?blue:x%2?[255,0,0]:[0,255,0]):Array.from(base.rgba.subarray(4*i,4*i+3)),label:hole?-1:base.labels[i]};});
 const holes=Array.from({length:6},(_,k)=>20*width+17+k);for(const i of holes){f.foreground[i]=0;f.rgba[4*i+3]=0;}const before=f.foreground.slice(),a=20*width+16,b=20*width+36,moved=apply(f),result=illustrationRegions(width,height,f.rgba,false),owners=new Int32Array(width*height).fill(-1);result.regions.forEach((r,k)=>r.indices.forEach(i=>owners[i]=k));const metrics={name:'transparent missing source profiles',hidden,moved,directCoreLabels:[f.labels[a],f.labels[b]],classifiedCoreOwners:[owners[a],owners[b]],regions:result.regions.map(r=>({color:r.color,pixels:r.indices.length}))};records.push(metrics);const message=JSON.stringify(metrics);
 expect.soft(f.labels[a],message).toBe(4);expect.soft(f.labels[b],message).toBe(0);expect.soft(owners[a],message).toBeGreaterThanOrEqual(0);expect.soft(owners[b],message).toBeGreaterThanOrEqual(0);expect.soft(owners[a],message).not.toBe(owners[b]);expect(f.foreground).toEqual(before);for(const i of holes){expect.soft(f.labels[i],message).toBe(-1);expect.soft(owners[i],message).toBe(-1);}
});

type XY={x:number;y:number};
const w=48,h=48,cx=24.21,cy=23.73;
const inside=(p:XY,ring:XY[])=>{let hit=false;for(let i=0,j=ring.length-1;i<ring.length;j=i++){const a=ring[i],b=ring[j];if((a.y>p.y)!==(b.y>p.y)&&p.x<(b.x-a.x)*(p.y-a.y)/(b.y-a.y)+a.x)hit=!hit;}return hit;};
function rings(piece:Piece){return[piece.nodes,...piece.holes??[]].map((ring,k)=>ring.flatMap((a,i)=>{const b=ring[(i+1)%ring.length],c=k===0?piece.curves?.find(c=>c.startNodeId===a.id&&c.endNodeId===b.id):undefined,n= c?Math.max(1,Math.ceil((Math.hypot(c.c1.xMm-a.xMm,c.c1.yMm-a.yMm)+Math.hypot(c.c2.xMm-c.c1.xMm,c.c2.yMm-c.c1.yMm)+Math.hypot(b.xMm-c.c2.xMm,b.yMm-c.c2.yMm))/.04)):1;return Array.from({length:n},(_,j)=>{const t=j/n,s=1-t;return{x:c?s**3*a.xMm+3*s*s*t*c.c1.xMm+3*s*t*t*c.c2.xMm+t**3*b.xMm:a.xMm+(b.xMm-a.xMm)*t,y:h-(c?s**3*a.yMm+3*s*s*t*c.c1.yMm+3*s*t*t*c.c2.yMm+t**3*b.yMm:a.yMm+(b.yMm-a.yMm)*t)};});}));}
const owns=(p:XY,r:XY[][])=>inside(p,r[0])&&!r.slice(1).some(h=>inside(p,h));
async function extract(rgba:Uint8Array){const png=await sharp(rgba,{raw:{width:w,height:h,channels:4}}).png().toBuffer(),calibration={a:{x:0,y:h},b:{x:0,y:0},distanceMm:h},references:Reference[]=(['front','back']as const).map(view=>({id:randomUUID(),name:view,view,width:w,height:h,png:'data:image/png;base64,'+png.toString('base64'),calibration,calibrationMode:'manual',resources:{} as Reference['resources']}));return splitReferences(references,h,6,false).regions.filter(r=>r.view==='front').map(r=>({piece:r.piece,rings:rings(r.piece)}));}
function render(radius:number,transparent=false,hidden:number[]=[0,0,0],junction=false){const rgba=new Uint8Array(w*h*4),aa=8;for(let y=0;y<h;y++)for(let x=0;x<w;x++){let n=0;for(let sy=0;sy<aa;sy++)for(let sx=0;sx<aa;sx++)n+=+(Math.hypot(x+(sx+.5)/aa-cx,y+(sy+.5)/aa-cy)<radius);const coverage=n/aa**2,bg=junction&&y>=24?[55,100,200]:[0,0,0],rgb=transparent?(coverage?[255,238,90]:hidden):bg.map(v=>Math.round(v+(255-v)*coverage));rgba.set([...rgb,transparent?Math.round(255*coverage):255],4*(y*w+x));}return rgba;}

it.each([{name:'black',hidden:[0,0,0]},{name:'magenta',hidden:[255,0,255]}])('transparent PNG retains only its prescribed material despite hidden $name RGB',async({hidden})=>{
 const pieces=await extract(render(5,true,hidden));let missingCore=0,invented=0;for(let y=0;y<h;y++)for(let x=0;x<w;x++){const p={x:x+.5,y:y+.5},d=Math.hypot(p.x-cx,p.y-cy),owners=pieces.filter(r=>owns(p,r.rings));if(d<3.5&&owners.length!==1)missingCore++;if(d>6.5&&owners.length)invented++;}records.push({name:'transparent source',hidden,missingCore,invented,pieces:pieces.length});expect(missingCore).toBe(0);expect(invented).toBe(0);expect(pieces).toHaveLength(1);
});
it('a blurred mark without a fully lit plateau cannot expand into certain surrounding black material',async()=>{
 const source=render(1.7),blurred=new Uint8Array(await sharp(source,{raw:{width:w,height:h,channels:4}}).blur(1.5).raw().toBuffer());expect(Math.max(...Array.from(blurred).filter((_,i)=>i%4<3))).toBeLessThan(160);const pieces=await extract(blurred),bright=pieces.filter(r=>pigmentFamily(r.piece.color!)===0);let swallowed=0,overlaps=0;for(let y=0;y<h;y++)for(let x=0;x<w;x++){const p={x:x+.5,y:y+.5};if(pieces.filter(r=>owns(p,r.rings)).length>1)overlaps++;if(Math.hypot(p.x-cx,p.y-cy)>3.2&&bright.some(r=>owns(p,r.rings)))swallowed++;}records.push({name:'no fully lit plateau',brightRegions:bright.length,swallowed,overlaps});expect(swallowed).toBe(0);expect(overlaps).toBe(0);expect(bright.length).toBeLessThanOrEqual(1);for(const r of bright)expect(r.piece.holes??[]).toHaveLength(0);
});
it('a bright island meeting two materials preserves the complete three-owner junction network',async()=>{
 const pieces=await extract(render(5,false,[0,0,0],true));let wrong=0,gaps=0,overlaps=0;for(let y=0;y<h;y++)for(let x=0;x<w;x++){const p={x:x+.5,y:y+.5},d=Math.hypot(p.x-cx,p.y-cy),owners=pieces.filter(r=>owns(p,r.rings));if(!owners.length)gaps++;if(owners.length>1)overlaps++;if(Math.abs(d-5)>1.5&&Math.abs(p.y-24)>1.5&&owners.length===1){const expected=d<5?0:p.y<24?6:4;if(pigmentFamily(owners[0].piece.color!)!==expected)wrong++;}}const families=pieces.map(r=>pigmentFamily(r.piece.color!));records.push({name:'three material junction',wrong,gaps,overlaps,families});expect({wrong,gaps,overlaps}).toEqual({wrong:0,gaps:0,overlaps:0});expect(families.sort()).toEqual([0,4,6]);
});

afterAll(async()=>{const dir='test-results/contour-repair/compact-source-review';mkdirSync(dir,{recursive:true});writeFileSync(dir+'/highlight-safety-metrics.json',JSON.stringify({oracle:'Fixed constant material rectangles, independent gradient source, analytic AA circles and three-material junction before rendering. No raw classification or fitted output supplies truth. A no-plateau blurred tiny mark may be discarded by existing noise policy, but cannot claim certain distant black pixels.',records},null,2));for(const kind of['step','gradient','ink','third']as const)await sharp(blueFixture(kind).rgba,{raw:{width,height,channels:4}}).png().toFile(dir+'/highlight-'+kind+'-source.png');});
