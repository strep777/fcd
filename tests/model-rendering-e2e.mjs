import {hiddenWindowId} from './desktop-window.mjs';
import {desktopScreenshot} from './desktop-screenshot.mjs';
import {build} from 'esbuild';
import {parse,compileScript} from '@vue/compiler-sfc';
import {_electron as electron} from 'playwright';
import {mkdir,mkdtemp,readFile,writeFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {resolve,dirname} from 'node:path';
import sharp from 'sharp';
import assert from 'node:assert/strict';

// This fixture uses current source geometry and the production WebGL component.
// Its Electron window is always hidden; the shared application is never rebuilt.
await mkdir('.local/tests',{recursive:true});await mkdir('test-results',{recursive:true});
const directory=resolve(await mkdtemp('.local/tests/model-render-'));
const generator=resolve(directory,'generate.mjs');
await build({stdin:{contents:`import {generateSpecies,speciesDefaults} from './apps/desktop/main/species';import {assembleSpecies} from './apps/desktop/main/species-assembly';import {writeFile} from 'node:fs/promises';const meshes=[];for(const species of ['canine','feline','rabbit','bear','deer','dragon'])meshes.push({species,surface:await assembleSpecies(generateSpecies(speciesDefaults(species)))});await writeFile(process.argv[2],JSON.stringify(meshes));`,resolveDir:resolve('.'),loader:'ts'},bundle:true,packages:'external',format:'esm',platform:'node',outfile:generator});
execFileSync(process.execPath,[generator,resolve(directory,'meshes.json')],{cwd:resolve('.'),stdio:'pipe'});
const meshes=JSON.parse(await readFile(resolve(directory,'meshes.json'),'utf8'));
const entry=`import {createApp,h,reactive} from 'vue';import SurfaceGpu from './apps/desktop/src/SurfaceGpu.vue';
window.meshes=${JSON.stringify(meshes)};window.preview=reactive({index:0,side:false,wireframe:false});window.unavailable=false;
createApp({render:()=>{const surface=window.meshes[window.preview.index].surface,limits=['xMm','yMm','zMm'].map(axis=>{const values=surface.vertices.map(v=>v[axis]);return [Math.min(...values),Math.max(...values)]}),extent=Math.max(...limits.map(([a,b])=>b-a)),center=limits.map(([a,b])=>(a+b)/2),camera={cx:center[0],cy:center[1],cz:center[2],extent,factor:450/extent,yaw:window.preview.side?Math.PI/2:0,pitch:0,panX:0,panY:0,perspective:false,zoom:1};return h('main',[h('h2',window.meshes[window.preview.index].species+' / '+(window.preview.side?'side':'front')),h('div',{class:'surface-preview'},[h(SurfaceGpu,{surface,faces:surface.faces.map(f=>({...f,color:'#b9bec6'})),markings:[],camera,wireframe:window.preview.wireframe,draft:[],handles:[],brushPath:'',onUnavailable:()=>window.unavailable=true})])]);}}).mount('#app');`;
await build({stdin:{contents:entry,resolveDir:resolve('.'),loader:'ts'},bundle:true,format:'iife',platform:'browser',outfile:resolve(directory,'fixture.js'),plugins:[{name:'production-vue',setup(build){build.onLoad({filter:/\.vue$/},async({path})=>{const {descriptor}=parse(await readFile(path,'utf8'));return {contents:compileScript(descriptor,{id:'model-source-render',inlineTemplate:true}).content+'\nconst s=document.createElement("style");s.textContent='+JSON.stringify(descriptor.styles.map(s=>s.content).join('\n'))+';document.head.append(s);',loader:'ts',resolveDir:dirname(path)};});}}]});
await writeFile(resolve(directory,'index.html'),'<html><style>body{margin:0;background:#e9eef2;font:18px sans-serif;color:#234}main{height:580px;display:flex;flex-direction:column}h2{font-size:22px;margin:12px 18px}.surface-preview{display:flex;flex:1;min-height:0}.surface-view{flex:1;min-height:80px}</style><div id="app"></div><script src="fixture.js"></script></html>');
await writeFile(resolve(directory,'main.cjs'),`const {app,BrowserWindow}=require('electron');app.setPath('userData',${JSON.stringify(resolve(directory,'profile'))});app.whenReady().then(()=>{new BrowserWindow({width:720,height:580,useContentSize:true,show:false,webPreferences:{contextIsolation:true,backgroundThrottling:false}}).loadFile(${JSON.stringify(resolve(directory,'index.html'))});});app.on('window-all-closed',()=>app.quit());`);
const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
const app=await electron.launch({args:['--disable-gpu','--enable-unsafe-swiftshader',...(process.env.FPCAD_TEST_NO_SANDBOX==='1'?['--no-sandbox']:[]),resolve(directory,'main.cjs')],env}),page=await app.firstWindow(),errors=[],screenshots=[],checks=[];
page.on('pageerror',error=>errors.push(error.message));
try{
 assert.equal(await app.evaluate(({BrowserWindow},id)=>BrowserWindow.fromId(id).isVisible(),await hiddenWindowId(app,page)),false);
 for(let index=0;index<meshes.length;index++)for(const side of [false,true]){
  const frame=await page.locator('canvas').getAttribute('data-frame').catch(()=>null);
  await page.evaluate(({index,side})=>{window.preview.index=index;window.preview.side=side;},{index,side});
  await page.waitForFunction(frame=>window.unavailable||document.querySelector('canvas')?.dataset.backend==='webgl'&&document.querySelector('canvas')?.dataset.frame!==frame,frame);
  assert.equal(await page.evaluate(()=>window.unavailable),false);
  const visiblePixels=await page.evaluate(()=>{const canvas=document.querySelector('canvas'),gl=canvas.getContext('webgl'),pixels=new Uint8Array(canvas.width*canvas.height*4);gl.readPixels(0,0,canvas.width,canvas.height,gl.RGBA,gl.UNSIGNED_BYTE,pixels);let count=0;for(let i=0;i<pixels.length;i+=4)if(Math.max(...pixels.slice(i,i+3))-Math.min(...pixels.slice(i,i+3))<35&&pixels[i]<220)count++;return count;});
  assert(visiblePixels>5000,meshes[index].species+' model must render substantial visible pixels');
  const path=resolve(directory,meshes[index].species+'-'+(side?'side':'front')+'.png');await desktopScreenshot(app,page,{path});screenshots.push(path);checks.push({species:meshes[index].species,view:side?'side':'front',visiblePixels});
 }
 assert.deepEqual(errors,[]);assert.equal(await app.evaluate(({BrowserWindow},id)=>BrowserWindow.fromId(id).isVisible(),await hiddenWindowId(app,page)),false);
 const thumbnails=await Promise.all(screenshots.map(path=>sharp(path).resize(480,387).toBuffer()));
 await sharp({create:{width:1920,height:1161,channels:4,background:'#fff'}}).composite(thumbnails.map((input,i)=>({input,left:i%4*480,top:Math.floor(i/4)*387}))).png().toFile('test-results/model-live-redesign.png');
 await writeFile('test-results/model-rendering-e2e.json',JSON.stringify({passed:true,directory,backgroundWindow:true,osSandboxDisabledForTest:process.env.FPCAD_TEST_NO_SANDBOX==='1',source:'current source geometry and production SurfaceGpu.vue',checks,errors},null,2));console.log('All six current source models rendered front and side in a hidden Electron window.');
}finally{await app.close();}
