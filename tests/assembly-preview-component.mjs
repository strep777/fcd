import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {build} from 'esbuild';
import {parse,compileScript} from '@vue/compiler-sfc';
import {readFile,mkdir,mkdtemp,writeFile} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
import {pathToFileURL} from 'node:url';

// Actual Vue components, assembly binding conversion and assembly renderer.
// The host supplies measured canvas boxes and records real Canvas2D commands;
// it does not run a browser CSS engine, GPU driver or Electron screenshot.
let canvasBox={x:0,y:0,width:900,height:500},frameId=0;
const frames=new Map(),observers=new Set();
class HostNode{
 constructor(tag=''){this.__v_skip=true;this.tag=tag;this.tagName=tag.toUpperCase();this.children=[];this.parentNode=null;this.attrs={};this.style={};this.listeners=new Map();this.value='';this.defaultValue='';this.type='';this.open=false;this.clientWidth=1120;this.dataset={};}
 get textContent(){return this.text??this.children.map(n=>n.textContent).join('');}set textContent(v){this.text=String(v);this.children=[];}
 get options(){return this.children.filter(n=>n.tag==='option');}get selectedIndex(){return this.options.findIndex(n=>n.selected);}set selectedIndex(i){this.options.forEach((n,j)=>{n.selected=j===i;});}get multiple(){return !!this.attrs.multiple;}
 addEventListener(type,listener){this.listeners.set(type,[...(this.listeners.get(type)??[]),listener]);}removeEventListener(type,listener){this.listeners.set(type,(this.listeners.get(type)??[]).filter(l=>l!==listener));}
 dispatchEvent(e){const handler=this.attrs['on'+e.type[0].toUpperCase()+e.type.slice(1)],listeners=new Set([...(this.listeners.get(e.type)??[]),...(Array.isArray(handler)?handler:handler?[handler]:[])]);for(const listener of listeners)listener({...e,target:this,currentTarget:this});return true;}
 get ownerDocument(){return document;}get valueAsNumber(){return this.value===''?NaN:Number(this.value);}
 getRootNode(){return document;}getBoundingClientRect(){return {x:0,y:0,left:0,top:0,width:1120,height:640};}getClientRects(){return [this.getBoundingClientRect()];}setPointerCapture(){}setAttribute(k,v){this.attrs[k]=v;}removeAttribute(k){delete this.attrs[k];}
}
class Canvas extends HostNode{
 constructor(){super('canvas');this.width=300;this.height=150;this.paths=[];let path=[];const owner=this;this.context={setTransform(){},clearRect(){owner.paths=[];},beginPath(){path=[];},moveTo(x,y){path.push([x,y]);},lineTo(x,y){path.push([x,y]);},closePath(){},fill(){owner.paths.push({color:this.fillStyle,points:path.map(p=>[...p])});},stroke(){}};}
 getBoundingClientRect(){return {...canvasBox,left:canvasBox.x,top:canvasBox.y};}getContext(kind){return kind==='2d'?this.context:null;}
}
class Observer{constructor(callback){this.callback=callback;this.nodes=new Set();observers.add(this);}observe(node){this.nodes.add(node);observers.add(this);}disconnect(){this.nodes.clear();observers.delete(this);}}
globalThis.document={createElement:tag=>new HostNode(tag),documentElement:new HostNode('html'),activeElement:null};globalThis.Document=class {};globalThis.ShadowRoot=class {};
globalThis.HTMLElement=HostNode;globalThis.HTMLCanvasElement=Canvas;globalThis.devicePixelRatio=1;globalThis.ResizeObserver=Observer;
globalThis.requestAnimationFrame=fn=>{frames.set(++frameId,fn);return frameId;};globalThis.cancelAnimationFrame=id=>frames.delete(id);
globalThis.localStorage={getItem:()=>null,setItem(){}};const events=new EventTarget();globalThis.window={addEventListener:events.addEventListener.bind(events),removeEventListener:events.removeEventListener.bind(events),dispatchEvent:events.dispatchEvent.bind(events)};
const {createRenderer,h,nextTick,shallowRef}=await import('vue');
await mkdir('.local/tests',{recursive:true});await mkdir('test-results',{recursive:true});
const directory=resolve(await mkdtemp('.local/tests/assembly-component-')),file=resolve(directory,'fixture.mjs');
await build({stdin:{contents:"export {default as CutAssemblyPreview} from './apps/desktop/src/CutAssemblyPreview.vue';export {default as AssemblyPage} from './apps/desktop/src/AssemblyPage.vue';export {default as UnwrapTools} from './apps/desktop/src/UnwrapTools.vue';export {useSession} from './apps/desktop/src/store';export {createPinia} from 'pinia';export {cutAssembly} from './packages/surface/cut-assembly';export {assemblyRenderer} from './apps/desktop/src/modules/assembly-renderer';",sourcefile:'assembly-component.ts',resolveDir:resolve('.'),loader:'ts'},outfile:file,bundle:true,platform:'node',format:'esm',packages:'external',plugins:[{name:'assembly-vue',setup(builder){builder.onLoad({filter:/\.vue$/},async({path})=>{const {descriptor}=parse(await readFile(path,'utf8'));return {contents:compileScript(descriptor,{id:'assembly',inlineTemplate:true,templateOptions:{compilerOptions:{hoistStatic:false}}}).content,loader:'ts',resolveDir:dirname(path)};});}}]});
const {CutAssemblyPreview,AssemblyPage,UnwrapTools,useSession,createPinia,cutAssembly,assemblyRenderer}=await import(pathToFileURL(file).href);
const renderer=createRenderer({querySelector:()=>null,createElement:tag=>tag==='canvas'?new Canvas():new HostNode(tag),createText:text=>{const n=new HostNode('#text');n.textContent=text;return n;},createComment:text=>{const n=new HostNode('#comment');n.textContent=text;return n;},setText:(n,t)=>{n.textContent=t;},setElementText:(n,t)=>{n.textContent=t;},parentNode:n=>n.parentNode,nextSibling:n=>n.parentNode?.children[n.parentNode.children.indexOf(n)+1]??null,insert(n,parent,anchor){if(n.parentNode){const i=n.parentNode.children.indexOf(n);if(i>=0)n.parentNode.children.splice(i,1);}const i=anchor?parent.children.indexOf(anchor):-1;parent.children.splice(i<0?parent.children.length:i,0,n);n.parentNode=parent;},remove(n){if(n.parentNode){const i=n.parentNode.children.indexOf(n);if(i>=0)n.parentNode.children.splice(i,1);n.parentNode=null;}},patchProp(n,key,old,value){n.attrs[key]=value;if(key==='value'){n.value=value;n._value=value;}if(key==='type')n.type=value;if(key==='checked')n.checked=value;if(key==='open')n.open=!!value;}});
function walk(node){return [node,...node.children.flatMap(walk)];}const hasClass=(n,name)=>n.attrs.class?.split(' ').includes(name);
async function flush(){for(let i=0;i<3;i++){await nextTick();const pending=[...frames];frames.clear();for(const [,fn]of pending)fn();await new Promise(resolve=>setImmediate(resolve));}}
function digest(value){return createHash('sha256').update(value).digest('hex');}
function fixture(){
 const vertices=[[0,0,0],[100,0,0],[100,100,0],[0,100,0]].map(([xMm,yMm,zMm])=>({id:randomUUID(),xMm,yMm,zMm}));
 const surface={id:randomUUID(),source:'obj',topologyVersion:1,vertices,faces:[[0,1,2],[0,2,3]].map(ids=>({id:randomUUID(),region:'sheet',vertices:ids.map(i=>vertices[i].id)}))};
 const pieces=surface.faces.map((f,i)=>({id:randomUUID(),name:i?'Blue flank':'White torso',color:i?'#0088cc':'#ffffff',closed:true,nodes:f.vertices.map(id=>({id:randomUUID(),xMm:vertices.find(v=>v.id===id).xMm,yMm:vertices.find(v=>v.id===id).yMm})),allowanceMm:0,cutQty:1,mirror:false,material:'Fur',furRad:0}));
 // The small display hole verifies an SVG thumbnail preserves its even-odd
 // source path; assembly itself is still governed by the saved bindings.
 pieces[0].holes=[[[60,15],[60,20],[65,20],[65,15]].map(([xMm,yMm])=>({id:randomUUID(),xMm,yMm}))];
 const surfaceHash=digest(JSON.stringify(surface)),bindings=pieces.map((p,i)=>({pieceId:p.id,surfaceId:surface.id,topologyVersion:1,surfaceHash,geometryHash:digest(JSON.stringify({nodes:p.nodes,holes:p.holes??[],curves:[]})),report:{faceIds:[surface.faces[i].id],uv:surface.faces[i].vertices.map(id=>({vertexId:id,xMm:vertices.find(v=>v.id===id).xMm,yMm:vertices.find(v=>v.id===id).yMm})),boundary:surface.faces[i].vertices,areaErrorMax:0,edgeErrorMax:0,distortionMean:0,distortionP95:0,distortionMax:0,status:'acceptable'}}));
 const run={sourceHash:surfaceHash,algorithm:'lscm-cg-1',accepted:true,pieces,bindings};return {surface,run,project:{id:randomUUID(),revision:1,name:'Assembly fixture',pieces,bindings,surface,surfaceRun:run,markings:[]}};
}
async function mount(component,props,p){
 const root=new HostNode('root'),input=shallowRef(props),pinia=createPinia(),store=useSession(pinia);if(p)store.data={project:p,geometry:[],canUndo:false,canRedo:false,savedRevision:null,history:[],recovery:[],recent:[],jobs:[]};
 const app=renderer.createApp({render:()=>h(component,input.value)});app.use(pinia);app.mount(root);await flush();return {root,app,input,store};
}
const checks=[],data=fixture(),view=await mount(CutAssemblyPreview,{surface:data.surface,run:data.run,language:'en'});
try{
 const {root,input}=view,findLabel=label=>{const n=walk(root).find(n=>n.attrs['aria-label']===label);assert(n,label);return n;},button=text=>{const n=walk(root).find(n=>n.tag==='button'&&n.textContent===text);assert(n,text);return n;},click=async n=>{n.attrs.onClick({button:0});await flush();};
 const canvas=walk(root).find(n=>n instanceof Canvas),first=walk(root).find(n=>hasClass(n,'first-pane')),second=walk(root).find(n=>hasClass(n,'second-pane'));
 assert(walk(first).includes(canvas));assert(walk(second).includes(findLabel('Search assembly pieces')));assert.equal(walk(second).filter(n=>n.tag==='svg').length,2);
 const white=walk(second).find(n=>n.tag==='path'&&n.attrs.fill==='#ffffff');assert.equal(white.attrs['fill-rule'],'evenodd');assert(white.attrs.stroke);assert.equal((white.attrs.d.match(/M/g)??[]).length,2,'thumbnail retains the hole');assert.equal(canvas.dataset.triangles,'2');
 const painted=canvas.paths.flatMap(p=>p.points),xs=painted.map(p=>p[0]),ys=painted.map(p=>p[1]),width=Math.max(...xs)-Math.min(...xs),height=Math.max(...ys)-Math.min(...ys);
 assert(width>300&&height>300,'actual renderer uses a substantive portion of the measured canvas');assert(Math.abs((Math.min(...xs)+Math.max(...xs))/2-450)<1e-6);assert(Math.abs((Math.min(...ys)+Math.max(...ys))/2-250)<1e-6);
 const separator=walk(root).find(n=>n.attrs.role==='separator');assert.equal(separator.attrs['aria-valuenow'],76,'left model pane starts with the main share of the horizontal split');
 checks.push({case:'left canvas / right outlined SVG piece picker; real renderer centered',width,height,passed:true});
 const check=findLabel('Show cut White torso');check.checked=false;check.dispatchEvent({type:'change'});await flush();assert.equal(canvas.dataset.triangles,'1');assert(canvas.paths.every(p=>p.color!=='#ffffff'));
 findLabel('Search assembly pieces').attrs['onUpdate:modelValue'](' blue ');await flush();assert.equal(walk(second).filter(n=>hasClass(n,'assembly-piece')).length,1);assert.equal(canvas.dataset.triangles,'1','search does not change the selection');
 await click(button('Combine all'));assert.equal(canvas.dataset.triangles,'2','select all includes pieces hidden by search');await click(button('Clear preview'));assert.equal(canvas.dataset.triangles,'0');assert.equal(canvas.paths.length,0);
 input.value={...input.value,run:{...data.run,pieces:data.run.pieces.map(p=>({...p,name:p.name+' renamed'}))}};await flush();assert.equal(walk(root).find(n=>n instanceof Canvas).dataset.triangles,'0','metadata refresh preserves explicit cleared selection');
 await click(button('Combine all'));findLabel('Explode distance').attrs['onUpdate:modelValue'](.5);await flush();await click(button('Reset assembly view'));assert.equal(findLabel('Explode distance').value,0);
 checks.push({case:'individual selection, search, select all, clear, metadata stability and view reset',passed:true});
 const resized=walk(root).find(n=>n instanceof Canvas);canvasBox={x:0,y:0,width:0,height:0};for(const o of observers)if(o.nodes.has(resized))o.callback([{contentRect:canvasBox}]);await flush();assert(resized.width>1&&resized.height>1,'hidden pane does not shrink backing buffer to 1×1');
 canvasBox={x:0,y:0,width:660,height:360};for(const o of observers)if(o.nodes.has(resized))o.callback([{contentRect:canvasBox}]);await flush();assert.equal(resized.width,660);assert.equal(resized.height,360);assert.equal(resized.dataset.triangles,'2');
 const afterResize=resized.paths.flatMap(p=>p.points),rx=afterResize.map(p=>p[0]),ry=afterResize.map(p=>p[1]);assert(Math.abs((Math.min(...rx)+Math.max(...rx))/2-330)<1e-6);assert(Math.abs((Math.min(...ry)+Math.max(...ry))/2-180)<1e-6);checks.push({case:'hidden / restored viewport resize keeps real canvas dimensions and model center synchronized',passed:true});
}finally{view.app.unmount();await flush();assert.equal(frames.size,0);assert.equal(observers.size,0);}

{
 const savedApi=window.fpcad,foldedData=fixture();let progressUnsubscribed=0;
 window.fpcad={onSurfaceProgress:()=>()=>progressUnsubscribed++};
 const folded=await mount(UnwrapTools,{language:'en'},foldedData.project),before=JSON.stringify(folded.store.data.project);
 try{
  const details=walk(folded.root).find(n=>n.tag==='details'&&n.children.some(child=>child.tag==='summary'&&child.textContent==='Cut assembly preview'));assert(details);
  const canvas=()=>walk(folded.root).find(n=>n instanceof Canvas),pieceControl=name=>walk(folded.root).find(n=>n.attrs['aria-label']==='Show cut '+name),button=text=>walk(folded.root).find(n=>n.tag==='button'&&n.textContent===text);
  const toggle=async open=>{details.open=open;details.dispatchEvent({type:'toggle'});await flush();};
  assert.equal(details.open,false);assert.equal(canvas(),undefined,'initially closed details do not mount the preview');assert.equal(observers.size,0);assert.equal(frames.size,0);
  await toggle(true);const firstCanvas=canvas();assert(firstCanvas);assert.equal(firstCanvas.dataset.triangles,'2');assert.equal(pieceControl('White torso').value,foldedData.run.pieces[0].id);
  const white=pieceControl('White torso');white.checked=false;white.dispatchEvent({type:'change'});await flush();assert.equal(canvas().dataset.triangles,'1');
  await toggle(false);assert.equal(canvas(),undefined);assert.equal(observers.size,0,'closing details disconnects preview and split observers');assert.equal(frames.size,0,'closing details cancels pending preview frames');assert.equal(progressUnsubscribed,0,'closing only releases the preview, retaining the parent task listener');
  await toggle(true);assert(canvas()!==firstCanvas,'reopening creates a new renderer');assert.equal(canvas().dataset.triangles,'1');assert.equal(pieceControl('White torso').checked,false);assert.equal(pieceControl('White torso').value,foldedData.run.pieces[0].id);assert.equal(pieceControl('Blue flank').checked,true);
  button('Clear preview').dispatchEvent({type:'click',button:0});await flush();assert.equal(canvas().dataset.triangles,'0');await toggle(false);await toggle(true);assert.equal(canvas().dataset.triangles,'0','an explicitly empty selection survives remounting');assert.equal(pieceControl('White torso').checked,false);assert.equal(pieceControl('Blue flank').checked,false);assert.equal(JSON.stringify(folded.store.data.project),before,'preview interaction must not modify project state');
  await toggle(false);const added={...foldedData.run.pieces[0],id:randomUUID(),name:'New panel'};folded.store.data.project.surfaceRun={...foldedData.run,pieces:[...foldedData.run.pieces,added],bindings:[...foldedData.run.bindings,{...foldedData.run.bindings[0],pieceId:added.id}]};await flush();assert.equal(canvas(),undefined,'updating a closed preview does not construct its renderer');
  await toggle(true);assert.equal(canvas().dataset.triangles,'1');assert.equal(pieceControl('New panel').checked,true,'new pieces are selected by default');assert.equal(pieceControl('New panel').value,added.id);assert.equal(pieceControl('White torso').checked,false);assert.equal(pieceControl('Blue flank').checked,false);
  checks.push({case:'closed details defer preview creation; close releases resources; reopen preserves hidden and cleared selections and piece IDs while selecting new pieces',passed:true});
 }finally{folded.app.unmount();await flush();window.fpcad=savedApi;assert.equal(progressUnsubscribed,1);assert.equal(frames.size,0);assert.equal(observers.size,0);}
}

canvasBox={x:0,y:0,width:900,height:500};const page=await mount(AssemblyPage,{language:'en',active:true},data.project);
try{for(let i=0;i<20&&!walk(page.root).some(n=>n instanceof Canvas);i++)await flush();assert(walk(page.root).some(n=>n instanceof Canvas),'validated AssemblyPage renders the actual preview');assert(walk(page.root).some(n=>hasClass(n,'assembly-picker')));checks.push({case:'AssemblyPage integrates the split preview after saved binding integrity verification',passed:true});}finally{page.app.unmount();await flush();}

let realEvidence;
try{
 const actual=JSON.parse(await readFile('test-results/current-task/real-cut-project.json','utf8'));
 if(actual.surface&&actual.surfaceRun){const preview=await mount(CutAssemblyPreview,{surface:actual.surface,run:actual.surfaceRun,markings:actual.previewMarkings??actual.markings,language:'en'});try{
  const canvas=walk(preview.root).find(n=>n instanceof Canvas),triangles=cutAssembly(actual.surface,actual.surfaceRun),points=triangles.flatMap(t=>t.points),min=[Infinity,Infinity,Infinity],max=[-Infinity,-Infinity,-Infinity];for(const p of points)for(let i=0;i<3;i++){min[i]=Math.min(min[i],p[i]);max[i]=Math.max(max[i],p[i]);}
  const projected=canvas.paths.flatMap(p=>p.points),bounds=[Infinity,Infinity,-Infinity,-Infinity];for(const [x,y]of projected){bounds[0]=Math.min(bounds[0],x);bounds[1]=Math.min(bounds[1],y);bounds[2]=Math.max(bounds[2],x);bounds[3]=Math.max(bounds[3],y);}
  realEvidence={faces:actual.surface.faces.length,pieces:actual.surfaceRun.pieces.length,triangles:triangles.length,sourceBounds:{min,max},canvas:{...canvasBox},paintedBounds:bounds,drawMs:Number(canvas.dataset.drawMs)};assert.equal(Number(canvas.dataset.triangles),triangles.length);assert(canvas.paths.length>0);checks.push({case:'real saved model bindings execute through the actual renderer',passed:true});
 }finally{preview.app.unmount();await flush();}}
}catch(error){if(error.code!=='ENOENT')throw error;}
{
 const canvas=new Canvas(),triangles=[{pieceId:'front',faceId:'front-face',color:'#ffffff',points:[[-100,0,0],[0,0,0],[0,100,0]]},{pieceId:'fold',faceId:'fold-face',color:'#ffffff',points:[[0,0,0],[0,100,0],[100,0,100]]}],painter=assemblyRenderer(canvas,triangles,[]);
 painter.draw({yaw:0,pitch:0,zoom:1,explode:0},['front','fold']);assert.equal(canvas.dataset.renderer,'canvas');assert.equal(canvas.paths.length,2);
 const channels=canvas.paths.map(p=>{assert.match(p.color,/^#[0-9a-f]{6}$/);const values=[1,3,5].map(i=>parseInt(p.color.slice(i,i+2),16));assert.equal(values[0],values[1]);assert.equal(values[1],values[2]);assert(values[0]>=100&&values[0]<255,'white material remains visible but is shaded');return values[0];});assert(Math.abs(channels[0]-channels[1])>30,'different face normals produce visible light differences');
 painter.draw({yaw:Math.PI,pitch:0,zoom:1,explode:0},['front','fold']);assert.notDeepEqual(canvas.paths.map(p=>p.color),channels.map(n=>'#'+n.toString(16).padStart(2,'0').repeat(3)),'camera rotation changes normal lighting');painter.dispose();
 checks.push({case:'actual Canvas2D white faces have normal-dependent shades and respond to orbit',passed:true});
}
{
 // Shader declarations and actual upload/pointer calls must agree. This uses a
 // GL command recorder, not shader execution or a GPU display verification.
 const glCalls={shader:[],attributes:[],uploads:[],draws:[]},names=['position','offset','color','normal'];
 const gl={VERTEX_SHADER:1,FRAGMENT_SHADER:2,COMPILE_STATUS:3,LINK_STATUS:4,ARRAY_BUFFER:5,STATIC_DRAW:6,FLOAT:7,COLOR_BUFFER_BIT:8,DEPTH_BUFFER_BIT:16,DEPTH_TEST:9,TRIANGLES:10,
  createShader:()=>({}),shaderSource:(_,source)=>glCalls.shader.push(source),compileShader(){},getShaderParameter:()=>true,createProgram:()=>({}),attachShader(){},linkProgram(){},getProgramParameter:()=>true,useProgram(){},createBuffer:()=>({}),getUniformLocation:(_,name)=>name,getAttribLocation:(_,name)=>names.indexOf(name),bindBuffer(){},bufferData:(_,data)=>glCalls.uploads.push([...data]),enableVertexAttribArray(){},vertexAttribPointer:(...args)=>glCalls.attributes.push(args),viewport(){},clearColor(){},clear(){},enable(){},uniform4f(){},uniform3f(){},uniform1f(){},drawArrays:(...args)=>glCalls.draws.push(args),deleteBuffer(){},deleteProgram(){},deleteShader(){}};
 const canvas=new Canvas();canvas.getContext=kind=>kind==='webgl'?gl:null;const triangles=cutAssembly(data.surface,data.run),painter=assemblyRenderer(canvas,triangles,[]);painter.draw({yaw:0,pitch:0,zoom:1,explode:0},data.run.pieces.map(p=>p.id));
 assert.equal(canvas.dataset.renderer,'webgl');const declared=[...glCalls.shader[0].matchAll(/attribute\s+vec3\s+(\w+)\s*;/g)].map(m=>m[1]);assert.deepEqual(declared,names);assert.deepEqual(glCalls.attributes,names.map((_,i)=>[i,3,gl.FLOAT,false,48,i*12]));const upload=glCalls.uploads[0];assert.equal(upload.length,triangles.length*3*12);assert(upload.every(Number.isFinite));
 for(let offset=0;offset<upload.length;offset+=12){assert(Math.abs(Math.hypot(...upload.slice(offset+9,offset+12))-1)<1e-6,'each packed vertex carries one unit normal');assert(upload.slice(offset+6,offset+9).every(c=>c>=0&&c<=1));}
 assert.deepEqual(glCalls.draws[0],[gl.TRIANGLES,0,triangles.length*3]);painter.dispose();checks.push({case:'GPU vec3 shader attributes, 48-byte stride and packed color/normal upload agree (command recorder)',passed:true});
}
await writeFile('test-results/assembly-preview-component.json',JSON.stringify({passed:true,verification:'Actual Vue/custom host, Canvas2D commands and GPU upload contract; not browser CSS or Electron GPU pixels',checks,realEvidence},null,2));
console.log(JSON.stringify({passed:true,checks,realEvidence}));
