import {randomUUID} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {expect,it} from 'vitest';
import {PDFArray,PDFDocument,PDFRawStream,decodePDFRawStream} from 'pdf-lib';
import {analyze} from '../../apps/desktop/main/worker';
import {svgExport,dxfExport,pdfExport,layout} from '../../apps/desktop/main/export';
import {printHtml} from '../../apps/desktop/main/workflow-exchange';
import {project} from '../fixtures';

const worker=resolve('target/release/fpcad-worker.exe');
const fixture=JSON.parse(readFileSync(new URL('../fixtures/allowance-created-hole-analytic.json',import.meta.url),'utf8')) as {outer:number[][];allowanceMm:number;collapsedHole:number[][];survivingHole:number[][]};
const points=(rows:number[][])=>rows.map(([xMm,yMm])=>({id:randomUUID(),xMm,yMm}));
function bay(){
 const p=project(),piece=p.pieces[0];piece.name='Analytic bay';piece.join='miter';piece.allowanceMm=fixture.allowanceMm;
 // The independent shared fixture has a 40 mm chamber and a 10 mm entrance.
 // A 10 mm outward allowance leaves a 20 x 20 mm cut hole after closing it.
 piece.nodes=points(fixture.outer);return p;
}
const group=(svg:string,name:string)=>svg.match(new RegExp(`<g id="${name}"[^>]*>([\\s\\S]*?)</g>`))![1];
const count=(text:string,token:RegExp)=>[...text.matchAll(token)].length;

it('an outer-bay allowance hole reaches layout, SVG, DXF, print HTML and the actual PDF cut strokes at 1:1',async()=>{
 const p=bay(),before=structuredClone(p),geometry=await analyze(worker,p),g=geometry[0];
 expect(g.issues.filter(i=>i.severity==='error')).toEqual([]);expect(p.pieces[0].holes??[]).toHaveLength(0);expect(g.cutHoles).toHaveLength(1);
 const hole=g.cutHoles![0],width=Math.max(...hole.map(v=>v.xMm))-Math.min(...hole.map(v=>v.xMm)),height=Math.max(...hole.map(v=>v.yMm))-Math.min(...hole.map(v=>v.yMm));expect(width).toBeCloseTo(20,9);expect(height).toBeCloseTo(20,9);
 const placed=layout(p,geometry);expect(placed).toHaveLength(1);expect(placed[0].cutHoles).toHaveLength(1);expect(placed[0].seamHoles).toHaveLength(0);
 const svg=svgExport(p,geometry,[]);expect(count(group(svg,'Cut'),/\bM/g)).toBe(2);expect(count(group(svg,'Cut'),/\bZ/g)).toBe(2);expect(count(group(svg,'Seam'),/\bM/g)).toBe(1);expect(svg).toContain('fill-rule="evenodd"');
 const dxf=dxfExport(p,geometry,[]),entities=dxf.split('0\r\nLWPOLYLINE\r\n').slice(1);expect(entities.filter(e=>e.includes('8\r\nCUT\r\n'))).toHaveLength(2);expect(entities.filter(e=>e.includes('8\r\nSEAM\r\n'))).toHaveLength(1);
 const html=printHtml(svg,{widthMm:210,heightMm:297,marginMm:10,overlapMm:10});expect(html).toContain('calibration-100mm');expect(count(group(html,'Cut'),/\bM/g)).toBe(2);
 const pdf=await PDFDocument.load(await pdfExport(p,geometry,[]));expect(pdf.getPageCount()).toBe(1);expect(pdf.getPage(0).getWidth()*25.4/72).toBeCloseTo(210,9);
 const contents=pdf.getPage(0).node.Contents(),refs=contents instanceof PDFArray?contents.asArray():[contents],text=refs.map(ref=>{const stream=pdf.context.lookup(ref!);return stream instanceof PDFRawStream?new TextDecoder().decode(decodePDFRawStream(stream).decode()):'';}).join('\n');
 const holeEdges=[...text.matchAll(/([-\d.eE]+) ([-\d.eE]+) m\s+([-\d.eE]+) ([-\d.eE]+) l\s+S/g)].filter(m=>{const length=Math.hypot(Number(m[3])-Number(m[1]),Number(m[4])-Number(m[2]))*25.4/72;return Math.abs(length-20)<1e-8;});
 expect(holeEdges,'All four 20 mm cut-hole edges must be drawn in the PDF').toHaveLength(4);expect(p).toEqual(before);
});

it('a retained real source hole and a newly closed bay export as distinct cut loops with only the real source hole on the seam layer',async()=>{
 const p=bay();p.pieces[0].holes=[points(fixture.survivingHole)];const geometry=await analyze(worker,p),g=geometry[0];expect(g.issues.filter(i=>i.severity==='error')).toEqual([]);expect(g.cutHoles).toHaveLength(2);
 const svg=svgExport(p,geometry,[]);expect(count(group(svg,'Cut'),/\bM/g)).toBe(3);expect(count(group(svg,'Seam'),/\bM/g)).toBe(2);
 const entities=dxfExport(p,geometry,[]).split('0\r\nLWPOLYLINE\r\n').slice(1);expect(entities.filter(e=>e.includes('8\r\nCUT\r\n'))).toHaveLength(3);expect(entities.filter(e=>e.includes('8\r\nSEAM\r\n'))).toHaveLength(2);
 const placed=layout(p,geometry);expect(placed[0].cutHoles).toHaveLength(2);expect(placed[0].seamHoles).toHaveLength(1);expect((await PDFDocument.load(await pdfExport(p,geometry,[]))).getPageCount()).toBe(1);
});

it('a vanished real source hole still blocks every manufacturing output even if an unrelated bay creates a new cut hole',async()=>{
 const p=bay();p.pieces[0].holes=[points(fixture.collapsedHole)];const before=structuredClone(p),geometry=await analyze(worker,p);
 expect(geometry[0].issues.some(i=>i.severity==='error'&&i.messageKey==='holeCollapsed')).toBe(true);
 expect(()=>svgExport(p,geometry,[])).toThrow('INVALID_GEOMETRY');expect(()=>dxfExport(p,geometry,[])).toThrow('INVALID_GEOMETRY');await expect(pdfExport(p,geometry,[])).rejects.toThrow('INVALID_GEOMETRY');expect(p).toEqual(before);
});
