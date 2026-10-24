import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import {mount,fixtureProject,capture,flush,id,walk} from './surface-viewport-host.mjs';
const checks=[];
async function check(name,run){try{await run();checks.push({case:name,passed:true});}catch(e){checks.push({case:name,passed:false,error:e.stack});}}
const rects=[{x:0,y:0,width:720,height:540},{x:190,y:74,width:1080,height:420},{x:32,y:215,width:380,height:620}];
await check('display menu height follows the actual model stage and wrapped navigation without changing project state',async()=>{
 const f=await mount(fixtureProject(),{mode:'cutting',controls:false});try{
  const stage=walk(f.root).find(n=>n.attrs.class==='surface-stage'),options=walk(f.root).find(n=>n.attrs.class==='display-options'),menu=options.children.find(n=>n.tag==='div'),before=JSON.stringify(f.store.data);
  let bottom=540,anchorBottom=90;stage.getBoundingClientRect=()=>({top:0,bottom});options.getBoundingClientRect=()=>({top:60,bottom:anchorBottom});options.open=true;
  options.attrs.onToggle();await flush();assert.equal(menu.attrs.style.maxHeight,'436px');
  bottom=310;anchorBottom=124;window.dispatchEvent(new Event('resize'));await flush();assert.equal(menu.attrs.style.maxHeight,'172px','heatmap/toolbar growth reduces the menu to available space');
  options.open=false;bottom=540;window.dispatchEvent(new Event('resize'));await flush();assert.equal(menu.attrs.style.maxHeight,'172px','a hidden menu does not keep recalculating');
  assert.equal(JSON.stringify(f.store.data),before);assert.equal(f.calls.length,0);
 }finally{f.app.unmount();}
});
for(const rect of rects)await check(`${rect.width}x${rect.height}: actual controls select vertices/parts, Shift toggles, empty hit clears`,async()=>{
 const f=await mount(fixtureProject(),{rect});try{
  await f.click(f.button('Front'));
  await f.byLabel('Model selection mode').attrs.onChange({target:{value:'vertex'}});await flush();
  await f.pointEvent('onPointerdown',3,2);await f.pointEvent('onPointerup',3,2);assert.deepEqual(f.edit.selectedVertexIds,[id('v0')]);assert.equal(capture().handles.length,1);
  await f.pointEvent('onPointerdown',97,3,{shiftKey:true});await f.pointEvent('onPointerup',97,3);assert.deepEqual(f.edit.selectedVertexIds,[id('v0'),id('v1')]);assert.equal(capture().handles.length,2);
  await f.pointEvent('onPointerdown',3,2,{shiftKey:true});assert.deepEqual(f.edit.selectedVertexIds,[id('v1')]);
  await f.byLabel('Model selection mode').attrs.onChange({target:{value:'region'}});await flush();
  await f.pointEvent('onPointerdown',75,25);assert.deepEqual(f.edit.selectedRegions,['lower-part']);
  await f.pointEvent('onPointerdown',25,75,{shiftKey:true});assert.deepEqual(f.edit.selectedRegions,['lower-part','upper-part']);
  const selectedColors=new Set(capture().faces.map(t=>t.color));assert.equal(selectedColors.size,1);assert(!selectedColors.has('#b9bec6'));
  await f.pointEvent('onPointerdown',75,25,{shiftKey:true});assert.deepEqual(f.edit.selectedRegions,['upper-part']);
  await f.pointEvent('onPointerdown',-100,-100);assert.deepEqual(f.edit.selectedRegions,[]);assert.equal(f.calls.length,0);
 }finally{f.app.unmount();}
});
for(const rect of rects)for(const mode of ['object','region','vertex'])await check(`${rect.width}x${rect.height}: ${mode} drag previews without commit, then emits exact mm command`,async()=>{
 const f=await mount(fixtureProject(),{rect});try{
  await f.click(f.button('Front'));f.edit.changeSelectionMode(mode);await f.click(f.byLabel('Model tool move'));
  const source=structuredClone(fixtureProject().surface),start=f.client(75,25),s=Math.min(rect.width/720,rect.height/540),factor=capture().camera.factor;
  await f.event('onPointerdown',start.x,start.y);await f.event('onPointermove',start.x+factor*s*10,start.y-factor*s*5);
  assert.equal(f.calls.length,0);assert.deepEqual(f.store.data.project.surface,source);assert.notDeepEqual(capture().surface.vertices,source.vertices);
  if(mode!=='object')assert.deepEqual(capture().surface.vertices.find(v=>v.id===id('v3')),source.vertices[3],'unselected vertex stays fixed');
  await f.event('onPointerup',start.x+factor*s*10,start.y-factor*s*5);assert.equal(f.calls.length,1);const [projectId,revision,c]=f.calls[0];assert.equal(projectId,id('project'));assert.equal(revision,1);assert.equal(c.type,'surface.transform');
  assert(Math.abs(c.translationMm.x-10)<1e-9);assert(Math.abs(c.translationMm.y-5)<1e-9);assert.equal(c.translationMm.z,0);
  if(mode==='vertex')assert.deepEqual(c.vertexIds,[id('v1')]);else if(mode==='region')assert.deepEqual(c.regions,['lower-part']);else assert(!('regions'in c)&&!('vertexIds'in c));
 }finally{f.app.unmount();}
});
for(const cancel of ['onPointercancel','Escape','onLostpointercapture'])await check(`cancel ${cancel}: discard preview and prevent later pointerup commit`,async()=>{
 const f=await mount(fixtureProject());try{
  await f.click(f.button('Front'));await f.click(f.byLabel('Model tool move'));const {x,y}=f.client(75,25),saved=structuredClone(fixtureProject().surface);
  await f.event('onPointerdown',x,y);await f.event('onPointermove',x+45,y);assert.notDeepEqual(capture().surface.vertices,saved.vertices);
  if(cancel==='Escape')await f.key('Escape');else await f.event(cancel,x+45,y);
  assert.deepEqual(capture().surface,saved,'cancellation restores original preview');await f.event('onPointerup',x+45,y);assert.equal(f.calls.length,0);assert.equal(f.store.data.project.revision,1);
 }finally{f.app.unmount();}
});
for(const tool of ['move','rotate','scale'])await check(`${tool} uses actual tool/axis controls, previews and sends only the constrained X transform`,async()=>{
 const f=await mount(fixtureProject());try{
  await f.click(f.button('Front'));await f.click(f.byLabel('Model tool '+tool));await f.byLabel('Model transform axis').attrs['onUpdate:modelValue']('x');await flush();
  const {x,y}=f.client(75,25);await f.event('onPointerdown',x,y);await f.event('onPointermove',x+45,y-15);assert.equal(f.calls.length,0);assert.notDeepEqual(capture().surface.vertices,fixtureProject().surface.vertices);
  await f.event('onPointerup',x+45,y-15);assert.equal(f.calls.length,1);const c=f.calls[0][2];
  if(tool==='move'){assert.deepEqual(c.translationMm,{x:10,y:0,z:0});assert.deepEqual(c.rotationDeg,{x:0,y:0,z:0});assert.deepEqual(c.scale,{x:1,y:1,z:1});}
  if(tool==='rotate'){assert.deepEqual(c.rotationDeg,{x:30,y:0,z:0});assert.deepEqual(c.translationMm,{x:0,y:0,z:0});assert.deepEqual(c.scale,{x:1,y:1,z:1});}
  if(tool==='scale'){assert(Math.abs(c.scale.x-Math.exp(.36))<1e-12);assert.equal(c.scale.y,1);assert.equal(c.scale.z,1);assert.deepEqual(c.translationMm,{x:0,y:0,z:0});assert.deepEqual(c.rotationDeg,{x:0,y:0,z:0});}
 }finally{f.app.unmount();}
});
await check('selected additive vertex pair is dragged together; orbit and pan never emit model transforms',async()=>{
 const f=await mount(fixtureProject());try{
  await f.click(f.button('Front'));f.edit.changeSelectionMode('vertex');await flush();await f.pointEvent('onPointerdown',3,2);await f.pointEvent('onPointerdown',97,3,{shiftKey:true});assert.deepEqual(f.edit.selectedVertexIds,[id('v0'),id('v1')]);
  await f.click(f.byLabel('Model tool move'));const {x,y}=f.client(97,3);await f.event('onPointerdown',x,y);await f.event('onPointermove',x+45,y);assert.equal(capture().surface.vertices[0].xMm,10);assert.equal(capture().surface.vertices[1].xMm,110);assert.equal(capture().surface.vertices[2].xMm,100);await f.event('onPointerup',x+45,y);assert.deepEqual(f.calls[0][2].vertexIds,[id('v0'),id('v1')]);
  const before=capture().camera.yaw;await f.event('onPointerdown',360,270,{button:1});await f.event('onPointermove',400,270,{button:1});await f.event('onPointerup',400,270,{button:1});assert.notEqual(capture().camera.yaw,before);assert.equal(f.calls.length,1);
  const pan=capture().camera.panX;await f.event('onPointerdown',360,270,{button:1,shiftKey:true});await f.event('onPointermove',400,290,{button:1,shiftKey:true});await f.event('onPointerup',400,290,{button:1,shiftKey:true});assert.notEqual(capture().camera.panX,pan);assert.equal(f.calls.length,1);
 }finally{f.app.unmount();}
});
await check('revision changes, mode changes, busy state and tiny gestures do not submit stale transforms',async()=>{
 const f=await mount(fixtureProject());try{
  await f.click(f.button('Front'));await f.click(f.byLabel('Model tool move'));const {x,y}=f.client(75,25);
  await f.event('onPointerdown',x,y);await f.event('onPointermove',x+1,y);await f.event('onPointerup',x+1,y);assert.equal(f.calls.length,0);
  await f.event('onPointerdown',x,y);await f.event('onPointermove',x+45,y);f.store.data.project.revision=2;await flush();await f.event('onPointerup',x+45,y);assert.equal(f.calls.length,0);
  await f.event('onPointerdown',x,y);await f.event('onPointermove',x+45,y);f.props.mode='mapping';await flush();await f.event('onPointerup',x+45,y);assert.equal(f.calls.length,0);
  f.props.mode='model';f.store.busy=true;await flush();await f.event('onPointerdown',x,y);await f.event('onPointermove',x+45,y);await f.event('onPointerup',x+45,y);assert.equal(f.calls.length,0);
 }finally{f.app.unmount();}
});
await check('switching projects at an equal revision cancels the old model drag without writing into the new project',async()=>{
 const f=await mount(fixtureProject());try{
  await f.click(f.button('Front'));await f.click(f.byLabel('Model tool move'));const {x,y}=f.client(75,25);await f.event('onPointerdown',x,y);await f.event('onPointermove',x+45,y);
  const replacement={...fixtureProject(),id:id('replacement-project'),surface:{...fixtureProject().surface,id:id('replacement-surface')}};f.store.data.project=replacement;await flush();
  await f.event('onPointerup',x+45,y);assert.equal(f.calls.length,0,'old drag must not submit to a different project with the same revision');assert.deepEqual(f.store.data.project,replacement);assert.equal(capture().surface.id,replacement.surface.id);
 }finally{f.app.unmount();}
});
const passed=checks.every(c=>c.passed);await writeFile('test-results/model-viewport-component.json',JSON.stringify({passed,verification:'Actual Vue SFC handlers and stores; custom DOM/GPU host, not WebView2 pixels',checks},null,2));console.log(JSON.stringify({passed,checks}));if(!passed)process.exitCode=1;
