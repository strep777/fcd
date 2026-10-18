import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {mount,fixtureProject,capture,flush,id,walk} from './surface-viewport-host.mjs';

const checks=[];
const hasClass=(n,name)=>n.attrs.class?.split(' ').includes(name);
const find=(f,name)=>walk(f.root).find(n=>hasClass(n,name));
async function keyboard(key,extra={}){const event=new Event('keydown',{cancelable:true});for(const [name,value]of Object.entries({key,...extra}))Object.defineProperty(event,name,{value});window.dispatchEvent(event);await flush();return event;}
async function model(f,label,value){f.byLabel(label).attrs['onUpdate:modelValue'](value);await flush();}
async function check(name,run){try{await run();checks.push({case:name,passed:true});}catch(error){checks.push({case:name,passed:false,error:error.stack});}}
function painted(){
 const p=fixtureProject(),shape={origin:[0,0,0],axes:[[1,0,0],[0,1,0],[0,0,1]],nodes:[[20,20],[80,20],[80,80],[20,80]].map(([xMm,yMm])=>({xMm,yMm}))};
 p.markings=[{id:id('transform-marking'),name:'Editable paint',color:'#2288cc',source:'surface',sourceHash:'',surfaceHash:'',surfaceId:p.surface.id,topologyVersion:1,view:'front',offsetXmm:0,offsetYmm:0,paths:[],surfaceShape:shape,fragments:[
  {faceId:id('lower'),rings:[[[.8,0,.2],[.2,.6,.2],[.2,0,.8]]]},
  {faceId:id('upper'),rings:[[[.8,.2,0],[.2,.8,0],[.2,.2,.6]]]},
 ]}];return p;
}

await check('Ctrl+T exposes eight resize handles and rotation; numerical edits and dragging stay synchronized until Enter commits once',async()=>{
 const calls=[];let f;f=await mount(painted(),{mode:'mapping',controls:false,api:{editSurfaceMarking:async(...args)=>{calls.push(args);const p=structuredClone(JSON.parse(JSON.stringify(f.store.data.project)));p.revision++;p.markings[0].surfaceShape=args[3];return {ok:true,data:{...f.store.data,project:p}};}}});
 try{
  await f.click(f.button('Front'));await model(f,'Select attached marking',id('transform-marking'));const before=JSON.parse(JSON.stringify(f.store.data.project));assert((await keyboard('t',{ctrlKey:true})).defaultPrevented);assert(find(f,'free-transform-box'));const handles=()=>find(f,'free-transform-handles').children;assert.equal(handles().filter(n=>n.tag==='rect').length,8);assert.equal(handles().filter(n=>n.tag==='circle').length,1);
  await model(f,'Attached marking width',75);await model(f,'Attached marking height',45);await model(f,'Attached marking rotation',25);const start=handles().find(n=>n.attrs['data-handle']==='e'),west=handles().find(n=>n.attrs['data-handle']==='w'),oldWest={x:west.attrs.x,y:west.attrs.y};await f.event('onPointerdown',Number(start.attrs.x)+364,Number(start.attrs.y)+274);await f.event('onPointermove',Number(start.attrs.x)+376,Number(start.attrs.y)+274);await f.event('onPointerup',Number(start.attrs.x)+376,Number(start.attrs.y)+274);assert(Number(f.byLabel('Attached marking width').value)>75);assert(Math.abs(Number(f.byLabel('Attached marking height').value)-45)<1e-6);const nextWest=handles().find(n=>n.attrs['data-handle']==='w');assert(Math.hypot(nextWest.attrs.x-oldWest.x,nextWest.attrs.y-oldWest.y)<1e-6,'opposite side stays fixed during width drag');
  const rotate=handles().find(n=>n.tag==='circle'),box=handles().filter(n=>n.tag==='rect'),center={x:box.reduce((s,n)=>s+Number(n.attrs.x)+4,0)/8,y:box.reduce((s,n)=>s+Number(n.attrs.y)+4,0)/8},v={x:Number(rotate.attrs.cx)-center.x,y:Number(rotate.attrs.cy)-center.y},a=-Math.PI/12,destination={x:center.x+v.x*Math.cos(a)-v.y*Math.sin(a),y:center.y+v.x*Math.sin(a)+v.y*Math.cos(a)};
  await f.event('onPointerdown',Number(rotate.attrs.cx)+360,Number(rotate.attrs.cy)+270);await f.event('onPointermove',destination.x+360,destination.y+270);await f.event('onPointerup',destination.x+360,destination.y+270);assert(Math.abs(Number(f.byLabel('Attached marking rotation').value)-40)<1e-6);assert.deepEqual(JSON.parse(JSON.stringify(f.store.data.project)),before);assert.equal(calls.length,0);
  await keyboard('Enter');assert.equal(calls.length,1);assert.deepEqual(calls[0].slice(0,3),[id('project'),1,id('transform-marking')]);assert.equal(handles().filter(n=>n.tag==='rect').length,8,'ordinary selection retains resize handles after confirmation');f.button('Free transform Ctrl+T');assert.equal(f.store.data.project.revision,2);assert(Math.abs(Number(f.byLabel('Attached marking rotation').value)-40)<1e-6);
  const accepted=JSON.parse(JSON.stringify(f.store.data.project));await f.click(f.button('Apply size and rotation'));assert.equal(calls.length,1,'untouched displayed values must not write rounded geometry');assert.deepEqual(JSON.parse(JSON.stringify(f.store.data.project)),accepted);
  await keyboard('t',{ctrlKey:true});await model(f,'Attached marking width',50);const cancelHandle=handles().find(n=>n.attrs['data-handle']==='e'),cancelOrigin={x:Number(cancelHandle.attrs.x)+364,y:Number(cancelHandle.attrs.y)+274};await f.event('onPointerdown',cancelOrigin.x,cancelOrigin.y);await f.event('onPointermove',cancelOrigin.x+18,cancelOrigin.y);assert(Math.abs(Number(f.byLabel('Attached marking width').value)-50)>1);await f.event('onPointercancel',cancelOrigin.x+18,cancelOrigin.y);assert(Math.abs(Number(f.byLabel('Attached marking width').value)-50)<1e-6,'cancelled pointer drag restores its starting preview');await keyboard('Escape');assert.equal(handles().filter(n=>n.tag==='rect').length,8,'cancelling returns to ordinary selected handles');f.button('Free transform Ctrl+T');assert.equal(calls.length,1);assert.equal(f.store.data.project.revision,2);
  f.store.data.project={...before,revision:4};await flush();assert(Math.abs(Number(f.byLabel('Attached marking width').value)-60)<1e-6);assert(Math.abs(Number(f.byLabel('Attached marking height').value)-60)<1e-6);assert.equal(Number(f.byLabel('Attached marking rotation').value),0,'external undo/restore cannot keep a stale transform angle');
 }finally{f.app.unmount();}
});

await check('freehand cut shows a continuous raw stroke without handles, then exposes compact editable world knots on request',async()=>{
 const f=await mount(fixtureProject(),{mode:'cutting',controls:false});try{
  await f.click(f.button('Front'));await f.click(f.byLabel('Freehand cut line'));await f.pointEvent('onPointerdown',20,25);for(let i=1;i<=40;i++)await f.pointEvent('onPointermove',20+i*1.5,25+i*.6);assert.equal(capture().handles.length,0);assert.equal(capture().draft.length,0);const raw=find(f,'active-cut-stroke');assert(raw);assert(raw.attrs.points.split(' ').length>30);await f.pointEvent('onPointerup',80,49);assert(!find(f,'active-cut-stroke'));assert.equal(capture().handles.length,0);const label=walk(f.root).find(n=>n.tag==='label'&&n.textContent==='Edit control nodes');assert(label);label.children.find(n=>n.tag==='input').attrs['onUpdate:modelValue'](true);await flush();assert.equal(capture().handles.length,2);assert(capture().draft.length>=2);assert(!f.button('Save cut line').attrs.disabled);assert.equal(f.store.data.project.revision,1);
  const first={...capture().handles[0]};await f.event('onPointerdown',first.x+360,first.y+270);await f.event('onPointermove',first.x+369,first.y+266);await f.event('onPointerup',first.x+369,first.y+266);assert(Math.hypot(capture().handles[0].x-first.x-9,capture().handles[0].y-first.y+4)<1e-6);assert.equal(f.store.data.project.revision,1);
 }finally{f.app.unmount();}
});

await check('middle-button orbit and Shift pan preserve a pen draft and allow the next point against the new camera',async()=>{
 const f=await mount(fixtureProject(),{mode:'cutting',controls:false});try{
  await f.click(f.button('Front'));await f.click(f.byLabel('Surface pen'));await f.pointEvent('onClick',25,25);assert.equal(capture().handles.length,1);const first={...capture().handles[0]},yaw=capture().camera.yaw;await f.event('onPointerdown',360,270,{button:1});await f.event('onPointermove',385,282,{button:1});await f.event('onPointerup',385,282,{button:1});assert.notEqual(capture().camera.yaw,yaw);assert.equal(capture().handles.length,1);assert(Math.hypot(capture().handles[0].x-first.x,capture().handles[0].y-first.y)>1);
  const pan=capture().camera.panX;await f.event('onPointerdown',360,270,{button:1,shiftKey:true});await f.event('onPointermove',380,278,{button:1,shiftKey:true});await f.event('onPointerup',380,278,{button:1,shiftKey:true});assert.notEqual(capture().camera.panX,pan);await f.event('onPointerdown',380,278);await f.event('onPointerup',380,278);await f.event('onClick',380,278);assert.equal(capture().handles.length,2);
  await f.click(f.byLabel('Rotate'));const toolbarYaw=capture().camera.yaw;await f.event('onPointerdown',360,270);await f.event('onPointermove',385,270);await f.event('onPointerup',385,270);assert.notEqual(capture().camera.yaw,toolbarYaw);await f.click(f.byLabel('Surface pen'));assert.equal(capture().handles.length,2,'returning from visible camera navigation resumes the same pen draft');await f.event('onPointerdown',405,290);await f.event('onPointerup',405,290);await f.event('onClick',405,290);assert.equal(capture().handles.length,3);assert(!f.button('Save cut line').attrs.disabled);assert.equal(f.store.data.project.revision,1);assert.equal(f.calls.length,0);
 }finally{f.app.unmount();}
});

await check('symmetry has a visible model-axis guide and a mirrored cut draft before saving',async()=>{
 const p=fixtureProject();for(const v of p.surface.vertices)v.xMm-=50;const f=await mount(p,{mode:'cutting',controls:false});try{
  await f.click(f.button('Front'));await f.click(f.byLabel('Surface pen'));const checkbox=walk(f.root).find(n=>n.tag==='label'&&n.textContent==='Symmetric').children.find(n=>n.tag==='input');checkbox.attrs['onUpdate:modelValue'](true);await flush();await f.pointEvent('onClick',15,25);await f.pointEvent('onClick',30,75);assert(find(f,'symmetry-guide'));const reflected=find(f,'mirrored-curve-preview');assert(reflected);const points=reflected.attrs.points.split(' ').map(pair=>pair.split(',').map(Number));assert(points.length>=2);for(const [x]of points)assert(x<=1e-6,'mirror draft lies on opposite side of model centre');assert.equal(f.store.data.project.revision,1);assert.equal(f.calls.length,0);
 }finally{f.app.unmount();}
});

const resultsDirectory=process.env.FPCAD_TEST_RESULTS_DIR??'test-results/current-cutting';await mkdir(resultsDirectory,{recursive:true});const passed=checks.every(c=>c.passed);await writeFile(resultsDirectory+'/workflow-editing-component.json',JSON.stringify({passed,verification:'Production Vue component handlers with custom DOM/GPU/IPC host; no Electron compositor verification',checks},null,2));console.log(JSON.stringify({passed,checks}));if(!passed)process.exitCode=1;
