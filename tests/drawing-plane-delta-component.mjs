import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {mount,fixtureProject,capture,flush,id,walk} from './surface-viewport-host.mjs';

const checks=[];
async function check(name,run){try{await run();checks.push({case:name,passed:true});}catch(error){checks.push({case:name,passed:false,error:error.stack});}}
function painted({tilted=false,occluder=false}={}){
 const p=fixtureProject();if(tilted)for(const v of p.surface.vertices)v.zMm=v.xMm*.7;
 if(occluder){const ids=['cover0','cover1','cover2','cover3'].map(id);p.surface.vertices.push(...[[35,5],[60,5],[60,30],[35,30]].map(([xMm,yMm],i)=>({id:ids[i],xMm,yMm,zMm:10})));p.surface.faces.push({id:id('coverA'),vertices:[ids[0],ids[1],ids[2]],region:'cover'},{id:id('coverB'),vertices:[ids[0],ids[2],ids[3]],region:'cover'});}
 const shape={origin:[0,0,0],axes:[[1,0,0],[0,1,0],[0,0,1]],nodes:[[30,15],[80,15],[80,65],[30,20]].map(([xMm,yMm])=>({xMm,yMm})),regions:['lower-part'],anchorFaceId:id('lower')};
 p.markings=[{id:id('delta-marking'),name:'Plane delta',color:'#2288cc',source:'surface',sourceHash:'',surfaceHash:'',surfaceId:p.surface.id,topologyVersion:1,view:'front',offsetXmm:0,offsetYmm:0,paths:[],surfaceShape:shape,fragments:[{faceId:id('lower'),rings:[[[.7,.15,.15],[.2,.65,.15],[.2,.15,.65],[.7,.1,.2]]]}]}];return p;
}
async function setup(options){const saved=[];let f;f=await mount(painted(options),{mode:'mapping',controls:false,api:{editSurfaceMarking:async(_project,_revision,_id,shape)=>{saved.push(JSON.parse(JSON.stringify(shape)));return{ok:true,data:{...f.store.data,project:{...f.store.data.project,revision:2}}};}}});await f.click(f.button('Front'));return{f,saved};}
async function begin(f){f.byLabel('Select attached marking').attrs['onUpdate:modelValue'](id('delta-marking'));await flush();await f.click(f.byLabel('Edit attached marking nodes'));}

await check('a tilted-sheet node drag keeps the click offset and uses one stable plane delta',async()=>{
 const {f,saved}=await setup({tilted:true});try{
  await f.event('onPointerdown',360,270,{button:1});await f.event('onPointermove',395,270,{button:1});await f.event('onPointerup',395,270,{button:1});await begin(f);
  const before=JSON.parse(JSON.stringify(f.store.data.project)),handle=capture().handles[0],camera=capture().camera,start={x:handle.x+362,y:handle.y+270};
  await f.event('onPointerdown',start.x,start.y);await f.event('onPointermove',start.x+2,start.y);await f.event('onPointerup',start.x+2,start.y);
  assert.deepEqual(JSON.parse(JSON.stringify(f.store.data.project)),JSON.parse(JSON.stringify(before)),'pointer edits remain an uncommitted draft');
  await f.click(f.button('Confirm marking edit'));assert.equal(saved.length,1);const actual=saved[0].nodes[0].xMm-before.markings[0].surfaceShape.nodes[0].xMm,expected=2/(camera.factor*Math.cos(camera.yaw));assert(Math.abs(actual-expected)<1e-8,JSON.stringify({actual,expected,camera}));
  assert.equal(saved[0].nodes[0].yMm,before.markings[0].surfaceShape.nodes[0].yMm);assert.deepEqual(saved[0].nodes.slice(1),before.markings[0].surfaceShape.nodes.slice(1));assert.deepEqual(saved[0].regions,['lower-part']);assert.equal(saved[0].anchorFaceId,id('lower'));
 }finally{f.app.unmount();}
});

for(const occluder of [false,true])await check(occluder?'a closer disconnected occluder refuses a node drag without changing its draft':'crossing an explicit region scope refuses a node drag without changing its draft',async()=>{
 const {f,saved}=await setup({occluder});try{
  await begin(f);const before=structuredClone(capture().handles),start={x:before[0].x+360,y:before[0].y+270},end=f.client(occluder?40:30,occluder?15:60);
  await f.event('onPointerdown',start.x,start.y);await f.event('onPointermove',end.x,end.y);await f.event('onPointerup',end.x,end.y);assert.deepEqual(capture().handles,before);assert.equal(saved.length,0);assert.equal(f.store.data.project.revision,1);
 }finally{f.app.unmount();}
});
await check('a reference-source knot clipped to the silhouette can be dragged outside the mesh, cancelled, and then confirmed without losing its original click offset',async()=>{
 const p=fixtureProject(),shape={origin:[0,0,0],axes:[[1,0,0],[0,1,0],[0,0,1]],anchorFaceId:id('lower'),nodes:[[-5,20],[80,20],[80,70],[-5,70]].map(([xMm,yMm])=>({xMm,yMm}))};
 p.markings=[{id:id('delta-marking'),name:'Clipped source',color:'#2288cc',source:'reference',sourceHash:'',surfaceHash:'',surfaceId:p.surface.id,topologyVersion:1,view:'front',offsetXmm:0,offsetYmm:0,paths:[],surfaceShape:shape,fragments:[{faceId:id('lower'),rings:[[[.8,0,.2],[.2,.6,.2],[.2,.1,.7],[.3,0,.7]]]},{faceId:id('upper'),rings:[[[.8,0,.2],[.8,.2,0],[.3,.7,0],[.3,0,.7]]]}]}];
 const saved=[];let f;f=await mount(p,{mode:'mapping',controls:false,api:{editSurfaceMarking:async(_project,_revision,_id,edited)=>{saved.push(JSON.parse(JSON.stringify(edited)));return{ok:true,data:{...f.store.data,project:{...f.store.data.project,revision:2}}};}}});
 try{
  await f.click(f.button('Front'));await begin(f);const original=JSON.parse(JSON.stringify(f.store.data.project));
  async function dragOutside(){const handle=capture().handles[0],factor=capture().camera.factor;assert(Math.abs(handle.x)<360,'the clipped source knot remains visible at the actual silhouette');const start={x:handle.x+362,y:handle.y+270};await f.event('onPointerdown',start.x,start.y);const ghost=()=>walk(f.root).find(n=>n.attrs.class==='source-node-ghost'),circle=()=>ghost()?.children.find(n=>n.tag==='circle');assert(ghost(),'grabbing a visible source knot shows its temporary draft handle');assert.equal(ghost().children.find(n=>n.tag==='text').textContent,'Source knot draft · 1','one draft label retains the selected node number');assert(!capture().labels.some(label=>label.id==='selected-cut-node'),'dragging hides the overlapping second selected-node label');assert.equal(Number(circle().attrs.cx),handle.x,'the ghost starts at the visible handle without a click-offset jump');await f.event('onPointermove',start.x-20*factor,start.y);assert(Math.abs(Number(circle().attrs.cx)-handle.x+20*factor)<1e-8,'the ghost follows the pointer delta even beyond the silhouette');assert(!capture().labels.some(label=>label.id==='selected-cut-node'),'the moving draft retains just one node label');await f.event('onPointerup',start.x-20*factor,start.y);assert(!ghost(),'release restores the exact clipped contour display');assert.equal(capture().labels.filter(label=>label.id==='selected-cut-node').length,1,'release restores the selected-node label');}
  await dragOutside();assert.deepEqual(JSON.parse(JSON.stringify(f.store.data.project)),original);assert.equal(saved.length,0);await f.key('Escape');assert.deepEqual(JSON.parse(JSON.stringify(f.store.data.project)),original);assert(!walk(f.root).some(n=>n.attrs.class==='source-node-ghost'));
  await begin(f);await dragOutside();await f.click(f.button('Confirm marking edit'));assert.equal(saved.length,1);assert(Math.abs(saved[0].nodes[0].xMm+25)<1e-8,'20 mm plane displacement is added to the original -5 mm source knot');assert.equal(saved[0].nodes[0].yMm,20);assert.deepEqual(saved[0].nodes.slice(1),shape.nodes.slice(1));assert.deepEqual(saved[0].axes,shape.axes);assert.equal(saved[0].anchorFaceId,shape.anchorFaceId);
 }finally{f.app.unmount();}
});

await check('a grabbed knot expands onto a distant face on its connected sheet instead of being constrained by the old footprint bounds',async()=>{
 const p=fixtureProject(),vertices=[],faces=[],at=(x,y)=>id('sheet-'+x+'-'+y);for(let y=0;y<=5;y++)for(let x=0;x<=5;x++)vertices.push({id:at(x,y),xMm:x*20,yMm:y*20,zMm:0});for(let y=0;y<5;y++)for(let x=0;x<5;x++)faces.push({id:id('sheet-face-'+x+'-'+y+'a'),vertices:[at(x,y),at(x+1,y),at(x+1,y+1)],region:'body'},{id:id('sheet-face-'+x+'-'+y+'b'),vertices:[at(x,y),at(x+1,y+1),at(x,y+1)],region:'body'});p.surface.vertices=vertices;p.surface.faces=faces;
 const shape={origin:[0,0,0],axes:[[1,0,0],[0,1,0],[0,0,1]],anchorFaceId:id('sheet-face-1-0a'),nodes:[[20,10],[40,10],[40,20],[20,20]].map(([xMm,yMm])=>({xMm,yMm}))};p.markings=[{id:id('delta-marking'),name:'Small source footprint',color:'#2288cc',source:'reference',sourceHash:'',surfaceHash:'',surfaceId:p.surface.id,topologyVersion:1,view:'front',offsetXmm:0,offsetYmm:0,paths:[],surfaceShape:shape,fragments:[{faceId:id('sheet-face-1-0a'),rings:[[[.5,0,.5],[0,.5,.5],[0,0,1]]]},{faceId:id('sheet-face-1-0b'),rings:[[[.5,0,.5],[.5,.5,0],[0,1,0],[0,0,1]]]}]}];
 const saved=[];let f;f=await mount(p,{mode:'mapping',controls:false,api:{editSurfaceMarking:async(_project,_revision,_id,edited)=>{saved.push(JSON.parse(JSON.stringify(edited)));return{ok:true,data:{...f.store.data,project:{...f.store.data.project,revision:2}}};}}});
 try{
  await f.click(f.button('Front'));await begin(f);const before=JSON.parse(JSON.stringify(f.store.data.project)),handle=capture().handles[1],end=f.client(80,5);await f.event('onPointerdown',handle.x+360,handle.y+270);await f.event('onPointermove',end.x,end.y);await f.event('onPointerup',end.x,end.y);assert.deepEqual(JSON.parse(JSON.stringify(f.store.data.project)),before);await f.click(f.button('Confirm marking edit'));assert.equal(saved.length,1);assert(Math.abs(saved[0].nodes[1].xMm-80)<1e-8);assert(Math.abs(saved[0].nodes[1].yMm-5)<1e-8);assert.deepEqual(saved[0].nodes.filter((_,i)=>i!==1),shape.nodes.filter((_,i)=>i!==1));assert.equal(saved[0].anchorFaceId,shape.anchorFaceId);
 }finally{f.app.unmount();}
});
await mkdir('test-results/current-cutting',{recursive:true});const passed=checks.every(c=>c.passed);await writeFile('test-results/current-cutting/drawing-plane-delta-independent.json',JSON.stringify({passed,verification:'Production Vue handlers in the existing custom component host; no native worker, build or desktop process',checks},null,2));console.log(JSON.stringify({passed,checks}));if(!passed)process.exitCode=1;
