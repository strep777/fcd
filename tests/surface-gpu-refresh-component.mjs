import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {parse,compileScript} from '@vue/compiler-sfc';
import {mkdir,mkdtemp,readFile,writeFile} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
import {pathToFileURL} from 'node:url';

// Actual SurfaceGpu SFC and geometry builders. Record the WebGL command/data
// contract and control animation frames; this is not a GPU pixel/driver test.
let nextFrame=0,nextResource=0;
const frames=new Map(),observers=new Set(),cancelled=[];
class Node {
 constructor(tag=''){this.__v_skip=true;this.tag=tag;this.tagName=tag.toUpperCase();this.children=[];this.parentNode=null;this.attrs={};this.style={};this.dataset={};this.listeners=new Map();}
 get textContent(){return this.text??this.children.map(n=>n.textContent).join('');}set textContent(value){this.text=String(value);this.children=[];}
 addEventListener(type,fn){this.listeners.set(type,[...(this.listeners.get(type)??[]),fn]);}removeEventListener(type,fn){this.listeners.set(type,(this.listeners.get(type)??[]).filter(f=>f!==fn));}
 getBoundingClientRect(){return {x:0,y:0,left:0,top:0,width:720,height:540};}getClientRects(){return [this.getBoundingClientRect()];}getRootNode(){return document;}setAttribute(k,v){this.attrs[k]=v;}removeAttribute(k){delete this.attrs[k];}
}
function recorder(){
 const state={uploads:[],draws:[],liveBuffers:new Map(),liveTextures:new Set(),programs:new Set(),uniforms:new Map(),bound:null,lost:0};
 const gl={};
 ['ARRAY_BUFFER','STATIC_DRAW','VERTEX_SHADER','FRAGMENT_SHADER','COMPILE_STATUS','LINK_STATUS','DEPTH_TEST','LEQUAL','TEXTURE_2D','RGBA','UNSIGNED_BYTE','TEXTURE_MIN_FILTER','NEAREST','LINEAR','TEXTURE_MAG_FILTER','TEXTURE_WRAP_S','TEXTURE_WRAP_T','CLAMP_TO_EDGE','UNPACK_FLIP_Y_WEBGL','COLOR_BUFFER_BIT','DEPTH_BUFFER_BIT','STENCIL_BUFFER_BIT','FLOAT','TEXTURE0','TRIANGLES','POLYGON_OFFSET_FILL','STENCIL_TEST','ALWAYS','KEEP','INVERT','EQUAL','LINES'].forEach((key,i)=>gl[key]=1<<i%29);
 Object.assign(gl,{
  createBuffer(){const buffer={id:++nextResource};state.liveBuffers.set(buffer,null);return buffer;},deleteBuffer(buffer){state.liveBuffers.delete(buffer);},bindBuffer(_kind,buffer){state.bound=buffer;},bufferData(_kind,array){assert(state.bound);const data=Array.from(array);state.liveBuffers.set(state.bound,data);state.uploads.push({buffer:state.bound,data});},
  createShader(){return {id:++nextResource};},getShaderParameter(){return true;},createProgram(){const p={id:++nextResource};state.programs.add(p);return p;},deleteProgram(p){state.programs.delete(p);},getProgramParameter(){return true;},
  createTexture(){const t={id:++nextResource};state.liveTextures.add(t);return t;},deleteTexture(t){state.liveTextures.delete(t);},getContextAttributes(){return {stencil:true};},
  getUniformLocation(_program,name){return name;},getAttribLocation(_program,name){return ['position','uv','color','normal'].indexOf(name);},
  uniform1f(name,value){state.uniforms.set(name,value);},uniform1i(name,value){state.uniforms.set(name,value);},uniform2f(name,...values){state.uniforms.set(name,values);},uniformMatrix3fv(name,_transpose,values){state.uniforms.set(name,Array.from(values));},
  drawArrays(mode,first,count){state.draws.push({mode,first,count,buffer:state.bound,data:state.liveBuffers.get(state.bound)?.slice(),uniforms:new Map(state.uniforms)});},
  getExtension(name){return name==='WEBGL_lose_context'?{loseContext(){state.lost++;}}:null;},
 });
 for(const name of ['shaderSource','compileShader','deleteShader','attachShader','linkProgram','enable','disable','depthFunc','bindTexture','texImage2D','texParameteri','pixelStorei','viewport','clearColor','clear','useProgram','enableVertexAttribArray','disableVertexAttribArray','vertexAttribPointer','activeTexture','depthMask','polygonOffset','stencilMask','stencilFunc','stencilOp','colorMask','vertexAttrib2f','vertexAttrib3f','lineWidth'])gl[name]=()=>{};
 return {gl,state};
}
class Canvas extends Node {constructor(){super('canvas');this.width=300;this.height=150;this.gpu=recorder();}getContext(kind){assert.equal(kind,'webgl');return this.gpu.gl;}}
class Observer {constructor(callback){this.callback=callback;observers.add(this);}observe(){}disconnect(){observers.delete(this);}}
Object.assign(globalThis,{HTMLElement:Node,HTMLCanvasElement:Canvas,Document:class{},ShadowRoot:class{},devicePixelRatio:1,ResizeObserver:Observer,requestAnimationFrame:fn=>{frames.set(++nextFrame,fn);return nextFrame;},cancelAnimationFrame:id=>{cancelled.push(id);frames.delete(id);},getComputedStyle:()=>({getPropertyValue:()=>'',borderLeftWidth:'0',borderRightWidth:'0',borderTopWidth:'0',borderBottomWidth:'0',paddingLeft:'0',paddingRight:'0',paddingTop:'0',paddingBottom:'0'})});
globalThis.document={createElement:tag=>new Node(tag),documentElement:new Node('html')};
const {createRenderer,h,nextTick,shallowReactive}=await import('vue');
await mkdir('.local/tests',{recursive:true});const directory=await mkdtemp('.local/tests/gpu-refresh-'),file=resolve(directory,'gpu.mjs');
await build({stdin:{contents:"export {default} from './apps/desktop/src/SurfaceGpu.vue';",resolveDir:resolve('.'),loader:'ts'},outfile:file,bundle:true,format:'esm',platform:'node',packages:'external',plugins:[{name:'gpu-refresh-sfc',setup(b){b.onLoad({filter:/\.vue$/},async({path})=>{const {descriptor}=parse(await readFile(path,'utf8'));return {contents:compileScript(descriptor,{id:'gpu-refresh',inlineTemplate:true,templateOptions:{compilerOptions:{hoistStatic:false}}}).content,loader:'ts',resolveDir:dirname(path)};});}}]});
const {default:SurfaceGpu}=await import(pathToFileURL(file).href);
const renderer=createRenderer({createElement:t=>t==='canvas'?new Canvas():new Node(t),createText:t=>{const n=new Node('#text');n.textContent=t;return n;},createComment:()=>new Node('#comment'),setText:(n,t)=>n.textContent=t,setElementText:(n,t)=>n.textContent=t,parentNode:n=>n.parentNode,nextSibling:n=>n.parentNode?.children[n.parentNode.children.indexOf(n)+1]??null,insert(n,p,a){if(n.parentNode)n.parentNode.children.splice(n.parentNode.children.indexOf(n),1);const i=a?p.children.indexOf(a):-1;p.children.splice(i<0?p.children.length:i,0,n);n.parentNode=p;},remove(n){if(n.parentNode)n.parentNode.children.splice(n.parentNode.children.indexOf(n),1);n.parentNode=null;},patchProp(n,k,_,v){n.attrs[k]=v;}});
const walk=n=>[n,...n.children.flatMap(walk)];
async function vueFlush(){await nextTick();await Promise.resolve();await nextTick();}
async function paintOne(){await vueFlush();assert.equal(frames.size,1,'all current updates must share one animation-frame request');const pending=[...frames.values()];frames.clear();for(const fn of pending)fn();await vueFlush();assert.equal(frames.size,0,'building buffers while painting must not schedule a redundant frame');}
function fixture(){const surface={id:'gpu-surface',source:'obj',topologyVersion:1,vertices:[[0,0,0],[100,0,0],[0,100,0]].map(([xMm,yMm,zMm],i)=>({id:'v'+i,xMm,yMm,zMm})),faces:[{id:'f0',vertices:['v0','v1','v2'],region:'sheet'}]};const marking=color=>({surfaceId:surface.id,topologyVersion:1,color,fragments:[{faceId:'f0',rings:[[[1,0,0],[0,1,0],[0,0,1]]]}]});return {surface,faces:[{id:'f0',vertices:['v0','v1','v2'],color:'#ffffff'}],camera:{cx:0,cy:0,cz:0,extent:100,factor:4.5,yaw:0,pitch:0,panX:0,panY:0,perspective:false,zoom:1},markings:[marking('#ff0000')],outline:[],wireframe:false,texturePreview:true,marking};}
async function mount(){assert.equal(frames.size,0);const data=fixture(),{marking,...initial}=data,props=shallowReactive(initial),root=new Node('root'),unavailable=[];const app=renderer.createApp({render:()=>h(SurfaceGpu,{...props,onUnavailable:()=>unavailable.push(true)})});app.mount(root);await vueFlush();const canvas=walk(root).find(n=>n instanceof Canvas);assert(canvas);await paintOne();assert.deepEqual(unavailable,[]);assert.equal(canvas.dataset.backend,'webgl');return {app,root,props,marking,canvas,...canvas.gpu,unavailable};}
const positions=data=>Array.from({length:data.length/11},(_,i)=>data.slice(i*11,i*11+3));
function colorEquals(data,color){for(let i=0;i<data.length;i+=11)for(let j=0;j<3;j++)assert(Math.abs(data[i+5+j]-color[j])<1e-6);}
const outline=()=>[{a:{xMm:10,yMm:10,zMm:0},b:{xMm:30,yMm:10,zMm:0}}];
const checks=[];
async function check(name,run){try{await run();checks.push({case:name,passed:true});}catch(error){checks.push({case:name,passed:false,error:error.stack});}}

await check('one Vue flush changing mesh, faces and markings uploads one current mesh and one marking mask/fill pair',async()=>{
 const f=await mount();try{const before=f.state.uploads.length,frame=Number(f.canvas.dataset.frame);f.props.mesh={vertices:f.props.surface.vertices.map((p,i)=>i===1?{...p,xMm:120}:p),faces:f.props.surface.faces};f.props.faces=f.props.faces.map(face=>({...face,color:'#00ff00'}));f.props.markings=[f.marking('#0000ff')];await vueFlush();assert.equal(f.state.uploads.length,before,'watchers defer construction until the shared paint');await paintOne();const uploads=f.state.uploads.slice(before);assert.equal(uploads.length,3,'mesh + mask + fill must upload once, with no duplicate marking build');assert.equal(Number(f.canvas.dataset.frame),frame+1);for(const upload of uploads)assert.deepEqual(positions(upload.data),[[0,0,0],[120,0,0],[0,100,0]]);colorEquals(uploads[0].data,[0,1,0]);for(const upload of uploads.slice(1))colorEquals(upload.data,[0,0,1]);assert.equal(f.canvas.dataset.markingBatches,'1');assert.deepEqual(f.unavailable,[]);}finally{f.app.unmount();}
});
await check('a markings-only update replaces its two buffers and actually draws the new color without reuploading the base mesh',async()=>{
 const f=await mount();try{const base=f.state.draws.find(d=>d.mode===f.gl.TRIANGLES).buffer,before=f.state.uploads.length,draw=f.state.draws.length;f.props.markings=[f.marking('#ffff00')];await paintOne();const uploads=f.state.uploads.slice(before);assert.equal(uploads.length,2);for(const upload of uploads)colorEquals(upload.data,[1,1,0]);const rendered=f.state.draws.slice(draw);assert.equal(rendered[0].buffer,base);assert.equal(rendered.length,3);for(const command of rendered.slice(1))colorEquals(command.data,[1,1,0]);assert.equal(f.state.liveBuffers.size,3);assert.deepEqual(f.unavailable,[]);}finally{f.app.unmount();}
});
await check('wireframe and outline updates share a frame and retain the existing mesh and marking buffers',async()=>{
 const f=await mount();try{const before=f.state.uploads.length,draw=f.state.draws.length;f.props.wireframe=true;f.props.outline=outline();await paintOne();const uploads=f.state.uploads.slice(before);assert.equal(uploads.length,2);assert.deepEqual(uploads.find(u=>u.data.length===6).data,[10,10,0,30,10,0]);assert.deepEqual(uploads.find(u=>u.data.length===18).data,[0,0,0,100,0,0,100,0,0,0,100,0,0,100,0,0,0,0]);const lines=f.state.draws.slice(draw).filter(d=>d.mode===f.gl.LINES);assert.deepEqual(lines.map(d=>d.count),[6,2]);assert.equal(f.canvas.dataset.outlineVertices,'2');}finally{f.app.unmount();}
});
await check('camera-center changes rebase mesh, markings, wire and outline exactly once in one frame',async()=>{
 const f=await mount();try{f.props.wireframe=true;f.props.outline=outline();await paintOne();const before=f.state.uploads.length;f.props.camera={...f.props.camera,cx:10,cy:20,cz:30};await paintOne();const uploads=f.state.uploads.slice(before);assert.equal(uploads.length,5);for(const upload of uploads.filter(u=>u.data.length===33))assert.deepEqual(positions(upload.data),[[-10,-20,-30],[90,-20,-30],[-10,80,-30]]);assert.equal(uploads.filter(u=>u.data.length===33).length,3);assert.deepEqual(uploads.find(u=>u.data.length===6).data,[0,-10,-30,20,-10,-30]);assert.deepEqual(uploads.find(u=>u.data.length===18).data,[-10,-20,-30,90,-20,-30,90,-20,-30,-10,80,-30,-10,80,-30,-10,-20,-30]);}finally{f.app.unmount();}
});
await check('orbit, pan, zoom and texture-display changes update drawing uniforms without rebuilding geometry',async()=>{
 const f=await mount();try{const before=f.state.uploads.length;f.props.camera={...f.props.camera,yaw:.3,pitch:.2,panX:8,panY:12,factor:9,zoom:2,perspective:true};f.props.texturePreview=false;await paintOne();assert.equal(f.state.uploads.length,before);assert.equal(f.state.uniforms.get('factor'),9);assert.equal(f.state.uniforms.get('perspective'),1);assert.deepEqual(f.state.uniforms.get('pan'),[8/360,-12/270]);assert(Math.abs(f.state.uniforms.get('rotation')[0]-Math.cos(.3))<1e-6);}finally{f.app.unmount();}
});
await check('unmount cancels pending rebuild/paint and releases observers and every GPU resource',async()=>{
 const f=await mount();f.props.markings=[f.marking('#0000ff')];await vueFlush();assert.equal(frames.size,1);const [pending,callback]=[...frames][0],uploads=f.state.uploads.length,draws=f.state.draws.length;f.app.unmount();assert(cancelled.includes(pending));assert.equal(frames.size,0);assert.equal(observers.size,0);assert.equal(f.state.liveBuffers.size,0);assert.equal(f.state.liveTextures.size,0);assert.equal(f.state.programs.size,0);assert.equal(f.state.lost,1);callback();await vueFlush();assert.equal(f.state.uploads.length,uploads);assert.equal(f.state.draws.length,draws);assert.equal(frames.size,0);assert.deepEqual(f.unavailable,[]);
});
await mkdir('test-results/current-cutting/consolidated',{recursive:true});const report={passed:checks.every(c=>c.passed),verification:'Actual SurfaceGpu.vue SFC, Vue flush/watchers and real geometry builders; controlled RAF, DOM boxes and WebGL command/data recorder. No hardware pixels, WebView2, native solver or user project database.',checks};await writeFile('test-results/current-cutting/consolidated/surface-gpu-refresh-component.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));if(!report.passed)process.exitCode=1;
