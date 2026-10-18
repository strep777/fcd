import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {parse,compileScript} from '@vue/compiler-sfc';
import {readFile,mkdir,mkdtemp,writeFile} from 'node:fs/promises';
import {resolve,dirname,basename} from 'node:path';
import {pathToFileURL} from 'node:url';

// Actual SurfacePanel rendering and handlers run under Vue's custom renderer.
// Only the canvas/GPU presentation children, browser coordinates and IPC are
// substituted. This is component logic coverage, not an Electron UI capture.
class HostNode {
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
globalThis.__surfaceCapture=undefined;
const {createRenderer,h,nextTick}=await import('vue');
await mkdir('.local/tests',{recursive:true});await mkdir('test-results',{recursive:true});
const directory=resolve(await mkdtemp('.local/tests/surface-component-')),file=resolve(directory,'fixture.mjs');
await build({stdin:{contents:"export {default as SurfacePanel} from './apps/desktop/src/SurfacePanel.vue';export {useSession} from './apps/desktop/src/store';export {createPinia} from 'pinia';",sourcefile:'surface-component.ts',resolveDir:resolve('.'),loader:'ts'},outfile:file,bundle:true,format:'esm',platform:'node',packages:'external',plugins:[{name:'component-vue',setup(builder){builder.onLoad({filter:/\.vue$/},async({path})=>{
 if(['SurfaceGpu.vue','SurfaceCanvas.vue'].includes(basename(path)))return {contents:"import {defineComponent,h} from 'vue';export default defineComponent({inheritAttrs:false,setup(_,context){return()=>{globalThis.__surfaceCapture={...context.attrs};return h('canvas',{class:'surface-view'});};}});",loader:'js'};
 if(basename(path)==='ToolIcon.vue')return {contents:"import {h} from 'vue';export default {render(){return h('i');}};",loader:'js'};
 const {descriptor}=parse(await readFile(path,'utf8'));return {contents:compileScript(descriptor,{id:'component',inlineTemplate:true,templateOptions:{compilerOptions:{hoistStatic:false}}}).content,loader:'ts',resolveDir:dirname(path)};
});}}]});
const {SurfacePanel,useSession,createPinia}=await import(pathToFileURL(file).href);
let mappingControls;
const renderer=createRenderer({
 createElement:tag=>tag==='canvas'?new HostCanvas():new HostNode(tag),createText:text=>{const n=new HostNode('#text');n.textContent=text;return n;},createComment:text=>{const n=new HostNode('#comment');n.textContent=text;return n;},
 setText:(n,text)=>{n.textContent=text;},setElementText:(n,text)=>{n.textContent=text;},parentNode:n=>n.parentNode,nextSibling:n=>n.parentNode?.children[n.parentNode.children.indexOf(n)+1]??null,
 insert(n,parent,anchor){if(n.parentNode){const i=n.parentNode.children.indexOf(n);if(i>=0)n.parentNode.children.splice(i,1);}const i=anchor?parent.children.indexOf(anchor):-1;parent.children.splice(i<0?parent.children.length:i,0,n);n.parentNode=parent;},
 remove(n){if(n.parentNode){const i=n.parentNode.children.indexOf(n);if(i>=0)n.parentNode.children.splice(i,1);n.parentNode=null;}},
 patchProp(n,key,previous,value){n.attrs[key]=value;if(key==='value'){n.value=value;n._value=value;}if(key==='type')n.type=value;if(key==='checked')n.checked=value;},querySelector:selector=>selector==='#mapping-surface-controls'?mappingControls:null
});
function walk(node){return [node,...node.children.flatMap(walk)];}
async function flush(){await nextTick();await Promise.resolve();await nextTick();}
function project(curved=false,existing=false){
 const vertices=[[0,0],[100,0],[100,100],[0,100]].map(([xMm,yMm],i)=>({id:'v'+i,xMm,yMm,zMm:curved?20+xMm*.5:0}));
 const surface={id:'surface',topologyVersion:1,source:'obj',vertices,faces:[{id:'lower',vertices:['v0','v1','v2'],region:'panel'},{id:'upper',vertices:['v0','v2','v3'],region:'panel'}]};
 const marking={id:'old',name:'Existing paint',surfaceId:surface.id,topologyVersion:1,color:'#2288cc',source:'surface',locked:false,paths:[],fragments:[{faceId:'lower',rings:[[[.8,0,.2],[.2,.6,.2],[.2,0,.8]]]},{faceId:'upper',rings:[[[.8,.2,0],[.2,.8,0],[.2,.2,.6]]]}],surfaceShape:{origin:[0,0,0],axes:[[1,0,0],[0,1,0],[0,0,1]],nodes:[[20,20],[80,20],[80,80],[20,80]].map(([xMm,yMm])=>({xMm,yMm}))}};
 return {id:'project',revision:1,schemaVersion:2,name:'Component fixture',unit:'mm',pieces:[],bindings:[],surface,markings:existing?[marking]:[]};
}
async function mount(p){
 const pinia=createPinia(),store=useSession(pinia),root=new HostNode('root'),calls=[];
 mappingControls=new HostNode('aside');mappingControls.parentNode=root;root.children.push(mappingControls);
 store.data={project:p,geometry:[],canUndo:false,canRedo:false,savedRevision:null,history:[],recovery:[],recent:[],jobs:[]};
 const reply=()=>({ok:true,data:{...JSON.parse(JSON.stringify(store.data)),project:{...JSON.parse(JSON.stringify(store.data.project)),revision:store.data.project.revision+1}}});
 window.fpcad={brushSurfaceMarking:async(...args)=>{calls.push({method:'brush',args});return reply();},editSurfaceMarking:async(...args)=>{calls.push({method:'edit',args});return reply();}};
 const app=renderer.createApp({render:()=>h(SurfacePanel,{language:'en',selectedId:'',mode:'mapping'})});app.use(pinia);app.mount(root);await flush();
 const byLabel=label=>{const n=walk(root).find(n=>n.attrs['aria-label']===label);assert(n,'missing control: '+label);return n;};
 const button=text=>{const n=walk(root).find(n=>n.tag==='button'&&n.textContent===text);assert(n,'missing button: '+text);return n;};
 const click=async n=>{assert(!n.attrs.disabled,'control is disabled');n.attrs.onClick({button:0});await flush();};
 const model=async(n,value)=>{n.attrs['onUpdate:modelValue'](value);await flush();};
 const pointer=(type,x,y,button=0)=>({type,clientX:x,clientY:y,button,pointerId:1,currentTarget:walk(root).find(n=>n instanceof HostCanvas),target:root,shiftKey:false,ctrlKey:false,metaKey:false,preventDefault(){}});
 const event=async(name,x,y,button=0)=>{const fn=globalThis.__surfaceCapture[name];assert.equal(typeof fn,'function',name);await fn(pointer(name.slice(2).toLowerCase(),x,y,button));await flush();};
 return {app,root,store,calls,byLabel,button,click,model,event};
}
const checks=[];
for(const shape of ['round','square']){
 const fixture=await mount(project());try{
  const {byLabel,button,click,model,event,calls}=fixture;await click(button('Front'));await click(byLabel('Brush add marking'));
  assert(byLabel('Surface brush radius')&&byLabel('Surface brush shape')&&byLabel('Surface brush color'));
  await model(byLabel('Surface brush radius'),13);await model(byLabel('Surface brush shape'),shape);await model(byLabel('Surface brush color'),'#a13e76');
  await event('onPointerdown',270,360);assert(globalThis.__surfaceCapture['brush-path']??globalThis.__surfaceCapture.brushPath,'first down exposes a live brush footprint');await event('onPointermove',360,315);await event('onPointerup',360,315);
  assert.equal(calls.length,1);const {method,args}=calls[0];assert.equal(method,'brush');assert.deepEqual(args.slice(0,3),['project',1,undefined]);
  const stroke=args[3];assert.equal(stroke.radiusMm,13);assert.equal(stroke.brushShape,shape);assert.equal(stroke.mode,'add');assert.equal(stroke.paint.color,'#a13e76');assert(stroke.paint.name);
  assert.deepEqual(JSON.parse(JSON.stringify(stroke.paint.frame)),{origin:[50,50,0],axes:[[1,0,0],[0,1,0],[0,0,1]]});assert.equal(stroke.points.length,2);assert(Math.hypot(stroke.points[0].xMm+20,stroke.points[0].yMm+20)<1e-7);assert(Math.hypot(stroke.points[1].xMm,stroke.points[1].yMm+10)<1e-7);
  checks.push({case:'fresh '+shape+' brush without selection',passed:true});
 }finally{fixture.app.unmount();}
}
{
 const fixture=await mount(project(true,true));try{
  const {byLabel,button,click,model,event,calls,store}=fixture;await click(button('Front'));await model(byLabel('Select attached marking'),'old');
  // Rotate the model before editing so a planar z=0 overlay would visibly
  // disagree with the actual depth of this inclined surface.
  await event('onPointerdown',360,270,1);await event('onPointermove',410,270,1);await event('onPointerup',410,270,1);
  const savedFragments=JSON.parse(JSON.stringify(store.data.project.markings[0].fragments));await click(byLabel('Edit attached marking nodes'));
  const canvas=globalThis.__surfaceCapture,handles=canvas.handles,outline=canvas.outline,camera=canvas.camera;assert.equal(handles.length,4);assert(outline.length>=4);assert.deepEqual(canvas.markings[0].fragments,savedFragments);
  for(const line of outline)for(const p of[line.a,line.b])assert(Math.abs(p.zMm-(20+p.xMm*.5))<1e-7,'outline lies on observed surface depth');
  const world={xMm:20,yMm:20,zMm:30},x=world.xMm-camera.cx,y=world.yMm-camera.cy,z=world.zMm-camera.cz;
  const expected={x:(x*Math.cos(camera.yaw)+z*Math.sin(camera.yaw))*camera.factor+camera.panX,y:-(y*Math.cos(camera.pitch)-(-x*Math.sin(camera.yaw)+z*Math.cos(camera.yaw))*Math.sin(camera.pitch))*camera.factor+camera.panY};
  assert(Math.hypot(handles[0].x-expected.x,handles[0].y-expected.y)<1e-7,'editable handle is projected from surface coordinates');
  const before=JSON.parse(JSON.stringify(store.data.project));await event('onPointerdown',handles[0].x+360,handles[0].y+270);await event('onPointermove',handles[0].x+372,handles[0].y+264);await event('onPointerup',handles[0].x+372,handles[0].y+264);
  assert.deepEqual(store.data.project,before,'node drag remains uncommitted');assert.notDeepEqual(globalThis.__surfaceCapture.markings[0].fragments,savedFragments,'live fragments follow a moved knot');
  await click(button('Confirm marking edit'));assert.equal(calls.length,1);assert.equal(calls[0].method,'edit');assert.deepEqual(calls[0].args.slice(0,3),['project',1,'old']);assert.notDeepEqual(calls[0].args[3].nodes,before.markings[0].surfaceShape.nodes);
  checks.push({case:'existing depth-correct outline, handles, live drag and explicit save',passed:true});
 }finally{fixture.app.unmount();}
}
await writeFile('test-results/surface-panel-component.json',JSON.stringify({passed:true,verification:'Vue custom renderer component logic; no Electron display verification',checks},null,2));
console.log(JSON.stringify({passed:true,verification:'component logic',checks}));
