import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {parse,compileScript} from '@vue/compiler-sfc';
import {readFile,mkdir,mkdtemp,writeFile} from 'node:fs/promises';
import {resolve,dirname,basename} from 'node:path';
import {pathToFileURL} from 'node:url';

// Actual Vue rendering and handlers run under a custom renderer. DOM/IPC
// substitutes allow component behavior coverage without launching Electron.
class HostNode {
 get ownerDocument(){return document;}
 constructor(tag=''){this.tag=tag;this.tagName=tag.toUpperCase();this.children=[];this.parentNode=null;this.attrs={};this.style={};this.listeners=new Map();this.value='';this.defaultValue='';this.type='';this.nodeType=1;}
 get textContent(){return this.text??this.children.map(n=>n.textContent).join('');}
 set textContent(value){this.text=String(value);this.children=[];}
 get options(){return this.children.filter(n=>n.tag==='option');}
 get selectedIndex(){return this.options.findIndex(n=>n.selected);}
 set selectedIndex(i){this.options.forEach((n,j)=>{n.selected=j===i;});}
 get multiple(){return !!this.attrs.multiple;}
 addEventListener(type,listener){this.listeners.set(type,[...(this.listeners.get(type)??[]),listener]);}
 removeEventListener(type,listener){this.listeners.set(type,(this.listeners.get(type)??[]).filter(l=>l!==listener));}
 dispatchEvent(event){for(const listener of this.listeners.get(event.type)??[])listener({target:this,currentTarget:this,type:event.type});return true;}
 setAttribute(name,value){this.attrs[name]=value;}
 removeAttribute(name){delete this.attrs[name];}
 getAttribute(name){return this.attrs[name];}
 getRootNode(){return document;}
 getBoundingClientRect(){return {x:0,y:0,left:0,top:0,width:720,height:540};}
 getClientRects(){return [this.getBoundingClientRect()];}
 setPointerCapture(){}
 releasePointerCapture(){}
 closest(){return null;}
 querySelector(selector){return walk(this).find(n=>n.tag===selector||n.attrs.class?.split(' ').includes(selector.slice(1)));}
}
class HostCanvas extends HostNode {constructor(){super('canvas');}}
class Matrix {
 constructor(values=[1,0,0,1,0,0]){[this.a,this.b,this.c,this.d,this.e,this.f]=values;}
 inverse(){const det=this.a*this.d-this.b*this.c;return new Matrix([this.d/det,-this.b/det,-this.c/det,this.a/det,(this.c*this.f-this.d*this.e)/det,(this.b*this.e-this.a*this.f)/det]);}
}
class Point {constructor(x=0,y=0){this.x=x;this.y=y;}matrixTransform(m){return new Point(m.a*this.x+m.c*this.y+m.e,m.b*this.x+m.d*this.y+m.f);}}
const windowEvents=new EventTarget();
globalThis.HTMLElement=HostNode;globalThis.Element=HostNode;globalThis.HTMLCanvasElement=HostCanvas;globalThis.SVGElement=class {};globalThis.SVGSVGElement=class {};globalThis.DOMMatrix=Matrix;globalThis.DOMPoint=Point;
globalThis.Document=class {};globalThis.ShadowRoot=class {};
globalThis.document={documentElement:new HostNode('html'),createElement:tag=>new HostNode(tag),querySelector:()=>null,activeElement:null};
globalThis.getComputedStyle=()=>({getPropertyValue:()=>'',borderLeftWidth:'0',borderRightWidth:'0',borderTopWidth:'0',borderBottomWidth:'0',paddingLeft:'0',paddingRight:'0',paddingTop:'0',paddingBottom:'0'});
globalThis.window={addEventListener:windowEvents.addEventListener.bind(windowEvents),removeEventListener:windowEvents.removeEventListener.bind(windowEvents),dispatchEvent:windowEvents.dispatchEvent.bind(windowEvents)};
const {createRenderer,h,nextTick}=await import('vue');
await mkdir('.local/tests',{recursive:true});await mkdir('test-results',{recursive:true});
const directory=resolve(await mkdtemp('.local/tests/model-controls-')),file=resolve(directory,'fixture.mjs');
await build({stdin:{contents:"export {default as UnwrapTools} from './apps/desktop/src/UnwrapTools.vue';export {default as ModelEditControls} from './apps/desktop/src/ModelEditControls.vue';export {default as PatternDirection} from './apps/desktop/src/PatternDirection.vue';export {useSession} from './apps/desktop/src/store';export {useModelEdit} from './apps/desktop/src/modules/modelEditContext';export {createPinia} from 'pinia';",sourcefile:'controls-component.ts',resolveDir:resolve('.'),loader:'ts'},outfile:file,bundle:true,format:'esm',platform:'node',packages:'external',plugins:[{name:'component-vue',setup(builder){builder.onLoad({filter:/\.vue$/},async({path})=>{
 if(basename(path)==='CutAssemblyPreview.vue')return {contents:"import {h} from 'vue';export default {render(){return h('div');}};",loader:'js'};
 const {descriptor}=parse(await readFile(path,'utf8'));return {contents:compileScript(descriptor,{id:'component',inlineTemplate:true,templateOptions:{compilerOptions:{hoistStatic:false}}}).content,loader:'ts',resolveDir:dirname(path)};
});}}]});
const {UnwrapTools,ModelEditControls,PatternDirection,useSession,useModelEdit,createPinia}=await import(pathToFileURL(file).href);
const renderer=createRenderer({
 createElement:tag=>new HostNode(tag),createText:text=>{const n=new HostNode('#text');n.textContent=text;return n;},createComment:text=>{const n=new HostNode('#comment');n.textContent=text;return n;},
 setText:(n,text)=>{n.textContent=text;},setElementText:(n,text)=>{n.textContent=text;},parentNode:n=>n.parentNode,nextSibling:n=>n.parentNode?.children[n.parentNode.children.indexOf(n)+1]??null,
 insert(n,parent,anchor){if(n.parentNode){const i=n.parentNode.children.indexOf(n);if(i>=0)n.parentNode.children.splice(i,1);}const i=anchor?parent.children.indexOf(anchor):-1;parent.children.splice(i<0?parent.children.length:i,0,n);n.parentNode=parent;},
 remove(n){if(n.parentNode){const i=n.parentNode.children.indexOf(n);if(i>=0)n.parentNode.children.splice(i,1);n.parentNode=null;}},
 patchProp(n,key,previous,value){n.attrs[key]=value;if(key==='value'){n.value=value;n._value=value;}if(key==='type')n.type=value;if(key==='checked')n.checked=value;}
});
function walk(node){return [node,...node.children.flatMap(walk)];}
async function flush(){await nextTick();await Promise.resolve();await nextTick();}
function project(){return {id:'project',revision:1,schemaVersion:2,name:'Component fixture',unit:'mm',defaultAllowanceMm:10,pieces:[],bindings:[],markings:[],surface:{id:'surface',topologyVersion:1,source:'obj',vertices:[{id:'v0',xMm:0,yMm:0,zMm:0},{id:'v1',xMm:100,yMm:0,zMm:0},{id:'v2',xMm:0,yMm:100,zMm:0}],faces:[{id:'face',vertices:['v0','v1','v2'],region:'ear'}]}};}
async function mount(Component,props={}){
 const pinia=createPinia(),store=useSession(pinia),edit=useModelEdit(pinia),root=new HostNode('root'),calls=[];
 store.data={project:project(),geometry:[],canUndo:false,canRedo:false,savedRevision:null,history:[],recovery:[],recent:[],jobs:[]};
 let fail=false;
 const reply=()=>({ok:true,data:{...JSON.parse(JSON.stringify(store.data)),project:{...JSON.parse(JSON.stringify(store.data.project)),revision:store.data.project.revision+1}}});
 window.fpcad={onSurfaceProgress:()=>()=>{},apply:async(...args)=>{calls.push({method:'apply',args});if(fail)return {ok:false,error:{code:'TEST_REJECTED'}};const response=reply();if(args[2].type==='project.allowance')response.data.project.defaultAllowanceMm=args[2].widthMm;return response;},unwrapSurface:async(...args)=>{calls.push({method:'unwrap',args});return reply();}};
 const app=renderer.createApp({render:()=>h(Component,{language:'en',...props})});app.use(pinia);app.mount(root);await flush();
 const byLabel=label=>{const n=walk(root).find(n=>n.attrs['aria-label']===label);assert(n,'missing control: '+label);return n;};
 const button=text=>{const n=walk(root).find(n=>n.tag==='button'&&n.textContent===text);assert(n,'missing button: '+text);return n;};
 const click=async n=>{assert(!n.attrs.disabled,'control is disabled');await n.attrs.onClick({button:0});await flush();};
 const model=async(n,value)=>{n.attrs['onUpdate:modelValue'](value);await flush();};
 return {app,root,store,edit,calls,byLabel,button,click,model,reject:()=>{fail=true;}};
}
const checks=[];
for(const cm of [0,10,2.5]){
 const f=await mount(UnwrapTools);try{
  await f.model(f.byLabel('Cut seam allowance cm'),cm);await f.click(f.button('Cut and compute pattern candidate'));
  assert.deepEqual(f.calls.map(c=>c.method),['apply','unwrap']);assert.deepEqual(f.calls[0].args,['project',1,{type:'project.allowance',widthMm:cm*10}]);assert.deepEqual(f.calls[1].args.slice(0,2),['project',2]);assert.equal(f.store.data.project.defaultAllowanceMm,cm*10);
  checks.push({case:`${cm} cm allowance is saved in mm before computing with the new revision`,passed:true});
 }finally{f.app.unmount();}
}
{
 const f=await mount(UnwrapTools);try{
  for(const invalid of [-1,10.01,NaN]){await f.model(f.byLabel('Cut seam allowance cm'),invalid);assert(f.button('Cut and compute pattern candidate').attrs.disabled);assert(f.button('Apply allowance').attrs.disabled);}
  assert.equal(f.calls.length,0);await f.model(f.byLabel('Cut seam allowance cm'),2);f.reject();await f.click(f.button('Cut and compute pattern candidate'));assert.deepEqual(f.calls.map(c=>c.method),['apply']);assert.equal(f.store.data.project.revision,1);assert.equal(f.store.data.project.defaultAllowanceMm,10);
  checks.push({case:'invalid values cannot compute; rejected allowance leaves project intact and does not unwrap',passed:true});
 }finally{f.app.unmount();}
}
{
 const f=await mount(UnwrapTools);try{
  f.store.data.project={...f.store.data.project,surfaceRun:{algorithm:'lscm-arap-1',accepted:false,pieces:[],bindings:[]}};await flush();
  assert(!f.button('Accept patterns and save to library (undoable)').attrs.disabled);
  await f.model(f.byLabel('Cut seam allowance cm'),2);assert(f.button('Accept patterns and save to library (undoable)').attrs.disabled);
  await f.click(f.button('Apply allowance'));assert(f.button('Accept patterns and save to library (undoable)').attrs.disabled,'saving the new allowance does not validate the old candidate');
  await f.click(f.button('Cut and compute pattern candidate'));assert(!f.button('Accept patterns and save to library (undoable)').attrs.disabled);
  checks.push({case:'an edited allowance requires recomputing before the visible candidate can be accepted',passed:true});
 }finally{f.app.unmount();}
}
{
 const f=await mount(ModelEditControls);try{
  await f.model(f.byLabel('Model translation x mm'),12);await f.model(f.byLabel('Model rotation z degrees'),90);await f.model(f.byLabel('Model scale y'),2);await f.click(f.button('Apply model transform (undoable)'));
  assert.deepEqual(f.calls[0].args,['project',1,{type:'surface.transform',translationMm:{x:12,y:0,z:0},rotationDeg:{x:0,y:0,z:90},scale:{x:1,y:2,z:1}}]);
  f.edit.selectVertex('v0');f.edit.selectVertex('v1',true);await flush();await f.click(f.button('Apply model transform (undoable)'));assert.deepEqual(f.calls[1].args[2].vertexIds,['v0','v1']);assert(!('regions' in f.calls[1].args[2]));
  f.edit.selectVertex('v0',true);assert.deepEqual(f.edit.selectedVertexIds,['v1']);f.edit.selectRegion('ear');await flush();await f.click(f.button('Apply model transform (undoable)'));assert.deepEqual(f.calls[2].args[2].regions,['ear']);assert(!('vertexIds' in f.calls[2].args[2]));
  await f.model(f.byLabel('Model scale x'),0);assert(f.button('Apply model transform (undoable)').attrs.disabled);
  await f.model(f.byLabel('Model scale x'),1001);assert(f.button('Apply model transform (undoable)').attrs.disabled);
  f.store.data.project={...f.store.data.project,surface:{...f.store.data.project.surface,id:'replacement'}};await flush();assert.deepEqual(f.edit.selectedRegions,[]);assert.deepEqual(f.edit.selectedVertexIds,[]);assert.equal(f.edit.tool,'select');
  checks.push({case:'object, additive vertex and named region transforms produce distinct IPC selections; zero scale and cross-model selection are blocked',passed:true});
 }finally{f.app.unmount();}
}
{
 const f=await mount(ModelEditControls);try{
  f.reject();await f.model(f.byLabel('Model translation z mm'),15);await f.click(f.button('Apply model transform (undoable)'));assert.equal(f.store.data.project.revision,1);assert.equal(Number(f.byLabel('Model translation z mm').value),15);
  checks.push({case:'rejected model transform retains numerical draft and project revision',passed:true});
 }finally{f.app.unmount();}
}
for(const grainRad of [undefined,Math.PI/2,0]){
 const f=await mount(PatternDirection,{furRad:0,grainRad,anchor:{xMm:40,yMm:50,clearanceMm:30}});try{
  const directions=walk(f.root).filter(n=>n.attrs['data-angle-rad']!==undefined),fur=directions.find(n=>n.attrs.class==='piece-direction-fur');assert.equal(fur.attrs['data-angle-rad'],0);assert.equal(directions.length,grainRad===Math.PI/2?2:1);
  assert.equal(f.byLabel('Piece fur and fabric direction').attrs.transform,'translate(40,-50)');if(grainRad===Math.PI/2)assert(walk(f.root).some(n=>n.attrs.transform==='rotate(-90)'));
  assert(grainRad===0?f.root.textContent.includes('Fur / grain'):f.root.textContent.includes('Fur'));
  checks.push({case:`direction arrows preserve fur and ${grainRad===undefined?'unknown':grainRad===0?'matching':'separate'} fabric direction`,passed:true});
 }finally{f.app.unmount();}
}
await writeFile('test-results/model-manufacturing-controls-component.json',JSON.stringify({passed:true,verification:'Vue custom renderer component handlers; no Electron display verification',checks},null,2));
console.log(JSON.stringify({passed:true,verification:'Vue component logic',checks}));
