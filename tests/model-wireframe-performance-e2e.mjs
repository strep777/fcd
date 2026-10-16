import {build} from 'esbuild';
import {parse,compileScript} from '@vue/compiler-sfc';
import {_electron as electron} from 'playwright';
import {mkdir,mkdtemp,readFile,writeFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {resolve,dirname} from 'node:path';
import assert from 'node:assert/strict';
import {hiddenWindowId} from './desktop-window.mjs';
await mkdir('.local/tests',{recursive:true});await mkdir('test-results',{recursive:true});
const directory=resolve(await mkdtemp('.local/tests/wireframe-')),generator=resolve(directory,'generate.mjs');
await build({stdin:{contents:`import {generateSpecies,speciesDefaults} from './apps/desktop/main/species';import {assembleSpecies} from './apps/desktop/main/species-assembly';import {gridMesh} from './tests/large-mesh-fixture';import {writeFile,readFile} from 'node:fs/promises';const surface=process.env.FPCAD_WIREFRAME_SAMPLE?JSON.parse(await readFile(process.env.FPCAD_WIREFRAME_SAMPLE,'utf8')):await assembleSpecies(generateSpecies(speciesDefaults('canine')));await writeFile(process.argv[2],JSON.stringify([{name:'real builtin',surface},{name:'200000 imported faces',surface:gridMesh(400,250)}]));`,resolveDir:resolve('.'),loader:'ts'},bundle:true,packages:'external',format:'esm',platform:'node',outfile:generator});
execFileSync(process.execPath,[generator,resolve(directory,'meshes.json')],{cwd:resolve('.'),stdio:'pipe'});
const meshes=JSON.parse(await readFile(resolve(directory,'meshes.json'),'utf8'));
const entry=`import {createApp,h,reactive} from 'vue';import SurfaceGpu from './apps/desktop/src/SurfaceGpu.vue';import {meshBounds} from './packages/surface/preview';
window.uploads=[];const original=WebGLRenderingContext.prototype.bufferData;WebGLRenderingContext.prototype.bufferData=function(...args){window.uploads.push(args[1]?.byteLength??0);return original.apply(this,args);};
window.meshes=${JSON.stringify(meshes)};const prepared=window.meshes.map(m=>{const b=meshBounds(m.surface.vertices);return {...m,faces:m.surface.faces.map(f=>({...f,color:'#b9bec6'})),camera:{...b,factor:450/b.extent,yaw:0,pitch:0,panX:0,panY:0,perspective:false,zoom:1}};});
window.preview=reactive({index:0,wireframe:false,yaw:0});window.unavailable=false;
createApp({render:()=>{const m=prepared[window.preview.index];return h(SurfaceGpu,{surface:m.surface,faces:m.faces,camera:{...m.camera,yaw:window.preview.yaw},wireframe:window.preview.wireframe,onUnavailable:()=>window.unavailable=true});}}).mount('#app');`;
await build({stdin:{contents:entry,resolveDir:resolve('.'),loader:'ts'},bundle:true,format:'iife',platform:'browser',outfile:resolve(directory,'fixture.js'),plugins:[{name:'production-vue',setup(build){build.onLoad({filter:/\.vue$/},async({path})=>{const {descriptor}=parse(await readFile(path,'utf8'));return {contents:compileScript(descriptor,{id:'wireframe-performance',inlineTemplate:true}).content+'\nconst style=document.createElement("style");style.textContent='+JSON.stringify(descriptor.styles.map(s=>s.content).join('\n'))+';document.head.append(style);',loader:'ts',resolveDir:dirname(path)};});}}]});
await writeFile(resolve(directory,'index.html'),'<html><style>body{margin:0}.surface-view{width:720px;height:540px}</style><div id="app"></div><script src="fixture.js"></script></html>');
await writeFile(resolve(directory,'main.cjs'),`const {app,BrowserWindow}=require('electron');app.setPath('userData',${JSON.stringify(resolve(directory,'profile'))});app.whenReady().then(()=>new BrowserWindow({width:720,height:540,useContentSize:true,show:false,webPreferences:{contextIsolation:true,backgroundThrottling:false}}).loadFile(${JSON.stringify(resolve(directory,'index.html'))}));app.on('window-all-closed',()=>app.quit());`);
const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
const app=await electron.launch({args:['--fpcad-background-test','--disable-gpu','--enable-unsafe-swiftshader',...(process.env.FPCAD_TEST_NO_SANDBOX==='1'?['--no-sandbox']:[]),resolve(directory,'main.cjs')],env}),page=await app.firstWindow(),errors=[],checks=[];
page.on('pageerror',e=>errors.push(e.message));
try{
 await hiddenWindowId(app,page);await page.waitForFunction(()=>window.unavailable||document.querySelector('canvas')?.dataset.backend==='webgl');assert(!await page.evaluate(()=>window.unavailable));
 for(let index=0;index<meshes.length;index++){
  await page.evaluate(async index=>{window.preview.index=index;window.preview.wireframe=false;window.preview.yaw=0;await new Promise(ok=>requestAnimationFrame(()=>requestAnimationFrame(ok)));},index);
  const result=await page.evaluate(async()=>{
   const frame=()=>new Promise(ok=>requestAnimationFrame(()=>requestAnimationFrame(ok))),uploads=window.uploads.length,start=performance.now();window.preview.wireframe=true;await frame();const firstMs=performance.now()-start,firstUploads=window.uploads.slice(uploads);const rotateStart=performance.now(),afterFirst=window.uploads.length;
   for(let i=1;i<=10;i++){window.preview.yaw=i*.03;await frame();}const orbitMs=(performance.now()-rotateStart)/10,orbitUploads=window.uploads.length-afterFirst;
   window.preview.wireframe=false;await frame();const repeatStart=performance.now(),beforeRepeat=window.uploads.length;window.preview.wireframe=true;await frame();
   return {firstMs,firstUploads,orbitMs,orbitUploads,repeatMs:performance.now()-repeatStart,repeatUploads:window.uploads.length-beforeRepeat,paintMs:Number(document.querySelector('canvas').dataset.paintMs),wireBuildMs:Number(document.querySelector('canvas').dataset.wireBuildMs),geometryBuildMs:Number(document.querySelector('canvas').dataset.buildMs)};
  });checks.push({name:meshes[index].name,faces:meshes[index].surface.faces.length,...result});
 }
 await writeFile('test-results/model-wireframe-performance.json',JSON.stringify({directory,backgroundWindow:true,timingNote:'Wall times include throttled animation-frame waits in the hidden host; GPU buffer build and paint CPU times are reported separately, not interaction FPS.',checks,errors},null,2));console.log(JSON.stringify(checks,null,2));
 assert.deepEqual(errors,[]);for(const check of checks){assert.equal(check.firstUploads.length,1,'Wire toggle must only upload its own buffer');assert.equal(check.orbitUploads,0,'Orbit must reuse geometry buffers');assert.equal(check.repeatUploads,0,'Repeated wire toggles must reuse the cache');assert(check.firstUploads[0]<=check.faces*18*4,'Wire buffer stores only unique edge positions');}
 await hiddenWindowId(app,page);
}finally{await app.close();}
