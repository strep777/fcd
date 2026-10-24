import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {parse,compileScript} from '@vue/compiler-sfc';
import {mkdir,mkdtemp,readFile,writeFile} from 'node:fs/promises';
import {resolve,dirname,basename} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createRenderer,nextTick} from 'vue';
import {HostNode,walk} from './surface-viewport-host.mjs';

// Exercise the actual startup template, its read handler and the unchanged
// session/task store. Unrelated workflow pages are not mounted by this fixture.
await mkdir('.local/tests',{recursive:true});
const directory=await mkdtemp('.local/tests/startup-component-'),file=resolve(directory,'app.mjs');
await build({stdin:{contents:"export {default as App} from './apps/desktop/src/App.vue';export {useSession} from './apps/desktop/src/store';export {createPinia} from 'pinia';export {setLocale} from './apps/desktop/src/localization';",resolveDir:resolve('.'),loader:'ts'},outfile:file,bundle:true,format:'esm',platform:'node',packages:'external',plugins:[{name:'startup-component',setup(b){b.onLoad({filter:/\.vue$/},async({path})=>{
 if(!['App.vue','TaskActivity.vue'].includes(basename(path)))return {contents:"export default {render(){return null;}}",loader:'js'};
 const {descriptor}=parse(await readFile(path,'utf8'));return {contents:compileScript(descriptor,{id:'startup',inlineTemplate:true,templateOptions:{compilerOptions:{hoistStatic:false}}}).content,loader:'ts',resolveDir:dirname(path)};
});}}]});
const {App,useSession,createPinia,setLocale}=await import(pathToFileURL(file).href);setLocale('en');
const renderer=createRenderer({createElement:t=>new HostNode(t),createText:t=>{const n=new HostNode('#text');n.textContent=t;return n;},createComment:()=>new HostNode('#comment'),setText:(n,t)=>n.textContent=t,setElementText:(n,t)=>n.textContent=t,parentNode:n=>n.parentNode,nextSibling:n=>n.parentNode?.children[n.parentNode.children.indexOf(n)+1]??null,insert(n,p,a){if(n.parentNode)n.parentNode.children.splice(n.parentNode.children.indexOf(n),1);const i=a?p.children.indexOf(a):-1;p.children.splice(i<0?p.children.length:i,0,n);n.parentNode=p;},remove(n){if(n.parentNode)n.parentNode.children.splice(n.parentNode.children.indexOf(n),1);n.parentNode=null;},patchProp(n,k,_,v){n.attrs[k]=v;},querySelector:()=>null});
const flush=async()=>{for(let i=0;i<5;i++){await Promise.resolve();await nextTick();}};
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};
const session=(recent=[])=>({project:null,geometry:[],canUndo:false,canRedo:false,savedRevision:null,recovery:[],history:[],recent,jobs:[]});
const entries=[{sessionId:'test-first',name:'Existing first project',revision:4},{sessionId:'test-second',name:'Existing second project',revision:2}];
const nodes=(f,cls)=>walk(f.root).filter(n=>n.attrs.class?.split(' ').includes(cls));
const button=(f,text)=>{const n=walk(f.root).find(n=>n.tag==='button'&&n.textContent===text);assert(n,'missing '+text);return n;};
async function mount(read){const pinia=createPinia(),store=useSession(pinia),root=new HostNode('root'),events={};window.fpcad={read,onChanged:fn=>{events.changed=fn;return()=>delete events.changed;},onStorageError:fn=>{events.storage=fn;return()=>delete events.storage;}};const app=renderer.createApp(App);app.use(pinia);app.mount(root);await flush();return {app,root,store,events};}
const checks=[];
async function check(name,run){try{await run();checks.push({case:name,passed:true});}catch(error){checks.push({case:name,passed:false,error:error.stack});}}
function loading(f){assert.equal(nodes(f,'startup-spinner').length,1);assert.equal(nodes(f,'welcome').length,0);assert.equal(nodes(f,'project-toolbar').length,0);assert.equal(nodes(f,'project-card').length,0);const footer=walk(f.root).find(n=>n.tag==='footer');assert(footer.textContent.includes('Loading projects…'));assert(!footer.textContent.includes('Ready'));assert.equal(f.store.busy,false,'read loading must not take the mutation/task lock');assert.equal(f.store.task,undefined);}

await check('a pending first read shows a loading status and spinner without flashing an empty library or ready status',async()=>{
 const read=deferred();let reads=0;const f=await mount(()=>{reads++;return read.promise;});try{loading(f);assert.equal(nodes(f,'startup-state')[0].attrs['aria-busy'],true);assert(!f.root.textContent.includes('Create a project or open a project file to begin.'));f.events.changed();await new Promise(done=>setTimeout(done,130));await flush();assert.equal(reads,1,'a startup notification must not invalidate the pending first read with a second refresh');loading(f);read.resolve({ok:true,data:session(entries)});await flush();assert.equal(nodes(f,'startup-state').length,0);assert.equal(nodes(f,'project-card').length,2);assert(f.root.textContent.includes('Local projects · 2'));assert(f.root.textContent.includes(entries[0].name));assert(walk(f.root).find(n=>n.tag==='footer').textContent.includes('Ready'));}finally{f.app.unmount();}
});
await check('an actually empty library is displayed only after its successful read',async()=>{
 const read=deferred(),f=await mount(()=>read.promise);try{loading(f);read.resolve({ok:true,data:session()});await flush();assert.equal(nodes(f,'startup-spinner').length,0);assert.equal(nodes(f,'welcome').length,1);assert(f.root.textContent.includes('Create a project or open a project file to begin.'));assert(f.root.textContent.includes('Local projects · 0'));}finally{f.app.unmount();}
});
for(const rejected of [false,true])await check(rejected?'a rejected first read stops loading and a successful retry restores the actual library':'a failed read response shows an error and retry without presenting a false empty library',async()=>{
 const first=deferred(),retry=deferred();let reads=0;const f=await mount(()=>++reads===1?first.promise:retry.promise);try{if(rejected)first.reject(new Error('Unavailable IPC'));else first.resolve({ok:false,error:{code:'CONNECTION_ERROR',messageKey:'CONNECTION_ERROR'}});await flush();assert.equal(nodes(f,'startup-spinner').length,0);assert.equal(nodes(f,'welcome').length,0);assert(f.root.textContent.includes('Local projects could not be loaded'));assert.equal(f.store.error,'CONNECTION_ERROR');const result=button(f,'Retry loading projects').attrs.onClick();await flush();loading(f);assert.equal(f.store.error,'');retry.resolve({ok:true,data:session(entries)});await result;await flush();assert.equal(reads,2);assert.equal(nodes(f,'project-card').length,2);assert.equal(nodes(f,'startup-state').length,0);assert.equal(f.store.error,'');}finally{f.app.unmount();}
});
await check('an unanswered read times out with retry and its late response cannot replace the retried result',async()=>{
 const originalSet=globalThis.setTimeout,originalClear=globalThis.clearTimeout,clocks=new Map();let id=100000;
 globalThis.setTimeout=(fn,delay,...args)=>{if(delay===30000){const token=++id;clocks.set(token,fn);return token;}return originalSet(fn,delay,...args);};globalThis.clearTimeout=token=>{if(clocks.has(token))clocks.delete(token);else originalClear(token);};
 const first=deferred(),retry=deferred();let reads=0;const f=await mount(()=>++reads===1?first.promise:retry.promise);
 try{loading(f);assert.equal(clocks.size,1);[...clocks.values()][0]();await flush();assert.equal(nodes(f,'startup-spinner').length,0);assert.equal(clocks.size,0);const result=button(f,'Retry loading projects').attrs.onClick();await flush();loading(f);retry.resolve({ok:true,data:session(entries)});await result;await flush();first.resolve({ok:true,data:session([{sessionId:'late',name:'Stale late result',revision:0}])});await flush();assert.equal(nodes(f,'project-card').length,2);assert(!f.root.textContent.includes('Stale late result'));assert.deepEqual(JSON.parse(JSON.stringify(f.store.data.recent)),entries);assert.equal(clocks.size,0);}finally{f.app.unmount();globalThis.setTimeout=originalSet;globalThis.clearTimeout=originalClear;}
});
await check('ordinary task progress still uses the existing task activity after startup completes',async()=>{
 const f=await mount(async()=>({ok:true,data:session(entries)})),work=deferred();try{assert.equal(nodes(f,'startup-state').length,0);const running=f.store.run(()=>work.promise,{label:'Existing task workflow'});await flush();assert.equal(nodes(f,'startup-spinner').length,0);assert.equal(nodes(f,'task-spinner').length,1);assert(f.root.textContent.includes('Existing task workflow'));work.resolve({ok:true,data:session(entries)});await running;await flush();assert.equal(nodes(f,'task-spinner').length,0);assert.equal(nodes(f,'project-card').length,2);}finally{f.app.unmount();}
});
await mkdir('test-results/current-cutting/consolidated',{recursive:true});const report={passed:checks.every(c=>c.passed),verification:'Actual App.vue startup UI, TaskActivity.vue and Pinia store in a custom renderer; controlled read-only responses and timeout, no native worker, WebView2, dist build or user library',checks};await writeFile('test-results/current-cutting/consolidated/startup-loading-component.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));if(!report.passed)process.exitCode=1;
