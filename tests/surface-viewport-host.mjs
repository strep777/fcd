import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {parse,compileScript} from '@vue/compiler-sfc';
import {readFile,mkdir,mkdtemp} from 'node:fs/promises';
import {resolve,dirname,basename} from 'node:path';
import {pathToFileURL} from 'node:url';

// Real SFCs, stores and domain functions; only browser coordinates, IPC and
// GPU presentation are substituted. This does not verify Electron pixels.
export let viewport={x:0,y:0,width:720,height:540};
export class HostNode {
 constructor(tag=''){this.__v_skip=true;this.tag=tag;this.tagName=tag.toUpperCase();this.children=[];this.parentNode=null;this.attrs={};this.style={};this.listeners=new Map();this.value='';this.type='';this.nodeType=1;}
 get textContent(){return this.text??this.children.map(n=>n.textContent).join('');}
 set textContent(v){this.text=String(v);this.children=[];}
 get options(){return this.children.filter(n=>n.tag==='option');}
 get selectedIndex(){return this.options.findIndex(n=>n.selected);}
 set selectedIndex(i){this.options.forEach((n,j)=>n.selected=j===i);}
 get multiple(){return !!this.attrs.multiple;}
 get ownerDocument(){return document;}
 addEventListener(t,l){this.listeners.set(t,[...(this.listeners.get(t)??[]),l]);}
 removeEventListener(t,l){this.listeners.set(t,(this.listeners.get(t)??[]).filter(x=>x!==l));}
 dispatchEvent(e){for(const l of this.listeners.get(e.type)??[])l({...e,target:this,currentTarget:this});return true;}
 setAttribute(k,v){this.attrs[k]=v;}
 removeAttribute(k){delete this.attrs[k];}
 getAttribute(k){return this.attrs[k];}
 getRootNode(){return document;}
 getBoundingClientRect(){return {...viewport,left:viewport.x,top:viewport.y};}
 getClientRects(){return [this.getBoundingClientRect()];}
 setPointerCapture(){}
 releasePointerCapture(){}
 closest(){return null;}
 querySelector(s){return walk(this).find(n=>n.tag===s||n.attrs.class?.split(' ').includes(s.slice(1)));}
}
class HostCanvas extends HostNode{constructor(){super('canvas');}}
class Matrix{
 constructor(v=[1,0,0,1,0,0]){[this.a,this.b,this.c,this.d,this.e,this.f]=v;}
 inverse(){const d=this.a*this.d-this.b*this.c;return new Matrix([this.d/d,-this.b/d,-this.c/d,this.a/d,(this.c*this.f-this.d*this.e)/d,(this.b*this.e-this.a*this.f)/d]);}
}
class Point{constructor(x=0,y=0){this.x=x;this.y=y;}matrixTransform(m){return new Point(m.a*this.x+m.c*this.y+m.e,m.b*this.x+m.d*this.y+m.f);}}
const windowEvents=new EventTarget();
Object.assign(globalThis,{HTMLElement:HostNode,Element:HostNode,HTMLCanvasElement:HostCanvas,SVGElement:class{},SVGSVGElement:class{},DOMMatrix:Matrix,DOMPoint:Point,Document:class{},ShadowRoot:class{}});
globalThis.document={documentElement:new HostNode('html'),createElement:t=>new HostNode(t),querySelector:()=>null,activeElement:null};
globalThis.getComputedStyle=()=>({getPropertyValue:()=>'',borderLeftWidth:'0',borderRightWidth:'0',borderTopWidth:'0',borderBottomWidth:'0',paddingLeft:'0',paddingRight:'0',paddingTop:'0',paddingBottom:'0'});
globalThis.window={addEventListener:windowEvents.addEventListener.bind(windowEvents),removeEventListener:windowEvents.removeEventListener.bind(windowEvents),dispatchEvent:windowEvents.dispatchEvent.bind(windowEvents)};
const {createRenderer,h,nextTick,reactive}=await import('vue');
await mkdir('.local/tests',{recursive:true});await mkdir('test-results',{recursive:true});
const file=resolve(await mkdtemp('.local/tests/viewport-component-'),'fixture.mjs');
await build({stdin:{contents:"export {default as UnwrapTools} from './apps/desktop/src/UnwrapTools.vue';export {default as SurfacePanel} from './apps/desktop/src/SurfacePanel.vue';export {default as ModelEditControls} from './apps/desktop/src/ModelEditControls.vue';export {useSession} from './apps/desktop/src/store';export {useModelEdit} from './apps/desktop/src/modules/modelEditContext';export {createPinia} from 'pinia';export {projectSchema} from './packages/schema/index';",sourcefile:'viewport-component.ts',resolveDir:resolve('.'),loader:'ts'},outfile:file,bundle:true,format:'esm',platform:'node',packages:'external',plugins:[{name:'viewport-sfc',setup(b){b.onLoad({filter:/\.vue$/},async({path})=>{
 if(['SurfaceGpu.vue','SurfaceCanvas.vue'].includes(basename(path)))return {contents:"import {defineComponent,h} from 'vue';export default defineComponent({inheritAttrs:false,setup(_,context){return()=>{globalThis.__viewportCapture={...context.attrs};return h('canvas',{class:'surface-view'});};}});",loader:'js'};
 if(basename(path)==='ToolIcon.vue')return {contents:"import {h} from 'vue';export default {render(){return h('i');}};",loader:'js'};
 const {descriptor}=parse(await readFile(path,'utf8'));return {contents:compileScript(descriptor,{id:'viewport',inlineTemplate:true,templateOptions:{compilerOptions:{hoistStatic:false}}}).content,loader:'ts',resolveDir:dirname(path)};
});}}]});
const {UnwrapTools,SurfacePanel,ModelEditControls,useSession,useModelEdit,createPinia,projectSchema}=await import(pathToFileURL(file).href);
const teleportTarget=new HostNode('aside');
const renderer=createRenderer({createElement:t=>t==='canvas'?new HostCanvas():new HostNode(t),createText:t=>{const n=new HostNode('#text');n.textContent=t;return n;},createComment:t=>{const n=new HostNode('#comment');n.textContent=t;return n;},setText:(n,t)=>n.textContent=t,setElementText:(n,t)=>n.textContent=t,parentNode:n=>n.parentNode,nextSibling:n=>n.parentNode?.children[n.parentNode.children.indexOf(n)+1]??null,
 insert(n,p,a){if(n.parentNode){const i=n.parentNode.children.indexOf(n);if(i>=0)n.parentNode.children.splice(i,1);}const i=a?p.children.indexOf(a):-1;p.children.splice(i<0?p.children.length:i,0,n);n.parentNode=p;},remove(n){if(n.parentNode){const i=n.parentNode.children.indexOf(n);if(i>=0)n.parentNode.children.splice(i,1);n.parentNode=null;}},patchProp(n,k,_,v){n.attrs[k]=v;if(k==='value'){n.value=v;n._value=v;}if(k==='type')n.type=v;if(k==='checked')n.checked=v;},querySelector:s=>s==='#surface-cut-draft'?teleportTarget:null});
export function walk(n){return [n,...n.children.flatMap(walk)];}
export async function flush(){await nextTick();await Promise.resolve();await nextTick();}
export const capture=()=>globalThis.__viewportCapture;
const names=['project','surface','v0','v1','v2','v3','lower','upper'];
export const id=name=>{if(!names.includes(name))names.push(name);return '10000000-0000-4000-8000-'+String(names.indexOf(name)+1).padStart(12,'0');};
export function fixtureProject(){return {id:id('project'),revision:1,schemaVersion:2,name:'Viewport fixture',unit:'mm',createdAt:'2026-10-14T00:00:00.000Z',updatedAt:'2026-10-14T00:00:00.000Z',pieces:[],bindings:[],markings:[],surface:{id:id('surface'),topologyVersion:1,source:'obj',vertices:[[0,0],[100,0],[100,100],[0,100]].map(([xMm,yMm],i)=>({id:id('v'+i),xMm,yMm,zMm:0})),faces:[{id:id('lower'),vertices:['v0','v1','v2'].map(id),region:'lower-part'},{id:id('upper'),vertices:['v0','v2','v3'].map(id),region:'upper-part'}]}};}
export async function mount(p,{mode='model',rect={x:0,y:0,width:720,height:540},controls=true,component='surface',api={}}={}){
 viewport=rect;const pinia=createPinia(),store=useSession(pinia),root=new HostNode('root'),calls=[],emits=[],props=reactive({language:'en',selectedId:'',mode});
 store.data={project:projectSchema.parse(p),geometry:[],canUndo:false,canRedo:false,savedRevision:null,history:[],recovery:[],recent:[],jobs:[]};const edit=useModelEdit(pinia);
 window.fpcad={onSurfaceProgress:()=>()=>{},apply:async(...args)=>{calls.push(args);return {ok:true,data:{...JSON.parse(JSON.stringify(store.data)),project:{...JSON.parse(JSON.stringify(store.data.project)),revision:store.data.project.revision+1}}};},...api};
 const app=renderer.createApp({render:()=>h('div',[h(component==='unwrap'?UnwrapTools:SurfacePanel,{...props,onSelect:id=>emits.push({event:'select',value:id}),onPoint:p=>emits.push({event:'point',value:p}),onChoices:ids=>emits.push({event:'choices',value:ids})}),controls?h(ModelEditControls,{language:'en'}):null])});app.use(pinia);app.mount(root);await flush();
 const button=t=>{const n=walk(root).find(n=>n.tag==='button'&&n.textContent===t);assert(n,'missing button: '+t);return n;};
 const byLabel=t=>{const n=walk(root).find(n=>n.attrs['aria-label']===t);assert(n,'missing control: '+t);return n;};
 const click=async n=>{assert(!n.attrs.disabled);await n.attrs.onClick({button:0});await flush();};
 // Independent projection for this planar fixture after the actual Front preset.
 const client=(xMm,yMm)=>{const c=capture().camera,s=Math.min(rect.width/720,rect.height/540);return {x:rect.x+rect.width/2+(xMm-c.cx)*c.factor*s,y:rect.y+rect.height/2-(yMm-c.cy)*c.factor*s};};
 const event=async(name,x,y,extra={})=>{const target=walk(root).find(n=>n instanceof HostCanvas),e={type:name.slice(2).toLowerCase(),clientX:x,clientY:y,button:0,pointerId:1,currentTarget:target,target,shiftKey:false,ctrlKey:false,metaKey:false,preventDefault(){},...extra};const fn=capture()[name];assert.equal(typeof fn,'function',name);await fn(e);await flush();};
 const key=async key=>{const e=new Event('keydown',{cancelable:true});Object.defineProperty(e,'key',{value:key});window.dispatchEvent(e);await flush();};
 const pointEvent=async(name,xMm,yMm,extra)=>{const {x,y}=client(xMm,yMm);await event(name,x,y,extra);};
 return {app,root,store,edit,calls,emits,props,button,byLabel,click,client,event,key,pointEvent};
}
