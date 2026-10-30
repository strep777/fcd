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
import * as nativeClose from '../../apps/desktop/src/modules/useNativeDraftCloseGuard';
import * as context from '../../apps/desktop/src/modules/patternEditorContext';
import * as localization from '../../apps/desktop/src/localization';
import * as i18n from '../../apps/desktop/src/i18n';
import {project} from '../fixtures';
import type {Session} from '../../packages/schema/index';

// Execute the real App template, session publication and editor context. Small
// child probes expose component lifetime/local drafts without a GPU or browser.
class HostNode {
 __v_skip=true;children:HostNode[]=[];parentNode:HostNode|null=null;attrs:Record<string,any>={};style:Record<string,unknown>={};value:unknown='';_value:unknown;tagName:string;text:string|undefined;selected=false;selectedIndex=-1;multiple=false;
 constructor(readonly tag:string){this.tagName=tag.toUpperCase();}
 get options(){return this.children.filter(node=>node.tag==='option');}
 get textContent():string{return this.text??this.children.map(node=>node.textContent).join('');}
 set textContent(value:string){this.text=value;this.children=[];}
 addEventListener(){}removeEventListener(){}setAttribute(key:string,value:unknown){this.attrs[key]=value;}removeAttribute(key:string){delete this.attrs[key];}
 getClientRects(){return [{}];}focus(){(document as any).activeElement=this;}
}
function walk(node:HostNode):HostNode[]{return [node,...node.children.flatMap(walk)];}
const mounts:{name:string;sessionId:string|undefined;instance:number}[]=[];let nextInstance=0;
const targets:Record<string,string[]>={ModelManagementPage:['model-viewport'],MappingPage:['mapping-viewport'],CuttingPage:['cutting-viewport','cutting-pattern-viewport'],PatternPage:['pattern-viewport']};
const children=new Map<string,unknown>();
function child(name:string){if(!children.has(name))children.set(name,Vue.defineComponent({name,setup(){const store=useSession(),instance=++nextInstance,draft=Vue.ref('');mounts.push({name,sessionId:store.data.sessionId,instance});return()=>Vue.h('section',{'data-probe':name,'data-instance':instance},[Vue.h('input',{'data-draft':name,value:draft.value,onInput:(event:any)=>{draft.value=event.target.value;}}),...(targets[name]??[]).map(id=>Vue.h('div',{id}))]);}}));return children.get(name);}
const script=compileScript(parse(readFileSync('apps/desktop/src/App.vue','utf8')).descriptor,{id:'session-page-cache',inlineTemplate:true,templateOptions:{compilerOptions:{hoistStatic:false}}});
const compiled=transformSync(script.content,{loader:'ts',format:'cjs'}).code,loaded={exports:{} as any};
new Function('require','module','exports',compiled)((name:string)=>name==='vue'?Vue:name==='./store'?{useSession}:name==='./localization'?localization:name==='./i18n'?i18n:name.endsWith('/usePatternEditor')?{usePatternEditor}:name.endsWith('/useDraftHistory')?history:name.endsWith('/draft-history')?stamps:name.endsWith('/workflow-tabs')?tabs:name.endsWith('/surfaceTransformDraftGuard')?transforms:name.endsWith('/useNativeDraftCloseGuard')?nativeClose:name.endsWith('/patternEditorContext')?context:name.endsWith('.vue')?{__esModule:true,default:child(name.slice(2,-4))}:{},loaded,loaded.exports);
const App=loaded.exports.default;
async function flush(){for(let i=0;i<5;i++){await Promise.resolve();await Vue.nextTick();}}
const apps:{unmount:()=>void}[]=[];
afterEach(()=>{for(const app of apps.splice(0))app.unmount();vi.unstubAllGlobals();});
async function mount(){
 mounts.length=0;setActivePinia(createPinia());const store=useSession(),root=new HostNode('root'),events=new EventTarget(),p=project();
 const session=(sessionId:string):Session=>({sessionId,project:{...p},geometry:[],canUndo:false,canRedo:false,savedRevision:null,recovery:[],history:[],recent:[],jobs:[]});
 vi.stubGlobal('HTMLElement',HostNode);vi.stubGlobal('Element',HostNode);const query=(selector:string)=>selector.startsWith('#')?walk(root).find(node=>node.attrs.id===selector.slice(1))??null:null;
 vi.stubGlobal('document',{querySelector:query,activeElement:null});vi.stubGlobal('window',{fpcad:{read:async()=>({ok:true,data:session('startup')}),onChanged:()=>()=>{},onStorageError:()=>()=>{}},addEventListener:events.addEventListener.bind(events),removeEventListener:events.removeEventListener.bind(events),dispatchEvent:events.dispatchEvent.bind(events)});
 const renderer=Vue.createRenderer<HostNode,HostNode>({createElement:tag=>new HostNode(tag),createText:text=>{const node=new HostNode('#text');node.textContent=text;return node;},createComment:()=>new HostNode('#comment'),setText:(node,text)=>{node.textContent=text;},setElementText:(node,text)=>{node.textContent=text;},parentNode:node=>node.parentNode,nextSibling:node=>node.parentNode?.children[node.parentNode.children.indexOf(node)+1]??null,insert(node,parent,anchor){if(node.parentNode){const previous=node.parentNode.children.indexOf(node);if(previous>=0)node.parentNode.children.splice(previous,1);}const index=anchor?parent.children.indexOf(anchor):-1;parent.children.splice(index<0?parent.children.length:index,0,node);node.parentNode=parent;},remove(node){if(node.parentNode){const index=node.parentNode.children.indexOf(node);if(index>=0)node.parentNode.children.splice(index,1);node.parentNode=null;}},patchProp(node,key,_,value){node.attrs[key]=value;if(key==='value'){node.value=value;node._value=value;}},querySelector:query});
 const app=renderer.createApp(App);app.mount(root);apps.push(app);await flush();await store.run(async()=>({ok:true,data:session('first')}));await flush();
 const stage=async(value:tabs.Stage)=>{const button=walk(root).find(node=>node.attrs['data-stage']===value)!;expect(button).toBeDefined();button.attrs.onClick();await flush();};
 const probe=(name:string)=>walk(root).find(node=>node.attrs['data-probe']===name),draft=(name:string)=>walk(root).find(node=>node.attrs['data-draft']===name)!;
 return {app,store,root,stage,probe,draft,switch:async(id:string)=>{await store.run(async()=>({ok:true,data:session(id)}));await flush();}};
}

it('does not rebuild historical hidden pages or parked previews when another session opens at the current stage',async()=>{
 const ui=await mount();await ui.stage('model');await ui.stage('mapping');await ui.stage('cutting');await ui.stage('pattern');await ui.stage('references');expect(ui.probe('ModelViewport')).toBeDefined();expect(ui.probe('PatternCanvas')).toBeDefined();
 await ui.switch('other');const created=mounts.filter(entry=>entry.sessionId==='other').map(entry=>entry.name);expect(created).toContain('MarkingsPage');for(const name of ['ModelManagementPage','MappingPage','CuttingPage','PatternPage','ModelViewport','PatternCanvas']){expect(created).not.toContain(name);expect(ui.probe(name)).toBeUndefined();}
 await ui.stage('mapping');expect(ui.probe('MappingPage')).toBeDefined();expect(ui.probe('ModelViewport')!.parentNode!.attrs.id).toBe('mapping-viewport');
});

it('retains local page drafts across same-session navigation and refreshes',async()=>{
 const ui=await mount(),first=ui.probe('MarkingsPage');ui.draft('MarkingsPage').attrs.onInput({target:{value:'Uncommitted selection'}});await flush();await ui.stage('model');await ui.stage('references');expect(ui.probe('MarkingsPage')).toBe(first);expect(ui.draft('MarkingsPage').attrs.value).toBe('Uncommitted selection');
 await ui.switch('first');expect(ui.probe('MarkingsPage')).toBe(first);expect(ui.draft('MarkingsPage').attrs.value).toBe('Uncommitted selection');
});

it('rebinds a model preview to the replacement target for another session while retaining same-session preview drafts',async()=>{
 const ui=await mount();await ui.stage('model');const viewport=ui.probe('ModelViewport')!,target=viewport.parentNode;expect(target!.attrs.id).toBe('model-viewport');ui.draft('ModelViewport').attrs.onInput({target:{value:'Uncommitted model view'}});await flush();
 await ui.stage('mapping');await ui.stage('model');expect(ui.probe('ModelViewport')).toBe(viewport);expect(ui.draft('ModelViewport').attrs.value).toBe('Uncommitted model view');
 await ui.switch('other');const replacement=ui.probe('ModelViewport')!,currentTarget=walk(ui.root).find(node=>node.attrs.id==='model-viewport');expect(replacement).toBeDefined();expect(replacement).not.toBe(viewport);expect(currentTarget).toBeDefined();expect(currentTarget).not.toBe(target);expect(replacement.parentNode).toBe(currentTarget);
});

it('creates the 2D preview on first use, preserves its state between targets and remounts only the current page for another session',async()=>{
 const ui=await mount();expect(ui.probe('PatternCanvas')).toBeUndefined();await ui.stage('model');expect(ui.probe('PatternCanvas')).toBeUndefined();await ui.stage('cutting');const canvas=ui.probe('PatternCanvas')!;expect(canvas.parentNode!.attrs.id).toBe('cutting-pattern-viewport');ui.draft('PatternCanvas').attrs.onInput({target:{value:'Saved preview camera'}});await flush();
 await ui.stage('pattern');expect(ui.probe('PatternCanvas')).toBe(canvas);expect(canvas.parentNode!.attrs.id).toBe('pattern-viewport');expect(ui.draft('PatternCanvas').attrs.value).toBe('Saved preview camera');await ui.stage('references');expect(ui.probe('PatternCanvas')).toBe(canvas);expect(canvas.parentNode!.attrs.id).toBe('preview-parking');await ui.stage('pattern');
 const previousTarget=canvas.parentNode;await ui.switch('other');expect(ui.probe('PatternPage')).toBeDefined();const replacement=ui.probe('PatternCanvas')!,currentTarget=walk(ui.root).find(node=>node.attrs.id==='pattern-viewport');expect(replacement).toBeDefined();expect(replacement).not.toBe(canvas);expect(currentTarget).toBeDefined();expect(currentTarget).not.toBe(previousTarget);expect(replacement.parentNode).toBe(currentTarget);expect(ui.probe('MarkingsPage')).toBeUndefined();expect(ui.probe('CuttingPage')).toBeUndefined();
});
