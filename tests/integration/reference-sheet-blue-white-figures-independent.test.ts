import {afterAll,beforeAll,expect,it} from 'vitest';
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
import UPNG from '@pdf-lib/upng';
import type {Reference} from '../../packages/schema/index';
import {readReference,referenceFromPng} from '../../apps/desktop/main/references';
import {splitReferences} from '../../apps/desktop/main/automatic-reference';
import {illustrationSheet,sheetFigureWindows} from '../../packages/reference/sheet-figures';
import {illustrationRegions} from '../../packages/reference/illustration';

const codec=(UPNG as unknown as {default?:typeof UPNG}).default??UPNG;
const width=1536,height=1024,originalBoundary=803,exchangedBoundary=733;
type Result=ReturnType<typeof illustrationSheet>;
type Vectors=ReturnType<typeof splitReferences>;
type Mode='original'|'exchanged';
type Sample={reference:Reference;rgba:Uint8Array;classified:Result;vectors:Vectors;windows:ReturnType<typeof sheetFigureWindows>;local:{window:ReturnType<typeof sheetFigureWindows>[number];result:ReturnType<typeof illustrationRegions>}[]};
const samples=new Map<Mode,Sample>();
let originalPixels:Uint8Array;
const sourceSha256='274a203ba64db2fe3c949d585f949396d030ed27902826eee781174b43dcd11b';
const signature=(region:Result['regions'][number])=>JSON.stringify({color:region.color,part:region.part,side:region.side,contexts:region.contexts});
function crop(rgba:Uint8Array,x:number,w:number){const result=new Uint8Array(w*height*4);for(let y=0;y<height;y++)result.set(rgba.subarray((y*width+x)*4,(y*width+x+w)*4),y*w*4);return result;}
function exchange(rgba:Uint8Array){const result=new Uint8Array(rgba.length);for(let y=0;y<height;y++){result.set(rgba.subarray((y*width+originalBoundary)*4,(y+1)*width*4),y*width*4);result.set(rgba.subarray(y*width*4,(y*width+originalBoundary)*4),(y*width+exchangedBoundary)*4);}return result;}
function restoreIndex(index:number){const x=index%width;return Math.floor(index/width)*width+(x<exchangedBoundary?x+originalBoundary:x-exchangedBoundary);}
function bounds(indices:number[]){let left=width,top=height,right=0,bottom=0;for(const index of indices){const x=index%width,y=Math.floor(index/width);left=Math.min(left,x);right=Math.max(right,x+1);top=Math.min(top,y);bottom=Math.max(bottom,y+1);}return {left,top,right,bottom};}
function owned(result:Result,restore=false){const counts=new Uint8Array(width*height),owners=new Map<number,string>();for(const region of result.regions){const key=signature(region);for(const index of region.indices){const i=restore?restoreIndex(index):index;counts[i]++;owners.set(i,key);}}return {counts,owners};}
function ownershipDiagnostics(){const original=samples.get('original'),exchanged=samples.get('exchanged');if(!original||!exchanged)return;const before=owned(original.classified),after=owned(exchanged.classified,true),differences=[];for(const index of new Set([...before.owners.keys(),...after.owners.keys()]))if(before.owners.get(index)!==after.owners.get(index))differences.push({index,x:index%width,y:Math.floor(index/width),originalRgba:Array.from(original.rgba.subarray(index*4,index*4+4)),originalOwner:before.owners.get(index)??null,exchangedRestoredOwner:after.owners.get(index)??null});return{originalPixels:before.owners.size,exchangedPixels:after.owners.size,differenceCount:differences.length,examples:differences.slice(0,100)};}
function sampleContour(region:Vectors['regions'][number],reference:Reference){const c=reference.calibration!,dx=c.b.x-c.a.x,dy=c.b.y-c.a.y,toPixel=(p:{xMm:number;yMm:number})=>({x:c.a.x+(-dy*p.xMm+dx*p.yMm)/c.distanceMm,y:c.a.y+(dx*p.xMm+dy*p.yMm)/c.distanceMm});return [region.piece.nodes,...region.piece.holes??[]].flatMap(ring=>ring.flatMap((node,i)=>{const next=ring[(i+1)%ring.length],curve=region.piece.curves?.find(curve=>curve.startNodeId===node.id&&curve.endNodeId===next.id),a=toPixel(node),d=toPixel(next),b=curve?toPixel(curve.c1):a,c=curve?toPixel(curve.c2):d,count=Math.max(1,Math.ceil((Math.hypot(b.x-a.x,b.y-a.y)+Math.hypot(c.x-b.x,c.y-b.y)+Math.hypot(d.x-c.x,d.y-c.y))/.2));return Array.from({length:count},(_,i)=>{const t=i/count,s=1-t;return{x:s*s*s*a.x+3*s*s*t*b.x+3*s*t*t*c.x+t*t*t*d.x,y:s*s*s*a.y+3*s*s*t*b.y+3*s*t*t*c.y+t*t*t*d.y};});}));}

beforeAll(async()=>{
 const path=resolve('tests/fixtures/character-blue-white-front-back.png'),bytes=await readFile(path);expect(createHash('sha256').update(bytes).digest('hex')).toBe(sourceSha256);
 const original=await readReference(path,'sheet'),decoded=codec.decode(Uint8Array.from(Buffer.from(original.png.split(',')[1],'base64')).buffer);originalPixels=new Uint8Array(codec.toRGBA8(decoded)[0]);
 for(const mode of ['original','exchanged'] as const){const rgba=mode==='original'?originalPixels:exchange(originalPixels),reference=mode==='original'?original:referenceFromPng(Buffer.from(codec.encode([rgba.buffer as ArrayBuffer],width,height,0)),'Blue white artwork exchanged without mirroring','sheet'),windows=sheetFigureWindows(width,height,rgba),classified=illustrationSheet(width,height,rgba,true,'character'),vectors=splitReferences([reference],1800,8,true),local=windows.map(window=>({window,result:illustrationRegions(window.width,height,crop(rgba,window.x,window.width),true,'character',true,'median')}));samples.set(mode,{reference,rgba,classified,vectors,windows,local});}
},240000);

afterAll(async()=>{await writeFile(resolve('test-results/reference-sheet-blue-white-figures-independent.json'),JSON.stringify({sourceSha256,review:'Independent visual review identifies two anatomical eyes with their black rims/pupils, coloured iris and adjacent white oval brows, in two disjoint fixed front-face windows. Colour components are not counted as anatomical eyes. The historical803px crop changes component pixels and cannot supply exact132px pupil masks for the801px actual detector window.',exchangeOwnership:ownershipDiagnostics(),samples:[...samples].map(([mode,sample])=>({mode,windows:sample.windows,figures:sample.classified.figures,regions:sample.classified.regions.length,foregroundPixels:sample.classified.foregroundPixels,palette:sample.classified.palette,details:sample.classified.regions.filter(region=>region.detail).map(region=>({sourceGroup:region.sourceGroup,color:region.color,pixels:region.indices.length,bounds:bounds(region.indices)})),vectorDetails:sample.vectors.regions.filter(region=>region.fabrication==='detail').map(region=>({sourceGroup:region.sourceGroup,name:region.piece.name,color:region.piece.color}))}))},null,2));});

it.each(['original','exchanged'] as const)('%s blue-white artwork yields two whole figures despite disconnected head, arm and leg pigment components',mode=>{
 const sample=samples.get(mode)!;expect(sample.windows).toHaveLength(2);expect(sample.classified.figures).toHaveLength(2);expect(sample.windows[0].x).toBe(0);expect(sample.windows[0].width+sample.windows[1].width).toBe(width);expect(sample.windows[1].x).toBe(sample.windows[0].width);expect(sample.windows.every(window=>window.y===0&&window.height===height&&window.width>600)).toBe(true);
 const separator=sample.windows[1].x;expect(Array.from({length:height},(_,y)=>{const i=(y*width+separator)*4;return sample.rgba[i+3]<128||Math.min(sample.rgba[i],sample.rgba[i+1],sample.rgba[i+2])>=238;}).every(Boolean)).toBe(true);
 const reference=sample.vectors.references[0],decoded=codec.decode(Uint8Array.from(Buffer.from(reference.png.split(',')[1],'base64')).buffer);expect(sample.vectors.references).toHaveLength(1);expect([reference.width,reference.height,reference.view]).toEqual([width,height,'sheet']);expect(Buffer.from(codec.toRGBA8(decoded)[0]).equals(Buffer.from(sample.rgba))).toBe(true);
});

it.each(['original','exchanged'] as const)('%s group lifting retains every local pixel owner and original source colour without duplication or crossing windows',mode=>{
 const sample=samples.get(mode)!,actual=owned(sample.classified),expected=new Map<number,string>();let duplicates=0;
 for(const {window,result} of sample.local)for(const region of result.regions){const key=signature({...region,sourceGroup:0,detail:false});for(const index of region.indices){const global=(Math.floor(index/window.width)+window.y)*width+index%window.width+window.x;if(expected.has(global))duplicates++;expected.set(global,key);}}
 expect(duplicates).toBe(0);expect(actual.counts.every(count=>count<=1)).toBe(true);expect(actual.owners.size).toBe(expected.size);const mismatches:number[]=[];for(const [index,key] of expected)if(actual.owners.get(index)!==key&&mismatches.length<20)mismatches.push(index);expect(mismatches).toEqual([]);
 for(const region of sample.classified.regions){const window=sample.windows[region.sourceGroup];expect(region.indices.every(i=>i%width>=window.x&&i%width<window.x+window.width)).toBe(true);}
 for(const frame of sample.classified.partBounds){const window=sample.windows[frame.sourceGroup];expect(frame.minX).toBeGreaterThanOrEqual(window.x);expect(frame.maxX).toBeLessThanOrEqual(window.x+window.width);}
 expect(new Set(sample.classified.palette)).toEqual(new Set(sample.local.flatMap(row=>row.result.palette)));
});

it('moving the two complete drawings swaps their positions while front/back identity and every restored original material owner stay unchanged',()=>{
 const original=samples.get('original')!,exchanged=samples.get('exchanged')!;expect(original.classified.figures.map(figure=>figure.normalZ)).toEqual([1,-1]);expect(exchanged.classified.figures.map(figure=>figure.normalZ)).toEqual([-1,1]);
 const first=owned(original.classified),restored=owned(exchanged.classified,true);expect(first.owners.size).toBe(restored.owners.size);const differences:number[]=[];for(const [index,owner] of first.owners)if(restored.owners.get(index)!==owner&&differences.length<20)differences.push(index);expect(differences).toEqual([]);expect(restored.counts.every(count=>count<=1)).toBe(true);
});

it('two independently reviewed anatomical eye windows contain the detail sources and the back figure never gains fictitious eyes',()=>{
 const eyeWindows=[{left:353,top:171,right:414,bottom:237,pupil:{left:385,top:207,right:406,bottom:233}},{left:442,top:171,right:504,bottom:237,pupil:{left:448,top:207,right:473,bottom:233}}];
 const original=samples.get('original')!,expected=original.classified.regions.filter(region=>region.detail).map(region=>({color:region.color,pixels:region.indices.length,bounds:bounds(region.indices)}));
 for(const mode of ['original','exchanged'] as const){const sample=samples.get(mode)!,details=sample.classified.regions.filter(region=>region.detail),restored=details.map(region=>({region,indices:mode==='original'?region.indices:region.indices.map(restoreIndex)}));expect(details.every(region=>region.part==='head'&&sample.classified.figures[region.sourceGroup].normalZ===1)).toBe(true);expect(sample.classified.regions.filter(region=>sample.classified.figures[region.sourceGroup].normalZ===-1&&region.detail)).toEqual([]);
  for(const {indices} of restored){const b=bounds(indices);expect(eyeWindows.filter(window=>b.left>=window.left&&b.right<=window.right&&b.top>=window.top&&b.bottom<=window.bottom)).toHaveLength(1);}
  for(const window of eyeWindows){const inWindow=restored.filter(({indices})=>{const b=bounds(indices);return b.left>=window.left&&b.right<=window.right&&b.top>=window.top&&b.bottom<=window.bottom;});expect(inWindow.filter(row=>row.region.color==='#282b30')).toHaveLength(2);for(const color of ['#282b30','#fefaf8','#fac36c','#7aaded'])expect(inWindow.some(row=>row.region.color===color)).toBe(true);const pupil=inWindow.filter(row=>{const b=bounds(row.indices),core=window.pupil;return row.region.color==='#282b30'&&b.left>=core.left&&b.top>=core.top&&b.right<=core.right&&b.bottom<=core.bottom;});expect(pupil).toHaveLength(1);expect(pupil[0].indices.length).toBeGreaterThan(100);expect(pupil[0].indices.length).toBeLessThan(400);}
  expect(restored.map(({region,indices})=>({color:region.color,pixels:indices.length,bounds:bounds(indices)}))).toEqual(expected);
 }
});

it('independent navy thigh drops and tail bands preserve their own pigment beside the distinct light-blue fur in both figures',async()=>{
 const sample=samples.get('original')!,baseline=JSON.parse(await readFile(resolve('tests/fixtures/blue-white-material-partition-baseline.json'),'utf8')) as {sourceSha256:string;references:{view:string;components:{color:string}[]}[]};expect(baseline.sourceSha256).toBe(sourceSha256);
 expect(new Set(sample.classified.palette)).toEqual(new Set(baseline.references.flatMap(reference=>reference.components.map(component=>component.color))));
 const owner=new Map<number,Result['regions'][number]>();for(const region of sample.classified.regions)for(const index of region.indices)owner.set(index,region);
 for(const [view,left,navy,light,tail] of [['front',0,[[332,603],[521,603]],[[320,655],[525,655]],[648,804]],['back',803,[[167,604],[362,606]],[[160,670],[360,670]],[457,806]]] as const){
  const samples=[...navy,...[tail]],lightOwners=light.map(([x,y])=>owner.get(y*width+x+left)!);for(const region of lightOwners){expect(region).toBeDefined();const rgb=[1,3,5].map(i=>parseInt(region.color.slice(i,i+2),16));expect(rgb[2]).toBeGreaterThan(180);expect(rgb[0]).toBeGreaterThan(80);}
  for(const [x,y] of samples){const region=owner.get(y*width+x+left)!;expect(region).toBeDefined();expect(region.sourceGroup).toBe(view==='front'?0:1);expect(lightOwners.every(light=>light!==region)).toBe(true);const rgb=[1,3,5].map(i=>parseInt(region.color.slice(i,i+2),16));expect(rgb[0]).toBeLessThan(40);expect(rgb[2]).toBeLessThan(140);for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++)expect(owner.get((y+dy)*width+x+left+dx)).toBe(region);}
 }
});

it.each(['original','exchanged'] as const)('%s editable cubic contours retain their assigned full figure instead of crossing the empty sheet gutter',mode=>{
 const sample=samples.get(mode)!,reference=sample.vectors.references[0];expect(new Set(sample.vectors.regions.map(region=>region.sourceGroup))).toEqual(new Set([0,1]));
 for(const region of sample.vectors.regions){const window=sample.windows[region.sourceGroup!];expect(sampleContour(region,reference).every(point=>point.x>=window.x-1&&point.x<=window.x+window.width+1&&point.y>=-1&&point.y<=height+1)).toBe(true);}
 expect(sample.vectors.regions.filter(region=>region.fabrication==='detail')).toHaveLength(sample.classified.regions.filter(region=>region.detail).length);
});
