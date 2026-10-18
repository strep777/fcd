import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {mount,fixtureProject,capture,flush,id,walk} from './surface-viewport-host.mjs';

const clone=value=>JSON.parse(JSON.stringify(value));
function project(){
 const p=fixtureProject(),shape={origin:[0,0,0],axes:[[1,0,0],[0,1,0],[0,0,1]],nodes:[[25,20],[70,20],[70,65],[25,65]].map(([xMm,yMm])=>({xMm,yMm}))};
 p.markings=[{id:id('selection-marking'),name:'Selected marking',color:'#2288cc',source:'surface',sourceHash:'',surfaceHash:'',surfaceId:p.surface.id,topologyVersion:1,view:'front',offsetXmm:0,offsetYmm:0,paths:[],surfaceShape:shape,fragments:[{faceId:id('lower'),rings:[[[.55,.25,.2],[.1,.7,.2],[.1,.25,.65]]]},{faceId:id('upper'),rings:[[[.55,.2,.25],[.1,.2,.7],[.1,.65,.25]]]}]}];
 p.patternLibrary=[{piece:{id:id('selection-source'),name:'Source pattern',color:'#2288cc',nodes:[[0,0],[15,0],[15,15],[0,15]].map(([xMm,yMm],i)=>({id:id('source-node-'+i),xMm,yMm})),closed:true,allowanceMm:0,cutQty:1,mirror:false,material:'Fur',furRad:0},referenceId:id('selection-reference'),view:'front',category:'body'}];
 return p;
}
async function fixture(){let f;const edited=[],attached=[];f=await mount(project(),{mode:'mapping',controls:false,api:{editSurfaceMarking:async(...args)=>{edited.push(clone(args));const next=clone(f.store.data.project);next.revision++;next.markings.find(m=>m.id===args[2]).surfaceShape=clone(args[3]);return{ok:true,data:{...f.store.data,project:next}};},surfaceMarking:async(...args)=>{attached.push(clone(args));const next=clone(f.store.data.project);next.revision++;next.markings=[{...clone(project().markings[0]),id:id('reattached-marking'),surfaceShape:clone(args[2])}];return{ok:true,data:{...f.store.data,project:next}};}}});await f.click(f.button('Front'));f.byLabel('Select attached marking').attrs['onUpdate:modelValue'](id('selection-marking'));await flush();return{f,edited,attached};}
const resizeHandles=f=>walk(f.root).filter(n=>n.tag==='rect'&&n.attrs['data-handle']);
const checks=[];
async function check(name,run){try{await run();checks.push({case:name,passed:true});}catch(error){checks.push({case:name,passed:false,error:error.stack});}}

await check('ordinary selection exposes resize handles; direct drag stays a draft, Escape restores and confirmation saves once',async()=>{
 const {f,edited}=await fixture();try{
  assert.equal(resizeHandles(f).length,8,'selecting a marking exposes all resize handles without Ctrl+T');
  const original=clone(f.store.data.project),before=Number(f.byLabel('Attached marking width').value),handle=resizeHandles(f).find(n=>n.attrs['data-handle']==='se');
  const start={x:Number(handle.attrs.x)+364,y:Number(handle.attrs.y)+274};
  await f.event('onPointerdown',start.x,start.y);await f.event('onPointermove',start.x+24,start.y+16);await f.event('onPointerup',start.x+24,start.y+16);
  assert(Number(f.byLabel('Attached marking width').value)>before);assert.deepEqual(clone(f.store.data.project),original);assert.equal(edited.length,0);f.button('Confirm transform Enter');
  await f.key('Escape');assert.equal(Number(f.byLabel('Attached marking width').value),before);assert.equal(resizeHandles(f).length,8);assert.deepEqual(clone(f.store.data.project),original);
  const next=resizeHandles(f).find(n=>n.attrs['data-handle']==='se'),point={x:Number(next.attrs.x)+364,y:Number(next.attrs.y)+274};
  await f.event('onPointerdown',point.x,point.y);await f.event('onPointermove',point.x+20,point.y+10);await f.event('onPointerup',point.x+20,point.y+10);await f.click(f.button('Confirm transform Enter'));
  assert.equal(edited.length,1);assert.equal(edited[0][2],id('selection-marking'));assert.equal(f.store.data.project.revision,original.revision+1);
 }finally{f.app.unmount();}
});

await check('clearing while contour editing discards the deleted draft and permits a new library drop without an edit of the old ID',async()=>{
 const {f,edited,attached}=await fixture();try{
  await f.click(f.byLabel('Edit attached marking nodes'));assert.equal(capture().handles.length,4);
  const p=f.store.data.project;f.store.data.project={...p,revision:p.revision+1,markings:[]};await flush();
  assert.equal(capture().handles.length,0);assert.equal(resizeHandles(f).length,0);assert.equal(f.byLabel('Select attached marking').value,'');assert(!walk(f.root).some(n=>n.tag==='button'&&n.textContent==='Confirm marking edit'));
  const preview=walk(f.root).find(n=>n.attrs.class==='surface-preview'),canvas=walk(f.root).find(n=>n.attrs.class==='surface-view'),point=f.client(50,50);canvas.closest=selector=>selector==='.surface-view'?canvas:null;
  const transfer={types:['application/x-fpcad-region'],dropEffect:'none',getData:key=>key==='application/x-fpcad-region'?id('selection-source'):''};let prevented=false;
  const event={clientX:point.x,clientY:point.y,target:canvas,currentTarget:preview,dataTransfer:transfer,preventDefault(){prevented=true;}};
  preview.attrs.onDragover(event);assert(prevented,'a library drag remains accepted after clearing an editing draft');assert.equal(transfer.dropEffect,'copy');
  await preview.attrs.onDrop(event);await flush();assert.equal(attached.length,1);assert.equal(edited.length,0);assert.equal(f.store.data.project.markings[0].id,id('reattached-marking'));assert.equal(f.byLabel('Select attached marking').value,id('reattached-marking'));assert.equal(resizeHandles(f).length,8);
 }finally{f.app.unmount();}
});

await check('clearing during a transform removes the draft and a later Enter cannot write the deleted marking',async()=>{
 const {f,edited}=await fixture();try{
  await f.click(f.button('Free transform Ctrl+T'));const p=f.store.data.project;f.store.data.project={...p,revision:p.revision+1,markings:[]};await flush();await f.key('Enter');assert.equal(edited.length,0);assert.equal(resizeHandles(f).length,0);assert.equal(f.byLabel('Select attached marking').value,'');
 }finally{f.app.unmount();}
});

await mkdir('test-results/current-cutting',{recursive:true});const passed=checks.every(c=>c.passed);await writeFile('test-results/current-cutting/mapping-selection-state-component.json',JSON.stringify({passed,verification:'Production SurfacePanel handlers in the custom component host; no desktop process or native worker',checks},null,2));console.log(JSON.stringify({passed,checks}));if(!passed)process.exitCode=1;
