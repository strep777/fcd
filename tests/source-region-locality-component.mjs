import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {localityOracle,compareFragmentFill} from './fixtures/source-region-locality-oracle.mjs';

// Reuse the isolated host scaffolding without running or changing its cases.
// The current SurfacePanel and its real native projection backend are exercised;
// presentation children, browser coordinates and session transport are substituted.
const output=resolve('test-results/current-task-2');await mkdir(output,{recursive:true});
const scaffold=await readFile('tests/surface-panel-component.mjs','utf8'),end=scaffold.indexOf('const checks=[];');assert(end>0);
const hostFile=resolve(output,'source-locality-host.mjs');
await writeFile(hostFile,scaffold.slice(0,end)+'\nexport {mount,flush,HostNode,walk};\n');
const {mount,flush,HostNode,walk}=await import(pathToFileURL(hostFile).href);
HostNode.prototype.closest=function(selector){for(let p=this;p;p=p.parentNode)if(selector.startsWith('.')&&p.attrs.class?.split(' ').includes(selector.slice(1)))return p;return null;};
const backendFile=resolve(output,'source-locality-backend.mjs');
await build({stdin:{contents:"export {surfaceMarking} from './apps/desktop/main/markings';export {editSurfaceMarking} from './apps/desktop/main/surface-marking-edit';",resolveDir:resolve('.')},outfile:backendFile,bundle:true,format:'esm',platform:'node',packages:'external'});
const backend=await import(pathToFileURL(backendFile).href),worker=resolve('target/release/fpcad-worker.exe');
const input=JSON.parse(await readFile('test-results/current-task/real-cut-project.json','utf8'));
const source=input.patternLibrary.find(r=>r.view==='front'&&r.piece.name.endsWith('/ 17')).piece;
const recorded=JSON.parse(await readFile(resolve(output,'source-region17-locality.json'),'utf8'));
const worldScreen=(p,camera)=>{const x=p.xMm-camera.cx,y=p.yMm-camera.cy,z=p.zMm-camera.cz,u=x*Math.cos(camera.yaw)+z*Math.sin(camera.yaw),depth=-x*Math.sin(camera.yaw)+z*Math.cos(camera.yaw);return{x:360+u*camera.factor+camera.panX,y:270-(y*Math.cos(camera.pitch)-depth*Math.sin(camera.pitch))*camera.factor+camera.panY};};
const evidence=[],failures=[];
function visibleHit(surface,camera,point){
 const vertices=new Map(surface.vertices.map(v=>[v.id,{...worldScreen(v,camera),z:-(v.xMm-camera.cx)*Math.sin(camera.yaw)*Math.cos(camera.pitch)+(v.yMm-camera.cy)*Math.sin(camera.pitch)+(v.zMm-camera.cz)*Math.cos(camera.yaw)*Math.cos(camera.pitch)}]));
 let best;
 for(const face of surface.faces){const [a,b,c]=face.vertices.map(id=>vertices.get(id)),d=(b.y-c.y)*(a.x-c.x)+(c.x-b.x)*(a.y-c.y);if(Math.abs(d)<1e-9)continue;const u=((b.y-c.y)*(point.x-c.x)+(c.x-b.x)*(point.y-c.y))/d,v=((c.y-a.y)*(point.x-c.x)+(a.x-c.x)*(point.y-c.y))/d,w=1-u-v;if(Math.min(u,v,w)<-1e-7)continue;const depth=u*a.z+v*b.z+w*c.z;if(!best||depth>best.depth)best={faceId:face.id,region:face.region,depth};}return best;
}
for(const target of recorded.filter(e=>e.grab==='center')){
 const p={...structuredClone(input),pieces:[],bindings:[],markings:[]},fixture=await mount(p);
 const {store,root,button,click,model,byLabel,event}=fixture,calls=[],attempts=[],diagnostic={};
 const current=()=>JSON.parse(JSON.stringify(store.data.project));
 const resetDraft=async()=>{const key=new Event('keydown',{cancelable:true});Object.assign(key,{key:'Escape',ctrlKey:false,metaKey:false,altKey:false});window.dispatchEvent(key);await flush();await click(byLabel('Edit attached marking nodes'));};
 const reply=project=>({ok:true,data:{...JSON.parse(JSON.stringify(store.data)),project}});
 window.fpcad.surfaceMarking=async(_,revision,shape,color,name)=>{
  calls.push({kind:'drop',shape:structuredClone(shape)});const project=current(),marking=await backend.surfaceMarking(worker,project,shape,color,name);
  return reply({...project,revision:revision+1,markings:[...project.markings,marking]});
 };
 window.fpcad.editSurfaceMarking=async(_,revision,id,shape)=>{
  calls.push({kind:'edit',shape:structuredClone(shape)});const project=current(),marking=await backend.editSurfaceMarking(worker,project,id,shape);
  return reply({...project,revision:revision+1,markings:project.markings.map(m=>m.id===id?marking:m)});
 };
 const regionParts=fragments=>[...new Set(fragments.map(fragment=>p.surface.faces.find(face=>face.id===fragment.faceId)?.region))].sort();
 try{
  await click(button('Front'));const canvas=globalThis.__surfaceCapture,point=worldScreen(target.position,canvas.camera),node=walk(root).find(n=>n.tag==='canvas'),dropHit=visibleHit(p.surface,canvas.camera,point);assert.equal(dropHit?.region,target.region);
  const host=walk(root).find(n=>n.attrs.class?.split(' ').includes('surface-preview'));assert(host?.attrs.onDrop);
  await host.attrs.onDrop({clientX:point.x,clientY:point.y,target:node,currentTarget:host,preventDefault(){},dataTransfer:{getData:type=>type==='application/x-fpcad-region'?source.id:''}});await flush();
  assert.equal(calls.length,1);const marking=current().markings[0];assert(marking,'actual drop must save one marking');
  assert.equal(calls[0].shape.anchorFaceId,dropHit.faceId,'the saved anchor must be the independently ray-hit original face');const initialOracle=localityOracle(p.surface,marking.surfaceShape),dropProof=initialOracle.verify(marking.fragments,target.region);
  await model(byLabel('Select attached marking'),marking.id);await click(byLabel('Edit attached marking nodes'));
  // The editable source knots span about 87 x 86 mm; the independent oracle
  // measures the full cubic contour, including its controls' curved extents.
  // Zoom and pan the selected attachment before testing individual knots.
  for(let i=0;i<16;i++){await globalThis.__surfaceCapture.onWheel({deltaY:-1,preventDefault(){}});await flush();}
  const focus=worldScreen(target.position,globalThis.__surfaceCapture.camera),canvasNode=walk(root).find(n=>n.tag==='canvas');
  const panEvent=(type,x,y)=>({type,clientX:x,clientY:y,button:1,pointerId:2,currentTarget:canvasNode,target:root,shiftKey:true,ctrlKey:false,metaKey:false,preventDefault(){}});
  await globalThis.__surfaceCapture.onPointerdown(panEvent('pointerdown',360,270));await flush();await globalThis.__surfaceCapture.onPointermove(panEvent('pointermove',720-focus.x,540-focus.y));await flush();await globalThis.__surfaceCapture.onPointerup(panEvent('pointerup',720-focus.x,540-focus.y));await flush();
  const draft=globalThis.__surfaceCapture,before=structuredClone(marking.surfaceShape),baseFragments=JSON.stringify(marking.fragments);let chosen,refused;
  // Try every displayed knot and small directions. Each trial resets the draft
  // from the same saved marking; no synthetic selection or node mutation occurs.
  for(let index=0;index<draft.handles.length&&!chosen;index++)for(const direction of [[1,0],[-1,0],[0,1],[0,-1],[1,1],[-1,1],[1,-1],[-1,-1]]){
   await resetDraft();const handle=globalThis.__surfaceCapture.handles[index];if(!handle||Math.abs(handle.x)>=1e5||Math.abs(handle.y)>=1e5)continue;
   const start={x:handle.x+360,y:handle.y+270};if(start.x<3||start.x>717||start.y<3||start.y>537)continue;const length=Math.hypot(...direction),move={x:direction[0]/length*2,y:direction[1]/length*2},end={x:start.x+move.x,y:start.y+move.y},startHit=visibleHit(p.surface,draft.camera,start),endHit=visibleHit(p.surface,draft.camera,end);
   await event('onPointerdown',start.x,start.y);if(button('Delete selected node').attrs.disabled){await event('onPointerup',start.x,start.y);continue;}await event('onPointermove',end.x,end.y);await event('onPointerup',end.x,end.y);
   assert.equal(store.data.project.revision,p.revision+1,'every pointer trial remains a draft');const live=globalThis.__surfaceCapture.markings.find(m=>m.id===marking.id),changed=JSON.stringify(live.fragments)!==baseFragments,measured={nodeIndex:index,start,move,startHit,endHit,startInScope:!!startHit&&initialOracle.allowed.has(startHit.faceId),endInScope:!!endHit&&initialOracle.allowed.has(endHit.faceId),changed,confirmDisabled:button('Confirm marking edit').attrs.disabled};attempts.push(measured);
   if(!measured.confirmDisabled&&changed&&measured.endInScope){chosen={...measured,live:structuredClone(live)};break;}if(!changed&&!measured.endInScope&&!measured.confirmDisabled)refused=measured;
  }
  if(!chosen&&target.target==='middle')throw Error('no actual node edit succeeded on any displayed knot and supported small direction');
  if(!chosen&&refused){await resetDraft();await event('onPointerdown',refused.start.x,refused.start.y);await event('onPointermove',refused.start.x+refused.move.x,refused.start.y+refused.move.y);await event('onPointerup',refused.start.x+refused.move.x,refused.start.y+refused.move.y);chosen={...refused,live:structuredClone(globalThis.__surfaceCapture.markings.find(m=>m.id===marking.id))};}
  assert(chosen,'at least one displayed knot must provide a supported edit or a verified off-sheet refusal');const {start,move,nodeIndex,startHit,endHit}=chosen;
  assert.equal(current().revision,p.revision+1,'drag remains a draft until explicitly confirmed');
  const live=chosen.live,liveParts=regionParts(live.fragments);
  const confirm=button('Confirm marking edit');if(confirm.attrs.disabled)throw Error('small node drag unexpectedly makes the source invalid');await confirm.attrs.onClick({button:0});await flush();
  assert.equal(current().revision,p.revision+2,'native save completes before inspecting persisted node coordinates');
  const saved=current().markings.find(m=>m.id===marking.id),after=saved.surfaceShape;
  const changes=after.nodes.map((n,i)=>Math.hypot(n.xMm-before.nodes[i].xMm,n.yMm-before.nodes[i].yMm));
  Object.assign(diagnostic,{before,after,camera:draft.camera,chosen:{...chosen,live:undefined},liveFragments:live.fragments,savedFragments:saved.fragments,nodeChangesMm:changes});
  const finalOracle=localityOracle(p.surface,after),liveProof=finalOracle.verify(live.fragments,target.region),savedProof=finalOracle.verify(saved.fragments,target.region),fillAgreement=compareFragmentFill(p.surface,live.fragments,saved.fragments);
  const measured={region:target.region,target:target.target,position:target.position,anchorFaceId:calls[0].shape.anchorFaceId,nodeIndex,before,after,camera:draft.camera,start,move,startHit,endHit,startInScope:chosen.startInScope,endInScope:chosen.endInScope,mousePixels:Math.hypot(move.x,move.y),nodeChangesMm:changes,liveParts,savedParts:regionParts(saved.fragments),dropProof,liveProof,savedProof,fillAgreement,attempts};evidence.push(measured);
  assert(changes.filter(change=>change>1e-5).length<=1,'a single handle drag cannot move unrelated source nodes');
  if(measured.endInScope)assert(changes.some(change=>change>1e-5),'a small drag onto the supported arm must update one node');
  else assert(changes.every(change=>change<=1e-5),'a knot dragged onto an occluding or disconnected sheet must not move');
  // A small pointer change must retain the clipped handle's existing offset.
  // Bound movement by the local projection angle, not a fixed world-mm limit.
  const frameZ=before.axes[2],cameraZ=[-Math.sin(draft.camera.yaw)*Math.cos(draft.camera.pitch),Math.sin(draft.camera.pitch),Math.cos(draft.camera.yaw)*Math.cos(draft.camera.pitch)];
  const cosine=Math.abs(frameZ.reduce((s,v,i)=>s+v*cameraZ[i],0)),limit=Math.hypot(move.x,move.y)/draft.camera.factor/Math.max(.03,cosine)+2;
  assert(Math.max(...changes)<=limit,`small pointer drag moved a node ${Math.max(...changes).toFixed(2)} mm; geometric pointer bound ${limit.toFixed(2)} mm`);
 }catch(error){failures.push({region:target.region,target:target.target,error:String(error),stack:error.stack,calls,attempts,diagnostic});}
 finally{fixture.app.unmount();}
}
for(const region of ['arm-left','arm-right'])if(!evidence.some(e=>e.region===region&&e.target==='middle'&&e.nodeChangesMm.some(change=>change>1e-5)))failures.push({region,error:'the middle-arm component case must complete an actual source-node edit'});
await writeFile(resolve(output,'source-region17-component.json'),JSON.stringify({verification:'Actual Vue handlers and native backend, no WebView2 display verification',evidence,failures},null,2));
console.log(JSON.stringify({cases:evidence.map(e=>({region:e.region,target:e.target,nodeChangesMm:e.nodeChangesMm,liveParts:e.liveParts,savedParts:e.savedParts})),failures:failures.map(({region,target,error})=>({region,target,error}))},null,2));
assert.equal(failures.length,0,JSON.stringify(failures.map(({region,target,error})=>({region,target,error}))));
