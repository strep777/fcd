import {beforeEach,afterEach,it,expect,vi} from 'vitest';
import {createPinia,setActivePinia} from 'pinia';
import {createSSRApp,defineComponent,h,provide,ref,markRaw,nextTick,type Component} from 'vue';
import {renderToString} from 'vue/server-renderer';
import {useSession} from '../../apps/desktop/src/store';
import {usePatternEditor} from '../../apps/desktop/src/modules/usePatternEditor';
import {patternEditorKey} from '../../apps/desktop/src/modules/patternEditorContext';
import CutSelection from '../../apps/desktop/src/CutSelection.vue';
import PatternProperties from '../../apps/desktop/src/PatternProperties.vue';
import CuttingPage from '../../apps/desktop/src/CuttingPage.vue';
import MaterialsPanel from '../../apps/desktop/src/MaterialsPanel.vue';
import NestingPanel from '../../apps/desktop/src/NestingPanel.vue';
import SeamsPanel from '../../apps/desktop/src/SeamsPanel.vue';
import PatternCanvas from '../../apps/desktop/src/PatternCanvas.vue';
import {previewRuler,pieceDimensions} from '../../packages/ui/pattern-preview';
import {parseObj} from '../../apps/desktop/main/surface';
import {analyze} from '../../apps/desktop/main/worker';
import {pdfExport,svgExport} from '../../apps/desktop/main/export';
import {PDFDocument,PDFArray,PDFRawStream,decodePDFRawStream} from 'pdf-lib';
import {resolve} from 'node:path';
import {project,rectangle} from '../fixtures';
import {stubAnimationFrames} from '../animation-frames';
let pinia:ReturnType<typeof createPinia>;
let frames:ReturnType<typeof stubAnimationFrames>;
beforeEach(()=>{pinia=createPinia();setActivePinia(pinia);frames=stubAnimationFrames();});afterEach(()=>vi.unstubAllGlobals());
function setup(){const store=useSession(),p=project();p.pieces=[{...rectangle(350,600),allowanceMm:0}];p.surface=parseObj('v 0 0 0\nv 100 0 0\nv 100 100 0\nv 0 100 0\nf 1 2 3\nf 1 3 4');store.data.project=p;const editor=usePatternEditor(ref('zh'),ref('pattern'),()=>{});editor.selectedId.value=p.pieces[0].id;return {store,p,editor};}
async function rendered(component:Component,advanced:boolean,props={}){const {editor}=setup(),app=createSSRApp(defineComponent({setup(){provide(patternEditorKey,editor);provide('advancedMode',ref(advanced));return ()=>h(component,props);}}));app.use(pinia);return renderToString(app);}
it('keeps common piece edits and allowance available in simple mode, then restores advanced editing controls',async()=>{
 const simple=await rendered(PatternProperties,false),advanced=await rendered(PatternProperties,true);
 for(const text of ['裁片颜色','名称','生成缝份候选','材料与裁剪'])expect(simple).toContain(text);
 for(const text of ['新建轮廓','导入 SVG 纸样','复制']){expect(simple).not.toContain(text);expect(advanced).not.toContain(text);}
 for(const text of ['逐边缝份','缝份连接','轮廓、孔洞','布向角']){expect(simple).not.toContain(text);expect(advanced).toContain(text);}
});
it('simple cutting retains computation and saved cuts while advanced restores manual point edits and solver options',async()=>{
 const simple=await rendered(CuttingPage,false,{language:'zh'}),advanced=await rendered(CuttingPage,true,{language:'zh'});
 for(const text of ['裁切版型','曲面钢笔','自由绘制','裁切并计算版型候选'])expect(simple).toContain(text);
 for(const text of ['手动切分点与切分线','半侧制版与中线围合','求解参数','展开算法']){expect(simple).not.toContain(text);expect(advanced).toContain(text);}
});
it('simple production forms keep fabric essentials while hiding algorithm and detailed manufacturing settings',async()=>{
 const materials=await rendered(MaterialsPanel,false,{language:'zh',selectedId:''}),materialsAdvanced=await rendered(MaterialsPanel,true,{language:'zh',selectedId:''});
 expect(materials).toContain('默认缝份 mm');expect(materials).not.toContain('经向伸长比');expect(materialsAdvanced).toContain('经向伸长比');
 const nesting=await rendered(NestingPanel,false,{language:'zh'}),nestingAdvanced=await rendered(NestingPanel,true,{language:'zh'});expect(nesting).toContain('幅宽 mm');expect(nesting).toContain('片间距 mm');expect(nesting).not.toContain('保守包围框');expect(nestingAdvanced).toContain('保守包围框');
 const seams=await rendered(SeamsPanel,false,{language:'zh'}),seamsAdvanced=await rendered(SeamsPanel,true,{language:'zh'});expect(seams).toContain('建立接缝');expect(seams).not.toContain('A 起止');expect(seamsAdvanced).toContain('A 起止');
});
it('simple output offers three common actions and advanced restores separate single/batch and bundle operations',async()=>{
 const props={language:'zh',selectedId:'',paper:{widthMm:210,heightMm:297,marginMm:10,overlapMm:10}},simple=await rendered(CutSelection,false,props),advanced=await rendered(CutSelection,true,props);
 expect(simple).not.toContain('导出裁片 ZIP');expect(advanced).toContain('导出裁片 ZIP');expect((simple.match(/<button/g)??[]).length).toBe(4);expect((advanced.match(/<button/g)??[]).length).toBe(9);
});
it('the pattern icon rail names every action and displays physical dimensions and a world-mm ruler',async()=>{
 const simple=await rendered(PatternCanvas,false),advanced=await rendered(PatternCanvas,true);
 expect(simple).toContain('350 × 600 mm');expect(simple).toContain('预览缩放百分比');expect(simple).toContain('mm ruler');expect(simple).toContain('aria-label="手形平移"');expect(simple).toContain('aria-label="放大"');expect(simple).not.toContain('aria-label="节点"');expect(advanced).toContain('aria-label="节点"');
});
it('arbitrary preview magnification leaves millimetre dimensions, SVG output, PDF page size and 100 mm calibration untouched',async()=>{
 const {p,store,editor}=setup();store.data.geometry=await analyze(resolve('target/release/fpcad-worker.exe'),p);await nextTick();editor.focusSelection();const baseline={...editor.view.value},before=svgExport(p,store.data.geometry,[]),physical={...editor.previewBounds.value},paper={...editor.paper.value};
 for(const percent of [10,37,125,3200,100]){editor.setZoomPercent(percent);expect(editor.zoomPercent.value).toBeCloseTo(percent,10);expect(editor.previewBounds.value).toEqual(physical);expect(editor.paper.value).toEqual(paper);expect(svgExport(p,store.data.geometry,[])).toEqual(before);}
 expect(editor.view.value.w).toBeCloseTo(baseline.w,9);const pdf=await PDFDocument.load(await pdfExport(p,store.data.geometry,[],paper));expect(pdf.getPageCount()).toBe(6);
 for(const page of pdf.getPages()){expect(page.getWidth()*25.4/72).toBeCloseTo(210,9);expect(page.getHeight()*25.4/72).toBeCloseTo(297,9);const contents=page.node.Contents(),refs=contents instanceof PDFArray?contents.asArray():[contents],text=refs.map(r=>{const stream=pdf.context.lookup(r!);return stream instanceof PDFRawStream?new TextDecoder().decode(decodePDFRawStream(stream).decode()):'';}).join('\n');const lines=[...text.matchAll(/([-\d.eE]+) ([-\d.eE]+) m\s+([-\d.eE]+) ([-\d.eE]+) l\s+S/g)];expect(lines.some(m=>Math.abs((Number(m[3])-Number(m[1]))*25.4/72-100)<1e-8&&Math.abs(Number(m[2])-Number(m[4]))<1e-8)).toBe(true);}
});
it('middle drag always pans in edit mode without selecting or committing geometry, including during a busy operation',()=>{
 const {editor,store,p}=setup(),before=JSON.stringify(p);vi.stubGlobal('DOMPoint',class{constructor(public x:number,public y:number){}matrixTransform(){return this;}});editor.svg.value=markRaw({getScreenCTM:()=>({inverse:()=>({})}),setPointerCapture:vi.fn()}) as unknown as SVGSVGElement;editor.tool.value='select';store.busy=true;const v={...editor.view.value};editor.down({button:1,pointerId:9,clientX:20,clientY:30,preventDefault(){}} as PointerEvent,p.pieces[0]);editor.move({pointerId:9,clientX:50,clientY:70} as PointerEvent);expect(editor.view.value).toEqual(v);expect(frames.pending).toBe(1);frames.flush();expect(editor.view.value).toMatchObject({x:v.x-30,y:v.y-40,w:v.w,h:v.h});expect(editor.preview.value).toBeNull();expect(JSON.stringify(p)).toBe(before);
});
it('the scale ruler reports an honest world length at every zoom and viewport size',()=>{for(const pixelsPerMm of [.02,.2,1,5,100]){const r=previewRuler(pixelsPerMm);expect(r.pixels).toBeGreaterThanOrEqual(40);expect(r.pixels).toBeLessThanOrEqual(100);expect(r.pixels/pixelsPerMm).toBeCloseTo(r.mm,9);}expect(previewRuler(NaN)).toEqual({mm:0,pixels:0});});

it('dimension readout uses cubic curve extrema rather than the control cage or node-only box',()=>{const p=rectangle(100,50);p.curves=[{id:crypto.randomUUID(),startNodeId:p.nodes[2].id,endNodeId:p.nodes[3].id,c1:{id:crypto.randomUUID(),xMm:100,yMm:150},c2:{id:crypto.randomUUID(),xMm:0,yMm:150}}];expect(pieceDimensions(p)).toEqual({widthMm:100,heightMm:125});const {editor}=setup();editor.preview.value={...p,id:editor.selectedId.value};expect(editor.previewBounds.value).toMatchObject({widthMm:100,heightMm:125});});
