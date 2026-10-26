import {expect,it} from 'vitest';
import {randomUUID} from 'node:crypto';
import UPNG from '@pdf-lib/upng';
import {referenceSchema,regionSchema,requestSchema,type Reference,type Project} from '../../packages/schema/index';
import {referenceFromPng,wholeReferenceSheet,validateReference} from '../../apps/desktop/main/references';
import {splitReferences} from '../../apps/desktop/main/automatic-reference';
import {designMaterials} from '../../apps/desktop/main/design-materials';
import {companionRegions} from '../../packages/reference/cross-view';
import {Repository} from '../../apps/desktop/main/repository';
import {pack,unpack} from '../../apps/desktop/main/archive';
import {project,rectangle} from '../fixtures';

const codec=(UPNG as unknown as {default?:typeof UPNG}).default??UPNG;
type Region=NonNullable<Project['patternLibrary']>[number];
function image(width:number,height:number,pixel:(x:number,y:number)=>number[]){
 const rgba=new Uint8Array(width*height*4);for(let y=0;y<height;y++)for(let x=0;x<width;x++)rgba.set(pixel(x,y),(y*width+x)*4);
 return Buffer.from(codec.encode([rgba.buffer],width,height,0));
}
function decoded(reference:Reference){const png=codec.decode(Uint8Array.from(Buffer.from(reference.png.split(',')[1],'base64')).buffer);return {width:png.width,height:png.height,rgba:new Uint8Array(codec.toRGBA8(png)[0])};}
function region(reference:Reference,color='#efdd30'):Region{const piece=rectangle(20,30);piece.color=color;return {piece,referenceId:reference.id,view:reference.view,category:'body',anatomy:{part:'body',side:'center',confidence:1,method:'silhouette-1'}};}
function sheet(palette=['#f9e33c','#04a3f0']):Reference{
 const r=referenceFromPng(image(96,64,(x,y)=>x>=8&&x<88&&y>=8&&y<56?(x<48?[249,227,60,255]:[4,163,240,255]):[255,255,255,255]),'Complete sheet','sheet');
 r.calibration={a:{x:0,y:64},b:{x:0,y:0},distanceMm:128};r.calibrationMode='manual';
 r.illustration={algorithm:'illustration-2',subject:'head',bounds:{minX:8,minY:8,maxX:88,maxY:56},partBounds:[],foregroundPixels:80*48,discardedPixels:0,palette,smoothingPx:0};return r;
}

it('sheet and both legacy views remain readable in reference, region and project archives',()=>{
 for(const view of ['sheet','front','back'] as const){const r={...sheet(),view},source=region(r),p={...project(),references:[r],patternLibrary:[source]};expect(referenceSchema.parse(r)).toEqual(r);expect(regionSchema.parse(source)).toEqual(source);expect(unpack(pack(p).bytes)).toEqual(p);}
 const request=requestSchema.parse({protocolVersion:1,requestId:randomUUID(),projectId:randomUUID(),expectedRevision:0,method:'reference.auto',payload:{heightMm:128,clusters:6,excludeBackground:true}});expect(request.method==='reference.auto'&&request.payload.layout).toBe('sheet');
});

it('single-sheet extraction retains the entire original image, calibration and colors across its midpoint',()=>{
 const input=sheet(),before=structuredClone(input),output=splitReferences([input],128,6,true,'simple','head');
 expect(output.references).toHaveLength(1);expect(output.references[0]).toMatchObject({id:input.id,view:'sheet',width:96,height:64,png:input.png,calibration:input.calibration,calibrationMode:'manual'});
 expect(output.regions.length).toBeGreaterThan(0);expect(output.regions.every(r=>r.view==='sheet'&&r.referenceId===input.id)).toBe(true);
 expect(output.references[0].illustration!.bounds.minX).toBeLessThan(48);expect(output.references[0].illustration!.bounds.maxX).toBeGreaterThan(48);
 expect(output.regions.some(r=>r.piece.color==='#04a3f0')).toBe(true);expect(output.regions.some(r=>r.piece.color==='#f9e33c')).toBe(true);
 expect(input).toEqual(before);validateReference(output.references[0]);
});

it('same-sheet companions exclude the selected piece but include another matching region from the same image',()=>{
 const r=sheet(),base=region(r),close=region(r,'#edda38'),different=region(r,'#0011dd'),before=structuredClone([base,close,different]);
 expect(companionRegions(base,[base,close,different])).toEqual([close]);expect([base,close,different]).toEqual(before);
});

it.each([
 {name:'one white',palette:['#ede7ea','#04a3f0'],expected:'#ede7ea'},
 {name:'duplicate identical white',palette:['#ede7ea','#ede7ea','#04a3f0'],expected:'#ede7ea'},
 {name:'no white',palette:['#04a3f0','#f9e33c'],expected:'#eceae5'},
 {name:'ambiguous whites',palette:['#ede7ea','#cccccc','#04a3f0'],expected:'#eceae5'},
 {name:'dark neutral',palette:['#777777','#04a3f0'],expected:'#eceae5'},
])('single sheet $name chooses only an unambiguous bright neutral base material',({palette,expected})=>{
 const p={...project(),references:[sheet(palette)]},before=structuredClone(p);expect(designMaterials(p).baseColor).toBe(expected);expect(p).toEqual(before);
});

it('replacing legacy front/back with a sheet is one undoable transaction and survives archive roundtrip',()=>{
 const front={...sheet(),view:'front' as const},back={...sheet(),view:'back' as const},p={...project(),references:[front,back],patternLibrary:[region(front),region(back)]},next=sheet(),nextRegion=region(next),repo=new Repository(':memory:');
 try{repo.open(p,null);repo.commit({type:'library.regions',references:[next],regions:[nextRegion],replaceViews:['sheet','front','back']},randomUUID(),'replace complete sheet');const committed=repo.snapshot()!;expect(committed.references).toEqual([next]);expect(committed.patternLibrary).toEqual([nextRegion]);expect(unpack(pack(committed).bytes)).toEqual(committed);repo.historyMove(false);expect(repo.snapshot()!.references).toEqual(p.references);expect(repo.snapshot()!.patternLibrary).toEqual(p.patternLibrary);repo.historyMove(true);expect(repo.snapshot()!.references).toEqual([next]);expect(repo.snapshot()!.patternLibrary).toEqual([nextRegion]);}finally{repo.close();}
});

it('legacy crops sharing a saved original recover every original pixel and translate manual calibration back to sheet coordinates',()=>{
 const png=image(11,7,(x,y)=>[x*17,y*29,(x+y)*11,255]),sheetId=randomUUID(),uri='data:image/png;base64,'+png.toString('base64');
 const crop=(x:number,width:number,view:'front'|'back')=>({...referenceFromPng(image(width,7,(a,b)=>[(a+x)*17,b*29,(a+x+b)*11,255]),'Original / '+(view==='front'?'正面':'背面'),view),sheet:{id:sheetId,width:11,height:7,x,y:0,png:uri}});
 const front=crop(5,6,'front'),back=crop(0,5,'back');front.calibration={a:{x:1,y:6},b:{x:1,y:1},distanceMm:50};front.calibrationMode='manual';
 const inputs=[front,back],before=structuredClone(inputs),result=wholeReferenceSheet(inputs),actual=decoded(result),original=decoded(referenceFromPng(png,'original','sheet'));
 expect(result.view).toBe('sheet');expect(actual).toEqual(original);expect(result.calibration).toEqual({a:{x:6,y:6},b:{x:6,y:1},distanceMm:50});expect(result.calibrationMode).toBe('manual');expect(inputs).toEqual(before);validateReference(result);
});

it('different legacy source images concatenate all pixels at native resolution and pad only the shorter image transparently',()=>{
 const left=referenceFromPng(image(5,7,(x,y)=>[10+x,20+y,30,255]),'First image','front'),right=referenceFromPng(image(6,4,(x,y)=>[100+x,120+y,140,255]),'Second image','back');left.calibration={a:{x:2,y:6},b:{x:2,y:1},distanceMm:50};left.calibrationMode='manual';
 const inputs=[left,right],before=structuredClone(inputs),result=wholeReferenceSheet(inputs),actual=decoded(result);
 expect(result).toMatchObject({view:'sheet',width:11,height:7,calibration:left.calibration,calibrationMode:'manual'});
 for(let y=0;y<7;y++)for(let x=0;x<11;x++)expect([...actual.rgba.slice((y*11+x)*4,(y*11+x+1)*4)]).toEqual(x<5?[10+x,20+y,30,255]:y<4?[100+x-5,120+y,140,255]:[0,0,0,0]);
 expect(inputs).toEqual(before);validateReference(result);
});

it('a single full reference changes to sheet without replacing its ID, calibration or image resources',()=>{
 const input={...sheet(),view:'front' as const},before=structuredClone(input);expect(wholeReferenceSheet([input])).toEqual({...before,view:'sheet'});expect(input).toEqual(before);expect(()=>wholeReferenceSheet([])).toThrow('REFERENCE_REQUIRED');
});

it.each(['manual','legacy-no-mode'] as const)('restoring a common original preserves %s calibration from the crop that does not carry the original PNG',mode=>{
 const png=image(11,9,(x,y)=>[x*17,y*23,(x+y)*10,255]),sheetId=randomUUID(),carrier=referenceFromPng(image(5,9,(x,y)=>[x*17,y*23,(x+y)*10,255]),'Original / 正面','front'),other=referenceFromPng(image(6,7,(x,y)=>[(x+5)*17,(y+2)*23,(x+y+7)*10,255]),'Original / 背面','back');
 carrier.sheet={id:sheetId,width:11,height:9,x:0,y:0,png:'data:image/png;base64,'+png.toString('base64')};carrier.calibration={a:{x:2.5,y:9},b:{x:2.5,y:0},distanceMm:90};carrier.calibrationMode='automatic';
 other.sheet={id:sheetId,width:11,height:9,x:5,y:2};other.calibration={a:{x:1,y:6},b:{x:2,y:1},distanceMm:73};if(mode==='manual')other.calibrationMode='manual';
 const inputs=[carrier,other],before=structuredClone(inputs),result=wholeReferenceSheet(inputs);expect(result.calibration).toEqual({a:{x:6,y:8},b:{x:7,y:3},distanceMm:73});expect(result.calibrationMode).toBe('manual');expect(decoded(result)).toEqual(decoded(referenceFromPng(png,'Full original','sheet')));expect(inputs).toEqual(before);validateReference(result);
});

it.each(['manual','legacy-no-mode'] as const)('joining unrelated images retains a unique second-image %s calibration at its concatenated offset',mode=>{
 const first=referenceFromPng(image(5,9,()=>[80,110,140,255]),'First standalone','front'),second=referenceFromPng(image(6,7,()=>[120,60,30,255]),'Second standalone','back');first.calibration={a:{x:2.5,y:9},b:{x:2.5,y:0},distanceMm:90};first.calibrationMode='automatic';second.calibration={a:{x:1,y:6},b:{x:2,y:1},distanceMm:73};if(mode==='manual')second.calibrationMode='manual';
 const inputs=[first,second],before=structuredClone(inputs),result=wholeReferenceSheet(inputs);expect(result).toMatchObject({view:'sheet',width:11,height:9,calibration:{a:{x:6,y:6},b:{x:7,y:1},distanceMm:73},calibrationMode:'manual'});expect(inputs).toEqual(before);validateReference(result);
});
