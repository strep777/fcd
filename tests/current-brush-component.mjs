import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {mount,fixtureProject,capture,flush,walk,id,draftHistory} from './surface-viewport-host.mjs';

const checks=[],output='test-results/current-cutting';
async function check(name,run){try{await run();checks.push({case:name,passed:true});}catch(error){checks.push({case:name,passed:false,error:error.stack});}}
async function historyKey(key){assert(draftHistory(key==='y'),'visible draft history must handle this action');await flush();}
async function freehand(f){
 await f.click(f.button('Front'));await f.click(f.byLabel('Draw surface marking'));
 f.byLabel('Surface drawing mode').attrs['onUpdate:modelValue']('freehand');await flush();
 const points=Array.from({length:180},(_,i)=>({x:50+30*Math.cos(i*2*Math.PI/180),y:50+20*Math.sin(i*2*Math.PI/180)}));
 await f.pointEvent('onPointerdown',points[0].x,points[0].y);
 for(const p of points.slice(1))await f.pointEvent('onPointermove',p.x,p.y);
 const captured=capture().handles.length;await f.pointEvent('onPointerup',points.at(-1).x,points.at(-1).y);return captured;
}
function contourSamples(shape){
 return shape.nodes.flatMap((a,i)=>{const b=shape.nodes[(i+1)%shape.nodes.length],c=shape.curves?.find(c=>c.startIndex===i);if(!c)return[a];
  return Array.from({length:30},(_,j)=>{const t=j/30,u=1-t;return{xMm:u**3*a.xMm+3*u*u*t*c.c1.xMm+3*u*t*t*c.c2.xMm+t**3*b.xMm,yMm:u**3*a.yMm+3*u*u*t*c.c1.yMm+3*u*t*t*c.c2.yMm+t**3*b.yMm};});});
}
await check('region freehand release fits a sparse editable ellipse and saves that same bounded contour',async()=>{
 const calls=[];const f=await mount(fixtureProject(),{mode:'mapping',controls:false,api:{surfaceMarking:async(...args)=>{calls.push(args);return{ok:true,data:{...f.store.data,project:{...f.store.data.project,revision:2}}};}}});
 try{
  const before=JSON.parse(JSON.stringify(f.store.data.project)),raw=await freehand(f),after=capture().handles.length;
  const evidence={rawNodes:raw,releasedNodes:after,revision:f.store.data.project.revision};await mkdir(output,{recursive:true});await writeFile(output+'/region-freehand-observation.json',JSON.stringify(evidence,null,2));
  assert(raw>80,'fixture must capture a real dense pointer path');assert(after<=24,`smooth ellipse should expose at most 24 editable knots, saw ${after}`);
  assert.deepEqual(JSON.parse(JSON.stringify(f.store.data.project)),before,'fitting remains a draft');
  await historyKey('z');assert.equal(capture().handles.length,0,'one undo removes the entire captured/fitted stroke');await historyKey('y');assert.equal(capture().handles.length,after,'redo restores the compact curve, not raw samples');
  await f.click(f.button('Close and attach'));assert.equal(calls.length,1);const shape=calls[0][2];assert(shape.nodes.length<=24);assert(shape.curves?.length>0,'smooth freehand must preserve curve controls');
  // Front projection origin is the planar fixture centre. Verify physical scale
  // independently of the fitted endpoint count rather than trusting its report.
  for(const p of contourSamples(shape)){const radius=Math.hypot(p.xMm/30,p.yMm/20);assert(Math.abs(radius-1)*30<=.5,'fitted ellipse must retain the measured boundary within 0.5 mm');}
 }finally{f.app.unmount();}
});
await check('cancelled freehand capture and explicit cancellation retain the whole project',async()=>{
 const f=await mount(fixtureProject(),{mode:'mapping',controls:false});try{
  const before=JSON.parse(JSON.stringify(f.store.data.project));await f.click(f.button('Front'));await f.click(f.byLabel('Draw surface marking'));await f.pointEvent('onPointerdown',20,20);await f.pointEvent('onPointermove',50,20);await f.pointEvent('onPointermove',50,50);await f.pointEvent('onPointercancel',50,50);
  assert.equal(capture().handles.length,0);await f.click(f.byLabel('Cancel drawing'));assert.deepEqual(JSON.parse(JSON.stringify(f.store.data.project)),before);assert.equal(f.calls.length,0);
 }finally{f.app.unmount();}
});
await check('cutting paint draws real colored material through paint IPC and never requests a mapping page transition',async()=>{
 const calls=[];let f;f=await mount(fixtureProject(),{mode:'cutting',controls:false,api:{brushSurfaceMarking:async(...args)=>{calls.push(args);const p=JSON.parse(JSON.stringify(f.store.data.project));p.revision++;p.markings=[{id:id('cutting-paint'),name:'Paint',color:'#cc9944',source:'surface',surfaceId:p.surface.id,topologyVersion:1,sourceHash:'',surfaceHash:'',view:'front',offsetXmm:0,offsetYmm:0,paths:[],fragments:[{faceId:id('lower'),rings:[[[1,0,0],[0,1,0],[0,0,1]]]},{faceId:id('upper'),rings:[[[1,0,0],[0,1,0],[0,0,1]]]}]}];return{ok:true,data:{...f.store.data,project:p}};}}});
 try{
  await f.click(f.button('Front'));await f.click(f.byLabel('Paint markings (areas)'));
  for(const[label,value]of[['Surface brush radius',12],['Surface brush shape','round'],['Surface brush color','#cc9944']]){f.byLabel(label).attrs['onUpdate:modelValue'](value);await flush();}
  await f.pointEvent('onPointerdown',25,40);await f.pointEvent('onPointermove',45,45);await f.pointEvent('onPointercancel',45,45);assert.equal(calls.length,0);assert.equal(f.store.data.project.revision,1);
  await f.pointEvent('onPointerdown',25,40);await f.pointEvent('onPointermove',45,45);await f.pointEvent('onPointerup',45,45);assert.equal(calls.length,1);assert.equal(calls[0][2],undefined,'new paint needs no existing cut line or marking');const stroke=calls[0][3];assert.equal(stroke.mode,'add');assert.equal(stroke.radiusMm,12);assert.equal(stroke.paint.color,'#cc9944');assert(stroke.points.length>=2);assert(!stroke.shape);assert.equal(f.store.data.project.markings.length,1);assert.equal(f.store.data.project.surface.cutLines?.length??0,0);
  await f.click(f.byLabel('Select'));await f.pointEvent('onClick',40,40);assert.equal(f.props.mode,'cutting');assert.equal(f.emits.filter(e=>e.event==='marking').length,0,'clicking painted material in cutting must not trigger mapping navigation');
 }finally{f.app.unmount();}
});
await check('surface pen creates an editable closed cut and node visibility remains an explicit control',async()=>{
 const f=await mount(fixtureProject(),{mode:'cutting',controls:false});try{
  await f.click(f.button('Front'));await f.click(f.byLabel('Surface pen'));
  for(const [x,y]of [[20,25],[70,25],[70,70],[20,70]])await f.pointEvent('onClick',x,y);
  assert.equal(capture().handles.length,4,'each clicked pen anchor remains independently editable');assert(capture().cuts.filter(segment=>segment.key.startsWith('pen-draft-')).length>=4,'the closed path must have an actual surface preview');assert(capture().cuts.every(segment=>segment.nodes===false),'surface cut segments do not add tessellation endpoint dots');
  const label=walk(f.root).find(n=>n.tag==='label'&&n.textContent==='Edit control nodes');assert(label);const visibility=label.children.find(n=>n.tag==='input');visibility.attrs['onUpdate:modelValue'](false);await flush();assert.equal(capture().handles.length,0,'hiding control nodes keeps the cut preview clean');assert(capture().cuts.filter(segment=>segment.key.startsWith('pen-draft-')).length>=4,'hiding knots must preserve the closed cut preview');
  visibility.attrs['onUpdate:modelValue'](true);await flush();assert.equal(capture().handles.length,4);assert(!f.button('Save cut line').attrs.disabled);
  await f.click(f.button('Save cut line'));assert.equal(f.calls.length,1);assert.equal(f.calls[0][2].type,'surface.curve');assert.equal(f.calls[0][2].kind,'pen');assert.equal(f.calls[0][2].closed,true);assert.equal(f.calls[0][2].controlPoints.length,4);
 }finally{f.app.unmount();}
});
await check('saved multi-segment seams are rendered without mesh endpoint dots or editable handles',async()=>{
 const p=fixtureProject(),edges=[['v0','v1'],['v1','v2'],['v2','v3'],['v3','v0'],['v0','v2']].map(([a,b])=>({a:id(a),b:id(b)}));p.surface.cutConstraints=edges.map(e=>({...e,locked:true}));p.surface.cutLines=[{id:id('saved-seam'),name:'Saved seam',kind:'freehand',enabled:true,closed:false,symmetric:false,tension:0,controlPoints:p.surface.vertices.slice(0,2),edges}];
 const f=await mount(p,{mode:'cutting',controls:false});try{
  await f.click(f.button('Front'));assert.equal(capture().cuts.length,5);assert(capture().cuts.every(segment=>segment.nodes===false),'every saved mesh segment must suppress endpoint dots');assert.equal(capture().handles.length,0);assert.equal(capture().draft.length,0);assert.equal(f.calls.length,0);
 }finally{f.app.unmount();}
});
await check('choosing overlapping cut candidates on colored material preserves cutting context without a mapping request',async()=>{
 const p=fixtureProject(),pieces=['First','Second'].map(name=>({id:id(name),name,color:'#cc9944',nodes:p.surface.vertices.map(v=>({id:id(name+v.id),xMm:v.xMm,yMm:v.yMm})),closed:true,allowanceMm:0,cutQty:1,mirror:false,material:'Fur',furRad:0})),bindings=pieces.map(piece=>({pieceId:piece.id,surfaceId:p.surface.id,topologyVersion:1,geometryHash:'a'.repeat(64),surfaceHash:'b'.repeat(64),report:{faceIds:p.surface.faces.map(f=>f.id),uv:p.surface.vertices.map(v=>({vertexId:v.id,xMm:v.xMm,yMm:v.yMm})),boundary:p.surface.vertices.map(v=>v.id),areaErrorMax:0,edgeErrorMax:0,distortionMean:0,distortionP95:0,distortionMax:0,status:'acceptable'}}));
 p.surfaceRun={sourceHash:'b'.repeat(64),algorithm:'lscm-arap-1',accepted:false,pieces,bindings};p.markings=[{id:id('pending-painted'),name:'Pending colored material',color:'#cc9944',source:'surface',sourceHash:'',surfaceHash:'',surfaceId:p.surface.id,topologyVersion:1,view:'front',offsetXmm:0,offsetYmm:0,paths:[],fragments:[{faceId:id('lower'),rings:[[[1,0,0],[0,1,0],[0,0,1]]]}]}];
 const f=await mount(p,{mode:'cutting',controls:false});try{
  await f.click(f.button('Front'));await f.pointEvent('onClick',60,25);assert.deepEqual(f.emits.findLast(e=>e.event==='choices').value,pieces.map(p=>p.id));const choice=walk(f.root).find(n=>n.tag==='button'&&n.textContent.startsWith('Second / '));assert(choice);await f.click(choice);assert.equal(f.emits.findLast(e=>e.event==='select').value,pieces[1].id);assert.equal(f.emits.filter(e=>e.event==='marking').length,0,'pendingPick.markingId must not redirect the cut chooser to Mapping');assert.equal(f.props.mode,'cutting');assert.equal(f.store.data.project.revision,1);assert.equal(f.calls.length,0);
 }finally{f.app.unmount();}
});
await check('cutting paint keeps its chosen color across continued strokes and safely erases an explicit unlocked target',async()=>{
 const p=fixtureProject(),frame={origin:[50,50,0],axes:[[1,0,0],[0,1,0],[0,0,1]]},shape={...frame,nodes:[[-45,-45],[45,-45],[45,45],[-45,45]].map(([xMm,yMm])=>({xMm,yMm}))};
 const marking=(name,color,locked=false)=>({id:id(name),name,color,locked,source:'surface',surfaceId:p.surface.id,topologyVersion:1,sourceHash:'',surfaceHash:'',view:'front',offsetXmm:0,offsetYmm:0,paths:[],surfaceShape:shape,fragments:[{faceId:id('lower'),rings:[[[1,0,0],[0,1,0],[0,0,1]]]},{faceId:id('upper'),rings:[[[1,0,0],[0,1,0],[0,0,1]]]}]});
 p.markings=[marking('Erase target','#cc9944'),marking('Locked target','#6688aa',true)];
 const calls=[];let f;f=await mount(p,{mode:'cutting',controls:false,api:{brushSurfaceMarking:async(...args)=>{calls.push(args);const next=JSON.parse(JSON.stringify(f.store.data.project));next.revision++;if(args[3].mode==='add')next.markings.push(marking('New paint '+calls.length,args[3].paint.color));return{ok:true,data:{...f.store.data,project:next}};}}});
 const stroke=async()=>{await f.pointEvent('onPointerdown',35,40);await f.pointEvent('onPointermove',45,45);await f.pointEvent('onPointerup',45,45);};
 try{
  await f.click(f.button('Front'));await f.click(f.byLabel('Paint markings (areas)'));
  f.byLabel('Surface brush color').attrs['onUpdate:modelValue']('#bb2244');f.byLabel('Symmetric surface paint').attrs['onUpdate:modelValue'](true);await flush();assert(walk(f.root).some(n=>n.tag==='g'&&n.attrs.class==='symmetry-guide'&&n.children.some(child=>child.tag==='line')),'cutting paint must show the same symmetry guide as mapping paint');await stroke();assert.equal(calls[0][3].paint.color,'#bb2244');assert.equal(calls[0][3].symmetric,true);
  f.byLabel('Surface brush color').attrs['onUpdate:modelValue']('#2255bb');await flush();await f.click(f.byLabel('Paint markings (areas)'));assert.equal(f.byLabel('Surface brush color').value,'#2255bb','reselecting the paint tool preserves a newly chosen color');await stroke();assert.equal(calls[1][3].paint.color,'#2255bb');
  f.byLabel('Cutting paint operation').attrs['onUpdate:modelValue']('erase');await flush();f.byLabel('Cutting paint target').attrs['onUpdate:modelValue'](id('Erase target'));await flush();await stroke();assert.equal(calls.length,3);assert.equal(calls[2][2],id('Erase target'));assert.equal(calls[2][3].mode,'erase');assert(calls[2][3].shape);assert(!calls[2][3].paint);
  assert.equal(f.byLabel('Cutting paint target').options.find(option=>option.attrs.value===id('Locked target')).attrs.disabled,true);
  f.byLabel('Cutting paint target').attrs['onUpdate:modelValue'](id('Locked target'));await flush();await stroke();assert.equal(calls.length,3,'locked targets must never issue an erase write');
  f.byLabel('Cutting paint operation').attrs['onUpdate:modelValue']('add');await flush();await stroke();assert.equal(calls.length,4);assert.equal(calls[3][3].paint.color,'#2255bb');assert.equal(f.emits.filter(e=>e.event==='marking').length,0);assert.equal(f.props.mode,'cutting');
 }finally{f.app.unmount();}
});
await check('drawing-part options explain their scope and cancelling or changing models clears the pending cut state',async()=>{
 const f=await mount(fixtureProject(),{mode:'cutting',controls:false});try{
  assert(walk(f.root).some(n=>n.tag==='small'&&n.textContent==='Limits hand-drawn cut lines only; automatic cutting scope is unchanged.'));
  await f.click(f.byLabel('Surface pen'));assert.equal(f.emits.findLast(e=>e.event==='cutDraftActive').value,true);await f.click(f.button('Cancel path edits'));assert.equal(f.emits.findLast(e=>e.event==='cutDraftActive').value,false);
  await f.click(f.byLabel('Surface pen'));await f.pointEvent('onClick',20,20);assert.equal(f.emits.findLast(e=>e.event==='cutDraftActive').value,true);
  const next=JSON.parse(JSON.stringify(f.store.data.project));next.surface.id=id('replacement-surface');f.store.data={...f.store.data,project:next};await flush();assert.equal(f.emits.findLast(e=>e.event==='cutDraftActive').value,false);assert.equal(capture().draft.length,0);
  await f.click(f.byLabel('Surface pen'));assert.equal(f.emits.findLast(e=>e.event==='cutDraftActive').value,true);f.props.mode='mapping';await flush();assert.equal(f.emits.findLast(e=>e.event==='cutDraftActive').value,false);
 }finally{f.app.unmount();}
});
await check('pending cut drafts block both the compute control and its handler until the parent clears the draft flag',async()=>{
 let f;const calls=[];f=await mount(fixtureProject(),{component:'unwrap',controls:false,api:{unwrapSurface:async(...args)=>{calls.push(args);return{ok:true,data:JSON.parse(JSON.stringify(f.store.data))};}}});try{
  f.props.cutDraftActive=true;await flush();const blocked=f.button('Compute & preview cut lines');assert.equal(blocked.attrs.disabled,true);assert(walk(f.root).some(n=>n.tag==='small'&&n.textContent==='Save or cancel the cut draft before computing.'));await blocked.attrs.onClick({});await flush();assert.equal(calls.length,0);
  f.props.cutDraftActive=false;await flush();assert.equal(f.button('Compute & preview cut lines').attrs.disabled,false);await f.click(f.button('Compute & preview cut lines'));assert.equal(calls.length,1);
 }finally{f.app.unmount();}
});
await check('legacy saved-path repair uses the surface pen and retains actual-surface anchors until the closed cut is saved',async()=>{
 const p=fixtureProject(),line={id:id('anchored-saved-path'),name:'Anchored saved path',kind:'pen',enabled:true,closed:false,symmetric:false,surfaceAnchored:true,tension:.5,regions:['lower-part','upper-part'],controlPoints:p.surface.vertices.slice(0,3),projection:{origin:[50,50,0],axes:[[1,0,0],[0,1,0],[0,0,1]]},edges:[]};p.surface.cutLines=[line];
 const list=await mount(p,{component:'cuttools',controls:false});let request;
 try{
  const choose=walk(list.root).find(n=>n.tag==='button'&&n.attrs.class==='select-cut');assert(choose);await list.click(choose);await list.click(list.button('Repair path with pen'));request=list.emits.findLast(e=>e.event==='draw')?.value;assert.deepEqual(request,{kind:'pen',lineId:line.id});assert.equal(list.calls.length,0,'opening the pen must not mutate or commit the old open path');assert.deepEqual(list.store.data.project.surface.cutLines,[line]);
 }finally{list.app.unmount();}
 const f=await mount(p,{mode:'cutting',controls:false});try{
  f.props.cutRequest={...request,nonce:1};await flush();assert(!f.button('Save cut line').attrs.disabled,'the existing open path can be repaired without forced closure');f.byLabel('Closed cut path').attrs['onUpdate:modelValue'](true);await flush();assert(!f.button('Save cut line').attrs.disabled);await f.click(f.button('Save cut line'));
  assert.equal(f.calls.length,1);const command=f.calls[0][2];assert.equal(command.type,'surface.curve');assert.equal(command.id,line.id);assert.equal(command.surfaceAnchored,true);assert.equal(command.closed,true);assert.deepEqual(command.projection,line.projection);assert.deepEqual(command.controlPoints,line.controlPoints);
 }finally{f.app.unmount();}
});

await check('two-point open seams require an explicit mode switch and preserve draft history and open preview endpoints',async()=>{
 const f=await mount(fixtureProject(),{mode:'cutting',controls:false});try{
  const before=JSON.stringify(f.store.data.project);await f.click(f.button('Front'));await f.click(f.byLabel('Surface pen'));
  assert.equal(f.byLabel('Closed cut path').checked,true,'new pen cuts remain closed by default');await f.pointEvent('onClick',20,25);await f.pointEvent('onClick',70,25);assert(f.button('Save cut line').attrs.disabled);
  f.byLabel('Closed cut path').attrs['onUpdate:modelValue'](false);await flush();assert(!f.button('Save cut line').attrs.disabled);assert.equal(capture().handles.length,2);
  const segments=capture().cuts.filter(segment=>segment.key.startsWith('pen-draft-'));assert(segments.length>0);assert(Math.hypot(segments[0].a.x-segments.at(-1).b.x,segments[0].a.y-segments.at(-1).b.y)>1,'open preview must retain two different endpoints');
  await historyKey('z');assert.equal(f.byLabel('Closed cut path').checked,true);assert(f.button('Save cut line').attrs.disabled);await historyKey('y');assert.equal(f.byLabel('Closed cut path').checked,false);assert(!f.button('Save cut line').attrs.disabled);assert.equal(JSON.stringify(f.store.data.project),before);assert.equal(f.calls.length,0);
  await f.click(f.button('Save cut line'));assert.equal(f.calls.length,1);assert.equal(f.calls[0][2].closed,false);assert.equal(f.calls[0][2].controlPoints.length,2);assert.equal(f.emits.findLast(e=>e.event==='cutDraftActive').value,false);
 }finally{f.app.unmount();}
});
await check('valid saved open seams remain editable without repair warnings and cancel or save with their original identity',async()=>{
 const p=fixtureProject(),line={id:id('valid-open-seam'),name:'Open structural seam',kind:'pen',enabled:true,closed:false,symmetric:false,surfaceAnchored:true,tension:.5,regions:['lower-part','upper-part'],controlPoints:p.surface.vertices.slice(0,2),projection:{origin:[50,50,0],axes:[[1,0,0],[0,1,0],[0,0,1]]},edges:[{a:id('v0'),b:id('v1')}]};p.surface.cutLines=[line];
 const list=await mount(p,{component:'cuttools',controls:false});let request;try{await list.click(walk(list.root).find(n=>n.tag==='button'&&n.attrs.class==='select-cut'));assert(!walk(list.root).some(n=>n.attrs.class==='cut-path-warning'));assert(walk(list.root).some(n=>n.tag==='small'&&n.textContent.includes('open seam')));await list.click(list.button('Edit pen nodes'));request=list.emits.findLast(e=>e.event==='draw').value;assert.equal(request.lineId,line.id);}finally{list.app.unmount();}
 const f=await mount(p,{mode:'cutting',controls:false});try{const before=JSON.stringify(f.store.data.project);f.props.cutRequest={...request,nonce:1};await flush();assert.equal(f.byLabel('Closed cut path').checked,false);assert.equal(capture().handles.length,2);assert(!f.button('Save cut line').attrs.disabled);await f.click(f.button('Cancel path edits'));assert.equal(JSON.stringify(f.store.data.project),before);assert.equal(f.calls.length,0);f.props.cutRequest={...request,nonce:2};await flush();await f.click(f.button('Save cut line'));assert.equal(f.calls[0][2].id,line.id);assert.equal(f.calls[0][2].closed,false);assert.deepEqual(f.calls[0][2].controlPoints,line.controlPoints);}finally{f.app.unmount();}
});
for(const [name,edges]of [['branch',[['v0','v1'],['v1','v2'],['v1','v3']]],['retrace',[['v0','v1'],['v1','v0']]],['disconnected',[['v0','v1'],['v2','v3']]]])await check('saved '+name+' path shows a repair warning from the shared cut contract',async()=>{
 const p=fixtureProject();p.surface.cutLines=[{id:id('invalid-open-'+name),name,kind:'pen',enabled:true,closed:false,symmetric:false,surfaceAnchored:true,tension:.5,controlPoints:p.surface.vertices.slice(0,2),projection:{origin:[50,50,0],axes:[[1,0,0],[0,1,0],[0,0,1]]},edges:edges.map(([a,b])=>({a:id(a),b:id(b)}))}];const f=await mount(p,{component:'cuttools',controls:false});try{await f.click(walk(f.root).find(n=>n.tag==='button'&&n.attrs.class==='select-cut'));const warning=walk(f.root).find(n=>n.attrs.class==='cut-path-warning');assert(warning);assert(warning.textContent.includes('one continuous path without branches or retraced segments'));assert(f.button('Repair path with pen'));assert.equal(f.calls.length,0);}finally{f.app.unmount();}
});
await check('a rejected open seam keeps all nodes and the original project available for correction',async()=>{
 const calls=[],f=await mount(fixtureProject(),{mode:'cutting',controls:false,api:{apply:async(...args)=>{calls.push(args);return {ok:false,error:{code:'CUT_PATH_INVALID'}};}}});try{const before=JSON.stringify(f.store.data.project);await f.click(f.button('Front'));await f.click(f.byLabel('Surface pen'));await f.pointEvent('onClick',20,25);await f.pointEvent('onClick',70,25);f.byLabel('Closed cut path').attrs['onUpdate:modelValue'](false);await flush();await f.click(f.button('Save cut line'));assert.equal(calls.length,1);assert.equal(capture().handles.length,2);assert.equal(f.byLabel('Closed cut path').checked,false);assert.equal(f.emits.findLast(e=>e.event==='cutDraftActive').value,true);assert.equal(JSON.stringify(f.store.data.project),before);assert(!f.button('Save cut line').attrs.disabled);}finally{f.app.unmount();}
});

await mkdir(output,{recursive:true});const passed=checks.every(c=>c.passed);await writeFile(output+'/current-brush-component.json',JSON.stringify({passed,verification:'Production Vue handlers; custom GPU/DOM/IPC host, no WebView2 or screenshot verification',checks},null,2));console.log(JSON.stringify({passed,checks}));if(!passed)process.exitCode=1;
