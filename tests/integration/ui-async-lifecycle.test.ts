import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import * as Vue from 'vue';
import {createPinia,setActivePinia} from 'pinia';
import {parse,compileScript} from '@vue/compiler-sfc';
import {transformSync} from 'esbuild';
import {readFileSync} from 'node:fs';
import {useSession} from '../../apps/desktop/src/store';
import * as localization from '../../apps/desktop/src/localization';
import * as assistantConfig from '../../packages/schema/assistant-config';
import * as draftHistory from '../../packages/ui/draft-history';
import * as activity from '../../apps/desktop/src/modules/useDelayedActivity';
import {project} from '../fixtures';

// Run the production SFC setup in a renderer with no browser or geometry work.
function component(name:string){
 const script=compileScript(parse(readFileSync(`apps/desktop/src/${name}.vue`,'utf8')).descriptor,{id:name});
 const compiled=transformSync(script.content,{loader:'ts',format:'cjs'}).code,loaded={exports:{} as any};
 new Function('require','module','exports',compiled)((path:string)=>path==='vue'?Vue:path==='./store'?{useSession}:path==='./localization'?localization:path.endsWith('/useDelayedActivity')?activity:path.endsWith('/assistant-config')?assistantConfig:path.endsWith('/draft-history')?draftHistory:{default:{}},loaded,loaded.exports);
 return loaded.exports.default;
}
const CutSelection=component('CutSelection'),AssistantConnection=component('AssistantConnection'),AssistantPage=component('AssistantPage');
const renderer=Vue.createRenderer<any,any>({createElement:tag=>({tag,children:[]}),createComment:text=>({text}),createText:text=>({text}),insert:(n,p)=>p.children.push(n),remove(){},setText(){},setElementText(){},parentNode:()=>null,nextSibling:()=>null,patchProp(){}});
function mount(component:any,props:Record<string,unknown>={language:'en'}){let state:any;const app=renderer.createApp(Vue.defineComponent({setup(){state=component.setup(Vue.reactive(props),{emit:vi.fn(),expose(){}});return ()=>null;}}));app.mount({children:[]});return {app,state};}
function deferred(){let resolve!:(value:any)=>void,reject!:(error:Error)=>void;const promise=new Promise<any>((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};}
async function flush(){await Vue.nextTick();await Vue.nextTick();}
const api={patternPreview:vi.fn(),patternOverview:vi.fn(),assistant:vi.fn(),assistantSettings:vi.fn()};
beforeEach(()=>{setActivePinia(createPinia());for(const method of Object.values(api))method.mockReset();const events=new EventTarget();vi.stubGlobal('window',{fpcad:api,addEventListener:events.addEventListener.bind(events),removeEventListener:events.removeEventListener.bind(events)});});
afterEach(()=>{vi.useRealTimers();vi.unstubAllGlobals();});
function previews(){const store=useSession();store.data={project:project(),geometry:[],canUndo:false,canRedo:false,savedRevision:null,recovery:[],history:[],recent:[],jobs:[]};const ui=mount(CutSelection,{language:'en',selectedId:store.data.project!.pieces[0].id,paper:{widthMm:210,heightMm:297,marginMm:10,overlapMm:10}});return {...ui,store};}
const preview=(svg:string)=>({ok:true,printPreview:{svg,plan:{},revision:0,pieceIds:[]}});

it('selects every pattern by default and preserves explicit exclusions while new pieces join the selection',async()=>{
 const ui=previews();try{const original=ui.store.data.project!.pieces.map(piece=>piece.id);expect(ui.state.chosen.value).toEqual(original);ui.state.chosen.value=[];ui.store.data.project={...ui.store.data.project!,revision:1,pieces:ui.store.data.project!.pieces.map(piece=>({...piece,name:'Edited'}))};await flush();expect(ui.state.chosen.value).toEqual([]);
  const next={...ui.store.data.project!.pieces[0],id:crypto.randomUUID()};ui.store.data.project!.pieces=[...ui.store.data.project!.pieces,next];await flush();expect(ui.state.chosen.value).toEqual([next.id]);ui.store.data.project!.pieces=ui.store.data.project!.pieces.filter(piece=>piece.id!==next.id);await flush();expect(ui.state.chosen.value).toEqual([]);
  const replacement=project();ui.store.data.project=replacement;await flush();expect(ui.state.chosen.value).toEqual(replacement.pieces.map(piece=>piece.id));
 }finally{ui.app.unmount();}
});

it('closing a preview invalidates late answers without releasing a newer preview lock',async()=>{
 const old=deferred(),next=deferred();api.patternPreview.mockReturnValueOnce(old.promise).mockReturnValueOnce(next.promise);const ui=previews();
 try{const first=ui.state.showPreview(true);expect(ui.state.previewBusy.value).toBe(true);ui.state.closePreview();const second=ui.state.showPreview(true);old.resolve(preview('old'));await first;expect(ui.state.preview.value).toBeUndefined();expect(ui.state.previewBusy.value).toBe(true);next.resolve(preview('current'));await second;expect(ui.state.preview.value.svg).toBe('current');expect(ui.state.previewBusy.value).toBe(false);expect(ui.store.data.project!.revision).toBe(0);}finally{ui.app.unmount();}
});

it('select all only changes filtered patterns and leaves hidden selections intact',async()=>{
 const ui=previews();try{const first=ui.store.data.project!.pieces[0],other={...first,id:crypto.randomUUID(),name:'Hidden pattern'};ui.store.data.project!.pieces=[{...first,name:'Visible pattern'},other];await flush();ui.state.search.value='Visible';expect(ui.state.allSelected.value).toBe(true);ui.state.toggleAll();expect(ui.state.chosen.value).toEqual([other.id]);expect(ui.state.allSelected.value).toBe(false);ui.state.toggleAll();expect(new Set(ui.state.chosen.value)).toEqual(new Set([first.id,other.id]));}finally{ui.app.unmount();}
});

it('preview work locks immediately and shows activity only for a sustained request',async()=>{
 vi.useFakeTimers();const pending=deferred();api.patternPreview.mockReturnValueOnce(pending.promise);const ui=previews();try{const request=ui.state.showPreview(true);expect(ui.state.previewBusy.value).toBe(true);expect(ui.state.previewWorking.value).toBe(false);await vi.advanceTimersByTimeAsync(activity.activityDelayMs);expect(ui.state.previewWorking.value).toBe(true);pending.resolve(preview('current'));await request;expect(ui.state.previewBusy.value).toBe(false);expect(ui.state.previewWorking.value).toBe(false);expect(vi.getTimerCount()).toBe(0);}finally{ui.app.unmount();}
});

it('a preview that completes before feedback delay never flashes a loading indicator',async()=>{
 vi.useFakeTimers();api.patternPreview.mockResolvedValueOnce(preview('fast'));const ui=previews();try{await ui.state.showPreview(true);await vi.advanceTimersByTimeAsync(activity.activityDelayMs);expect(ui.state.previewWorking.value).toBe(false);expect(ui.state.preview.value.svg).toBe('fast');expect(vi.getTimerCount()).toBe(0);}finally{ui.app.unmount();}
});

it('unmounting a preview suppresses a late failure and does not reopen either dialog',async()=>{
 const pending=deferred();api.patternPreview.mockReturnValueOnce(pending.promise);const ui=previews(),request=ui.state.showPreview(true);ui.app.unmount();pending.reject(Error('offline'));await request;expect(ui.state.preview.value).toBeUndefined();expect(ui.state.overview.value).toBeUndefined();expect(ui.state.previewBusy.value).toBe(false);expect(ui.store.error).toBe('');
});

it('a preview requested for an older project revision cannot publish an error or reopen',async()=>{
 const pending=deferred();api.patternPreview.mockReturnValueOnce(pending.promise);const ui=previews();try{const request=ui.state.showPreview(true);ui.store.data.project!.revision++;pending.resolve({ok:false,error:{code:'OLD_REVISION'}});await request;await flush();expect(ui.state.preview.value).toBeUndefined();expect(ui.state.previewBusy.value).toBe(false);expect(ui.store.error).toBe('');}finally{ui.app.unmount();}
});

it('an older connection status cannot overwrite a completed toggle',async()=>{
 vi.useFakeTimers();const pending=deferred(),enabled={enabled:true,connected:false,endpoint:'http://127.0.0.1:1234',token:'test'};api.assistant.mockReturnValueOnce(pending.promise).mockResolvedValueOnce({ok:true,connection:enabled});const ui=mount(AssistantConnection);
 try{expect(api.assistant).toHaveBeenCalledWith('status');await ui.state.toggle();pending.resolve({ok:true,connection:{...enabled,enabled:false}});await flush();expect(ui.state.connection.value.enabled).toBe(true);expect(ui.state.busy.value).toBe(false);expect(ui.state.error.value).toBe('');}finally{ui.app.unmount();}expect(vi.getTimerCount()).toBe(0);
});

it('failed background status reads are contained and polling stops on unmount',async()=>{
 vi.useFakeTimers();api.assistant.mockRejectedValue(Error('offline'));const ui=mount(AssistantConnection);await flush();expect(ui.state.error.value).toBe('');await vi.advanceTimersByTimeAsync(3000);expect(api.assistant).toHaveBeenCalledTimes(2);ui.app.unmount();await vi.advanceTimersByTimeAsync(6000);expect(api.assistant).toHaveBeenCalledTimes(2);expect(vi.getTimerCount()).toBe(0);
});

it.each(['models','testMcp'])('unmounting during settings save prevents the %s follow-up request',async action=>{
 api.assistantSettings.mockResolvedValueOnce({ok:true,config:assistantConfig.defaultAssistantConfig()});const ui=mount(AssistantPage);await flush();const pending=deferred();api.assistantSettings.mockReturnValueOnce(pending.promise);const request=ui.state[action]('ollama');expect(api.assistantSettings.mock.calls.map(([r])=>r.action)).toEqual(['read','save']);ui.app.unmount();pending.resolve({ok:true,config:assistantConfig.defaultAssistantConfig()});await request;expect(api.assistantSettings).toHaveBeenCalledTimes(2);expect(ui.state.message.value).toBe('');
});

it('unmounting during skill file reading preserves the detached settings draft',async()=>{
 api.assistantSettings.mockResolvedValueOnce({ok:true,config:assistantConfig.defaultAssistantConfig()});const ui=mount(AssistantPage);await flush();const pending=deferred(),input={files:[{name:'SKILL.md',size:20,text:()=>pending.promise}],value:'SKILL.md'},request=ui.state.importSkill({target:input});ui.app.unmount();pending.resolve('Do something');await request;expect(ui.state.config.value.skills).toEqual([]);expect(input.value).toBe('');
});

it('skill reading locks settings until the imported content can be included in save',async()=>{
 vi.useFakeTimers();api.assistantSettings.mockResolvedValueOnce({ok:true,config:assistantConfig.defaultAssistantConfig()});const ui=mount(AssistantPage);await flush();const pending=deferred(),input={files:[{name:'SKILL.md',size:20,text:()=>pending.promise}],value:'SKILL.md'};try{const reading=ui.state.importSkill({target:input});expect(ui.state.busy.value).toBe(true);expect(ui.state.working.value).toBe(false);expect(await ui.state.save()).toBe(false);expect(api.assistantSettings).toHaveBeenCalledTimes(1);pending.resolve('Imported instructions');await reading;expect(ui.state.busy.value).toBe(false);expect(ui.state.config.value.skills[0].content).toBe('Imported instructions');api.assistantSettings.mockResolvedValueOnce({ok:true,config:ui.state.config.value});await ui.state.save();expect(api.assistantSettings.mock.lastCall![0].config.skills[0].content).toBe('Imported instructions');expect(input.value).toBe('');}finally{ui.app.unmount();}
});

it('oversized skill input can be selected again after showing its size error',async()=>{
 api.assistantSettings.mockResolvedValueOnce({ok:true,config:assistantConfig.defaultAssistantConfig()});const ui=mount(AssistantPage);await flush();const read=vi.fn(),input={files:[{name:'SKILL.md',size:100001,text:read}],value:'SKILL.md'};try{await ui.state.importSkill({target:input});expect(input.value).toBe('');expect(read).not.toHaveBeenCalled();expect(ui.state.busy.value).toBe(false);expect(ui.state.failed.value).toBe(true);expect(ui.state.message.value).toContain('too large');}finally{ui.app.unmount();}
});
