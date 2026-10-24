import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile,mkdir,mkdtemp,writeFile} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {build} from 'esbuild';
import {parse,compileScript} from '@vue/compiler-sfc';
import {desktop} from './tauri-desktop.mjs';
import {hiddenWindowId} from './desktop-window.mjs';
import {desktopScreenshot} from './desktop-screenshot.mjs';

// This fixture uses the real production SFCs, native Image.decode, Canvas2D and
// WebGL. A gate can delay delivery only AFTER native decode has actually finished;
// no image bytes, decoded pixels, draw calls or GL results are substituted.
const output=resolve(process.env.FPCAD_TEST_RESULTS_DIR??'test-results/surface-texture-lifecycle-browser');
await mkdir(output,{recursive:true});await mkdir('.local/tests',{recursive:true});
const directory=await mkdtemp(resolve('.local/tests/texture-lifecycle-browser-'));
const entry=`
import {createApp,h,shallowReactive,nextTick} from 'vue';
import SurfaceGpu from './apps/desktop/src/SurfaceGpu.vue';
import SurfaceCanvas from './apps/desktop/src/SurfaceCanvas.vue';
(async()=>{
const NativeImage=window.Image,nativeDecode=NativeImage.prototype.decode,srcDescriptor=Object.getOwnPropertyDescriptor(HTMLImageElement.prototype,'src');
const sha=async bytes=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),x=>x.toString(16).padStart(2,'0')).join('');
const colors={a:[240,20,20,255],b:[20,220,20,255],c:[20,20,230,255]},sources={},sourceNames=new Map(),sourceEvidence=[];
for(const [key,color] of Object.entries(colors)){
 const canvas=document.createElement('canvas');canvas.width=canvas.height=1024;const ctx=canvas.getContext('2d'),pixels=ctx.createImageData(1024,1024);let noise=0x12345678;
 for(let i=0;i<pixels.data.length;i+=4){pixels.data.set(color,i);if(i<1024*64*4){noise^=noise<<13;noise^=noise>>>17;noise^=noise<<5;pixels.data[i]=noise&255;pixels.data[i+1]=(noise>>>8)&255;pixels.data[i+2]=(noise>>>16)&255;}}
 ctx.putImageData(pixels,0,0);const original=canvas.toDataURL('image/png'),proxy=document.createElement('canvas');proxy.width=proxy.height=128;proxy.getContext('2d').drawImage(canvas,0,0,128,128);sources[key]={original,proxy:proxy.toDataURL('image/png')};sourceNames.set(original,key+'.original');sourceNames.set(sources[key].proxy,key+'.proxy');
 const encoded=Uint8Array.from(atob(original.split(',')[1]),c=>c.charCodeAt(0)),image=new NativeImage();image.src=original;await image.decode();ctx.clearRect(0,0,1024,1024);ctx.drawImage(image,0,0);const decoded=ctx.getImageData(0,0,1024,1024).data;
 sourceEvidence.push({key,width:image.naturalWidth,height:image.naturalHeight,encodedBytes:encoded.length,encodedSha256:await sha(encoded),originalPixelSha256:await sha(pixels.data),decodedPixelSha256:await sha(decoded)});image.src='';
}
const records=[],gates=[],gpuCommands={created:0,deleted:0,uploads:[]};let unavailable=0,app,state;
for(const method of ['createTexture','deleteTexture','texImage2D']){const native=WebGLRenderingContext.prototype[method];WebGLRenderingContext.prototype[method]=function(...args){const result=native.apply(this,args);if(this.canvas.closest('#app')){if(method==='createTexture')gpuCommands.created++;else if(method==='deleteTexture')gpuCommands.deleted++;else{const image=args.at(-1);if(image instanceof HTMLImageElement)gpuCommands.uploads.push({source:sourceNames.get(image.src),width:image.naturalWidth,height:image.naturalHeight});}}return result;};}
function TrackedImage(...args){
 const image=Reflect.construct(NativeImage,args),record={id:records.length,writes:[],decodes:[],image};records.push(record);
 Object.defineProperty(image,'src',{configurable:true,get(){return srcDescriptor.get.call(this);},set(value){record.writes.push(value===''?'':sourceNames.get(String(value))??'unknown');return srcDescriptor.set.call(this,value);}});
 image.decode=async function(...args){const source=this.src,label=sourceNames.get(source),gate=gates.find(g=>!g.claimed&&g.source===source);if(gate){gate.claimed=true;gate.imageId=record.id;}const decoded={source:label,status:'pending'};record.decodes.push(decoded);
  try{await nativeDecode.apply(this,args);Object.assign(decoded,{status:'native-decoded',width:this.naturalWidth,height:this.naturalHeight});if(gate){gate.nativeDecoded=true;await gate.promise;}decoded.status='delivered';}catch(error){decoded.status='rejected';decoded.error=error.name;throw error;}
 };return image;
}
TrackedImage.prototype=NativeImage.prototype;Object.setPrototypeOf(TrackedImage,NativeImage);window.Image=TrackedImage;
const sizes=new WeakMap(),nativeGetContext=HTMLCanvasElement.prototype.getContext;
for(const axis of ['width','height']){const descriptor=Object.getOwnPropertyDescriptor(HTMLCanvasElement.prototype,axis);Object.defineProperty(HTMLCanvasElement.prototype,axis,{...descriptor,set(value){if(this.closest('#app')){const writes=sizes.get(this)??[];writes.push({axis,value});sizes.set(this,writes);}return descriptor.set.call(this,value);}});}
HTMLCanvasElement.prototype.getContext=function(...args){const result=nativeGetContext.apply(this,args);if(result&&args[0]==='2d'&&state?.legacyReset&&this.closest('#app')&&!Object.hasOwn(result,'reset'))Object.defineProperty(result,'reset',{value:undefined,configurable:true});return result;};
const vertices=[{id:'a',xMm:-200,yMm:-180,zMm:0},{id:'b',xMm:200,yMm:-180,zMm:0},{id:'c',xMm:200,yMm:180,zMm:0},{id:'d',xMm:-200,yMm:180,zMm:0}],faces=[{id:'one',region:'sheet',vertices:['a','b','c']},{id:'two',region:'sheet',vertices:['a','c','d']}];
const texture=key=>({id:'texture',name:'Original',width:1024,height:1024,png:sources[key].original,sha256:'0'.repeat(64),proxy:{width:128,height:128,png:sources[key].proxy}});
const surface=key=>({id:'mesh',source:'obj',topologyVersion:1,vertices,faces,textures:[texture(key)],textureFaces:[{faceId:'one',textureId:'texture',uv:[[0,1],[1,1],[1,0]]},{faceId:'two',textureId:'texture',uv:[[0,1],[1,0],[0,0]]}]});
const camera={cx:0,cy:0,cz:0,extent:400,factor:1,yaw:0,pitch:0,panX:0,panY:0,perspective:false,zoom:1};
async function mount(kind,legacyReset=false){if(app)app.unmount();state=shallowReactive({kind,surface:surface('a'),tick:0,legacyReset});unavailable=0;document.querySelector('#app').style.width='720px';document.querySelector('#app').style.height='540px';
 app=createApp({render(){const mesh=state.surface,common={surface:mesh,mesh,faces:faces.map(face=>({...face,color:'#ffffff',screen:face.vertices.map(id=>{const v=vertices.find(v=>v.id===id);return {x:v.xMm,y:-v.yMm,z:0,inverseDepth:1};})})),onUnavailable:()=>unavailable++};return state.kind==='gpu'?h(SurfaceGpu,{...common,texturePreview:true,markings:[],camera:{...camera,yaw:state.tick*.001}}):h(SurfaceCanvas,{...common,view:{yaw:state.tick*.001,pitch:0},lighting:false,markings:new Map(),labels:[]});}});app.mount('#app');await nextTick();}
const frame=()=>Number(document.querySelector('#app canvas')?.dataset.frame??0);
const settle=async()=>{await nextTick();await new Promise(requestAnimationFrame);await new Promise(requestAnimationFrame);};
function arm(key,part='original'){let release;const gate={id:gates.length,source:sources[key][part],claimed:false,nativeDecoded:false,released:false,promise:new Promise(resolve=>release=resolve),release(){this.released=true;release();}};gates.push(gate);return gate.id;}
function snapshot(){return {unavailable,frame:frame(),gpuCommands,records:records.map(({image,...record})=>({...record,currentSource:sourceNames.get(image.src)??(image.getAttribute('src')===''?'':'unknown')})),gates:gates.map(({promise,release,source,...gate})=>({...gate,source:sourceNames.get(source)})),sizes:[...(sizes.get(document.querySelector('#app canvas'))??[])]};}
// Probe inside the uniform source interior, away from the two triangles' shared
// diagonal: Canvas antialiasing along a clip edge is not source-image corruption.
function pixel(){const canvas=document.querySelector('#app canvas');if(!canvas)return null;let rgba;const x=Math.floor(canvas.width/2)+17,y=Math.floor(canvas.height/2)+11;if(state.kind==='gpu'){const gl=canvas.getContext('webgl');if(!gl||gl.isContextLost())return null;rgba=new Uint8Array(4);gl.readPixels(x,y,1,1,gl.RGBA,gl.UNSIGNED_BYTE,rgba);}else rgba=canvas.getContext('2d').getImageData(x,y,1,1).data;return {rgba:[...rgba],sample:{x,y},width:canvas.width,height:canvas.height,frame:frame(),backend:canvas.dataset.backend??'canvas'};}
window.fixture={sources:sourceEvidence,colors,mount,arm,snapshot,pixel,frame,settle,diagnostics(){const canvas=document.querySelector('#app canvas');return {snapshot:snapshot(),pixel:pixel(),texturePreview:app?._instance?.subTree?.component?.props?.texturePreview,canvas:canvas?{classes:canvas.className,width:canvas.width,height:canvas.height,dataset:{...canvas.dataset}}:null};},
 async replace(key){state.surface={...state.surface,textures:[texture(key)]};await nextTick();},
 async equivalent(){state.surface={...state.surface,textures:state.surface.textures.map(t=>({...t,name:'Renamed',sha256:'1'.repeat(64),proxy:{...t.proxy}}))};await nextTick();},
 async proxy(key){state.surface={...state.surface,textures:state.surface.textures.map(t=>({...t,proxy:{...t.proxy,png:sources[key].proxy}}))};await nextTick();},
 release(id){gates[id].release();},
 async redraw(corrupt=false){if(corrupt){const ctx=document.querySelector('#app canvas').getContext('2d');ctx.globalAlpha=.2;ctx.globalCompositeOperation='multiply';ctx.setTransform(2,0,0,2,80,90);}state.tick++;await nextTick();},
 async resize(width,height){Object.assign(document.querySelector('#app').style,{width:width+'px',height:height+'px'});await nextTick();},
 async unmount(){const canvas=document.querySelector('#app canvas');app?.unmount();app=undefined;await nextTick();return canvas?{frame:Number(canvas.dataset.frame),width:canvas.width,height:canvas.height}:null;},
 cleanup(){for(const gate of gates)gate.release();app?.unmount();app=undefined;window.Image=NativeImage;}
};window.fixtureReady=true;
})().catch(error=>{window.fixtureError=error.stack??String(error);throw error;});
`;
const bundled=await build({stdin:{contents:entry,resolveDir:resolve('.'),sourcefile:'texture-lifecycle-browser-fixture.ts',loader:'ts'},bundle:true,format:'iife',target:'es2022',platform:'browser',metafile:true,outfile:resolve(directory,'fixture.js'),plugins:[{name:'production-vue',setup(builder){builder.onLoad({filter:/\.vue$/},async({path})=>{const {descriptor}=parse(await readFile(path,'utf8'));return {contents:compileScript(descriptor,{id:'texture-lifecycle-browser',inlineTemplate:true}).content+'\nconst style=document.createElement("style");style.textContent='+JSON.stringify(descriptor.styles.map(value=>value.content).join('\n'))+';document.head.append(style);',loader:'ts',resolveDir:dirname(path)};});}}]});
const sha=bytes=>createHash('sha256').update(bytes).digest('hex'),sourcePaths=[fileURLToPath(import.meta.url),...Object.keys(bundled.metafile.inputs).filter(path=>/^(apps|packages)[/\\]/.test(path)).map(path=>resolve(path))];
const sourceHashes=Object.fromEntries(await Promise.all([...new Set(sourcePaths)].sort().map(async path=>[path,sha(await readFile(path))])));
await writeFile(resolve(directory,'index.html'),'<!doctype html><html><meta charset="UTF-8"><style>html,body{margin:0}#app{width:720px;height:540px;display:flex}#app>.surface-view{width:100%;height:100%;border:0;box-sizing:border-box}#app>canvas{height:100%;min-height:0}</style><div id="app"></div><script src="fixture.js"></script></html>');
await writeFile(resolve(directory,'fixture.json'),JSON.stringify({html:resolve(directory,'index.html'),width:1100,height:800}));
const app=await desktop.launch({args:[resolve(directory,'fixture.json')]}),page=await app.firstWindow(),errors=[],checks=[],observations=[];let passed=false;
page.setDefaultTimeout(20000);page.on('pageerror',error=>errors.push(error.message));page.on('console',message=>{if(message.text().includes('[Vue warn]'))errors.push(message.text());});
const snapshot=()=>page.evaluate(()=>window.fixture.snapshot());
const gateReady=id=>page.waitForFunction(id=>window.fixture.snapshot().gates[id]?.nativeDecoded===true,id);
async function colored(kind,key){
 const channel={a:0,b:1,c:2}[key];await page.waitForFunction(({channel,kind})=>{const p=window.fixture.pixel();return p&&p.frame>0&&(kind!=='gpu'||p.backend==='webgl')&&p.rgba[channel]>150&&p.rgba.slice(0,3).every((v,i)=>i===channel||v<p.rgba[channel]/3);},{channel,kind});
 const pixel=await page.evaluate(()=>window.fixture.pixel());assert(pixel.rgba[channel]>150);if(kind==='canvas')assert.deepEqual(pixel.rgba,await page.evaluate(key=>window.fixture.colors[key],key));observations.push({kind,key,...pixel});return pixel;
}
try{
 await hiddenWindowId(app,page);await page.waitForFunction(()=>window.fixtureReady===true);const sources=await page.evaluate(()=>window.fixture.sources);for(const source of sources){assert.equal(source.width,1024);assert.equal(source.height,1024);assert(source.encodedBytes>65536);assert.equal(source.originalPixelSha256,source.decodedPixelSha256);}observations.push({sourceImages:sources});checks.push('Three full-resolution source PNGs exceed 64 KiB and retain every decoded RGBA byte');
 for(const kind of ['gpu','canvas']){
  await page.evaluate(kind=>window.fixture.mount(kind),kind);await colored(kind,'a');await page.waitForFunction(()=>window.fixture.snapshot().records.at(-1)?.decodes.some(d=>d.source==='a.original'&&d.status==='delivered'));await page.evaluate(()=>window.fixture.settle());const initial=await snapshot();assert.equal(initial.unavailable,0);const imageCount=initial.records.length;if(kind==='gpu')assert(initial.gpuCommands.uploads.some(upload=>upload.source==='a.original'&&upload.width===1024&&upload.height===1024));
  await page.evaluate(()=>window.fixture.equivalent());await page.evaluate(()=>window.fixture.settle());const reused=await snapshot();assert.equal(reused.records.length,imageCount,'Equivalent texture input must reuse the decoder');if(kind==='gpu')assert.deepEqual(reused.gpuCommands,initial.gpuCommands,'Equivalent decoder inputs must retain real GPU textures without another creation, deletion or upload');await colored(kind,'a');checks.push(kind+': semantic texture replacement retains real pixels without another Image or GPU texture upload');
  const proxyGate=await page.evaluate(()=>window.fixture.arm('a'));await page.evaluate(()=>window.fixture.proxy('b'));await gateReady(proxyGate);let state=await snapshot();assert.equal(state.records.length,imageCount+1);const changed=state.records.at(-1);assert(changed.decodes.some(d=>d.source==='a.original'&&d.width===1024&&d.height===1024));if(kind==='gpu'){assert(changed.decodes.some(d=>d.source==='b.proxy'&&d.width===128));await colored(kind,'b');}await page.evaluate(id=>window.fixture.release(id),proxyGate);await colored(kind,'a');checks.push(kind+': changed proxy bytes reload despite the unchanged original, identity and digest');
  if(kind==='canvas'){
   await page.evaluate(()=>window.fixture.settle());const writes=(await snapshot()).sizes.length,frame=(await snapshot()).frame;await page.evaluate(()=>window.fixture.redraw(true));await page.waitForFunction(frame=>window.fixture.frame()>frame,frame);await colored(kind,'a');assert.equal((await snapshot()).sizes.length,writes,'Same-size repaint must retain the backing buffer');
   await page.evaluate(()=>window.fixture.resize(900,600));await page.waitForFunction(()=>{const p=window.fixture.pixel(),ratio=Math.min(devicePixelRatio,2);return p?.width===Math.round(900*ratio)&&p.height===Math.round(600*ratio);});await colored(kind,'a');assert((await snapshot()).sizes.length>writes);checks.push('Canvas native reset clears mutated drawing state without resetting same-size backing dimensions; actual resize retains texture pixels');
  }
  const late=await page.evaluate(()=>window.fixture.arm('b'));await page.evaluate(()=>window.fixture.replace('b'));await gateReady(late);const lateState=await snapshot(),lateImage=lateState.gates[late].imageId;await page.evaluate(()=>window.fixture.replace('c'));await colored(kind,'c');assert.equal((await snapshot()).records[lateImage].currentSource,'','Replacing a pending decoded Image must cancel its source');await page.evaluate(id=>window.fixture.release(id),late);await page.evaluate(()=>window.fixture.settle());await colored(kind,'c');assert.equal((await snapshot()).unavailable,0);checks.push(kind+': real late decode completion after replacement cannot overwrite the current blue texture or trigger fallback');
  const pending=await page.evaluate(()=>window.fixture.arm('b'));await page.evaluate(()=>window.fixture.replace('b'));await gateReady(pending);const beforeUnmount=await snapshot(),pendingImage=beforeUnmount.gates[pending].imageId;await page.evaluate(()=>{window.detachedCanvas=document.querySelector('#app canvas');return window.fixture.unmount();});const stoppedFrame=await page.evaluate(()=>Number(window.detachedCanvas.dataset.frame));assert.equal((await snapshot()).records[pendingImage].currentSource,'');await page.evaluate(id=>window.fixture.release(id),pending);await page.evaluate(()=>window.fixture.settle());assert.equal(await page.evaluate(()=>Number(window.detachedCanvas.dataset.frame)),stoppedFrame);assert.equal(await page.locator('#app canvas').count(),0);assert.equal((await snapshot()).unavailable,0);checks.push(kind+': unmount cancels the real pending Image and late completion leaves the detached frame unchanged');observations.push({kind,lifecycle:await snapshot()});
 }
 // Exercise the actual Canvas fallback branch on browsers lacking ctx.reset;
 // only the optional method is hidden, all drawing and pixel reads remain native.
 await page.evaluate(()=>window.fixture.mount('canvas',true));await colored('canvas','a');await page.evaluate(()=>window.fixture.settle());const legacy=await snapshot();assert.equal(await page.evaluate(()=>typeof document.querySelector('#app canvas').getContext('2d').reset),'undefined');await page.evaluate(()=>window.fixture.redraw(true));await page.waitForFunction(frame=>window.fixture.frame()>frame,legacy.frame);await colored('canvas','a');assert.equal((await snapshot()).sizes.length,legacy.sizes.length);checks.push('Canvas without native reset restores drawing state and exact source pixels while retaining its backing dimensions');
 await desktopScreenshot(app,page,{path:resolve(output,'canvas-texture.png')});await page.evaluate(()=>window.fixture.unmount());assert.deepEqual(errors,[]);assert.equal(checks.length,11);for(const [path,hash] of Object.entries(sourceHashes))assert.equal(sha(await readFile(path)),hash,'Production/test source changed during the browser run');passed=true;
}catch(error){const diagnostic=await page.evaluate(()=>window.fixture?.diagnostics()).catch(failure=>({diagnosticFailure:String(failure)}));observations.push({failure:error.stack??String(error),diagnostic});await desktopScreenshot(app,page,{path:resolve(output,'failure.png')}).catch(()=>{});process.exitCode=1;}
finally{await page.evaluate(()=>window.fixture?.cleanup()).catch(()=>{});await app.close();await writeFile(resolve(output,'report.json'),JSON.stringify({passed,verification:'Actual production Vue SFCs in headless Edge; native Image.decode, Canvas2D and WebGL pixels; only post-native-decode delivery is gated',directory,sourceHashes,checks,observations,errors},null,2));console.log(JSON.stringify({passed,checks:checks.length,output}));if(!passed)process.exitCode=1;}
