import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import * as Vue from 'vue';
import {createPinia,setActivePinia} from 'pinia';
import {parse,compileScript} from '@vue/compiler-sfc';
import {transformSync} from 'esbuild';
import {readFileSync} from 'node:fs';
import {useSession} from '../../apps/desktop/src/store';
import * as history from '../../apps/desktop/src/modules/useDraftHistory';
import * as localization from '../../apps/desktop/src/localization';
import * as resources from '../../packages/reference/resources';
import * as crossView from '../../packages/reference/cross-view';
import * as pen from '../../packages/reference/pen-path';
import * as scene from '../../apps/desktop/src/modules/reference-scene';
import * as activity from '../../apps/desktop/src/modules/useDelayedActivity';
import {project} from '../fixtures';
import type {Reference} from '../../packages/schema/index';

// Exercise the actual SFC setup. Only the browser worker and its URL are
// substituted; no mask/contour algorithms run in these lifecycle cases.
const script=compileScript(parse(readFileSync('apps/desktop/src/MaskEditor.vue','utf8')).descriptor,{id:'mask-task-state'});
const compiled=transformSync(script.content.replace("new URL('./mask-worker.ts',import.meta.url)","'mask-worker-test'"),{loader:'ts',format:'cjs'}).code,loaded={exports:{} as any};
new Function('require','module','exports',compiled)((name:string)=>name==='vue'?Vue:name==='./store'?{useSession}:name==='./localization'?localization:name.endsWith('/useDelayedActivity')?activity:name.endsWith('/useDraftHistory')?history:name.endsWith('/resources')?resources:name.endsWith('/cross-view')?crossView:name.endsWith('/pen-path')?pen:name.endsWith('/reference-scene')?scene:{default:{}},loaded,loaded.exports);
const MaskEditor=loaded.exports.default;
const renderer=Vue.createRenderer<any,any>({createElement:tag=>({tag,children:[]}),createComment:text=>({text}),createText:text=>({text}),insert:(n,p)=>p.children.push(n),remove(){},setText(){},setElementText(){},parentNode:()=>null,nextSibling:()=>null,patchProp(){}});
const workers:{onmessage?:({data}:{data:any})=>Promise<void>;onerror?:()=>void;onmessageerror?:()=>void;postMessage:ReturnType<typeof vi.fn>;terminate:ReturnType<typeof vi.fn>}[]=[];
const reference:Reference={id:'10000000-0000-4000-8000-000000000021',name:'Mask source',view:'front',width:32,height:32,png:'data:image/png;base64,AA==',calibration:{a:{x:0,y:32},b:{x:0,y:0},distanceMm:320}};
beforeEach(()=>{setActivePinia(createPinia());workers.length=0;const events=new EventTarget();vi.stubGlobal('window',{fpcad:{maskReference:vi.fn(),cancelSurface:vi.fn()},addEventListener:events.addEventListener.bind(events),removeEventListener:events.removeEventListener.bind(events),dispatchEvent:events.dispatchEvent.bind(events)});vi.stubGlobal('document',{querySelector:()=>null});vi.stubGlobal('Worker',class {onmessage?:({data}:{data:any})=>Promise<void>;onerror?:()=>void;onmessageerror?:()=>void;postMessage=vi.fn();terminate=vi.fn();constructor(){workers.push(this);}});});
afterEach(()=>{vi.useRealTimers();vi.unstubAllGlobals();});
function mount(){const store=useSession(),p=project();p.references=[reference];store.data={project:p,geometry:[],canUndo:false,canRedo:false,savedRevision:null,recovery:[],history:[],recent:[],jobs:[]};let state:any;const app=renderer.createApp(Vue.defineComponent({setup(){state=MaskEditor.setup(Vue.reactive({reference,language:'en',mode:'pen'}),{emit:vi.fn(),expose(){}});return ()=>null;}}));app.mount({children:[]});state.paths.value=[{nodes:[{x:2,y:2},{x:10,y:2},{x:10,y:10},{x:2,y:10}],closed:true,subtract:false}];return {app,state,store};}

it('worker startup failure releases the lock and retains the complete editable draft',async()=>{
 vi.stubGlobal('Worker',class {constructor(){throw Error('worker unavailable');}});const ui=mount(),before=JSON.stringify(ui.state.paths.value);
 try{await ui.state.candidate();expect(ui.state.computing.value).toBe(false);expect(ui.state.locked.value).toBe(false);expect(JSON.stringify(ui.state.paths.value)).toBe(before);expect(ui.state.notice.value).toContain('draft is preserved');}finally{ui.app.unmount();}
});

it('cancellation terminates rasterization, ignores late answers and allows a new computation',async()=>{
 const ui=mount();try{await ui.state.candidate();expect(ui.state.computing.value).toBe(true);ui.state.cancelCompute();expect(workers[0].terminate).toHaveBeenCalledOnce();await workers[0].onmessage!({data:{ok:true,count:1,mask:{}}});expect(window.fpcad.maskReference).not.toHaveBeenCalled();expect(ui.state.computing.value).toBe(false);await ui.state.candidate();expect(workers).toHaveLength(2);expect(ui.state.computing.value).toBe(true);}finally{ui.app.unmount();}expect(workers[1].terminate).toHaveBeenCalledOnce();
});

it('a nonresponding worker times out, preserves the draft and cannot leave the editor disabled',async()=>{
 vi.useFakeTimers();const ui=mount();try{await ui.state.candidate();expect(ui.state.locked.value).toBe(true);expect(ui.state.selectionWorking.value).toBe(false);await vi.advanceTimersByTimeAsync(activity.activityDelayMs);expect(ui.state.selectionWorking.value).toBe(true);await vi.advanceTimersByTimeAsync(120000-activity.activityDelayMs);expect(ui.state.locked.value).toBe(false);expect(ui.state.selectionWorking.value).toBe(false);expect(ui.state.paths.value).toHaveLength(1);expect(workers[0].terminate).toHaveBeenCalledOnce();expect(vi.getTimerCount()).toBe(0);}finally{ui.app.unmount();}
});
