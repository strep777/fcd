import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {build} from 'esbuild';
import {parse,compileScript} from '@vue/compiler-sfc';
import {readFile,mkdir,mkdtemp,writeFile} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import UPNG from '@pdf-lib/upng';
import {desktop} from './tauri-desktop.mjs';
import {hiddenWindowId} from './desktop-window.mjs';
import {desktopScreenshot} from './desktop-screenshot.mjs';

// Reuse the existing component fixture path in desktop.launch: actual Vue SFCs
// run in headless Edge, without starting or rebuilding the desktop application.
const output=resolve('test-results/embedded-image');
await mkdir(output,{recursive:true});await mkdir('.local/tests',{recursive:true});
const directory=await mkdtemp(resolve('.local/tests/embedded-image-'));
const sourceHashes=Object.fromEntries(await Promise.all([fileURLToPath(import.meta.url),resolve('apps/desktop/src/EmbeddedImage.vue'),resolve('apps/desktop/src/modules/image-url.ts')].map(async path=>[path,createHash('sha256').update(await readFile(path)).digest('hex')])));
const entry=`
import {createApp,h,reactive,nextTick} from 'vue';
import EmbeddedImage from './apps/desktop/src/EmbeddedImage.vue';
const nativeCreate=URL.createObjectURL.bind(URL),nativeRevoke=URL.revokeObjectURL.bind(URL);
const lifecycle={created:[],revoked:[]};
URL.createObjectURL=blob=>{const url=nativeCreate(blob);lifecycle.created.push({url,bytes:blob.size,type:blob.type});return url;};
URL.revokeObjectURL=url=>{lifecycle.revoked.push(url);nativeRevoke(url);};
function original(seed){
 const width=1024,height=768,canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;
 const context=canvas.getContext('2d'),image=context.createImageData(width,height);let value=seed;
 for(let i=0;i<image.data.length;i+=4){value^=value<<13;value^=value>>>17;value^=value<<5;image.data[i]=value&255;image.data[i+1]=(value>>>8)&255;image.data[i+2]=(value>>>16)&255;image.data[i+3]=255;}
 context.putImageData(image,0,0);return {width,height,pixels:image.data,source:canvas.toDataURL('image/png')};
}
const originals={a:original(0x12345678),b:original(0x735192af)};
const state=reactive({primary:originals.a.source,secondary:originals.a.source,attributes:originals.a.source,showPrimary:true,showSecondary:true,showAttributes:true});
const view=()=>h('main',[
 h('svg',{id:'pixel-image',width:1024,height:768,viewBox:'0 0 1024 768'},state.showPrimary?[h(EmbeddedImage,{id:'primary',source:state.primary,x:0,y:0,width:1024,height:768,preserveAspectRatio:'none'})]:[]),
 h('svg',{id:'attribute-image',width:600,height:300,viewBox:'0 0 600 300'},state.showAttributes?[h(EmbeddedImage,{id:'attributes',source:state.attributes,x:7,y:9,width:512,height:256,transform:'translate(3 4) scale(.5)',preserveAspectRatio:'none',class:'forwarded-image','aria-label':'Original reference image','data-probe':'svg-attributes',style:{opacity:'.75'}})]:[]),
 h('svg',{width:320,height:240,viewBox:'0 0 1024 768'},state.showSecondary?[h(EmbeddedImage,{id:'secondary',source:state.secondary,width:1024,height:768})]:[])
]);
let app=createApp({render:view}),mounted=true;app.mount('#app');
const sha=async bytes=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),byte=>byte.toString(16).padStart(2,'0')).join('');
const bytes=source=>Uint8Array.from(atob(source.slice(source.indexOf(',')+1)),character=>character.charCodeAt(0));
const equal=(actual,expected)=>{if(actual.length!==expected.length)return {equal:false,actualLength:actual.length,expectedLength:expected.length};let mismatches=0,first=-1;for(let i=0;i<actual.length;i++)if(actual[i]!==expected[i]){mismatches++;if(first<0)first=i;}return {equal:mismatches===0,bytes:actual.length,mismatches,first};};
async function inspect(id,key){
 const element=document.getElementById(id);if(!element)throw Error('Missing mounted image '+id);
 const href=element.getAttribute('href'),expected=originals[key],encoded=bytes(expected.source),response=await fetch(href);if(!response.ok)throw Error('Live image URL could not be read');const actualBytes=new Uint8Array(await response.arrayBuffer());
 const image=new Image();image.src=href;await image.decode();const canvas=document.createElement('canvas');canvas.width=image.naturalWidth;canvas.height=image.naturalHeight;const context=canvas.getContext('2d');context.drawImage(image,0,0);const pixels=context.getImageData(0,0,canvas.width,canvas.height).data;
 return {id,href,namespace:element.namespaceURI,localName:element.localName,sourceLength:expected.source.length,encodedBytes:encoded.length,width:image.naturalWidth,height:image.naturalHeight,encodedEquality:equal(actualBytes,encoded),pixelEquality:equal(pixels,expected.pixels),originalPixelSha256:await sha(expected.pixels),decodedPixelSha256:await sha(pixels),encodedSha256:await sha(encoded),actualEncodedSha256:await sha(actualBytes)};
}
window.fixture={state,originals,lifecycle,nextTick,inspect,
 async set(values){Object.assign(state,values);await nextTick();},
 async readable(url){try{const response=await fetch(url);return response.ok;}catch{return false;}},
 async unmount(){if(mounted){app.unmount();mounted=false;await nextTick();}},
 async remount(){app=createApp({render:()=>h('svg',{width:1024,height:768},[h(EmbeddedImage,{id:'remounted',source:originals.a.source,width:1024,height:768})])});app.mount('#app');mounted=true;await nextTick();}
};
window.fixtureReady=true;
`;
await build({stdin:{contents:entry,resolveDir:resolve('.'),sourcefile:'embedded-image-fixture.ts',loader:'ts'},bundle:true,format:'iife',platform:'browser',outfile:resolve(directory,'fixture.js'),plugins:[{name:'production-vue',setup(builder){builder.onLoad({filter:/\.vue$/},async({path})=>{const {descriptor}=parse(await readFile(path,'utf8'));return {contents:compileScript(descriptor,{id:'embedded-image-browser',inlineTemplate:true}).content,loader:'ts',resolveDir:dirname(path)};});}}]});
await writeFile(resolve(directory,'index.html'),'<!doctype html><html><meta charset="UTF-8"><style>html,body{margin:0;padding:0}svg{display:block}</style><div id="app"></div><script src="fixture.js"></script></html>');
await writeFile(resolve(directory,'fixture.json'),JSON.stringify({html:resolve(directory,'index.html'),width:1200,height:1100}));
const app=await desktop.launch({args:[resolve(directory,'fixture.json')]}),page=await app.firstWindow(),checks=[],errors=[],pixelEvidence=[];
page.setDefaultTimeout(20000);page.on('pageerror',error=>errors.push(error.message));page.on('console',message=>{if(message.text().includes('[Vue warn]'))errors.push(message.text());});
const lifecycle=()=>page.evaluate(()=>structuredClone(window.fixture.lifecycle));
const set=values=>page.evaluate(values=>window.fixture.set(values),values);
const href=id=>page.locator('#'+id).getAttribute('href');
const readable=url=>page.evaluate(url=>window.fixture.readable(url),url);
const inspect=async(id,key)=>{const result=await page.evaluate(({id,key})=>window.fixture.inspect(id,key),{id,key});assert.equal(result.namespace,'http://www.w3.org/2000/svg');assert.equal(result.localName,'image');assert(result.sourceLength>65536);assert(result.encodedBytes>65536,'The generated PNG itself must exceed 64 KiB');assert(result.href.startsWith('blob:'));assert.equal(result.width,1024);assert.equal(result.height,768);assert.equal(result.encodedEquality.equal,true,JSON.stringify(result.encodedEquality));assert.equal(result.pixelEquality.equal,true,JSON.stringify(result.pixelEquality));assert.equal(result.originalPixelSha256,result.decodedPixelSha256);assert.equal(result.encodedSha256,result.actualEncodedSha256);pixelEvidence.push(result);return result;};
try{
 await hiddenWindowId(app,page);await page.waitForFunction(()=>window.fixtureReady===true);
 const first=await inspect('primary','a'),shared=first.href;assert.equal(await href('secondary'),shared);assert.equal(await href('attributes'),shared);let state=await lifecycle();assert.equal(state.created.length,1);assert.equal(state.revoked.length,0);assert.equal(state.created[0].bytes,first.encodedBytes);checks.push('Three real SVG image consumers share one full-resolution Blob URL; fetched PNG bytes and decoded RGBA bytes exactly match the browser-generated original');
 const attrs=await page.locator('#attributes').evaluate(element=>({namespace:element.namespaceURI,x:element.getAttribute('x'),y:element.getAttribute('y'),width:element.getAttribute('width'),height:element.getAttribute('height'),transform:element.getAttribute('transform'),preserveAspectRatio:element.getAttribute('preserveAspectRatio'),class:element.getAttribute('class'),label:element.getAttribute('aria-label'),probe:element.getAttribute('data-probe'),opacity:element.style.opacity,sourceAttribute:element.hasAttribute('source')}));
 assert.deepEqual(attrs,{namespace:'http://www.w3.org/2000/svg',x:'7',y:'9',width:'512',height:'256',transform:'translate(3 4) scale(.5)',preserveAspectRatio:'none',class:'forwarded-image',label:'Original reference image',probe:'svg-attributes',opacity:'0.75',sourceAttribute:false});checks.push('Actual SVG namespace, position, dimensions, transform, preserveAspectRatio, class, style and accessible attributes pass through the production component');
 assert.equal(await page.evaluate(()=>devicePixelRatio),1,'Exact raster comparison requires a one-device-pixel fixture');
 await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));const screenshot=resolve(output,'full-resolution-original.png');await desktopScreenshot(app,page.locator('#pixel-image'),{path:screenshot});const codec=UPNG.default??UPNG,decoded=codec.decode(Uint8Array.from(await readFile(screenshot)).buffer),rgba=new Uint8Array(codec.toRGBA8(decoded)[0]);assert.equal(decoded.width,1024);assert.equal(decoded.height,768);const screenshotPixelSha256=createHash('sha256').update(rgba).digest('hex');assert.equal(screenshotPixelSha256,first.originalPixelSha256,'The actual SVG compositor pixels must match every original RGBA byte at full resolution');checks.push('Real browser SVG screenshot preserves every full-resolution RGBA byte, independently decoded outside the browser');
 await set({showSecondary:false});state=await lifecycle();assert.equal(state.created.length,1);assert.equal(state.revoked.length,0);assert(await readable(shared));await inspect('primary','a');checks.push('Removing one shared consumer keeps the remaining image URL and pixels valid');
 await page.evaluate(()=>window.fixture.set({primary:window.fixture.originals.b.source}));const second=await inspect('primary','b');assert.notEqual(second.href,shared);assert.equal(await href('attributes'),shared);assert(await readable(shared));state=await lifecycle();assert.equal(state.created.length,2);assert.equal(state.revoked.length,0);checks.push('Changing one source creates an independent full-resolution image while its old source stays valid for another mounted consumer');
 await page.evaluate(()=>window.fixture.set({attributes:window.fixture.originals.b.source}));assert.equal(await href('attributes'),second.href);state=await lifecycle();assert.deepEqual(state.revoked,[shared]);assert.equal(await readable(shared),false);assert(await readable(second.href));await inspect('attributes','b');checks.push('Switching the final old-source consumer revokes only the old URL and shares the still-live replacement');
 await page.evaluate(()=>window.fixture.set({primary:window.fixture.originals.a.source}));const transient=await inspect('primary','a');assert.notEqual(transient.href,shared,'A revoked cache entry must never be reused');assert(await readable(second.href));await page.evaluate(()=>window.fixture.set({primary:window.fixture.originals.b.source}));assert.equal(await href('primary'),second.href);state=await lifecycle();assert.equal(state.revoked.filter(url=>url===transient.href).length,1);assert.equal(state.revoked.filter(url=>url===second.href).length,0);assert.equal(await readable(transient.href),false);await inspect('primary','b');checks.push('Repeated source changes never resurrect revoked URLs or revoke another consumer’s active image');
 await set({showPrimary:false});assert(await readable(second.href));state=await lifecycle();assert.equal(state.revoked.filter(url=>url===second.href).length,0);await inspect('attributes','b');await page.evaluate(()=>window.fixture.unmount());state=await lifecycle();assert.equal(state.revoked.filter(url=>url===second.href).length,1);assert.equal(await readable(second.href),false);assert.equal(await page.locator('image').count(),0);for(const created of state.created)assert.equal(state.revoked.filter(url=>url===created.url).length,1);checks.push('The final component unmount revokes every allocated URL exactly once and removes all image nodes');
 await page.evaluate(()=>window.fixture.remount());const remounted=await inspect('remounted','a');assert.notEqual(remounted.href,shared);assert.notEqual(remounted.href,transient.href);await page.evaluate(()=>window.fixture.unmount());state=await lifecycle();for(const created of state.created)assert.equal(state.revoked.filter(url=>url===created.url).length,1);assert.equal(new Set(state.revoked).size,state.created.length);checks.push('A fresh mount after complete teardown receives a fresh working URL and leaves no live allocation after teardown');
 assert.deepEqual(errors,[]);for(const [path,hash] of Object.entries(sourceHashes))assert.equal(createHash('sha256').update(await readFile(path)).digest('hex'),hash,'Source changed during browser verification');await hiddenWindowId(app,page);await writeFile(resolve(output,'pixels.json'),JSON.stringify({sourceHashes,pixelEvidence,screenshot:{path:screenshot,width:decoded.width,height:decoded.height,screenshotPixelSha256}},null,2));
}catch(error){checks.push({passed:false,error:error.stack??String(error)});process.exitCode=1;await desktopScreenshot(app,page,{path:resolve(output,'failure.png')}).catch(()=>{});}
finally{await page.evaluate(()=>window.fixture?.unmount()).catch(()=>{});const allocations=await lifecycle().catch(()=>null);await app.close();const passed=checks.length===9&&checks.every(check=>typeof check==='string')&&errors.length===0;await writeFile(resolve(output,'report.json'),JSON.stringify({passed,verification:'Headless real Edge via the existing browser component fixture host; production EmbeddedImage Vue SFC and native Blob/URL/image decode/SVG compositor',directory,sourceHashes,checks,pixelEvidence,allocations,errors},null,2));console.log(JSON.stringify({passed,checks:checks.length,output}));if(!passed)process.exitCode=1;}
