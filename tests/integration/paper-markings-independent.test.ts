import {expect,it,vi} from 'vitest';
import {createPinia,setActivePinia} from 'pinia';
import {createSSRApp,defineComponent,h,provide,ref} from 'vue';
import {renderToString} from 'vue/server-renderer';
import PatternCanvas from '../../apps/desktop/src/PatternCanvas.vue';
import {usePatternEditor} from '../../apps/desktop/src/modules/usePatternEditor';
import {patternEditorKey} from '../../apps/desktop/src/modules/patternEditorContext';
import {useSession} from '../../apps/desktop/src/store';
import {stubAnimationFrames} from '../animation-frames';
import {resolve} from 'node:path';
import {paperMarkings} from '../../packages/manufacturing/paper-markings';
import {cutPreview} from '../../apps/desktop/main/cut-preview';
import {analyze} from '../../apps/desktop/main/worker';
import {layout,svgExport,dxfExport,pdfExport} from '../../apps/desktop/main/export';
import {PDFDocument,PDFArray,PDFRawStream,decodePDFRawStream} from 'pdf-lib';
import {bindingIssues} from '../../apps/desktop/main/surface';
import {materialIssues} from '../../packages/manufacturing/material';
import {projectMarking} from '../../apps/desktop/main/markings';
import {projectSchema} from '../../packages/schema/index';
import {box,detailPlane,detailWorker} from '../fixtures/detail-fabrication';

async function pdfOperators(bytes:Uint8Array){const pdf=await PDFDocument.load(bytes);return pdf.getPages().map(page=>{const contents=page.node.Contents(),refs=contents instanceof PDFArray?contents.asArray():[contents];return refs.map(ref=>{const stream=pdf.context.lookup(ref!);return stream instanceof PDFRawStream?new TextDecoder().decode(decodePDFRawStream(stream).decode()):'';}).join('\n');}).join('\n');}

async function resolved(){
 const {p}=await detailPlane({detailRole:'detail'}),before=structuredClone(p);
 const candidate=await cutPreview(detailWorker,p.surface!,p,{partitionStrategy:'design',automaticCuts:true,colorBoundaryCuts:true,method:'arap'},resolve('dist/assets'));
 expect(p).toEqual(before);
 const ready={...p,pieces:candidate.run.pieces,bindings:candidate.run.bindings,markings:candidate.markings};
 const geometry=await analyze(detailWorker,ready),ack=[...geometry.flatMap(g=>g.issues),...bindingIssues(ready),...materialIssues(ready)].map(i=>i.ruleId);
 expect(ready.pieces).toHaveLength(1);expect(ready.bindings.every(b=>b.trim&&b.colorHash&&b.materialResolved===true)).toBe(true);
 expect(geometry.flatMap(g=>g.issues.filter(i=>i.severity==='error'))).toEqual([]);
 return {ready,geometry,ack};
}

it('resolved cloth suppresses sewn provenance fills while actual detail fill, shape and source data survive',async()=>{
 const {ready,geometry,ack}=await resolved(),before=structuredClone(ready),piece=ready.pieces[0],detail=ready.markings.find(m=>m.fabrication==='detail')!;
 expect(ready.markings.some(m=>m.fabrication!=='detail'&&m.paths.some(p=>p.pieceId===piece.id))).toBe(true);
 expect(paperMarkings(ready,piece.id).map(m=>m.id)).toEqual([detail.id]);
 {
  const placed=layout(ready,geometry)[0];expect(placed.markings.map(m=>m.name)).toEqual([detail.name]);
  const svg=svgExport(ready,geometry,ack),group=svg.match(/<g id="Marking"[^>]*>([\s\S]*?)<\/g>/)!;
  expect(group[0]).toContain('stroke="none"');expect(group[1].match(/<path /g)).toHaveLength(detail.paths.length);
  expect(group[1]).toContain(`<title>${detail.name}</title>`);expect(group[1]).toContain(`fill="${detail.color}"`);
  expect(svg).toContain(`fill="${piece.color}"`);expect(svg).toContain('id="Cut"');expect(svg).toContain('id="Seam"');
  const dxf=dxfExport(ready,geometry,ack),expected=detail.paths.flatMap(p=>p.rings).length;
  expect((dxf.match(/\r\nMARKING\r\n/g)??[]).length-1).toBe(expected); // subtract layer declaration
 }
 const withDetail=await pdfOperators(await pdfExport(ready,geometry,ack)),withoutDetail=await pdfOperators(await pdfExport({...ready,markings:ready.markings.map(m=>m.fabrication==='detail'?{...m,paths:[]}:m)},geometry,ack));
 // A printed detail adds fill ink, never line segments presented as sewing paths.
 expect((withDetail.match(/\bl\s+S\b/g)??[]).length).toBe((withoutDetail.match(/\bl\s+S\b/g)??[]).length);
 expect(withDetail.length).toBeGreaterThan(withoutDetail.length);expect(ready).toEqual(before);
},60000);

it('unbound, unsplit, unresolved and legacy panels retain every mapped material and applied detail',async()=>{
 const {ready,geometry}=await resolved(),piece=ready.pieces[0],expected=ready.markings.filter(m=>m.paths.some(p=>p.pieceId===piece.id)).map(m=>m.id);
 for(const mode of ['unbound','unsplit','unresolved trim','unresolved material','legacy material resolution'] as const){
  const p=structuredClone(ready);if(mode==='unbound')p.bindings=[];else if(mode==='unsplit')delete p.bindings[0].trim;else if(mode==='unresolved trim')delete p.bindings[0].colorHash;else if(mode==='unresolved material')p.bindings[0].materialResolved=false;else delete p.bindings[0].materialResolved;
  const before=structuredClone(p);expect(paperMarkings(p,piece.id).map(m=>m.id),mode).toEqual(expected);
  expect(layout(p,geometry)[0].markings.map(m=>m.name),mode).toEqual(p.markings.map(m=>m.name));
  const restored=projectSchema.parse(p);expect(paperMarkings(restored,piece.id).map(m=>m.id),mode+' after contract round trip').toEqual(expected);
  expect(paperMarkings(p,'missing-piece')).toEqual([]);expect(p).toEqual(before);
 }
},60000);

it('real design cuts without color-boundary splitting retain multiple cloth colors and printed details in paper previews and exports',async()=>{
 const {p,referenceId}=await detailPlane({detailRole:'detail'}),patch=box(10,10,25,35,'Secondary cloth','#f15a35');
 p.patternLibrary!.push({piece:patch,referenceId,view:'front',category:'body'});p.markings!.push(await projectMarking(detailWorker,p,patch.id,'front',0,0));
 const sourceBefore=structuredClone(p),candidate=await cutPreview(detailWorker,p.surface!,p,{partitionStrategy:'design',automaticCuts:true,colorBoundaryCuts:false,method:'arap'},resolve('dist/assets'));
 expect(p).toEqual(sourceBefore);expect(candidate.run.materialPalette).toBeUndefined();
 const ready={...p,pieces:candidate.run.pieces,bindings:candidate.run.bindings,markings:candidate.markings},before=structuredClone(ready),piece=ready.pieces[0];
 expect(ready.pieces).toHaveLength(1);expect(ready.bindings.every(b=>b.trim&&b.colorHash&&b.materialResolved===false)).toBe(true);
 const geometry=await analyze(detailWorker,ready),ack=[...geometry.flatMap(g=>g.issues),...bindingIssues(ready),...materialIssues(ready)].map(i=>i.ruleId),expected=ready.markings.filter(m=>m.paths.some(path=>path.pieceId===piece.id));
 expect(expected).toHaveLength(3);expect(new Set(expected.filter(m=>m.fabrication!=='detail').map(m=>m.color)).size).toBe(2);expect(expected.some(m=>m.fabrication==='detail')).toBe(true);
 expect(paperMarkings(ready,piece.id).map(m=>m.id)).toEqual(expected.map(m=>m.id));expect(layout(ready,geometry)[0].markings.map(m=>m.name)).toEqual(expected.map(m=>m.name));
 const svg=svgExport(ready,geometry,ack),markingGroup=svg.match(/<g id="Marking"[^>]*>([\s\S]*?)<\/g>/)!;
 expect(markingGroup[0]).toContain('stroke="none"');expect(markingGroup[1].match(/<path /g)).toHaveLength(expected.reduce((sum,m)=>sum+m.paths.filter(path=>path.pieceId===piece.id).length,0));
 for(const marking of expected){expect(markingGroup[1]).toContain(`<title>${marking.name}</title>`);expect(markingGroup[1]).toContain(`fill="${marking.color}"`);}
 expect(svg).toContain('id="Cut"');expect(svg).toContain('id="Seam"');
 const dxf=dxfExport(ready,geometry,ack);expect((dxf.match(/\r\nMARKING\r\n/g)??[]).length-1).toBe(expected.flatMap(m=>m.paths.flatMap(path=>path.rings)).length);
 const operators=await pdfOperators(await pdfExport(ready,geometry,ack)),fillColors=[...operators.matchAll(/([-\d.eE]+) ([-\d.eE]+) ([-\d.eE]+) rg\b/g)].map(match=>match.slice(1).map(Number));
 for(const marking of expected){const color=[1,3,5].map(offset=>parseInt(marking.color.slice(offset,offset+2),16)/255);expect(fillColors.some(actual=>actual.every((value,i)=>Math.abs(value-color[i])<1e-12)),`PDF retains ${marking.name}`).toBe(true);}
 stubAnimationFrames();try{
  for(const candidateMode of [true,false]){
   const pinia=createPinia();setActivePinia(pinia);const store=useSession(pinia),shown=structuredClone(ready);
   if(candidateMode){shown.previewMarkings=shown.markings;shown.surfaceRun={...candidate.run,accepted:false};shown.markings=[];shown.bindings=[];}
   store.data.project=shown;store.data.geometry=geometry;
   const app=createSSRApp(defineComponent({setup(){const editor=usePatternEditor(ref('zh'),ref(candidateMode?'cutting':'pattern'),()=>{});provide(patternEditorKey,editor);provide('advancedMode',ref(false));return()=>h(PatternCanvas);}}));app.use(pinia);
   const html=await renderToString(app),titles=[...html.matchAll(/<title\b[^>]*>(.*?)<\/title>/g)].map(match=>match[1]);for(const marking of expected)expect(titles).toContain(marking.name);
   expect(html).toMatch(/<path[^>]*stroke="none"[^>]*><title/);
  }
 }finally{vi.unstubAllGlobals();}
 expect(ready).toEqual(before);expect(p).toEqual(sourceBefore);
},60000);

it('actual canvas uses candidate bindings before acceptance and accepted bindings afterwards without sewn fragment strokes',async()=>{
 const {ready,geometry}=await resolved(),detail=ready.markings.find(m=>m.fabrication==='detail')!,sewn=ready.markings.find(m=>m.fabrication!=='detail')!;
 stubAnimationFrames();try{
  for(const candidate of [true,false]){
   const pinia=createPinia();setActivePinia(pinia);const store=useSession(pinia),p=structuredClone(ready);
   if(candidate){p.previewMarkings=p.markings;p.surfaceRun={algorithm:'lscm-cg-1',sourceHash:p.bindings[0].surfaceHash,pieces:p.pieces,bindings:p.bindings,accepted:false};p.markings=[];p.bindings=[];}
   const before=structuredClone(p);store.data.project=p;store.data.geometry=geometry;
   const app=createSSRApp(defineComponent({setup(){const editor=usePatternEditor(ref('zh'),ref(candidate?'cutting':'pattern'),()=>{});provide(patternEditorKey,editor);provide('advancedMode',ref(false));return()=>h(PatternCanvas);}}));app.use(pinia);
   const html=await renderToString(app),titles=[...html.matchAll(/<title\b[^>]*>(.*?)<\/title>/g)].map(match=>match[1]);expect(titles).toContain(detail.name);expect(titles).not.toContain(sewn.name);
   expect(html).toMatch(/<path[^>]*stroke="none"[^>]*><title/);expect(html).not.toMatch(/textLength=|lengthAdjust=/);expect(store.data.project).toEqual(before);
  }
 }finally{vi.unstubAllGlobals();}
},60000);
