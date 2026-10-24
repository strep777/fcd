import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {mount,capture,flush,walk} from './surface-viewport-host.mjs';

// A real exported project is supplied explicitly, never a user library or a
// hard-coded temporary workspace. The small checked-in fixture contains the
// independently diagnosed real world stations and their original camera.
const sourcePath=process.env.FPCAD_REAL_HANDLE_WORKFLOW??process.argv[2];assert(sourcePath,'Supply an isolated exported real workflow path or set FPCAD_REAL_HANDLE_WORKFLOW');
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex'),clone=value=>JSON.parse(JSON.stringify(value));
const expected=JSON.parse((await readFile('tests/fixtures/legacy-handle-occlusion.json','utf8')).replace(/^\uFEFF/,'')),project=JSON.parse(await readFile(sourcePath,'utf8')).project;
assert.equal(hash(project),expected.sourceProjectHash,'real project must match the independently diagnosed export');
const originalHash=hash(project),saved=[],calls=[];let f;
f=await mount(project,{mode:'mapping',controls:false,api:{editSurfaceMarking:async(...args)=>{calls.push(args.slice(0,3));saved.push(clone(args[3]));const next=clone(f.store.data.project);next.revision++;next.markings.find(m=>m.id===expected.markingId).surfaceShape=clone(args[3]);return {ok:true,data:{...f.store.data,project:next}};}}});
const mesh=project.surface,byId=new Map(mesh.vertices.map(v=>[v.id,[v.xMm,v.yMm,v.zMm]])),triangles=mesh.faces.map(face=>face.vertices.map(id=>byId.get(id))),worlds=expected.points.map(p=>p.world);
const dot=(a,b)=>a.reduce((s,n,i)=>s+n*b[i],0),sub=(a,b)=>a.map((n,i)=>n-b[i]),cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]],xyz=p=>[p.xMm,p.yMm,p.zMm];
function cameraMath(pose={}){const c={...capture().camera,...pose},cy=Math.cos(c.yaw),sy=Math.sin(c.yaw),cp=Math.cos(c.pitch),sp=Math.sin(c.pitch);return {c,origin:[c.cx,c.cy,c.cz],axes:[[cy,0,sy],[sy*sp,cp,-cy*sp],[-sy*cp,sp,cy*cp]],distance:1800/(c.factor/c.zoom)};}
function screen(world){const {c,origin,axes,distance}=cameraMath(),d=sub(xyz(world),origin),depth=dot(d,axes[2]),q=c.perspective?distance/(distance-depth):1;return {x:dot(d,axes[0])*c.factor*q+c.panX,y:-dot(d,axes[1])*c.factor*q+c.panY};}
// Independent full-mesh world-space ray/triangle intersection, both windings.
function isVisible(world,pose){
 const {c,origin:center,axes,distance}=cameraMath(pose),point=xyz(world),origin=c.perspective?center.map((v,i)=>v+axes[2][i]*distance):point.map((v,i)=>v+axes[2][i]*5000),direction=c.perspective?sub(point,origin):axes[2].map(v=>-v),nodeDepth=dot(sub(point,center),axes[2]);let front=-Infinity;
 for(const [a,b,c]of triangles){const e1=sub(b,a),e2=sub(c,a),h=cross(direction,e2),det=dot(e1,h);if(Math.abs(det)<1e-12)continue;const s=sub(origin,a),u=dot(s,h)/det,q=cross(s,e1),v=dot(direction,q)/det,t=dot(e2,q)/det;if(u< -1e-9||v< -1e-9||u+v>1+1e-9||t<0)continue;const hit=origin.map((n,i)=>n+t*direction[i]);front=Math.max(front,dot(sub(hit,center),axes[2]));}
 return front-nodeDepth<=.001;
}
function verify(){const handles=capture().handles;assert.equal(handles.length,18,'hidden stations retain their editable indices');const visible=[];
 for(let i=0;i<18;i++){const predicted=isVisible(worlds[i]),actual=handles[i],p=screen(worlds[i]);if(predicted){visible.push(i);assert(Math.hypot(actual.x-p.x,actual.y-p.y)<1e-6,'visible station must keep its actual world projection');}else assert(actual.x>=1e5&&actual.y>=1e5,'rear station must be offscreen and unpickable');}
 return visible;
}
async function begin(){f.byLabel('Select attached marking').attrs['onUpdate:modelValue'](expected.markingId);await flush();await f.click(f.byLabel('Edit attached marking nodes'));}
async function assertUnwritten(){assert.equal(hash(f.store.data.project),originalHash);assert.equal(saved.length,0);assert.equal(calls.length,0);}
async function orbitTo(yaw,pitch){const c=capture().camera,x=360+(yaw-c.yaw)/.008,y=270+(pitch-c.pitch)/.008;await f.event('onPointerdown',360,270,{button:1});await f.event('onPointermove',x,y,{button:1});await f.event('onPointerup',x,y,{button:1});}
async function centerWorlds(){const points=worlds.map(screen),center={x:points.reduce((n,p)=>n+p.x,0)/18,y:points.reduce((n,p)=>n+p.y,0)/18};await f.event('onPointerdown',360,270,{button:1,shiftKey:true});await f.event('onPointermove',360-center.x,270-center.y,{button:1,shiftKey:true});await f.event('onPointerup',360-center.x,270-center.y,{button:1,shiftKey:true});}
const checks=[];async function check(name,run){try{checks.push({case:name,passed:true,...await run()});}catch(error){checks.push({case:name,passed:false,error:error.stack});await f.key('Escape');}}
try{
 for(let i=0;i<45;i++)await f.click(f.byLabel('Zoom in 3D'));
 await centerWorlds();
 await check('real 18-knot draft shows exactly the 10 independently ray-visible indices; hidden knots cannot be selected or moved and cancellation never writes',async()=>{
  await begin();const visible=verify();assert.deepEqual(visible,[0,1,2,3,4,13,14,15,16,17]);assert.deepEqual(expected.points.filter(p=>p.expectedVisible).map(p=>p.index),visible);
  const before=clone(capture().markings),p=screen(worlds[6]);await f.event('onPointerdown',p.x+360,p.y+270);assert.equal(f.button('Delete selected node').attrs.disabled,true,'the rear node must not become the selected editable knot');await f.event('onPointermove',p.x+362,p.y+270);await f.event('onPointerup',p.x+362,p.y+270);assert.deepEqual(capture().markings,before,'attempting to drag a hidden node cannot alter live fragments');verify();await assertUnwritten();await f.key('Escape');await assertUnwritten();return {visibleIndices:visible,hiddenIndices:[5,6,7,8,9,10,11,12]};
 });
 await check('middle-button camera rotation changes visible stations according to independent world rays without changing any editable node',async()=>{
  await begin();const before=verify(),initial={yaw:capture().camera.yaw,pitch:capture().camera.pitch};let target;
  // Choose a revealing pose using independent rays, before invoking any real
  // orbit handler. A hidden knot must become visible and actually editable.
  for(const yaw of [-.4,-.8,-1.2,0]){const pose={yaw,pitch:initial.pitch},visible=worlds.flatMap((w,i)=>isVisible(w,pose)?[i]:[]),revealed=visible.filter(i=>!before.includes(i));if(revealed.length){target={...pose,visible,revealed};break;}}
  assert(target,'the camera search must reveal at least one originally rear knot');await orbitTo(target.yaw,target.pitch);await centerWorlds();const rotated=verify();assert.deepEqual(rotated,target.visible);assert.notDeepEqual(rotated,before);
  const index=target.revealed[0],handle={...capture().handles[index]},oldFragments=clone(capture().markings);assert(Math.abs(handle.x)<360&&Math.abs(handle.y)<270,'the newly visible handle must be inside the actual viewport');
  await f.event('onPointerdown',handle.x+360,handle.y+270);assert.equal(f.button('Delete selected node').attrs.disabled,false,'a newly revealed rear knot becomes selectable');const grabbed=walk(f.root).find(n=>n.attrs.class==='source-node-ghost');assert.equal(grabbed?.children.find(n=>n.tag==='text')?.textContent,'Source knot draft · '+(index+1),'the single drag label must retain the original hidden node index');assert(!capture().labels.some(label=>label.id==='selected-cut-node'),'dragging must not restore the overlapping duplicate label');await f.event('onPointermove',handle.x+362,handle.y+270);await f.event('onPointerup',handle.x+362,handle.y+270);assert.equal(capture().labels.find(label=>label.id==='selected-cut-node')?.text,'Selected node '+(index+1),'release must restore the original selected index label');assert.notDeepEqual(capture().markings,oldFragments,'the newly revealed knot must produce a real live edit');await assertUnwritten();
  await f.key('Escape');await assertUnwritten();await begin();
  const remaining=worlds.flatMap((_,i)=>!before.includes(i)&&!rotated.includes(i)?[i]:[]);let additional;
  for(const yaw of [-.8,-1.2,-1.6,-2,0,.8,1.2,1.6,2]){for(const pitch of [-.2,.2,.6,-.6,1,-1]){const pose={yaw,pitch};if(remaining.every(i=>isVisible(worlds[i],pose))){additional=pose;break;}}if(additional)break;}
  assert(additional,'independent rays must find a camera revealing the remaining original hidden stations');await orbitTo(additional.yaw,additional.pitch);await centerWorlds();const additionallyVisible=verify();
  for(const i of remaining){assert(additionallyVisible.includes(i));const point=capture().handles[i];assert(Math.abs(point.x)<360&&Math.abs(point.y)<270);await f.event('onPointerdown',point.x+360,point.y+270);const grabbed=walk(f.root).find(n=>n.attrs.class==='source-node-ghost');assert.equal(grabbed?.children.find(n=>n.tag==='text')?.textContent,'Source knot draft · '+(i+1),'remaining knots retain their actual editable indices in the single drag label');assert(!capture().labels.some(label=>label.id==='selected-cut-node'));await f.event('onPointerup',point.x+360,point.y+270);assert.equal(capture().labels.find(label=>label.id==='selected-cut-node')?.text,'Selected node '+(i+1),'released remaining knots retain their actual editable indices');}
  const allVisible=[...new Set([...before,...rotated,...additionallyVisible])].sort((a,b)=>a-b);assert.deepEqual(allVisible,Array.from({length:18},(_,i)=>i),'camera navigation must eventually expose every persistent knot');
  await orbitTo(initial.yaw,initial.pitch);await centerWorlds();assert.deepEqual(verify(),before);await f.key('Escape');await assertUnwritten();return {beforeVisible:before,rotatedVisible:rotated,revealedIndices:target.revealed,revealedNodeActuallyEdited:index,targetPose:{yaw:target.yaw,pitch:target.pitch},additionalPose:additional,additionalVisibleIndices:additionallyVisible,remainingNodesSelected:remaining,visibleUnion:allVisible};
 });
 await check('perspective edit handles agree with real camera rays while preserving all 18 draft stations',async()=>{
  const label=walk(f.root).find(n=>n.tag==='label'&&n.textContent==='Perspective camera'),input=label.children.find(n=>n.tag==='input');input.attrs['onUpdate:modelValue'](true);await flush();await begin();assert.equal(capture().camera.perspective,true);const visible=verify();await f.key('Escape');await assertUnwritten();input.attrs['onUpdate:modelValue'](false);await flush();return {visibleIndices:visible};
 });
 await check('a visible front knot really edits the draft; confirmation saves all 18 stations and keeps every other knot unchanged',async()=>{
  await begin();verify();const handle={...capture().handles[0]},before=clone(capture().markings);await f.event('onPointerdown',handle.x+360,handle.y+270);assert.equal(f.button('Delete selected node').attrs.disabled,false);await f.event('onPointermove',handle.x+362,handle.y+270);await f.event('onPointerup',handle.x+362,handle.y+270);assert.notDeepEqual(capture().markings,before,'a visible knot must change actual live fragments');await assertUnwritten();await f.click(f.button('Confirm marking edit'));assert.equal(saved.length,1);assert.equal(saved[0].nodes.length,18);assert.equal(saved[0].curves.length,18);assert.notDeepEqual(saved[0].nodes[0],expected.points[0].sourceNode);assert.deepEqual(saved[0].nodes.slice(1),expected.points.slice(1).map(p=>p.sourceNode));assert.deepEqual(calls[0],[project.id,project.revision,expected.markingId]);return {savedNodes:18,savedCurves:18,unchangedOtherNodes:17};
 });
}finally{f.app.unmount();}
await mkdir('test-results/current-cutting',{recursive:true});const passed=checks.every(c=>c.passed);
await writeFile('test-results/current-cutting/final-regression-legacy-handle-visibility-component.json',JSON.stringify({passed,sourcePath,sourceProjectHash:originalHash,verification:'Real exported accepted project in actual SurfacePanel Vue handlers; world-space ray oracle on every original face; no native solver, build or WebView2',checks},null,2));console.log(JSON.stringify({passed,checks}));if(!passed)process.exitCode=1;
