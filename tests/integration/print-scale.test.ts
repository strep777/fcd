import {it,expect} from 'vitest';
import {resolve} from 'node:path';
import {mkdir,writeFile} from 'node:fs/promises';
import {PDFDocument,PDFArray,PDFDict,PDFName,PDFRawStream,decodePDFRawStream} from 'pdf-lib';
import {project,rectangle} from '../fixtures';
import {analyze} from '../../apps/desktop/main/worker';
import {svgExport,pdfExport,dxfExport} from '../../apps/desktop/main/export';
import {parseObj} from '../../apps/desktop/main/surface';
import {parseGlb,exportGlb} from '../../apps/desktop/main/glb';
import {parseSvg} from '../../apps/desktop/main/svg-import';
import {printHtml} from '../../apps/desktop/main/workflow-exchange';
import {printPlan,svgPrintPlan,printPageSvg,selectedPrintPages} from '../../packages/manufacturing/print-pages';
const worker=resolve('target/release/fpcad-worker.exe'),a4={widthMm:210,heightMm:297,marginMm:10,overlapMm:10},a3={...a4,widthMm:297,heightMm:420};
const extent=(points:{xMm:number;yMm:number}[])=>({width:Math.max(...points.map(p=>p.xMm))-Math.min(...points.map(p=>p.xMm)),height:Math.max(...points.map(p=>p.yMm))-Math.min(...points.map(p=>p.yMm))});
function content(pdf:PDFDocument,index:number){const contents=pdf.getPage(index).node.Contents(),streams=contents instanceof PDFArray?contents.asArray():[contents];return streams.map(ref=>{const stream=pdf.context.lookup(ref!);return stream instanceof PDFRawStream?new TextDecoder().decode(decodePDFRawStream(stream).decode()):'';}).join('\n');}
// Font subsets assign different glyph IDs when only some pages are exported.
// Compare their actual Unicode labels while keeping every drawing coordinate.
function decodedContent(pdf:PDFDocument,index:number){
 const fonts=pdf.getPage(index).node.Resources()!.lookup(PDFName.of('Font'),PDFDict),maps=new Map<string,Map<string,string>>();
 for(const [name,ref] of fonts.entries()){
  const font=pdf.context.lookup(ref,PDFDict),stream=pdf.context.lookup(font.get(PDFName.of('ToUnicode'))!);if(!(stream instanceof PDFRawStream))throw new Error('Missing font Unicode map');
  const map=new Map<string,string>(),cmap=new TextDecoder().decode(decodePDFRawStream(stream).decode());
  for(const block of cmap.matchAll(/beginbfchar([\s\S]*?)endbfchar/g))for(const pair of block[1].matchAll(/<([\da-f]+)>\s*<([\da-f]+)>/gi))map.set(pair[1].toUpperCase(),String.fromCharCode(...pair[2].match(/.{4}/g)!.map(unit=>parseInt(unit,16))));
  expect(map.size).toBeGreaterThan(0);maps.set(name.toString(),map);
 }
 let currentFont='';return content(pdf,index).replace(/(\/[^\s]+)\s+([-\d.eE]+)\s+Tf|<([\da-f]+)>\s+Tj/gi,(operator,font:string,size:string,encoded:string)=>{
  if(font){currentFont=font;return `/Font ${size} Tf`;}
  const map=maps.get(currentFont)!;expect(map).toBeDefined();const width=map.keys().next().value!.length;
  const glyphs=encoded.match(new RegExp(`.{${width}}`,'g'))!;return `${JSON.stringify(glyphs.map(glyph=>{const text=map.get(glyph.toUpperCase());expect(text).toBeDefined();return text;}).join(''))} Tj`;
 });
}
function lines(text:string){return [...text.matchAll(/([-\d.eE]+) ([-\d.eE]+) m\s+([-\d.eE]+) ([-\d.eE]+) l\s+S/g)].map(match=>{const prefix=text.slice(0,match.index),width=[...prefix.matchAll(/([-\d.eE]+) w/g)].at(-1);return {x1:Number(match[1])*25.4/72,y1:Number(match[2])*25.4/72,x2:Number(match[3])*25.4/72,y2:Number(match[4])*25.4/72,thickness:Number(width?.[1])*25.4/72};});}

it('OBJ cm, SVG cm and GLB metres converge to the same real mm geometry',async()=>{
 const obj='v 0 0 0\nv 35 0 0\nv 35 60 0\nv 0 60 0\nf 1 2 3\nf 1 3 4',surface=parseObj(obj,10);expect(extent(surface.vertices)).toEqual({width:350,height:600});
 const glb=await parseGlb(await exportGlb(surface));expect(extent(glb.vertices).width).toBeCloseTo(350,3);expect(extent(glb.vertices).height).toBeCloseTo(600,3);
 const svg=parseSvg('<svg width="35cm" height="60cm" viewBox="0 0 350 600"><rect width="350" height="600"/></svg>')[0];expect(extent(svg.nodes)).toEqual({width:350,height:600});
 const p=project();p.pieces=[{...svg,allowanceMm:0}];const g=await analyze(worker,p);expect(g[0].areaMm2).toBeCloseTo(210000,4);expect(g[0].perimeterMm).toBeCloseTo(1900,4);expect(dxfExport(p,g,[])).toContain('$INSUNITS\r\n70\r\n4');
});

it('350 x 600 mm spans six A4 pages with 10 mm overlaps and four A3 pages; small cuts fit one A4',async()=>{
 const p=project();p.pieces=[{...rectangle(350,600),allowanceMm:0}];const g=await analyze(worker,p),svg=svgExport(p,g,[]),plan=svgPrintPlan(svg,a4);
 expect(plan.columns).toBe(2);expect(plan.rows).toBe(3);expect(plan.pages).toHaveLength(6);expect(plan.stepXmm).toBe(180);expect(plan.stepYmm).toBe(267);
 expect(plan.contentWidthMm-plan.stepXmm).toBe(10);expect(plan.contentHeightMm-plan.stepYmm).toBe(10);expect(plan.pages[2]).toMatchObject({number:3,row:2,column:1,xMm:0,yMm:267});
 const bytes=await pdfExport(p,g,[],a4),pdf=await PDFDocument.load(bytes);expect(pdf.getPageCount()).toBe(6);
 for(let index=0;index<6;index++){const page=pdf.getPage(index);expect(page.getWidth()*25.4/72).toBeCloseTo(210,9);expect(page.getHeight()*25.4/72).toBeCloseTo(297,9);const ruler=lines(content(pdf,index)).find(l=>Math.abs(l.y1-292)<1e-8&&Math.abs(l.y2-292)<1e-8);expect(ruler).toBeDefined();expect(ruler!.x2-ruler!.x1).toBeCloseTo(100,9);const tile=printPageSvg(svg,plan,plan.pages[index]);expect(tile).toContain('width="210mm" height="297mm"');expect(tile).toContain(`viewBox="${plan.pages[index].xMm} ${plan.pages[index].yMm} 190 277"`);}
 expect(svgPrintPlan(svg,a3).pages).toHaveLength(4);expect((await PDFDocument.load(await pdfExport(p,g,[],a3))).getPageCount()).toBe(4);
 const small=project(),smallG=await analyze(worker,small);expect(svgPrintPlan(svgExport(small,smallG,[]),a4).pages).toHaveLength(1);expect((await PDFDocument.load(await pdfExport(small,smallG,[],a4))).getPageCount()).toBe(1);
 await mkdir('test-results',{recursive:true});await writeFile('test-results/350x600mm-A4-1to1.pdf',bytes);await writeFile('test-results/350x600mm-assembly.svg',svg);await writeFile('test-results/350x600mm-plan.json',JSON.stringify(plan,null,2));
});

it('independent PDF point measurements recover the 370 x 620 mm cut and 350 x 600 mm seam after assembly',async()=>{
 const p=project();p.pieces=[rectangle(350,600)];const g=await analyze(worker,p);expect(extent(g[0].cut)).toEqual({width:370,height:620});expect(extent(g[0].seam!)).toEqual({width:350,height:600});
 const plan=svgPrintPlan(svgExport(p,g,[]),a4),pdf=await PDFDocument.load(await pdfExport(p,g,[],a4)),recovered:{xMm:number;yMm:number;thickness:number}[]=[];
 for(let i=0;i<pdf.getPageCount();i++){const tile=plan.pages[i];for(const l of lines(content(pdf,i)).filter(l=>Math.hypot(l.x2-l.x1,l.y2-l.y1)>105))for(const [x,y] of [[l.x1,l.y1],[l.x2,l.y2]])recovered.push({xMm:x-10+tile.xMm,yMm:y-10+plan.heightMm-tile.yMm-277,thickness:l.thickness});}
 const cut=recovered.filter(p=>Math.abs(p.thickness-.25)<1e-8),seam=recovered.filter(p=>Math.abs(p.thickness-.18)<1e-8);
 expect(extent(cut).width).toBeCloseTo(370,8);expect(extent(cut).height).toBeCloseTo(620,8);expect(extent(seam).width).toBeCloseTo(350,8);expect(extent(seam).height).toBeCloseTo(600,8);
 expect(Math.min(...cut.map(p=>p.xMm))).toBeCloseTo(10,8);expect(Math.min(...seam.map(p=>p.xMm))).toBeCloseTo(20,8);expect(Math.min(...cut.map(p=>p.yMm))).toBeCloseTo(20,8);expect(Math.min(...seam.map(p=>p.yMm))).toBeCloseTo(30,8);
});

it('selected pages preserve original coordinates and numbering for reprinting assembly regions',async()=>{
 const p=project();p.pieces=[{...rectangle(350,600),allowanceMm:0}];const g=await analyze(worker,p),svg=svgExport(p,g,[]),all=await PDFDocument.load(await pdfExport(p,g,[],a4)),selected=await PDFDocument.load(await pdfExport(p,g,[],a4,false,[5,2]));
 expect(selected.getPageCount()).toBe(2);expect(decodedContent(selected,0)).toBe(decodedContent(all,1));expect(decodedContent(selected,1)).toBe(decodedContent(all,4));const html=printHtml(svg,a4,[2,5]);expect(html.match(/class="sheet"/g)).toHaveLength(2);expect(html).toContain('data-page="2"');expect(html).toContain('data-page="5"');expect(html).not.toContain('data-page="1"');
 for(const numbers of [[],[0],[7],[2,2]]){expect(()=>selectedPrintPages(svgPrintPlan(svg,a4),numbers)).toThrow('INVALID_SELECTION');await expect(pdfExport(p,g,[],a4,false,numbers)).rejects.toThrow('INVALID_SELECTION');expect(()=>printHtml(svg,a4,numbers)).toThrow('INVALID_SELECTION');}
});

it('long Unicode captions stay inside both print documents and paper/overlap resource errors are explicit',async()=>{
 const p=project();p.pieces[0].name='完整长标签'.repeat(24);const g=await analyze(worker,p),svg=svgExport(p,g,[]),plan=svgPrintPlan(svg,a4),pdf=await PDFDocument.load(await pdfExport(p,g,[],a4));expect(pdf.getPageCount()).toBe(plan.pages.length);
 const ys=[...svg.matchAll(/<text x="[^\"]+" y="([-\d.]+)"/g)].map(m=>Number(m[1]));expect(ys.every(y=>y>=0&&y<=plan.heightMm)).toBe(true);
 expect(()=>printPlan(350,600,{...a4,overlapMm:190})).toThrow('PAPER_TOO_SMALL');expect(()=>printPlan(350,600,{...a4,marginMm:5})).toThrow('PAPER_TOO_SMALL');expect(()=>printPlan(1e6,1e6,a4)).toThrow('RESOURCE_LIMIT');
});
