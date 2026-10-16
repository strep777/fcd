import {afterEach,expect,it,vi} from 'vitest';
import {createRenderer,h,nextTick,createSSRApp,defineComponent,provide,ref,ssrContextKey} from 'vue';
import {renderToString} from 'vue/server-renderer';
import {createPinia,setActivePinia} from 'pinia';
import NestingPanel from '../../apps/desktop/src/NestingPanel.vue';
import PatternPage from '../../apps/desktop/src/PatternPage.vue';
import {useSession} from '../../apps/desktop/src/store';
import {usePatternEditor} from '../../apps/desktop/src/modules/usePatternEditor';
import {patternEditorKey} from '../../apps/desktop/src/modules/patternEditorContext';
import {locale,setLocale} from '../../apps/desktop/src/localization';
import type {Nesting,NestingOptions} from '../../packages/schema/index';
import {project} from '../fixtures';
const saved:NestingOptions={widthMm:500,lengthLimitMm:2300,marginMm:17,gapMm:9,alignGrain:false,preserveLocks:false,mode:'shelf',rotationsRad:[0,Math.PI],candidateBudget:700};
const layout=(options=saved):Nesting=>({algorithm:'shelf-bbox-1',dependencyHash:'a'.repeat(64),options:structuredClone(options),sheets:[],unplaced:[]});
afterEach(()=>{setLocale('en');vi.unstubAllGlobals();});
function mountedNesting(){
 const pinia=createPinia();setActivePinia(pinia);const store=useSession(),p=project();p.nesting=layout();store.data.project=p;
 const renderer=createRenderer<any,any>({createComment:()=>({}),createElement:()=>({}),createText:()=>({}),setText(){},setElementText(){},parentNode:()=>null,nextSibling:()=>null,patchProp(){},insert(){},remove(){}});
 const app=renderer.createApp({...NestingPanel,render:()=>null},{language:'en'});app.use(pinia);app.provide(ssrContextKey,{modules:new Set()});const vm=app.mount({});
 return {store,p,pinia,app,state:(vm as any).$.setupState};
}
it('reloads saved fabric constraints, submits them, and does not mutate the stored options through the draft',async()=>{
 const {store,p,pinia,app,state}=mountedNesting();try{
  const html=await renderToString(createSSRApp(NestingPanel,{language:'en'}).use(pinia));
  expect(html.match(/Width mm[\s\S]*?<input([^>]*)>/)?.[1]).toContain('value="500"');
  expect(html.match(/Gap mm[\s\S]*?<input([^>]*)>/)?.[1]).toContain('value="9"');
  expect(state.options).toEqual(saved);state.options.widthMm=640;expect(store.data.project!.nesting!.options.widthMm).toBe(500);
  const nest=vi.fn(async()=>({ok:true,data:JSON.parse(JSON.stringify(store.data))}));vi.stubGlobal('window',{fpcad:{nest}});
  await state.run();expect(nest).toHaveBeenCalledWith(p.id,p.revision,{...saved,widthMm:640});
  expect(state.options.widthMm).toBe(640);
 }finally{app.unmount();}
});
it('restores undo and redo constraints, retains drafts on unrelated refreshes, and restores defaults without a saved layout',async()=>{
 const {store,app,state}=mountedNesting();try{
  state.options.widthMm=640;
  const refresh=JSON.parse(JSON.stringify(store.data));refresh.project.revision++;refresh.project.name='Renamed';await store.run(async()=>({ok:true,data:refresh}));await nextTick();expect(state.options.widthMm).toBe(640);
  const redo=JSON.parse(JSON.stringify(store.data));redo.project.nesting=layout({...saved,widthMm:800,gapMm:13});await store.run(async()=>({ok:true,data:redo}));await nextTick();expect(state.options).toEqual({...saved,widthMm:800,gapMm:13});
  const undo=JSON.parse(JSON.stringify(store.data));undo.project.nesting=layout();await store.run(async()=>({ok:true,data:undo}));await nextTick();expect(state.options).toEqual(saved);
  const removed=JSON.parse(JSON.stringify(store.data));delete removed.project.nesting;await store.run(async()=>({ok:true,data:removed}));await nextTick();expect(state.options).toMatchObject({widthMm:1500,lengthLimitMm:10000,marginMm:10,gapMm:5,alignGrain:true,mode:'contour',preserveLocks:true});
  state.options.widthMm=400;const other=JSON.parse(JSON.stringify(store.data));other.project=project();await store.run(async()=>({ok:true,data:other}));await nextTick();expect(state.options.widthMm).toBe(1500);
 }finally{app.unmount();}
});
it('keeps manual placement edits through unrelated refreshes and reloads authoritative placement changes',async()=>{
 const {store,p,app,state}=mountedNesting();try{
  store.data.project!.nesting!.sheets=[{material:p.pieces[0].material,lengthMm:400,utilization:.1,placements:[{pieceId:p.pieces[0].id,instance:1,xMm:20,yMm:30,angleRad:Math.PI/2,mirror:false,widthMm:100,heightMm:200}]}];
  state.chosen=`${p.pieces[0].id}:1`;await nextTick();expect(state.manual).toEqual({xMm:20,yMm:30,angleDeg:90,locked:false});
  state.manual.xMm=70;state.manual.yMm=80;state.manual.angleDeg=180;state.manual.locked=true;
  const refresh=JSON.parse(JSON.stringify(store.data));refresh.project.revision++;await store.run(async()=>({ok:true,data:refresh}));await nextTick();expect(state.manual).toEqual({xMm:70,yMm:80,angleDeg:180,locked:true});
  const changed=JSON.parse(JSON.stringify(store.data));changed.project.nesting.sheets[0].placements[0].xMm=40;await store.run(async()=>({ok:true,data:changed}));await nextTick();expect(state.manual).toEqual({xMm:40,yMm:30,angleDeg:90,locked:false});
  await store.run(async()=>({ok:true,data:refresh}));await nextTick();expect(state.manual).toEqual({xMm:20,yMm:30,angleDeg:90,locked:false});
 }finally{app.unmount();}
});
it('translates every production subtab in Japanese and follows subsequent locale changes',async()=>{
 const pinia=createPinia();setActivePinia(pinia);const store=useSession();store.data.project=project();
 const editor=usePatternEditor(ref('en'),ref('pattern'),()=>{});
 async function tabs(){const app=createSSRApp(defineComponent({setup(){provide(patternEditorKey,editor);provide('advancedMode',ref(false));return ()=>h(PatternPage,{language:'en',panel:'pieces'});}}));app.use(pinia);const html=await renderToString(app);return [...html.matchAll(/role="tab"[^>]*>([^<]*)<\/button>/g)].map(m=>m[1]);}
 setLocale('ja');expect(locale.value).toBe('ja');expect(await tabs()).toEqual(['型紙','素材','接ぎ目','配置','製作フロー']);
 setLocale('en');expect(await tabs()).toEqual(['Patterns','Materials','Seams','Nesting','Workflow']);
});
