import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {parse,compileScript} from '@vue/compiler-sfc';
import {readFile,mkdir,mkdtemp,writeFile} from 'node:fs/promises';
import {resolve,dirname,basename} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createRenderer,h,nextTick,reactive} from 'vue';

// Execute the production SFC's controls. Only its sibling panels and IPC/store
// boundary are substituted; assertions observe selected views and API requests.
class Node {
 constructor(tag=''){this.tag=tag;this.tagName=tag.toUpperCase();this.children=[];this.attrs={};this.listeners=new Map();this.parentNode=null;this.value='';}
 get textContent(){return this.text??this.children.map(n=>n.textContent).join('');}
 set textContent(value){this.text=String(value);this.children=[];}
 get options(){return this.children.filter(n=>n.tag==='option');}
 get selectedIndex(){return this.options.findIndex(n=>n.selected);}
 set selectedIndex(index){this.options.forEach((n,i)=>n.selected=i===index);}
 get multiple(){return false;}
 addEventListener(type,listener){this.listeners.set(type,[...(this.listeners.get(type)??[]),listener]);}
 removeEventListener(){}
}
const walk=n=>[n,...n.children.flatMap(walk)],clone=value=>JSON.parse(JSON.stringify(value));
const renderer=createRenderer({
 createElement:tag=>new Node(tag),createText:text=>{const n=new Node('#text');n.textContent=text;return n;},createComment:()=>new Node('#comment'),
 setText:(n,text)=>n.textContent=text,setElementText:(n,text)=>n.textContent=text,parentNode:n=>n.parentNode,nextSibling:()=>null,
 insert(n,p){p.children.push(n);n.parentNode=p;},remove(n){n.parentNode.children=n.parentNode.children.filter(c=>c!==n);},
 patchProp(n,key,old,value){n.attrs[key]=value;if(key==='value'){n.value=value;n._value=value;}}
});
await mkdir('.local/tests',{recursive:true});await mkdir('test-results',{recursive:true});
const output=resolve(await mkdtemp('.local/tests/reference-view-controls-'),'component.mjs');
await build({entryPoints:[resolve('apps/desktop/src/MarkingsPage.vue')],outfile:output,bundle:true,format:'esm',platform:'node',packages:'external',plugins:[{name:'reference-controls',setup(b){
 b.onLoad({filter:/\.vue$/},async({path})=>{
  if(basename(path)!=='MarkingsPage.vue')return {contents:"import {h} from 'vue';export default {setup(_,context){return()=>h('div',Object.values(context.slots).filter(slot=>typeof slot==='function').flatMap(slot=>slot()));}};",loader:'js'};
  const {descriptor}=parse(await readFile(path,'utf8'));return {contents:compileScript(descriptor,{id:'reference-views',inlineTemplate:true}).content,loader:'ts',resolveDir:dirname(path)};
 });
 b.onLoad({filter:/[\\/]store\.ts$/},()=>({contents:'export const useSession=()=>globalThis.__referenceViewStore;',loader:'js'}));
 b.onLoad({filter:/[\\/]localization\.ts$/},()=>({contents:'export const localize=value=>value;',loader:'js'}));
}}]});
const {default:MarkingsPage}=await import(pathToFileURL(output).href),checks=[];
async function fixture(references=[{id:'front-image',view:'front',calibration:{distanceMm:1700}},{id:'back-image',view:'back',calibration:{distanceMm:1700}}]){
 const root=new Node('root'),calls=[],store=reactive({busy:false,data:{project:{id:'views-project',revision:7,references,patternLibrary:[]}},async run(action){store.busy=true;try{const result=await action();return result.ok&&!result.cancelled;}finally{store.busy=false;}}});
 globalThis.__referenceViewStore=store;globalThis.window={fpcad:{...Object.fromEntries(['autoReference','importReference','splitAllReferences'].map(method=>[method,async(...args)=>{calls.push({method,args});return {ok:true,data:clone(store.data)};}])),cancelSurface:async()=>({ok:true,data:clone(store.data)})}};
 const app=renderer.createApp({render:()=>h(MarkingsPage,{language:'zh'})});app.mount(root);await nextTick();
 const control=label=>{const n=walk(root).find(n=>n.attrs['aria-label']===label);assert(n,label);return n;};
 const button=text=>{const n=walk(root).find(n=>n.tag==='button'&&n.textContent===text);assert(n,text);return n;};
 const click=async text=>{const n=button(text);assert(!n.attrs.disabled,text+' is disabled');await n.attrs.onClick();await nextTick();};
 const choose=async(label,value)=>{const n=control(label);n.attrs['onUpdate:modelValue'](value);await nextTick();};
 return {root,store,calls,app,control,button,click,choose};
}
async function check(name,run){try{await run();checks.push({name,passed:true});}catch(error){checks.push({name,passed:false,error:String(error.stack)});}}

await check('upload defaults to front-left and sends each explicitly chosen dual-view layout',async()=>{
 const f=await fixture();try{
  assert(f.control('双视图布局').options.find(n=>n.value==='front-left').selected);
  await f.click('上传双视图并自动拆分');assert.equal(f.calls.at(-1).args[2],'front-left');
  for(const layout of ['front-right','separate']){await f.choose('双视图布局',layout);await f.click('上传双视图并自动拆分');assert.equal(f.calls.at(-1).args[2],layout);}
  assert(f.calls.every(c=>c.method==='autoReference'&&c.args[0]==='views-project'&&c.args[1]===7));
 }finally{f.app.unmount();}
});
await check('single-image import sends the chosen front/back view',async()=>{
 const f=await fixture();try{
  await f.click('导入单张原图');assert.equal(f.calls.at(-1).args[2],'front');
  await f.choose('单张原图朝向','back');await f.click('导入单张原图');assert.deepEqual(f.calls.at(-1),{method:'importReference',args:['views-project',7,'back']});
 }finally{f.app.unmount();}
});
await check('ordinary resplit preserves saved views; only the explicit swap action requests view exchange',async()=>{
 const f=await fixture();try{
  const before=clone(f.store.data.project.references);await f.choose('双视图布局','front-right');assert.equal(f.calls.length,0);assert.deepEqual(clone(f.store.data.project.references),before);
  await f.click('按当前标定重新拆分');assert.equal(f.calls.at(-1).args[7],false);assert.equal(f.calls.at(-1).args[2],1700);
  await f.click('交换正背并重新拆分');assert.equal(f.calls.at(-1).args[7],true);
  await f.click('按当前标定重新拆分');assert.equal(f.calls.at(-1).args[7],false);assert.deepEqual(clone(f.store.data.project.references),before);
 }finally{f.app.unmount();}
});
await check('resplit requires both views and all view controls disable while an operation is active',async()=>{
 const f=await fixture([{id:'front-image',view:'front'}]);try{
  assert(f.button('按当前标定重新拆分').attrs.disabled);assert(f.button('交换正背并重新拆分').attrs.disabled);
  f.store.busy=true;await nextTick();for(const label of ['双视图布局','单张原图朝向'])assert(f.control(label).attrs.disabled);
  for(const text of ['上传双视图并自动拆分','导入单张原图'])assert(f.button(text).attrs.disabled);assert.equal(f.calls.length,0);
 }finally{f.app.unmount();}
});
const report={passed:checks.every(c=>c.passed),checks};await writeFile('test-results/reference-view-controls-component.json',JSON.stringify(report,null,2));
console.log(JSON.stringify(report,null,2));if(!report.passed)process.exitCode=1;
