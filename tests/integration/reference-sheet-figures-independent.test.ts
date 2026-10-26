import {afterAll,beforeAll,expect,it} from 'vitest';
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
import UPNG from '@pdf-lib/upng';
import type {Project,Reference} from '../../packages/schema/index';
import {projectSchema} from '../../packages/schema/index';
import {readReference,referenceFromPng} from '../../apps/desktop/main/references';
import {splitReferences} from '../../apps/desktop/main/automatic-reference';
import {illustrationSheet,sheetFigureWindows} from '../../packages/reference/sheet-figures';
import {illustrationRegions} from '../../packages/reference/illustration';
import {placementSources,registrationFingerprint} from '../../packages/reference/placement-registration';
import {referenceProjection} from '../../packages/reference/placement-context';
import {placementMatchesModel} from '../../packages/reference/placement-review';
import {anatomicalPlacement} from '../../apps/desktop/main/anatomical-placement';
import {automaticPlacement} from '../../apps/desktop/main/automatic-placement';
import {staleMarkingIds} from '../../apps/desktop/main/markings';
import {parseObj} from '../../apps/desktop/main/surface';
import {project} from '../fixtures';

const codec=(UPNG as unknown as {default?:typeof UPNG}).default??UPNG,worker=resolve('target/release/fpcad-worker.exe');
type Classified=ReturnType<typeof illustrationSheet>;
type Extracted=ReturnType<typeof splitReferences>;
let original:Reference,rgba:Uint8Array,classified:Classified,extracted:Extracted,swapped:Classified,swappedExtracted:Extracted;
type LocalFigure={left:number;width:number;result:ReturnType<typeof illustrationRegions>};
let separate:LocalFigure[],swappedSeparate:LocalFigure[],manualSeparate:LocalFigure[],frontLegacy:ReturnType<typeof illustrationRegions>;
const width=1275,height=750,oldBoundary=609,newBoundary=666;
function crop(pixels:Uint8Array,left:number,w:number){const result=new Uint8Array(w*height*4);for(let y=0;y<height;y++)result.set(pixels.subarray((y*width+left)*4,(y*width+left+w)*4),y*w*4);return result;}
function swappedPixels(){const result=new Uint8Array(rgba.length);for(let y=0;y<height;y++){result.set(rgba.subarray((y*width+oldBoundary)*4,(y+1)*width*4),y*width*4);result.set(rgba.subarray(y*width*4,(y*width+oldBoundary)*4),(y*width+newBoundary)*4);}return result;}
const sourcePixel=(index:number)=>{const x=index%width,y=Math.floor(index/width);return y*width+(x<newBoundary?x+oldBoundary:x-newBoundary);};
const regionSignature=(r:Classified['regions'][number])=>JSON.stringify({part:r.part,side:r.side,color:r.color,contexts:r.contexts});
function ownership(result:Classified,restore=false){const labels=new Map<string,number>(),owners=new Int32Array(width*height).fill(-1),counts=new Uint8Array(width*height);for(const r of result.regions){const key=regionSignature(r);if(!labels.has(key))labels.set(key,labels.size);for(const index of r.indices){const i=restore?sourcePixel(index):index;counts[i]++;owners[i]=labels.get(key)!;}}return {owners,counts,labels};}
function expectedOwnership(rows:LocalFigure[]){const expected=new Map<number,string>();let duplicates=0;for(const {left,width:w,result} of rows)for(const r of result.regions){const signature=regionSignature({...r,sourceGroup:0,detail:false});for(const i of r.indices){const index=Math.floor(i/w)*width+i%w+left;if(expected.has(index))duplicates++;expected.set(index,signature);}}return {expected,duplicates};}
function ownershipDifferences(actual:ReturnType<typeof ownership>,expected:Map<number,string>){const inverse=new Map([...actual.labels].map(([key,value])=>[value,key])),examples:{index:number;x:number;y:number;rgba:number[];actual:string|null;expected:string|null;rawRgbRange3x3:number}[]=[];let count=0,presenceDifferences=0;for(let i=0;i<width*height;i++){const a=inverse.get(actual.owners[i])??null,b=expected.get(i)??null;if(a===b)continue;count++;if(!a||!b)presenceDifferences++;if(examples.length<100){const x=i%width,y=Math.floor(i/width),values:number[][]=[];for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++)if(x+dx>=0&&x+dx<width&&y+dy>=0&&y+dy<height)values.push([...rgba.slice(((y+dy)*width+x+dx)*4,((y+dy)*width+x+dx)*4+3)]);examples.push({index:i,x,y,rgba:[...rgba.slice(i*4,i*4+4)],actual:a,expected:b,rawRgbRange3x3:Math.max(...[0,1,2].map(channel=>Math.max(...values.map(rgb=>rgb[channel]))-Math.min(...values.map(rgb=>rgb[channel]))))});}}return {count,presenceDifferences,examples};}
function pixelGeometry(r:Extracted['regions'][number],ref:Reference){const c=ref.calibration!,dx=c.b.x-c.a.x,dy=c.b.y-c.a.y,pixel=(p:{xMm:number;yMm:number})=>({x:c.a.x+(-dy*p.xMm+dx*p.yMm)/c.distanceMm,y:c.a.y+(dx*p.xMm+dy*p.yMm)/c.distanceMm});return [r.piece.nodes,...r.piece.holes??[]].flatMap(ring=>ring.flatMap((node,i)=>{const next=ring[(i+1)%ring.length],curve=r.piece.curves?.find(curve=>curve.startNodeId===node.id&&curve.endNodeId===next.id),a=pixel(node),d=pixel(next),b=curve?pixel(curve.c1):a,c=curve?pixel(curve.c2):d,count=Math.max(1,Math.ceil((Math.hypot(b.x-a.x,b.y-a.y)+Math.hypot(c.x-b.x,c.y-b.y)+Math.hypot(d.x-c.x,d.y-c.y))/.2));return Array.from({length:count},(_,j)=>{const t=j/count,s=1-t;return {x:s*s*s*a.x+3*s*s*t*b.x+3*s*t*t*c.x+t*t*t*d.x,y:s*s*s*a.y+3*s*s*t*b.y+3*s*t*t*c.y+t*t*t*d.y};});}));}
function bodyProject(){const p=project();p.pieces=[];p.markings=[];p.references=structuredClone(extracted.references);p.patternLibrary=structuredClone(extracted.regions);p.surface=parseObj('v -50 0 1\nv 50 0 1\nv 50 100 1\nv -50 100 1\nv -50 0 -1\nv 50 0 -1\nv 50 100 -1\nv -50 100 -1\ng torso\nf 1 2 3\nf 1 3 4\nf 7 6 5\nf 8 7 5');return p;}
const bodySources=(p:Project)=>p.references![0].illustration!.figures!.map(f=>p.patternLibrary!.find(r=>r.sourceGroup===f.sourceGroup&&r.anatomy?.part==='body')!);

beforeAll(async()=>{
 const imagePath=resolve('tests/fixtures/character-front-back.jpg');expect(createHash('sha256').update(await readFile(imagePath)).digest('hex')).toBe('ce2cad952e7efc4228ed236736b1d5370803aa5616b251a4bbffa164cd4ea768');
 original=await readReference(imagePath,'sheet');const decoded=codec.decode(Uint8Array.from(Buffer.from(original.png.split(',')[1],'base64')).buffer);rgba=new Uint8Array(codec.toRGBA8(decoded)[0]);
 classified=illustrationSheet(width,height,rgba,true,'character');extracted=splitReferences([original],1800,8,true);
 const pixels=swappedPixels();swapped=illustrationSheet(width,height,pixels,true,'character');const ref=referenceFromPng(Buffer.from(codec.encode([pixels.buffer],width,height,0)),'Same artwork with exchanged positions','sheet');swappedExtracted=splitReferences([ref],1800,8,true);
 separate=sheetFigureWindows(width,height,rgba).map(box=>({left:box.x,width:box.width,result:illustrationRegions(box.width,height,crop(rgba,box.x,box.width),true,'character',true,'median')}));
 swappedSeparate=sheetFigureWindows(width,height,pixels).map(box=>({left:box.x,width:box.width,result:illustrationRegions(box.width,height,crop(pixels,box.x,box.width),true,'character',true,'median')}));
 manualSeparate=[{left:0,width:609},{left:609,width:666}].map(box=>({...box,result:illustrationRegions(box.width,height,crop(rgba,box.left,box.width),true,'character')}));
 const front=separate.find(row=>row.left>0)!;frontLegacy=illustrationRegions(front.width,height,crop(rgba,front.left,front.width),true,'character',false,'median');
},180000);

afterAll(async()=>{if(!classified||!extracted||!swapped||!swappedExtracted)return;const rows=[['original',classified,extracted,rgba],['exchanged',swapped,swappedExtracted,swappedPixels()]] as const;await writeFile(resolve('test-results/reference-sheet-figures-independent.json'),JSON.stringify({figures:rows.map(([name,raw,output,pixels])=>{const windows=sheetFigureWindows(width,height,pixels);return {name,windows,figures:raw.figures,foregroundPixels:raw.foregroundPixels,regions:raw.regions.length,detailRegions:raw.regions.filter(r=>r.detail).map(r=>({sourceGroup:r.sourceGroup,pixels:r.indices.length,bounds:{minX:Math.min(...r.indices.map(i=>i%width)),maxX:Math.max(...r.indices.map(i=>i%width)),minY:Math.min(...r.indices.map(i=>Math.floor(i/width))),maxY:Math.max(...r.indices.map(i=>Math.floor(i/width)))}})),persistedFigures:output.references[0].illustration!.figures,vectorWindowViolations:output.regions.flatMap(r=>{const w=windows[r.sourceGroup!],points=pixelGeometry(r,output.references[0]),out=points.filter(p=>p.x<w.x-1||p.x>w.x+w.width+1||p.y< -1||p.y>height+1);return out.length?[{name:r.piece.name,sourceGroup:r.sourceGroup,outside:out.length,examples:out.slice(0,10)}]:[];})};}),windowSensitivityDiagnostics:manualSeparate?{scope:'Historical609/666 windows and translated windows use differing recognition extents. Differences are retained as diagnostics; exact wrapper lifting is checked against the actual independent local windows without a tolerance.',manualVsOriginal:ownershipDifferences(ownership(classified),expectedOwnership(manualSeparate).expected),exchangedRestoredVsOriginal:ownershipDifferences(ownership(swapped,true),new Map(classified.regions.flatMap(r=>{const signature=regionSignature(r);return r.indices.map(i=>[i,signature] as [number,string]);})))}:undefined},null,2));});

it('the immutable complete JPEG has two separated figures and exactly four eye-detail sources inside the independently registered eye window',()=>{
 expect([original.width,original.height]).toEqual([width,height]);expect(classified.figures).toHaveLength(2);expect(new Set(classified.figures.map(f=>f.normalZ))).toEqual(new Set([-1,1]));
 const details=classified.regions.filter(r=>r.detail);expect(details).toHaveLength(4);expect(new Set(details.map(r=>r.sourceGroup)).size).toBe(1);
 for(const r of details){expect(r.part).toBe('head');expect(r.indices.every(i=>i%width>=770&&i%width<=895&&Math.floor(i/width)>=160&&Math.floor(i/width)<=205)).toBe(true);expect(classified.figures.find(f=>f.sourceGroup===r.sourceGroup)!.normalZ).toBe(1);}
 const back=classified.figures.find(f=>f.normalZ===-1)!;expect(classified.regions.filter(r=>r.sourceGroup===back.sourceGroup&&r.detail)).toEqual([]);
});

it.each(['original','exchanged'] as const)('%s yellow thigh witnesses support only their own physical leg without duplicating a hip-crossing patch',mode=>{
 const raw=mode==='original'?classified:swapped,saved=mode==='original'?extracted:swappedExtracted;
 for(const [x,y,side] of [[759,520,'right'],[959,556,'left']] as const){
  const px=mode==='original'?x:x-oldBoundary,owners=raw.regions.filter(r=>r.indices.includes(y*width+px));
  expect(owners).toHaveLength(1);const source=owners[0];
  // These fixed witnesses come from the desktop pigment-interior check;
  // neighbouring raster pixels can belong to an ink boundary.
  const rgb=[1,3,5].map(i=>parseInt(source.color.slice(i,i+2),16));
  expect(rgb[0]).toBeGreaterThan(rgb[2]*2);expect(rgb[1]).toBeGreaterThan(rgb[2]*2);
  const persisted=saved.regions[raw.regions.indexOf(source)];
  expect(persisted.anatomy?.contexts?.filter(c=>c.part==='leg').map(c=>c.side)).toEqual([side]);
 }
});

it('figure windows partition the original sheet while all anatomy frames and owned pixel indices remain inside their own figure window',()=>{
 const windows=sheetFigureWindows(width,height,rgba);expect(windows).toHaveLength(2);expect(windows.reduce((n,w)=>n+w.width*w.height,0)).toBe(width*height);
 for(const figure of classified.figures){const window=windows[figure.sourceGroup];expect(figure.bounds.minX).toBeGreaterThanOrEqual(window.x);expect(figure.bounds.maxX).toBeLessThanOrEqual(window.x+window.width);for(const frame of classified.partBounds.filter(b=>b.sourceGroup===figure.sourceGroup)){expect(frame.minX).toBeGreaterThanOrEqual(window.x);expect(frame.maxX).toBeLessThanOrEqual(window.x+window.width);expect(frame.minY).toBeGreaterThanOrEqual(window.y);expect(frame.maxY).toBeLessThanOrEqual(window.y+window.height);}
  for(const r of classified.regions.filter(r=>r.sourceGroup===figure.sourceGroup))expect(r.indices.every(i=>i%width>=window.x&&i%width<window.x+window.width&&Math.floor(i/width)>=window.y&&Math.floor(i/width)<window.y+window.height)).toBe(true);
 }
});

it('whole-sheet analysis preserves every independently cropped original foreground pixel and its material/anatomy owner without duplication',()=>{
 const actual=ownership(classified),{expected,duplicates}=expectedOwnership(separate);expect(duplicates).toBe(0);expect(classified.regions.length).toBe(separate.reduce((sum,row)=>sum+row.result.regions.length,0));
 const actualPixels=actual.counts.reduce((n,count)=>n+(count?1:0),0);expect(actualPixels).toBe(expected.size);expect(actual.counts.every(count=>count<=1)).toBe(true);
 const inverse=new Map([...actual.labels].map(([key,value])=>[value,key])),mismatches:number[]=[];for(const [index,signature] of expected)if(inverse.get(actual.owners[index])!==signature&&mismatches.length<20)mismatches.push(index);expect(mismatches).toEqual([]);
});

it('exchanging the complete left/right artwork positions preserves physical facing and all original pixel ownership',()=>{
 expect(swapped.figures).toHaveLength(2);expect(swapped.figures.map(f=>f.normalZ)).toEqual([1,-1]);expect(classified.figures.map(f=>f.normalZ)).toEqual([-1,1]);
 const actual=ownership(swapped),{expected,duplicates}=expectedOwnership(swappedSeparate);expect(duplicates).toBe(0);expect(actual.counts.every(count=>count<=1)).toBe(true);expect(actual.counts.reduce((n,count)=>n+(count?1:0),0)).toBe(expected.size);expect(ownershipDifferences(actual,expected).count).toBe(0);
 const details=swapped.regions.filter(r=>r.detail);expect(details).toHaveLength(4);expect(details.every(r=>swapped.figures[r.sourceGroup].normalZ===1)).toBe(true);
});

it.each(['original','exchanged'] as const)('persisted %s vectors retain one original-size sheet, four detail sources and group-specific registration frames',mode=>{
 const result=mode==='original'?extracted:swappedExtracted,reference=result.references[0],pixels=mode==='original'?rgba:swappedPixels(),windows=sheetFigureWindows(width,height,pixels);expect(result.references).toHaveLength(1);expect([reference.width,reference.height,reference.view]).toEqual([width,height,'sheet']);if(mode==='original')expect(reference.png).toBe(original.png);const decoded=codec.decode(Uint8Array.from(Buffer.from(reference.png.split(',')[1],'base64')).buffer);expect(Buffer.from(codec.toRGBA8(decoded)[0]).equals(Buffer.from(pixels))).toBe(true);
 expect(reference.illustration!.figures).toHaveLength(2);expect(result.regions.filter(r=>r.fabrication==='detail')).toHaveLength(4);expect(new Set(result.regions.map(r=>r.sourceGroup))).toEqual(new Set([0,1]));
 for(const r of result.regions){const window=windows[r.sourceGroup!],points=pixelGeometry(r,reference);expect(points.every(p=>p.x>=window.x-1&&p.x<=window.x+window.width+1&&p.y>=-1&&p.y<=height+1)).toBe(true);}
 for(const bounds of reference.illustration!.partBounds){const window=windows[bounds.sourceGroup!];expect(bounds.bounds.minX).toBeGreaterThanOrEqual(window.x);expect(bounds.bounds.maxX).toBeLessThanOrEqual(window.x+window.width);}
 expect(projectSchema.parse({...project(),references:result.references,patternLibrary:result.regions}).patternLibrary).toEqual(result.regions);
});

it('registration sources and transforms isolate same-part pigments from another figure on the same sheet',()=>{
 const p=bodyProject(),sources=bodySources(p);expect(sources.every(Boolean)).toBe(true);expect(sources).toHaveLength(2);
 for(const source of sources){const group=placementSources(p,source);expect(group.length).toBeGreaterThan(0);expect(group.every(r=>r.sourceGroup===source.sourceGroup&&r.referenceId===source.referenceId)).toBe(true);const before=registrationFingerprint(p,source),placement=anatomicalPlacement(p,source),other=structuredClone(p);for(const r of other.patternLibrary!)if(r.sourceGroup!==source.sourceGroup)for(const node of r.piece.nodes)node.xMm+=1000;expect(registrationFingerprint(other,source)).toBe(before);expect(anatomicalPlacement(other,source)).toEqual(placement);}
 expect(registrationFingerprint(p,sources[0])).not.toBe(registrationFingerprint(p,sources[1]));
});

it('the connected neutral chest and both legs retain one complete source with separate placement contexts without altering pixels or contours when placement contexts are enabled',()=>{
 const front=classified.figures.find(figure=>figure.normalZ===1)!,source=classified.regions.find(region=>region.sourceGroup===front.sourceGroup&&region.indices.includes(340*width+835))!;expect(source).toBeDefined();
 const support=new Set(source.indices);for(const [x,y] of [[835,340],[795,565],[957,600]])for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++)expect(support.has((y+dy)*width+x+dx)).toBe(true);
 const contexts=source.contexts?.map(context=>context.part+':'+context.side)??[];expect(contexts).toContain('body:center');expect(contexts).toContain('leg:left');expect(contexts).toContain('leg:right');
 const actual=separate.find(row=>row.left>0)!.result,withoutContexts=(rows:typeof actual.regions)=>rows.map(({contexts,...region})=>region);expect(withoutContexts(actual.regions)).toEqual(withoutContexts(frontLegacy.regions));expect(actual.foregroundPixels).toBe(frontLegacy.foregroundPixels);expect(actual.palette).toEqual(frontLegacy.palette);
 const saved=extracted.regions.filter(region=>region.sourceGroup===front.sourceGroup&&region.anatomy?.contexts?.some(context=>context.part==='body')&&region.anatomy.contexts.some(context=>context.part==='leg'&&context.side==='left')&&region.anatomy.contexts.some(context=>context.part==='leg'&&context.side==='right'));expect(saved.length).toBeGreaterThan(0);
});

it('actual automatic placement uses each figure facing, remains unreviewed and becomes stale when its group is changed',async()=>{
 const p=bodyProject(),sources=bodySources(p),before=structuredClone(p),result=await automaticPlacement(worker,p,sources.map(r=>r.piece.id),['body']);expect(result.skipped).toEqual([]);expect(result.markings).toHaveLength(2);const placed={...p,markings:result.markings};expect([...staleMarkingIds(placed)]).toEqual([]);
 for(const marking of result.markings){const source=sources.find(r=>r.piece.id===marking.sourcePieceId)!;expect(marking.view).toBe(referenceProjection(p,source));expect(marking.placement!.reviewed).toBe(false);expect(placementMatchesModel(placed,marking)).toBe(true);const faces=new Map(p.surface!.faces.map(f=>[f.id,f])),vertices=new Map(p.surface!.vertices.map(v=>[v.id,v]));expect(marking.fragments.every(f=>faces.get(f.faceId)!.vertices.every(id=>vertices.get(id)!.zMm===(marking.view==='front'?1:-1)))).toBe(true);}
 const changed=structuredClone(placed),source=changed.patternLibrary!.find(r=>r.piece.id===result.markings[0].sourcePieceId)!;source.sourceGroup=source.sourceGroup===0?1:0;expect(staleMarkingIds(changed).has(result.markings[0].id)).toBe(true);expect(placementMatchesModel(changed,result.markings[0])).toBe(false);expect(p).toEqual(before);
},60000);

it('an unknown figure direction returns a reason without launching projection, changing state or choosing a side by image position',async()=>{
 const p=bodyProject();for(const figure of p.references![0].illustration!.figures!)delete figure.normalZ;const sources=bodySources(p),before=structuredClone(p);expect(sources.every(source=>referenceProjection(p,source)===undefined)).toBe(true);const result=await automaticPlacement(resolve('unknown-direction-must-not-launch-native.exe'),p,sources.map(r=>r.piece.id),['body']);expect(result.markings).toEqual([]);expect(result.skipped).toEqual(sources.map(source=>({pieceId:source.piece.id,name:source.piece.name,reason:'ANATOMY_POSITION_REQUIRED'})));expect(p).toEqual(before);
});
