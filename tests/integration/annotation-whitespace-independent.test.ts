import {beforeAll,expect,it,vi} from 'vitest';
import {resolve} from 'node:path';
import {createSSRApp,defineComponent,h,provide,ref} from 'vue';
import {createPinia} from 'pinia';
import {renderToString} from 'vue/server-renderer';
import {Resvg,initWasm} from '@resvg/resvg-wasm';
import fontkit from '@pdf-lib/fontkit';
import {unzipSync,strFromU8} from 'fflate';
import {PDFDocument,PDFArray,PDFDict,PDFName,PDFRawStream,decodePDFRawStream} from 'pdf-lib';
import PatternDirection from '../../apps/desktop/src/PatternDirection.vue';
import PatternCanvas from '../../apps/desktop/src/PatternCanvas.vue';
import {usePatternEditor} from '../../apps/desktop/src/modules/usePatternEditor';
import {patternEditorKey} from '../../apps/desktop/src/modules/patternEditorContext';
import {useSession} from '../../apps/desktop/src/store';
import {patternAnnotationLayout} from '../../packages/pattern/annotation-layout';
import {layout,svgExport,pdfExport} from '../../apps/desktop/main/export';
import {cutBundle} from '../../apps/desktop/main/workflow-exchange';
import {exportFont,exportWasm} from '../../apps/desktop/main/export-assets';
import {analyze} from '../../apps/desktop/main/worker';
import {project,rectangle} from '../fixtures';
import {stubAnimationFrames} from '../animation-frames';

beforeAll(async()=>{await initWasm(await exportWasm());});
function renderedTextWidth(node:string,bytes:Uint8Array,size:number){
 const renderer=new Resvg(`<svg xmlns="http://www.w3.org/2000/svg" width="10000" height="10000"><g font-family="FurryPattern Sans SC" font-kerning="none" font-feature-settings="'locl' 0, 'liga' 0">${node.replace(/\s(data-v-[\w-]+)(?=[\s>])/g,' $1=""').replace(/ x="[^"]*"/,' x="5000"').replace(/ y="[^"]*"/,' y="5000"').replace(/ font-size="[^"]*"/,` font-size="${size*100}"`).replaceAll('var(--ink)','black').replaceAll('var(--studio-white)','none')}</g></svg>`,{font:{fontBuffers:[bytes]}});
 try{const box=renderer.innerBBox();try{return (box?.width??0)/100;}finally{box?.free();}}finally{renderer.free();}
}

it('renders consecutive spaces in a piece name at the same natural width in the preview, standalone SVG, bundled SVG and PDF',async()=>{
 const p=project();p.pieces=[{...rectangle(100,140),name:'A  B'}];
 const geometry=await analyze(resolve('target/release/fpcad-worker.exe'),p),bytes=await exportFont(),font=fontkit.create(bytes);
 const annotation=patternAnnotationLayout(p.pieces[0]),placed=layout(p,geometry)[0],files=unzipSync(cutBundle(p,geometry));
 const preview=await renderToString(createSSRApp({render:()=>h(PatternDirection,{layout:annotation,language:'en'})}));
 const exports=[preview,svgExport(p,geometry,[]),strFromU8(files[`pieces/${p.pieces[0].id}.svg`])];
 for(const [i,svg] of exports.entries()){
  const text=[...svg.matchAll(/<text\b[^>]*>A  B<\/text>/g)].map(match=>match[0]);expect(text,`output ${i} retains the complete name`).toHaveLength(1);
  const size=(i===0?annotation:placed.annotation).caption.find(line=>line.text===p.pieces[0].name)!.fontSizeMm;
  const run=font.layout(p.pieces[0].name,{kern:false,locl:false,liga:false}),first=run.glyphs[0],last=run.glyphs.at(-1)!,advance=run.positions.slice(0,-1).reduce((sum,position)=>sum+position.xAdvance,0);
  const expected=(advance+last.bbox.maxX-first.bbox.minX)/font.unitsPerEm*size;
  // Rendered bounds reflect the visible space between the glyphs. Merely
  // retaining two spaces in the XML would still collapse them without the fix.
  // The renderer rounds visible bounds to whole pixels; 100x measurement
  // limits that rounding to 0.02 of the original physical text units.
  expect(Math.abs(renderedTextWidth(text[0],bytes,size)-expected),`output ${i} renders both spaces`).toBeLessThan(.02);
  expect(Math.abs(renderedTextWidth(text[0].replace(/ xml:space="preserve"/g,''),bytes,size)-(expected-224/font.unitsPerEm*size)),`output ${i} exercises the collapse regression`).toBeLessThan(.02);
 }
 // Read the PDF's own Unicode map rather than assuming its text encoder kept
 // the spaces. The existing annotation suite verifies its physical text size.
 const pdf=await PDFDocument.load(await pdfExport(p,geometry,[])),page=pdf.getPage(0),fonts=page.node.Resources()!.lookup(PDFName.of('Font'),PDFDict),map=new Map<string,string>();
 for(const [,ref] of fonts.entries()){
  const dict=pdf.context.lookup(ref,PDFDict),stream=pdf.context.lookup(dict.get(PDFName.of('ToUnicode'))!) as PDFRawStream,cmap=new TextDecoder().decode(decodePDFRawStream(stream).decode());
  for(const block of cmap.matchAll(/beginbfchar([\s\S]*?)endbfchar/g))for(const pair of block[1].matchAll(/<([\da-f]+)>\s*<([\da-f]+)>/gi))map.set(pair[1].toUpperCase(),String.fromCharCode(...pair[2].match(/.{4}/g)!.map(value=>parseInt(value,16))));
 }
 const contents=page.node.Contents(),refs=contents instanceof PDFArray?contents.asArray():[contents],operators=refs.map(ref=>{const stream=pdf.context.lookup(ref!);return stream instanceof PDFRawStream?new TextDecoder().decode(decodePDFRawStream(stream).decode()):'';}).join('\n');
 const width=map.keys().next().value!.length,text=[...operators.matchAll(/<([\da-f]+)>\s*Tj/gi)].map(match=>match[1].match(new RegExp(`.{${width}}`,'g'))!.map(glyph=>map.get(glyph.toUpperCase())).join(''));
 expect(text).toContain(p.pieces[0].name);
},60000);

it('renders manual labels in the bundled font with consecutive spaces while preserving their existing 4 mm preview size',async()=>{
 const p=project(),label={id:crypto.randomUUID(),xMm:20,yMm:40,text:'A  B'};p.pieces=[{...rectangle(100,140),name:'Manual label fixture',labels:[label]}];
 const before=structuredClone(p),geometry=await analyze(resolve('target/release/fpcad-worker.exe'),p),bytes=await exportFont(),font=fontkit.create(bytes),run=font.layout(label.text,{kern:false,locl:false,liga:false}),first=run.glyphs[0],last=run.glyphs.at(-1)!,advance=run.positions.slice(0,-1).reduce((sum,position)=>sum+position.xAdvance,0),expected=(advance+last.bbox.maxX-first.bbox.minX)/font.unitsPerEm*4;
 stubAnimationFrames();try{
  for(const language of ['zh','en'] as const){
   const pinia=createPinia(),store=useSession(pinia);store.data.project=structuredClone(p);store.data.geometry=geometry;
   const app=createSSRApp(defineComponent({setup(){provide(patternEditorKey,usePatternEditor(ref(language),ref('pattern'),()=>{}));provide('advancedMode',ref(false));return()=>h(PatternCanvas);}}));app.use(pinia);
   const html=await renderToString(app),text=[...html.matchAll(/<text\b[^>]*>A  B<\/text>/g)].map(match=>match[0]);expect(text).toHaveLength(1);
   expect(text[0]).toContain('font-family="FurryPattern Sans SC"');expect(text[0]).toContain('font-size="4"');expect(text[0]).toContain('x="20"');expect(text[0]).toContain('y="-40"');
   expect(Math.abs(renderedTextWidth(text[0],bytes,4)-expected)).toBeLessThan(.02);
   expect(renderedTextWidth(text[0].replace(/ xml:space="preserve"/g,''),bytes,4)).toBeLessThan(expected-.5);
   expect(store.data.project).toEqual(before);
  }
 }finally{vi.unstubAllGlobals();}
 expect(p).toEqual(before);
},60000);
