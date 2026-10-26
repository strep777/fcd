import {it,expect} from 'vitest';
import {resolve} from 'node:path';
import {readFile} from 'node:fs/promises';
import fontkit from '@pdf-lib/fontkit';
import {PDFDocument,PDFArray,PDFDict,PDFName,PDFRawStream,decodePDFRawStream} from 'pdf-lib';
import {project,rectangle} from '../fixtures';
import {analyze} from '../../apps/desktop/main/worker';
import {pdfExport} from '../../apps/desktop/main/export';

it('every actually drawn PDF character has its complete source-font outline in the embedded font',async()=>{
 const p=project();p.pieces=[{...rectangle(120,150),name:'100 mm · 按实际尺寸打印 / Actual size | 毛向 布向 WMWM 0123456789 office affine fi fl café naïve cafe\u0301 前脚ふわふわ',grainRad:0}];
 const geometry=await analyze(resolve('target/release/fpcad-worker.exe'),p),pdf=await PDFDocument.load(await pdfExport(p,geometry,[])),source=fontkit.create(await readFile('assets/fonts/FurryPatternSansSC-Regular.ttf'));
 const fontCache=new Map<PDFRawStream,ReturnType<typeof fontkit.create>>(),checked=new Set<string>();
 for(const page of pdf.getPages()){
  const resources=page.node.Resources()!.lookup(PDFName.of('Font'),PDFDict),fonts=new Map<string,{font:ReturnType<typeof fontkit.create>;unicode:Map<number,string>}>();
  for(const [name,ref] of resources.entries()){
   const dict=pdf.context.lookup(ref,PDFDict),descendant=pdf.context.lookup(dict.lookup(PDFName.of('DescendantFonts'),PDFArray).get(0),PDFDict);
   expect(descendant.get(PDFName.of('CIDToGIDMap'))?.toString()).toBe('/Identity');
   const descriptor=pdf.context.lookup(descendant.get(PDFName.of('FontDescriptor'))!,PDFDict),stream=pdf.context.lookup(descriptor.get(PDFName.of('FontFile2'))!);
   expect(stream).toBeInstanceOf(PDFRawStream);let font=fontCache.get(stream as PDFRawStream);if(!font){font=fontkit.create(decodePDFRawStream(stream as PDFRawStream).decode());fontCache.set(stream as PDFRawStream,font);}
   const cmap=pdf.context.lookup(dict.get(PDFName.of('ToUnicode'))!);expect(cmap).toBeInstanceOf(PDFRawStream);const unicode=new Map<number,string>(),mapping=new TextDecoder().decode(decodePDFRawStream(cmap as PDFRawStream).decode());
   for(const block of mapping.matchAll(/beginbfchar([\s\S]*?)endbfchar/g))for(const pair of block[1].matchAll(/<([\da-f]+)>\s*<([\da-f]+)>/gi))unicode.set(parseInt(pair[1],16),String.fromCharCode(...pair[2].match(/.{4}/g)!.map(u=>parseInt(u,16))));
   fonts.set(name.toString(),{font,unicode});
  }
  const contents=page.node.Contents(),references=contents instanceof PDFArray?contents.asArray():[contents],operators=references.map(ref=>{const stream=pdf.context.lookup(ref!);return stream instanceof PDFRawStream?new TextDecoder().decode(decodePDFRawStream(stream).decode()):'';}).join('\n');
  for(const block of operators.matchAll(/BT([\s\S]*?)ET/g)){
   const fontName=block[1].match(/(\/[^\s]+)\s+[-\d.eE]+\s+Tf/)?.[1];if(!fontName)continue;const embedded=fonts.get(fontName)!;expect(embedded).toBeDefined();
   for(const text of block[1].matchAll(/<([\da-f]+)>\s*Tj/gi))for(const encoded of text[1].match(/.{4}/g)??[]){
    const cid=parseInt(encoded,16),unicode=embedded.unicode.get(cid);expect(unicode,`missing Unicode for CID ${cid}`).toBeDefined();
    const key=fontName+':'+cid;if(checked.has(key))continue;checked.add(key);
    const original=source.layout(unicode!).glyphs;expect(original).toHaveLength(1);
    // Valid ToUnicode and a successful text extraction do not prove that the
    // actual embedded glyph draws. The broken subset had both intact, but
    // empty or truncated glyf records for digits, Latin and Chinese letters.
    const actual=embedded.font.getGlyph(cid),expected=original[0];
    expect(actual.path.toSVG(),`embedded outline for ${JSON.stringify(unicode)} CID ${cid}`).toBe(expected.path.toSVG());
    expect(actual.advanceWidth).toBe(expected.advanceWidth);
   }
  }
 }
 expect(checked.size).toBeGreaterThan(50);expect(fontCache.size).toBeGreaterThan(0);
});
