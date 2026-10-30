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
import * as transforms from '../../apps/desktop/src/modules/surfaceTransformDraftGuard';
import * as localization from '../../apps/desktop/src/localization';
import * as i18n from '../../apps/desktop/src/i18n';
import {project} from '../fixtures';
import type {Response,Session} from '../../packages/schema/index';

// Execute the actual SFC setup in Vue's renderer; no desktop host, GPU or DOM is needed.
let nativeBinding:{dirty:()=>boolean;requestLeave:(close:()=>void)=>void};
const descriptor=parse(readFileSync('apps/desktop/src/App.vue','utf8')).descriptor;
const script=compileScript(descriptor,{id:'global-navigation-audit'});
const compiled=transformSync(script.content,{loader:'ts',format:'cjs'}).code,loaded={exports:{} as any};
new Function('require','module','exports',compiled)((name:string)=>name==='vue'?Vue:name==='./store'?{useSession}:name==='./localization'?localization:name==='./i18n'?i18n:name.endsWith('/usePatternEditor')?{usePatternEditor}:name.endsWith('/useDraftHistory')?history:name.endsWith('/draft-history')?stamps:name.endsWith('/workflow-tabs')?tabs:name.endsWith('/surfaceTransformDraftGuard')?transforms:name.endsWith('/useNativeDraftCloseGuard')?{useNativeDraftCloseGuard:(dirty:()=>boolean,requestLeave:(close:()=>void)=>void)=>{nativeBinding={dirty,requestLeave};}}:name.endsWith('/patternEditorContext')?{patternEditorKey:Symbol('editor')}:{default:{}},loaded,loaded.exports);
const App=loaded.exports.default;
const renderer=Vue.createRenderer<any,any>({createElement:tag=>({tag,children:[]}),createComment:text=>({text}),createText:text=>({text}),insert:(n,p)=>p.children.push(n),remove(){},setText(){},setElementText(){},parentNode:()=>null,nextSibling:()=>null,patchProp(){}});
function response(sessionId='initial',recovery=[0]):Response{return {ok:true,data:{sessionId,project:project(),geometry:[],canUndo:false,canRedo:false,savedRevision:null,recovery,history:[],recent:[],jobs:[]} satisfies Session};}
async function mount(){
 setActivePinia(createPinia());const store=useSession(),api={read:vi.fn(async()=>response()),onChanged:()=>()=>{},onStorageError:()=>()=>{},open:vi.fn(async()=>response('opened')),create:vi.fn(async()=>response('created')),activate:vi.fn(async()=>response('activated'))};
 const events=new EventTarget();vi.stubGlobal('window',{fpcad:api,addEventListener:events.addEventListener.bind(events),removeEventListener:events.removeEventListener.bind(events),dispatchEvent:events.dispatchEvent.bind(events)});vi.stubGlobal('document',{querySelector:()=>null});
 let state:any,instance:ReturnType<typeof Vue.getCurrentInstance>;const app=renderer.createApp(Vue.defineComponent({setup(){instance=Vue.getCurrentInstance();state=App.setup({}, {expose(){}});return ()=>null;}}));app.mount({children:[]});await Vue.nextTick();await Vue.nextTick();await Vue.nextTick();return {app,state,store,api,setEditor:(editor:unknown)=>{instance!.refs.markingEditPage=editor;}};
}
const owners:(()=>void)[]=[];
afterEach(()=>{for(const stop of owners.splice(0))stop();vi.unstubAllGlobals();});
function owner(dirty=Vue.ref(true),save=vi.fn(async()=>{dirty.value=false;return true;})){const discard=vi.fn(()=>{dirty.value=false;});owners.push(transforms.registerSurfaceTransforms({dirty:()=>dirty.value,save,discard}));return{dirty,save,discard};}
function nativeX(close=vi.fn()){nativeBinding.requestLeave(close);return close;}

it.each([false,true])('a clean native close continues once even with background busy=%s',async busy=>{
 const ui=await mount();try{ui.store.busy=busy;expect(nativeBinding.dirty()).toBe(false);const close=nativeX();expect(close).toHaveBeenCalledOnce();expect(ui.state.pendingMarkingAction.value).toBeNull();}finally{ui.store.busy=false;ui.app.unmount();}
});

it('dirty X opens one pending decision; returning to edit or Escape preserves every local value',async()=>{
 const ui=await mount(),draft=owner();try{const before=structuredClone(Vue.toRaw(ui.store.data.project)),close=nativeX();expect(nativeBinding.dirty()).toBe(true);expect(close).not.toHaveBeenCalled();expect(ui.state.pendingMarkingAction.value).toBeTypeOf('function');ui.state.pendingMarkingAction.value=null;expect(draft.dirty.value).toBe(true);expect(draft.save).not.toHaveBeenCalled();expect(draft.discard).not.toHaveBeenCalled();nativeX(close);ui.state.keyboard({key:'Escape',defaultPrevented:false,preventDefault:vi.fn()});expect(ui.state.pendingMarkingAction.value).toBeNull();expect(close).not.toHaveBeenCalled();expect(ui.store.data.project).toEqual(before);}finally{ui.app.unmount();}
});

it('saving dirty transforms waits for the complete save before continuing the original native close once',async()=>{
 const ui=await mount(),dirty=Vue.ref(true);let finish!:(value:boolean)=>void;const draft=owner(dirty,vi.fn(()=>new Promise<boolean>(resolve=>{finish=resolve;})));try{const close=nativeX(),saving=ui.state.saveMarkingAndContinue();await Vue.nextTick();expect(draft.save).toHaveBeenCalledOnce();expect(close).not.toHaveBeenCalled();dirty.value=false;finish(true);await saving;expect(close).toHaveBeenCalledOnce();expect(ui.state.pendingMarkingAction.value).toBeNull();expect(draft.discard).not.toHaveBeenCalled();}finally{ui.app.unmount();}
});

it('failed or cancelled saving keeps the dialog and all dirty transforms available to retry',async()=>{
 const ui=await mount(),dirty=Vue.ref(true),save=vi.fn(async()=>false),draft=owner(dirty,save);try{const close=nativeX();await ui.state.saveMarkingAndContinue();expect(close).not.toHaveBeenCalled();expect(ui.state.pendingMarkingAction.value).toBeTypeOf('function');expect(dirty.value).toBe(true);expect(draft.discard).not.toHaveBeenCalled();save.mockImplementation(async()=>{dirty.value=false;return true;});await ui.state.saveMarkingAndContinue();expect(close).toHaveBeenCalledOnce();expect(save).toHaveBeenCalledTimes(2);}finally{ui.app.unmount();}
});

it('discard only removes local drafts, retains the committed revision and then continues native checkpoint closing',async()=>{
 const ui=await mount(),draft=owner();try{const before=structuredClone(Vue.toRaw(ui.store.data.project)),close=nativeX();ui.state.discardMarkingAndContinue();expect(draft.discard).toHaveBeenCalledOnce();expect(draft.save).not.toHaveBeenCalled();expect(close).toHaveBeenCalledOnce();expect(ui.store.data.project).toEqual(before);expect(nativeBinding.dirty()).toBe(false);}finally{ui.app.unmount();}
});

it('repeated X while dirty does not save or close twice',async()=>{
 const ui=await mount(),draft=owner();try{const close=vi.fn();nativeX(close);nativeX(close);expect(draft.save).not.toHaveBeenCalled();await ui.state.saveMarkingAndContinue();await ui.state.saveMarkingAndContinue();expect(draft.save).toHaveBeenCalledOnce();expect(close).toHaveBeenCalledOnce();}finally{ui.app.unmount();}
});

it('dirty plus busy retains the decision; when background save completes clean, confirmation does not call a missing editor',async()=>{
 const ui=await mount(),draft=owner();try{ui.store.busy=true;const close=nativeX();await ui.state.saveMarkingAndContinue();ui.state.discardMarkingAndContinue();expect(close).not.toHaveBeenCalled();expect(draft.save).not.toHaveBeenCalled();expect(draft.discard).not.toHaveBeenCalled();draft.dirty.value=false;ui.store.busy=false;expect(ui.state.markingEditPage.value).toBeNull();await ui.state.saveMarkingAndContinue();expect(close).toHaveBeenCalledOnce();expect(ui.state.pendingMarkingAction.value).toBeNull();expect(draft.save).not.toHaveBeenCalled();}finally{ui.store.busy=false;ui.app.unmount();}
});

it.each(['mapping','pattern'])('a cached dirty image editor still guards native X on the %s stage',async stage=>{
 const ui=await mount();try{ui.state.stage.value=stage;await Vue.nextTick();ui.state.markingEditDirty.value=true;const save=vi.fn(async()=>true),discard=vi.fn();ui.setEditor({save,discard});expect(nativeBinding.dirty()).toBe(true);const close=nativeX();expect(close).not.toHaveBeenCalled();await ui.state.saveMarkingAndContinue();expect(save).toHaveBeenCalledOnce();expect(close).toHaveBeenCalledOnce();expect(ui.state.markingEditDirty.value).toBe(false);}finally{ui.app.unmount();}
});

it('mixed cached-image and surface drafts must both save before close; image failure cannot drop its pending decision',async()=>{
 const ui=await mount(),draft=owner();try{ui.state.markingEditDirty.value=true;const save=vi.fn(async()=>false);ui.setEditor({save,discard:vi.fn()});const close=nativeX();await ui.state.saveMarkingAndContinue();expect(draft.save).toHaveBeenCalledOnce();expect(save).toHaveBeenCalledOnce();expect(close).not.toHaveBeenCalled();expect(ui.state.markingEditDirty.value).toBe(true);save.mockResolvedValue(true);await ui.state.saveMarkingAndContinue();expect(draft.save).toHaveBeenCalledOnce();expect(save).toHaveBeenCalledTimes(2);expect(close).toHaveBeenCalledOnce();}finally{ui.app.unmount();}
});

it('discarding both draft kinds preserves saved state and clears both before close',async()=>{
 const ui=await mount(),draft=owner();try{ui.state.markingEditDirty.value=true;const discard=vi.fn();ui.setEditor({save:vi.fn(),discard});const close=nativeX();ui.state.discardMarkingAndContinue();expect(draft.discard).toHaveBeenCalledOnce();expect(discard).toHaveBeenCalledOnce();expect(ui.state.markingEditDirty.value).toBe(false);expect(close).toHaveBeenCalledOnce();}finally{ui.app.unmount();}
});

it('native X first prepares queued pointer work before deciding whether the renderer is clean',async()=>{
 const ui=await mount(),dirty=Vue.ref(false),prepare=vi.fn(()=>{dirty.value=true;}),discard=vi.fn(()=>{dirty.value=false;});owners.push(transforms.registerSurfaceTransforms({dirty:()=>dirty.value,prepare,save:vi.fn(async()=>true),discard}));try{expect(nativeBinding.dirty()).toBe(false);const close=nativeX();expect(prepare).toHaveBeenCalledOnce();expect(nativeBinding.dirty()).toBe(true);expect(close).not.toHaveBeenCalled();expect(ui.state.pendingMarkingAction.value).toBeTypeOf('function');}finally{ui.app.unmount();}
});

