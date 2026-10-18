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
