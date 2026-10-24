import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {mount,fixtureProject,capture,flush,id,walk,draftHistory} from './surface-viewport-host.mjs';

const clone=value=>JSON.parse(JSON.stringify(value));
function project(){
 const p=fixtureProject(),shape={origin:[0,0,0],axes:[[1,0,0],[0,1,0],[0,0,1]],nodes:[[25,20],[70,20],[70,65],[25,65]].map(([xMm,yMm])=>({xMm,yMm}))};
 p.markings=[{id:id('selection-marking'),name:'Selected marking',color:'#2288cc',source:'surface',sourceHash:'',surfaceHash:'',surfaceId:p.surface.id,topologyVersion:1,view:'front',offsetXmm:0,offsetYmm:0,paths:[],surfaceShape:shape,fragments:[{faceId:id('lower'),rings:[[[.55,.25,.2],[.1,.7,.2],[.1,.25,.65]]]},{faceId:id('upper'),rings:[[[.55,.2,.25],[.1,.2,.7],[.1,.65,.25]]]}]}];
 p.patternLibrary=[{piece:{id:id('selection-source'),name:'Source pattern',color:'#2288cc',nodes:[[0,0],[15,0],[15,15],[0,15]].map(([xMm,yMm],i)=>({id:id('source-node-'+i),xMm,yMm})),closed:true,allowanceMm:0,cutQty:1,mirror:false,material:'Fur',furRad:0},referenceId:id('selection-reference'),view:'front',category:'body'}];
 return p;
}
async function fixture(options={}){let f;const edited=[],attached=[];f=await mount(project(),{...options,mode:'mapping',controls:false,api:{editSurfaceMarking:async(...args)=>{edited.push(clone(args));const next=clone(f.store.data.project);next.revision++;next.markings.find(m=>m.id===args[2]).surfaceShape=clone(args[3]);return{ok:true,data:{...f.store.data,project:next}};},surfaceMarking:async(...args)=>{attached.push(clone(args));const next=clone(f.store.data.project);next.revision++;next.markings=[{...clone(project().markings[0]),id:id('reattached-marking'),surfaceShape:clone(args[2])}];return{ok:true,data:{...f.store.data,project:next}};}}});await f.click(f.button('Front'));f.byLabel('Select attached marking').attrs['onUpdate:modelValue'](id('selection-marking'));await flush();return{f,edited,attached};}
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

for(const scale of[1,1.5])await check(`a numerically narrowed marking can move from its center, resize from a handle and undo exactly (viewport scale ${scale})`,async()=>{
 const rect={x:13,y:17,width:720*scale,height:540*scale},{f,edited}=await fixture({rect});
 try{
  const saved=clone(f.store.data.project),original=saved.markings[0].surfaceShape,handles=()=>clone(resizeHandles(f).map(n=>n.attrs)),numbers=()=>({width:Number(f.byLabel('Attached marking width').value),height:Number(f.byLabel('Attached marking height').value)});
  await f.click(f.button('Free transform Ctrl+T'));
  f.byLabel('Attached marking width').attrs['onUpdate:modelValue'](2);f.byLabel('Attached marking height').attrs['onUpdate:modelValue'](4);await flush();
  assert.deepEqual(numbers(),{width:2,height:4});
  const narrowed=handles(),camera=clone(capture().camera),start=f.client(47.5,42.5);
  // Its 9 x 18 SVG-unit box is entirely inside the old overlapping 11-unit
  // handle targets. A central drag must move it, never resize a hidden hit area.
  await f.event('onPointerdown',start.x,start.y);await f.event('onPointermove',start.x+12*scale,start.y+5*scale);await f.event('onPointerup',start.x+12*scale,start.y+5*scale);
  assert.deepEqual(numbers(),{width:2,height:4},'a center drag preserves the narrowed dimensions');
  const moved=handles();moved.forEach((h,i)=>{assert(Math.abs(h.x-narrowed[i].x-12)<1e-8);assert(Math.abs(h.y-narrowed[i].y-5)<1e-8);});
  assert.deepEqual(clone(f.store.data.project),saved);assert.equal(edited.length,0,'moving the transform stays uncommitted');
  assert(draftHistory(false));await flush();assert.deepEqual(handles(),narrowed);assert(draftHistory(true));await flush();assert.deepEqual(handles(),moved);
  const handle=resizeHandles(f).find(n=>n.attrs['data-handle']==='se'),point={x:rect.x+rect.width/2+(Number(handle.attrs.x)+4)*scale,y:rect.y+rect.height/2+(Number(handle.attrs.y)+4)*scale};
  await f.event('onPointerdown',point.x,point.y);await f.event('onPointermove',point.x+6*scale,point.y+4*scale);await f.event('onPointerup',point.x+6*scale,point.y+4*scale);
  assert(numbers().width>2&&numbers().height>4,'the actual narrow handle still resizes both dimensions');const resized=handles();
  assert(draftHistory(false));await flush();assert.deepEqual(numbers(),{width:2,height:4});assert.deepEqual(handles(),moved,'undo restores the moved narrow contour exactly');
  assert(draftHistory(true));await flush();assert.deepEqual(handles(),resized);assert(draftHistory(false));await flush();assert.deepEqual(handles(),moved);
  await f.key('Enter');assert.equal(edited.length,1,'the narrowed move is submitted once');const shape=edited[0][3];
  assert.deepEqual(shape.axes,original.axes);assert.equal(shape.nodes.length,original.nodes.length);
  shape.nodes.forEach((p,i)=>{assert(Math.abs(p.xMm-(47.5+(original.nodes[i].xMm-47.5)*2/45))<1e-9);assert(Math.abs(p.yMm-(42.5+(original.nodes[i].yMm-42.5)*4/45))<1e-9);});
  assert(Math.abs(shape.origin[0]-12/camera.factor)<1e-9);assert(Math.abs(shape.origin[1]+5/camera.factor)<1e-9);assert.equal(shape.origin[2],0);
  assert.equal(f.store.data.project.revision,saved.revision+1);await f.key('Enter');assert.equal(edited.length,1);
 }finally{f.app.unmount();}
});

await check('deserialized same-revision refresh preserves resize/rotation drafts, active capture ownership and local undo/redo',async()=>{
 const {f,edited}=await fixture();try{
  const values=()=>({width:Number(f.byLabel('Attached marking width').value),height:Number(f.byLabel('Attached marking height').value),angle:Number(f.byLabel('Attached marking rotation').value),handles:clone(resizeHandles(f).map(n=>n.attrs))});
  const initial=values(),before=clone(f.store.data.project),handle=resizeHandles(f).find(n=>n.attrs['data-handle']==='se'),start={x:Number(handle.attrs.x)+364,y:Number(handle.attrs.y)+274};
  await f.event('onPointerdown',start.x,start.y);await f.event('onPointermove',start.x+12,start.y+6);const during=values();assert(during.width>initial.width);
  const refreshed=clone(f.store.data);assert.notStrictEqual(refreshed.project,f.store.data.project);assert.equal(await f.store.refresh(async()=>({ok:true,data:refreshed})),true);await flush();
  assert.deepEqual(values(),during,'a read-only notification cannot discard an active resize or its frozen pointer frame');f.button('Confirm transform Enter');
  await f.event('onPointermove',start.x+24,start.y+12);await f.event('onPointerup',start.x+24,start.y+12);const resized=values();assert(resized.width>during.width);
  assert(draftHistory(false));await flush();assert.deepEqual(values(),initial);assert(draftHistory(true));await flush();assert.deepEqual(values(),resized);
  const rotate=walk(f.root).find(n=>n.tag==='circle'&&n.parentNode?.attrs.class==='free-transform-handles'),point={x:Number(rotate.attrs.cx)+360,y:Number(rotate.attrs.cy)+270};
  await f.event('onPointerdown',point.x,point.y);await f.event('onPointermove',point.x+30,point.y+12);await f.event('onPointerup',point.x+30,point.y+12);const rotated=values();assert(Math.abs(rotated.angle)>5);
  assert.equal(await f.store.refresh(async()=>({ok:true,data:clone(f.store.data)})),true);await flush();assert.deepEqual(values(),rotated);f.button('Confirm transform Enter');
  assert(draftHistory(false));await flush();assert.deepEqual(values(),resized,'rotation undo survives the new deserialized object');assert(draftHistory(true));await flush();assert.deepEqual(values(),rotated);
  assert.deepEqual(clone(f.store.data.project),before);assert.equal(edited.length,0);await f.key('Escape');assert.deepEqual(values(),initial);assert.equal(draftHistory(false),false);
 }finally{f.app.unmount();}
});

for(const changed of ['source contour','surface fragments','lock','marking ID','topology','surface vertices'])await check(`a real ${changed} change invalidates a pending transform and its local undo`,async()=>{
 const {f,edited}=await fixture();try{
  const handle=resizeHandles(f).find(n=>n.attrs['data-handle']==='se'),start={x:Number(handle.attrs.x)+364,y:Number(handle.attrs.y)+274};
  await f.event('onPointerdown',start.x,start.y);await f.event('onPointermove',start.x+24,start.y+12);await f.event('onPointerup',start.x+24,start.y+12);f.button('Confirm transform Enter');
  const next=clone(f.store.data),p=next.project,m=p.markings[0];
  if(changed==='source contour')m.surfaceShape.nodes[0].xMm+=1;
  if(changed==='surface fragments'){m.fragments[0].rings[0][0][0]-=.01;m.fragments[0].rings[0][0][1]+=.01;}
  if(changed==='lock')m.locked=true;
  if(changed==='marking ID')m.id=id('different-selected-marking');
  if(changed==='topology'){p.surface.topologyVersion++;m.topologyVersion++;}
  if(changed==='surface vertices')p.surface.vertices[0].zMm+=1;
  assert.equal(await f.store.refresh(async()=>({ok:true,data:next})),true);await flush();
  assert(!walk(f.root).some(n=>n.tag==='button'&&n.textContent==='Confirm transform Enter'));assert.equal(draftHistory(false),false);await f.key('Enter');assert.equal(edited.length,0);
 }finally{f.app.unmount();}
});

await check('F cannot refocus the camera during a resize or rotation drag and becomes available after release',async()=>{
 const {f,edited}=await fixture();try{
  for(const kind of ['resize','rotate']){
   await f.click(f.byLabel('Zoom in 3D'));const before=clone(capture().camera),handle=kind==='resize'?resizeHandles(f).find(n=>n.attrs['data-handle']==='se'):walk(f.root).find(n=>n.tag==='circle'&&n.parentNode?.attrs.class==='free-transform-handles'),point=kind==='resize'?{x:Number(handle.attrs.x)+364,y:Number(handle.attrs.y)+274}:{x:Number(handle.attrs.cx)+360,y:Number(handle.attrs.cy)+270};
   await f.event('onPointerdown',point.x,point.y);await f.event('onPointermove',point.x+12,point.y+6);await f.key('f');assert.deepEqual(capture().camera,before,'F must retain the captured camera throughout '+kind);
   await f.event('onPointermove',point.x+24,point.y+12);await f.event('onPointerup',point.x+24,point.y+12);await f.key('f');assert(capture().camera.factor<before.factor,'F must work again after '+kind+' release');f.button('Confirm transform Enter');
  }
  assert.equal(edited.length,0);
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

await check('visible resize handles take priority over an active orbit tool and one drag has exact local undo and redo',async()=>{
 const {f,edited}=await fixture();try{
  await f.click(f.byLabel('Rotate'));const yaw=capture().camera.yaw,before=clone(f.store.data.project),width=Number(f.byLabel('Attached marking width').value),handles=()=>clone(resizeHandles(f).map(n=>n.attrs));
  const initial=handles(),handle=resizeHandles(f).find(n=>n.attrs['data-handle']==='se'),start={x:Number(handle.attrs.x)+364,y:Number(handle.attrs.y)+274};
  await f.event('onPointerdown',start.x,start.y);await f.event('onPointermove',start.x+12,start.y+6);await f.event('onPointermove',start.x+24,start.y+12);await f.event('onPointerup',start.x+24,start.y+12);
  assert.equal(capture().camera.yaw,yaw,'the visible handle drag must resize rather than orbit');assert(Number(f.byLabel('Attached marking width').value)>width);const resized=handles();
  assert(draftHistory(false));await flush();assert.equal(Number(f.byLabel('Attached marking width').value),width);assert.deepEqual(handles(),initial,'undo restores the exact anchored box');
  assert(draftHistory(true));await flush();assert.deepEqual(handles(),resized,'redo restores the exact translated contour, not just its size');assert.deepEqual(clone(f.store.data.project),before);assert.equal(edited.length,0);
  await f.key('Escape');assert.deepEqual(handles(),initial);assert.equal(draftHistory(false),false,'cancelling a transform leaves no stale local undo actions');
 }finally{f.app.unmount();}
});

await check('unexpected capture loss rolls back a node gesture without recording an undo action',async()=>{
 const {f,edited}=await fixture();try{
  await f.click(f.byLabel('Edit attached marking nodes'));const initial=clone(capture().handles),handle=initial[0],before=clone(f.store.data.project);
  await f.event('onPointerdown',handle.x+360,handle.y+270);await f.event('onPointermove',handle.x+370,handle.y+275);assert.notDeepEqual(capture().handles,initial);
  await f.event('onLostpointercapture',handle.x+370,handle.y+275);assert.deepEqual(capture().handles,initial);assert.equal(draftHistory(false),false);assert.deepEqual(clone(f.store.data.project),before);assert.equal(edited.length,0);
 }finally{f.app.unmount();}
});

await check('switching projects with the same surface and marking IDs discards the old draft and its history',async()=>{
 const {f,edited}=await fixture();try{
  await f.click(f.byLabel('Edit attached marking nodes'));const handle=capture().handles[0];await f.event('onPointerdown',handle.x+360,handle.y+270);await f.event('onPointermove',handle.x+370,handle.y+275);await f.event('onPointerup',handle.x+370,handle.y+275);
  f.store.data.project={...clone(f.store.data.project),id:id('second-selection-project')};await flush();
  assert.equal(capture().handles.length,0);assert.equal(resizeHandles(f).length,0);assert.equal(f.byLabel('Select attached marking').value,'');assert.equal(draftHistory(false),false);await f.key('Enter');assert.equal(edited.length,0);
 }finally{f.app.unmount();}
});

await check('a mapping move is submitted before immediate implicit capture loss can cancel the released pointer',async()=>{
 const {f,edited}=await fixture();try{
  const before=clone(f.store.data.project),start=f.client(65,30),target=walk(f.root).find(n=>n.tag==='canvas');await f.event('onPointerdown',start.x,start.y);await f.event('onPointermove',start.x+15,start.y+4);
  const event={type:'pointerup',button:0,pointerId:1,clientX:start.x+15,clientY:start.y+4,currentTarget:target,target,preventDefault(){}};
  const released=capture().onPointerup(event);capture().onLostpointercapture({...event,type:'lostpointercapture'});await released;await flush();assert.equal(edited.length,1);assert.equal(f.store.data.project.revision,before.revision+1);assert.notDeepEqual(edited[0][3].origin,before.markings[0].surfaceShape.origin);
 }finally{f.app.unmount();}
});

await check('Shift-drag translates the original whole contour once and freezes zoom until the gesture ends',async()=>{
 const {f,edited}=await fixture();try{
  await f.click(f.byLabel('Edit attached marking nodes'));const before=clone(f.store.data.project),start=f.client(55,45),camera=clone(capture().camera);
  await f.event('onPointerdown',start.x,start.y,{shiftKey:true});await f.click(f.byLabel('Zoom in 3D'));assert.equal(capture().camera.factor,camera.factor);
  await f.event('onPointermove',start.x+9,start.y+4.5,{shiftKey:true});await f.event('onPointermove',start.x+18,start.y+9,{shiftKey:true});await f.event('onPointerup',start.x+18,start.y+9,{shiftKey:true});
  assert.deepEqual(clone(f.store.data.project),before);await f.click(f.button('Confirm marking edit'));assert.equal(edited.length,1);
  edited[0][3].nodes.forEach((node,i)=>{assert(Math.abs(node.xMm-before.markings[0].surfaceShape.nodes[i].xMm-18/camera.factor)<1e-8);assert(Math.abs(node.yMm-before.markings[0].surfaceShape.nodes[i].yMm+9/camera.factor)<1e-8);});
 }finally{f.app.unmount();}
});

await mkdir('test-results/current-cutting',{recursive:true});const passed=checks.every(c=>c.passed);await writeFile('test-results/current-cutting/mapping-selection-state-component.json',JSON.stringify({passed,verification:'Production SurfacePanel handlers in the custom component host; no desktop process or native worker',checks},null,2));console.log(JSON.stringify({passed,checks}));if(!passed)process.exitCode=1;
