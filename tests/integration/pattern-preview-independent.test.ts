import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {createPinia,setActivePinia} from 'pinia';
import {createSSRApp,defineComponent,h,markRaw,nextTick,provide,ref} from 'vue';
import {renderToString} from 'vue/server-renderer';
import {useSession} from '../../apps/desktop/src/store';
import {usePatternEditor} from '../../apps/desktop/src/modules/usePatternEditor';
import {patternEditorKey} from '../../apps/desktop/src/modules/patternEditorContext';
import type {Stage} from '../../apps/desktop/src/modules/workflow-tabs';
import PatternCanvas from '../../apps/desktop/src/PatternCanvas.vue';
import {project,rectangle} from '../fixtures';
import {stubAnimationFrames} from '../animation-frames';

let pinia:ReturnType<typeof createPinia>;
beforeEach(()=>{pinia=createPinia();setActivePinia(pinia);stubAnimationFrames();});afterEach(()=>vi.unstubAllGlobals());
function setup(candidate:boolean){
 const p=project(),base=rectangle(100,200),yellow=rectangle(60,30);base.name='Grey body panel';yellow.name='Yellow shoulder panel';yellow.color='#e3b546';yellow.nodes.forEach(n=>{n.xMm+=10000;n.yMm+=3000;});
 const pieces=[base,yellow];p.pieces=candidate?[]:pieces;if(candidate)p.surfaceRun={sourceHash:'a'.repeat(64),algorithm:'lscm-arap-1',pieces,bindings:[],accepted:false};
 const store=useSession();store.data.project=p;const editor=usePatternEditor(ref('zh'),ref<Stage>('cutting'),()=>{});editor.svg.value=markRaw({clientWidth:600,clientHeight:400}) as SVGSVGElement;
 return {p,editor,pieces};
}
async function html(editor:ReturnType<typeof usePatternEditor>){const app=createSSRApp(defineComponent({setup(){provide(patternEditorKey,editor);return ()=>h(PatternCanvas);}}));app.use(pinia);return renderToString(app);}

it.each([false,true])('choosing a piece shows only that piece, retains all choices and fits the actual selection (candidate=%s)',async candidate=>{
 const {p,editor,pieces}=setup(candidate),before=JSON.stringify(p);editor.fit();const allWidth=editor.view.value.w;
 expect(editor.shownPieces.value).toHaveLength(2);expect(editor.previewBounds.value).toMatchObject({widthMm:10060,heightMm:3030});
 editor.selectPiece(pieces[1].id);await nextTick();editor.fit();expect(editor.shownPieces.value.map(p=>p.id)).toEqual([pieces[1].id]);expect(editor.previewPieces.value).toHaveLength(2);expect(editor.view.value.w).toBeLessThan(1000);expect(editor.view.value.w).toBeLessThan(allWidth/10);expect(editor.previewBounds.value).toMatchObject({widthMm:60,heightMm:30});
 const selectedHtml=await html(editor);expect((selectedHtml.match(/data-piece-id=/g)??[]).length).toBe(1);expect(selectedHtml).toContain(`value="${pieces[0].id}"`);expect(selectedHtml).toContain(`value="${pieces[1].id}"`);expect(selectedHtml).toContain('screen-outline');expect(selectedHtml).toContain('60 × 30 mm');
 for(const zoom of[10,37,100,3200]){editor.setZoomPercent(zoom);expect(editor.previewBounds.value).toMatchObject({widthMm:60,heightMm:30});expect(JSON.stringify(p)).toBe(before);}
 editor.selectPiece('');editor.fit();expect(editor.shownPieces.value).toHaveLength(2);expect(editor.view.value.w).toBeCloseTo(allWidth,8);expect(editor.previewBounds.value).toMatchObject({widthMm:10060,heightMm:3030});const allHtml=await html(editor);expect((allHtml.match(/data-piece-id=/g)??[]).length).toBe(2);expect(allHtml).toContain('全片范围 · 10,060 × 3,030 mm');expect(JSON.stringify(p)).toBe(before);
});

it('a selection from a previous candidate does not hide a new candidate or modify its data',()=>{
 const {p,editor,pieces}=setup(true);editor.selectedId.value='previous-candidate-piece';const before=JSON.stringify(p);expect(editor.shownPieces.value.map(p=>p.id)).toEqual(pieces.map(p=>p.id));editor.fit();expect(editor.view.value.w).toBeGreaterThan(10000);expect(JSON.stringify(p)).toBe(before);
});

it('clicking a piece in the overview focuses its single-piece view without changing project geometry',async()=>{
 const {p,editor,pieces}=setup(true),before=JSON.stringify(p);editor.fit();editor.down({button:0} as PointerEvent,pieces[1]);await nextTick();expect(editor.shownPieces.value.map(p=>p.id)).toEqual([pieces[1].id]);expect(editor.view.value.w).toBeLessThan(1000);expect(JSON.stringify(p)).toBe(before);
});

it('candidate outlines and fit use the candidate allowance boundary even when saved geometry has the same ID',async()=>{
 const {p,editor,pieces}=setup(true),store=useSession(),piece=pieces[1],cut=piece.nodes.map(n=>({...n,xMm:n.xMm+(n.xMm===10000?-80:80),yMm:n.yMm+(n.yMm===3000?-90:90)}));
 store.data.project!.surfaceRun!.cutPreview=[{id:piece.id,cut}];store.data.geometry=[{id:piece.id,cut:cut.map(n=>({...n,xMm:n.xMm+90000})),seam:cut,areaMm2:0,perimeterMm:0,issues:[]}];
 const before=JSON.stringify(store.data.project);editor.selectPiece(piece.id);await nextTick();
 expect(editor.cutPath(piece.id)).toContain('M9920,-2910');expect(editor.cutPath(piece.id)).not.toContain('99920');expect(editor.previewBounds.value).toMatchObject({widthMm:60,heightMm:30});
 for(const node of cut){expect(node.xMm).toBeGreaterThanOrEqual(editor.view.value.x);expect(node.xMm).toBeLessThanOrEqual(editor.view.value.x+editor.view.value.w);expect(-node.yMm).toBeGreaterThanOrEqual(editor.view.value.y);expect(-node.yMm).toBeLessThanOrEqual(editor.view.value.y+editor.view.value.h);}
 expect(JSON.stringify(store.data.project)).toBe(before);expect(p.pieces).toHaveLength(0);
});

it.each([false,true])('returning to all pieces refits automatically and clears the prior mapped point (candidate=%s)',async candidate=>{
 const {p,editor,pieces}=setup(candidate),before=JSON.stringify(p);editor.fit();const overview={...editor.view.value};editor.selectPiece(pieces[1].id);await nextTick();editor.setZoomPercent(3200);editor.mappedPoint.value={pieceId:pieces[1].id,xMm:10000,yMm:3000};
 editor.selectPiece('');await nextTick();expect(editor.selectedId.value).toBe('');expect(editor.shownPieces.value).toHaveLength(2);expect(editor.view.value).toEqual(overview);expect(editor.zoomPercent.value).toBe(100);expect(editor.mappedPoint.value).toBeNull();expect(JSON.stringify(p)).toBe(before);
});

it('replacing a candidate clears missing selections and refits the new candidate without retaining old coordinates',async()=>{
 const {editor,pieces}=setup(true),store=useSession();editor.selectPiece(pieces[1].id);await nextTick();editor.mappedPoint.value={pieceId:pieces[1].id,xMm:10000,yMm:3000};editor.choiceIds.value=[pieces[1].id];
 const next=structuredClone(project()),replacement=rectangle(240,160);next.id=store.data.project!.id;next.surfaceRun={sourceHash:'b'.repeat(64),algorithm:'lscm-arap-1',accepted:false,pieces:[replacement],bindings:[]};next.pieces=[];const before=JSON.stringify(next);store.data.project=next;await nextTick();await nextTick();
 expect(editor.selectedId.value).toBe('');expect(editor.choiceIds.value).toEqual([]);expect(editor.mappedPoint.value).toBeNull();expect(editor.shownPieces.value.map(p=>p.id)).toEqual([replacement.id]);expect(editor.view.value.w).toBeLessThan(1000);expect(JSON.stringify(next)).toBe(before);
});

it('dock expansion and contraction fit the current piece at the actual canvas ratio and ignore hidden dimensions',async()=>{
 const {p,editor,pieces}=setup(true),before=JSON.stringify(p),canvas={clientWidth:600,clientHeight:400};editor.svg.value=markRaw(canvas) as SVGSVGElement;editor.selectPiece(pieces[1].id);await nextTick();
 for(const [width,height]of [[1100,650],[320,180],[800,550]]){editor.setZoomPercent(3200);canvas.clientWidth=width;canvas.clientHeight=height;editor.resizeViewport(width,height);expect(editor.view.value.w/editor.view.value.h).toBeCloseTo(width/height,10);expect(editor.zoomPercent.value).toBe(100);expect(editor.shownPieces.value.map(p=>p.id)).toEqual([pieces[1].id]);}
 const visible={...editor.view.value},size={...editor.viewportSize.value};editor.resizeViewport(0,0);editor.resizeViewport(NaN,500);expect(editor.view.value).toEqual(visible);expect(editor.viewportSize.value).toEqual(size);expect(JSON.stringify(p)).toBe(before);
});

it('the zoom input and wheel limits remain bounded without changing millimetre geometry',()=>{
 const {p,editor}=setup(true),before=JSON.stringify(p);editor.fit();editor.setZoomPercent(1e6);expect(editor.zoomPercent.value).toBeCloseTo(3200,8);editor.setZoomPercent(.001);expect(editor.zoomPercent.value).toBeCloseTo(10,8);editor.setZoomPercent(NaN);expect(editor.zoomPercent.value).toBeCloseTo(10,8);expect(JSON.stringify(p)).toBe(before);
});
