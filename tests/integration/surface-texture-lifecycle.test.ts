import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import * as Vue from 'vue';
import {readFileSync} from 'node:fs';
import {parse,compileScript} from '@vue/compiler-sfc';
import {transformSync} from 'esbuild';
import * as theme from '../../apps/desktop/src/modules/canvasTheme';
import * as textureSources from '../../apps/desktop/src/modules/texture-sources';
import * as preview from '../../packages/surface/preview';
import * as rendering from '../../packages/surface/rendering';
import {captureTextureSources,sameTextureSources} from '../../apps/desktop/src/modules/texture-sources';
import type {Surface} from '../../packages/schema/index';

// Vite imports SFCs as SSR modules in this Node suite. Compile their actual
// client templates explicitly so the custom renderer creates real canvas refs.
function clientComponent(name:'SurfaceGpu'|'SurfaceCanvas'){
 const script=compileScript(parse(readFileSync(`apps/desktop/src/${name}.vue`,'utf8')).descriptor,{id:name,inlineTemplate:true,templateOptions:{compilerOptions:{hoistStatic:false}}});
 const compiled=transformSync(script.content,{loader:'ts',format:'cjs'}).code,loaded={exports:{} as any};
 const modules:Record<string,unknown>={vue:Vue,'./modules/canvasTheme':theme,'./modules/texture-sources':textureSources,'../../../packages/surface/preview':preview,'../../../packages/surface/rendering':rendering};
 new Function('require','module','exports',compiled)((path:string)=>{if(!(path in modules))throw Error('Unexpected SFC import: '+path);return modules[path];},loaded,loaded.exports);return loaded.exports.default;
}
const SurfaceGpu=clientComponent('SurfaceGpu'),SurfaceCanvas=clientComponent('SurfaceCanvas');

// The real SFCs own controlled decoders, RAF and GPU/Canvas command recorders.
// These are resource-lifecycle checks, not image decoder or hardware-pixel tests.
type Decode={image:ControlledImage;source:string;settled:boolean;resolve:()=>void;reject:(error:Error)=>void};
const images:ControlledImage[]=[],decodes:Decode[]=[],sizes=new Map<string,[number,number]>(),frames=new Map<number,FrameRequestCallback>(),observers:Observer[]=[];let nextFrame=0;
class ControlledImage {
 private value='';abortOnClear=true;assignments:string[]=[];
 constructor(){images.push(this);}
 get src(){return this.value;}set src(value:string){this.value=value;this.assignments.push(value);if(!value&&this.abortOnClear)for(const pending of decodes)if(pending.image===this&&!pending.settled){pending.settled=true;pending.reject(Error('Image decode aborted'));}}
 get naturalWidth(){return sizes.get(this.value)?.[0]??0;}get naturalHeight(){return sizes.get(this.value)?.[1]??0;}
 decode(){return new Promise<void>((resolve,reject)=>decodes.push({image:this,source:this.src,settled:false,resolve,reject}));}
}
class Observer {constructor(readonly callback:()=>void){observers.push(this);}observe(){}disconnect(){} }
function context2d(){
 const defaults={globalAlpha:1,globalCompositeOperation:'source-over',fillStyle:'#000000',font:'10px sans-serif'},stack:Record<string,unknown>[]=[],state:any={...defaults,backgrounds:[] as any[],draws:[] as any[],resets:0};
 const reset=()=>{Object.assign(state,defaults);stack.length=0;};state.fresh=reset;state.reset=()=>{reset();state.resets++;};state.save=()=>stack.push(Object.fromEntries(Object.keys(defaults).map(key=>[key,state[key]])));state.restore=()=>{const value=stack.pop();if(value)Object.assign(state,value);};state.fillRect=()=>state.backgrounds.push({alpha:state.globalAlpha,operation:state.globalCompositeOperation});state.drawImage=(image:ControlledImage)=>state.draws.push({source:image.src,width:image.naturalWidth,height:image.naturalHeight});state.createLinearGradient=()=>({addColorStop(){}});
 for(const method of ['setTransform','clearRect','beginPath','translate','scale','moveTo','lineTo','closePath','clip','transform','fill','stroke','arc','strokeText','fillText'])state[method]=()=>{};
 return state;
}
function webgl(){
 const state={uploads:[] as {source:string;width:number;height:number}[],textures:new Set<object>(),deleted:0,lost:0};
 const methods:Record<string,any>={createTexture:()=>{const texture={};state.textures.add(texture);return texture;},deleteTexture:(texture:object)=>{state.textures.delete(texture);state.deleted++;},texImage2D:(...args:unknown[])=>{const image=args.at(-1);if(image instanceof ControlledImage)state.uploads.push({source:image.src,width:image.naturalWidth,height:image.naturalHeight});},createBuffer:()=>({}),createShader:()=>({}),createProgram:()=>({}),getContextAttributes:()=>({stencil:true}),getShaderParameter:()=>true,getProgramParameter:()=>true,getUniformLocation:()=>({}),getAttribLocation:()=>0,getExtension:()=>({loseContext:()=>{state.lost++;}})};
 const gl=new Proxy(methods,{get(target,key){if(typeof key!=='string')return Reflect.get(target,key);if(key in target)return target[key];if(/^[A-Z_0-9]+$/.test(key))return 1;return ()=>{};}});return {gl,state};
}
class Host {
 __v_skip=true;children:Host[]=[];parentNode:Host|null=null;attrs:Record<string,any>={};style={};dataset:Record<string,string>={};tagName:string;text:string|undefined;listeners=new Map<string,Function[]>();
 constructor(readonly tag:string){this.tagName=tag.toUpperCase();}
 get textContent():string{return this.text??this.children.map(node=>node.textContent).join('');}set textContent(value:string){this.text=value;this.children=[];}
 addEventListener(name:string,fn:Function){this.listeners.set(name,[...(this.listeners.get(name)??[]),fn]);}removeEventListener(name:string,fn:Function){this.listeners.set(name,(this.listeners.get(name)??[]).filter(value=>value!==fn));}
 getBoundingClientRect(){return {x:0,y:0,left:0,top:0,width:720,height:540};}getClientRects(){return [this.getBoundingClientRect()];}getRootNode(){return document;}setAttribute(key:string,value:unknown){this.attrs[key]=value;}removeAttribute(key:string){delete this.attrs[key];}
}
class Canvas extends Host {
 private w=300;private h=150;sizeWrites=0;box={width:720,height:540};context=context2d();gpu=webgl();
 constructor(){super('canvas');}get width(){return this.w;}set width(value:number){this.w=value;this.sizeWrites++;this.context.fresh();}get height(){return this.h;}set height(value:number){this.h=value;this.sizeWrites++;this.context.fresh();}
 override getBoundingClientRect(){return {x:0,y:0,left:0,top:0,...this.box};}getContext(kind:string){return kind==='webgl'?this.gpu.gl:this.context;}
}
const mounted:Vue.App[]=[];
function unmount(app:Vue.App){const index=mounted.indexOf(app);if(index>=0)mounted.splice(index,1);app.unmount();}
function walk(node:Host):Host[]{return [node,...node.children.flatMap(walk)];}
async function flush(){for(let i=0;i<5;i++){await Promise.resolve();await Vue.nextTick();}}
async function paint(){await flush();const callbacks=[...frames.values()];frames.clear();for(const callback of callbacks)callback(0);await flush();}
async function finish(image:ControlledImage){for(let i=0;i<2;i++){const pending=decodes.find(value=>value.image===image&&!value.settled);if(!pending)return;pending.settled=true;pending.resolve();await flush();}}
beforeEach(()=>{
 images.length=decodes.length=observers.length=0;sizes.clear();frames.clear();vi.stubGlobal('Image',ControlledImage);vi.stubGlobal('HTMLElement',Host);vi.stubGlobal('HTMLCanvasElement',Canvas);vi.stubGlobal('devicePixelRatio',1);vi.stubGlobal('ResizeObserver',Observer);vi.stubGlobal('requestAnimationFrame',(callback:FrameRequestCallback)=>{frames.set(++nextFrame,callback);return nextFrame;});vi.stubGlobal('cancelAnimationFrame',(id:number)=>frames.delete(id));vi.stubGlobal('getComputedStyle',()=>({getPropertyValue:()=>'',borderLeftWidth:'0',borderRightWidth:'0',borderTopWidth:'0',borderBottomWidth:'0',paddingLeft:'0',paddingRight:'0',paddingTop:'0',paddingBottom:'0'}));vi.stubGlobal('document',{documentElement:new Host('html'),createElement:(tag:string)=>new Host(tag)});
});
afterEach(async()=>{for(const app of mounted.splice(0))app.unmount();for(const pending of decodes)if(!pending.settled){pending.settled=true;pending.resolve();}await flush();vi.unstubAllGlobals();});
function fixture(){
 const texture:NonNullable<Surface['textures']>[number]={id:'texture-A',name:'Original texture',width:2048,height:2048,png:'data:image/png;base64,b3JpZ2luYWw=',sha256:'0'.repeat(64),proxy:{width:512,height:512,png:'data:image/png;base64,cHJveHk='}};sizes.set(texture.png,[2048,2048]);sizes.set(texture.proxy.png,[512,512]);
 const surface:Surface={id:'surface',source:'obj',topologyVersion:1,vertices:[{id:'a',xMm:0,yMm:0,zMm:0},{id:'b',xMm:100,yMm:0,zMm:0},{id:'c',xMm:0,yMm:100,zMm:0}],faces:[{id:'face',region:'sheet',vertices:['a','b','c']}],textures:[texture],textureFaces:[{faceId:'face',textureId:texture.id,uv:[[0,0],[1,0],[0,1]]}]};return {surface,texture};
}
async function mount(kind:'gpu'|'canvas',nativeReset=true){
 const {surface,texture}=fixture(),root=new Host('root'),unavailable=vi.fn(),props=Vue.shallowReactive<any>({surface,mesh:surface,faces:[{...surface.faces[0],color:'#ffffff',screen:[{x:0,y:0,z:0,inverseDepth:1},{x:100,y:0,z:0,inverseDepth:1},{x:0,y:100,z:0,inverseDepth:1}]}],camera:{cx:0,cy:0,cz:0,extent:100,factor:1,yaw:0,pitch:0,panX:0,panY:0,perspective:false,zoom:1},view:{yaw:0,pitch:0},lighting:false,markings:kind==='gpu'?[]:new Map(),labels:[]});
 const renderer=Vue.createRenderer<Host,Host>({createElement:tag=>{const node=tag==='canvas'?new Canvas():new Host(tag);if(node instanceof Canvas&&!nativeReset)node.context.reset=undefined;return node;},createText:text=>{const node=new Host('#text');node.textContent=text;return node;},createComment:()=>new Host('#comment'),setText:(node,text)=>{node.textContent=text;},setElementText:(node,text)=>{node.textContent=text;},parentNode:node=>node.parentNode,nextSibling:node=>node.parentNode?.children[node.parentNode.children.indexOf(node)+1]??null,insert(node,parent,anchor){if(node.parentNode){const index=node.parentNode.children.indexOf(node);if(index>=0)node.parentNode.children.splice(index,1);}const index=anchor?parent.children.indexOf(anchor):-1;parent.children.splice(index<0?parent.children.length:index,0,node);node.parentNode=parent;},remove(node){if(node.parentNode){const index=node.parentNode.children.indexOf(node);if(index>=0)node.parentNode.children.splice(index,1);node.parentNode=null;}},patchProp(node,key,_,value){node.attrs[key]=value;}});
 const component=kind==='gpu'?SurfaceGpu:SurfaceCanvas,app=renderer.createApp({render:()=>Vue.h(component as any,{...props,onUnavailable:unavailable})});app.mount(root);mounted.push(app);await flush();return {app,props,texture,canvas:walk(root).find(node=>node instanceof Canvas)! as Canvas,unavailable};
}

it.each(['gpu','canvas'] as const)('%s reuses identical replacement texture arrays and preserves the original resolution',async kind=>{
 const ui=await mount(kind),image=images[0];ui.props.surface={...ui.props.surface,textures:[{...ui.texture,name:'Renamed',sha256:'1'.repeat(64),proxy:{...ui.texture.proxy}}]};await flush();expect(images).toHaveLength(1);expect(image.src).not.toBe('');await finish(image);await paint();
 if(kind==='gpu'){expect(ui.canvas.gpu.state.uploads).toEqual([{source:ui.texture.proxy.png,width:512,height:512},{source:ui.texture.png,width:2048,height:2048}]);expect(image.src).toBe('');}else{expect(image.src).toBe(ui.texture.png);expect(ui.canvas.context.draws.at(-1)).toEqual({source:ui.texture.png,width:2048,height:2048});}
 const deleted=ui.canvas.gpu.state.deleted;ui.props.surface={...ui.props.surface,textures:[{...ui.texture,proxy:{...ui.texture.proxy}}]};await flush();expect(images).toHaveLength(1);expect(ui.canvas.gpu.state.deleted).toBe(deleted);expect(ui.unavailable).not.toHaveBeenCalled();unmount(ui.app);expect(image.src).toBe('');
});

it.each(['gpu','canvas'] as const)('%s replaces changed proxy bytes even when the texture ID, digest and original are unchanged',async kind=>{
 const ui=await mount(kind),old=images[0],changed={...ui.texture,proxy:{...ui.texture.proxy,png:'data:image/png;base64,bmV3LXByb3h5'}};sizes.set(changed.proxy.png,[512,512]);ui.props.surface={...ui.props.surface,textures:[changed]};await flush();expect(old.src).toBe('');expect(images).toHaveLength(2);await finish(images[1]);await paint();expect(ui.unavailable).not.toHaveBeenCalled();
 if(kind==='gpu')expect(ui.canvas.gpu.state.uploads.map(value=>value.source)).toEqual([changed.proxy.png,changed.png]);else expect(ui.canvas.context.draws.at(-1).source).toBe(changed.png);
});

it.each(['gpu','canvas'] as const)('%s cancels an old decoder and ignores its successful late completion after texture replacement',async kind=>{
 const ui=await mount(kind),old=images[0];old.abortOnClear=false;const pending=decodes.find(value=>value.image===old&&!value.settled)!,changed={...ui.texture,png:'data:image/png;base64,bmV3LW9yaWdpbmFs'};sizes.set(changed.png,[2048,2048]);ui.props.surface={...ui.props.surface,textures:[changed]};await flush();expect(old.src).toBe('');pending.settled=true;pending.resolve();await flush();await finish(images[1]);await paint();expect(ui.unavailable).not.toHaveBeenCalled();
 if(kind==='gpu')expect(ui.canvas.gpu.state.uploads.map(value=>value.source)).toEqual([changed.proxy.png,changed.png]);else expect(ui.canvas.context.draws.every((value:any)=>value.source===changed.png)).toBe(true);
});

it.each(['gpu','canvas'] as const)('%s cancels and settles in-flight decoders on unmount without publishing a stale result or fallback',async kind=>{
 const ui=await mount(kind),image=images[0];image.abortOnClear=false;unmount(ui.app);expect(image.src).toBe('');await finish(image);await flush();expect(ui.canvas.gpu.state.uploads).toEqual([]);expect(ui.canvas.context.draws).toEqual([]);expect(frames.size).toBe(0);expect(ui.unavailable).not.toHaveBeenCalled();
});

it.each([true,false])('software canvas resets drawing state each frame while retaining unchanged backing dimensions (native reset=%s)',async nativeReset=>{
 const ui=await mount('canvas',nativeReset);await finish(images[0]);await paint();const writes=ui.canvas.sizeWrites;expect(writes).toBe(2);ui.canvas.context.globalAlpha=.2;ui.canvas.context.globalCompositeOperation='multiply';ui.props.view={yaw:.1,pitch:.2};await paint();expect(ui.canvas.sizeWrites).toBe(writes);expect(ui.canvas.context.backgrounds.at(-1)).toEqual({alpha:1,operation:'source-over'});ui.canvas.box.width=900;observers.at(-1)!.callback();await paint();expect(ui.canvas.sizeWrites).toBe(writes+1);expect(ui.canvas.context.draws.at(-1).width).toBe(2048);
});

it.each(['id','width','height','png','proxy.width','proxy.height','proxy.png'])('compares actual decoder input %s independently of the asset digest',field=>{
 const {texture}=fixture(),before=captureTextureSources([texture]),changed={...texture,proxy:{...texture.proxy}} as any,target=field.startsWith('proxy.')?changed.proxy:changed,key=field.replace('proxy.','');target[key]=typeof target[key]==='number'?target[key]+1:target[key]+'changed';expect(sameTextureSources(before,captureTextureSources([changed]))).toBe(false);
});

it('compares equivalent texture collections independently of array order without retaining mutable proxy metadata',()=>{
 const {texture}=fixture(),other={...texture,id:'other'},before=captureTextureSources([texture,other]);expect(sameTextureSources(before,captureTextureSources([other,texture]))).toBe(true);texture.proxy.png+='changed';expect(sameTextureSources(before,captureTextureSources([texture,other]))).toBe(false);
});
