import {afterEach,expect,it,vi} from 'vitest';
import * as Vue from 'vue';
import {createPinia,setActivePinia} from 'pinia';
import {parse,compileScript} from '@vue/compiler-sfc';
import {transformSync} from 'esbuild';
import {readFileSync} from 'node:fs';
import {useSession} from '../../apps/desktop/src/store';
import {usePatternEditor} from '../../apps/desktop/src/modules/usePatternEditor';
import * as history from '../../apps/desktop/src/modules/useDraftHistory';
import * as stamps from '../../packages/ui/draft-history';
import * as tabs from '../../apps/desktop/src/modules/workflow-tabs';
import * as localization from '../../apps/desktop/src/localization';
import * as i18n from '../../apps/desktop/src/i18n';
import {project} from '../fixtures';
import type {Response,Session} from '../../packages/schema/index';

// Execute the actual SFC setup in Vue's renderer; no Electron, GPU or DOM is needed.
const descriptor=parse(readFileSync('apps/desktop/src/App.vue','utf8')).descriptor;
const script=compileScript(descriptor,{id:'global-navigation-audit'});
const compiled=transformSync(script.content,{loader:'ts',format:'cjs'}).code,loaded={exports:{} as any};
new Function('require','module','exports',compiled)((name:string)=>name==='vue'?Vue:name==='./store'?{useSession}:name==='./localization'?localization:name==='./i18n'?i18n:name.endsWith('/usePatternEditor')?{usePatternEditor}:name.endsWith('/useDraftHistory')?history:name.endsWith('/draft-history')?stamps:name.endsWith('/workflow-tabs')?tabs:name.endsWith('/patternEditorContext')?{patternEditorKey:Symbol('editor')}:{default:{}},loaded,loaded.exports);
const App=loaded.exports.default;
const renderer=Vue.createRenderer<any,any>({createElement:tag=>({tag,children:[]}),createComment:text=>({text}),createText:text=>({text}),insert:(n,p)=>p.children.push(n),remove(){},setText(){},setElementText(){},parentNode:()=>null,nextSibling:()=>null,patchProp(){}});
function response(sessionId='initial',recovery=[0]):Response{return {ok:true,data:{sessionId,project:project(),geometry:[],canUndo:false,canRedo:false,savedRevision:null,recovery,history:[],recent:[],jobs:[]} satisfies Session};}
async function mount(){
 setActivePinia(createPinia());const store=useSession(),api={read:vi.fn(async()=>response()),onChanged:()=>()=>{},onStorageError:()=>()=>{},open:vi.fn(async()=>response('opened')),create:vi.fn(async()=>response('created')),activate:vi.fn(async()=>response('activated'))};
 const events=new EventTarget();vi.stubGlobal('window',{fpcad:api,addEventListener:events.addEventListener.bind(events),removeEventListener:events.removeEventListener.bind(events),dispatchEvent:events.dispatchEvent.bind(events)});vi.stubGlobal('document',{querySelector:()=>null});
 let state:any;const app=renderer.createApp(Vue.defineComponent({setup(){state=App.setup({}, {expose(){}});return ()=>null;}}));app.mount({children:[]});await Vue.nextTick();await Vue.nextTick();await Vue.nextTick();return {app,state,store,api};
}
afterEach(()=>vi.unstubAllGlobals());
it('new/open/activate close the assistant and show the requested project',async()=>{
 const ui=await mount();try{for(const action of ['create','openProject','activateSession']){ui.state.assistantOpen.value=true;ui.state.home.value=true;await ui.state[action]('activated');expect(ui.state.assistantOpen.value).toBe(false);expect(ui.state.home.value).toBe(false);}}finally{ui.app.unmount();}
});
it('cancelled opening and failed switching preserve the editor draft and assistant state',async()=>{
 const ui=await mount();try{ui.state.stage.value='pattern';await Vue.nextTick();ui.state.tool.value='polygon';ui.state.editor.draft.value=[{id:'draft',xMm:1,yMm:2}];ui.state.assistantOpen.value=true;
 const cancelled=response();if(!cancelled.ok)throw Error('fixture');cancelled.cancelled=true;ui.api.open.mockResolvedValueOnce(cancelled);await ui.state.openProject();expect(ui.state.editor.draft.value).toHaveLength(1);expect(ui.state.assistantOpen.value).toBe(true);
 ui.api.activate.mockResolvedValueOnce({ok:false,error:{code:'PROJECT_MISSING'}} as Response);await ui.state.activateSession('missing');expect(ui.state.editor.draft.value).toHaveLength(1);expect(ui.state.stage.value).toBe('pattern');expect(ui.state.assistantOpen.value).toBe(true);
 }finally{ui.app.unmount();}
});
it('blank names and failed creation leave the current workflow stage intact',async()=>{
 const ui=await mount();try{ui.state.stage.value='model';ui.state.newName.value='  ';await ui.state.create();expect(ui.api.create).not.toHaveBeenCalled();expect(ui.state.stage.value).toBe('model');ui.state.newName.value='valid';ui.api.create.mockResolvedValueOnce({ok:false,error:{code:'CONNECTION_ERROR'}} as Response);await ui.state.create();expect(ui.state.stage.value).toBe('model');}finally{ui.app.unmount();}
});
it('losing focus for a native file dialog cancels only the active pointer gesture and retains drawn nodes',async()=>{
 const ui=await mount();try{ui.state.stage.value='pattern';await Vue.nextTick();ui.state.tool.value='polygon';ui.state.editor.draft.value=[{id:'draft-a',xMm:1,yMm:2},{id:'draft-b',xMm:3,yMm:4}];ui.state.editor.preview.value=ui.store.data.project!.pieces[0];window.dispatchEvent(new Event('blur'));expect(ui.state.editor.draft.value).toHaveLength(2);expect(ui.state.editor.preview.value).toBe(null);expect(ui.state.tool.value).toBe('polygon');}finally{ui.app.unmount();}
});
it('opening from the assistant preserves a session notice through the final editor navigation',async()=>{
 const ui=await mount();try{ui.state.assistantOpen.value=true;ui.state.home.value=true;const result=response('opened-notice');if(!result.ok)throw Error('fixture');result.data.notice='STORAGE_RECLAIM_FAILED';ui.api.open.mockResolvedValueOnce(result);await ui.state.openProject();expect(ui.state.home.value).toBe(false);expect(ui.state.assistantOpen.value).toBe(false);expect(ui.store.error).toBe('STORAGE_RECLAIM_FAILED');ui.state.stage.value='guide';await Vue.nextTick();expect(ui.store.error).toBe('STORAGE_RECLAIM_FAILED');ui.store.error='';expect(ui.store.error).toBe('');}finally{ui.app.unmount();}
});
it('recovery picks the latest available revision while preserving a valid user selection',async()=>{
 const ui=await mount();try{await ui.store.run(async()=>response('initial',[17,16,15]));await Vue.nextTick();expect(ui.state.recoveryRevision.value).toBe(17);ui.state.recoveryRevision.value=16;await ui.store.run(async()=>response('initial',[18,17,16]));await Vue.nextTick();expect(ui.state.recoveryRevision.value).toBe(16);await ui.store.run(async()=>response('other',[5,4]));await Vue.nextTick();expect(ui.state.recoveryRevision.value).toBe(5);}finally{ui.app.unmount();}
});
it('diagnostics navigate to pieces, seams or the mapped marking and close the assistant',async()=>{
 const ui=await mount();try{ui.state.assistantOpen.value=true;const pieceId=ui.store.data.project!.pieces[0].id;await ui.state.navigateIssue({ruleId:pieceId+':geometry',entityId:pieceId,severity:'error',messageKey:'openPath'});expect(ui.state.stage.value).toBe('pattern');expect(ui.state.productionTab.value).toBe('pieces');expect(ui.state.selectedId.value).toBe(pieceId);expect(ui.state.assistantOpen.value).toBe(false);
 ui.store.data.project!.seams=[{id:'seam'} as any];await ui.state.navigateIssue({ruleId:'seam:notches',entityId:pieceId,severity:'error',messageKey:'STALE_SEAM_NOTCHES'});expect(ui.state.productionTab.value).toBe('seams');expect(ui.state.nodeTarget.value).toBe('seam');expect(ui.state.selectedId.value).toBe(pieceId);
 ui.store.data.project!.markings=[{id:'marking',paths:[{pieceId:'other-piece'},{pieceId}]} as any];await ui.state.navigateIssue({ruleId:'marking:'+pieceId+':inference',entityId:pieceId,severity:'error',messageKey:'INFERRED_MARKING_REVIEW'});expect(ui.state.stage.value).toBe('mapping');expect(ui.state.selectedMarking.value).toEqual({markingId:'marking',pieceId});
 ui.state.assistantOpen.value=true;ui.state.showRecent.value=true;ui.state.showHome();expect(ui.state.home.value).toBe(true);expect(ui.state.assistantOpen.value).toBe(false);expect(ui.state.showRecent.value).toBe(false);
 }finally{ui.app.unmount();}
});
