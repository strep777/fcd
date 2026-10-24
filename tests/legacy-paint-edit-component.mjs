import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {mount,fixtureProject,capture,flush,id} from './surface-viewport-host.mjs';
import {contourBoundaryError} from './fixtures/contour-boundary-oracle.mjs';

const clone=value=>JSON.parse(JSON.stringify(value));
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
function freeze(value){for(const child of Object.values(value))if(child&&typeof child==='object')freeze(child);return Object.freeze(value);}
function ellipse(rx=30,ry=30,count=180){return Array.from({length:count},(_,i)=>({xMm:50+rx*Math.cos(i*2*Math.PI/count),yMm:50+ry*Math.sin(i*2*Math.PI/count)}));}
function project(shape,source='surface'){
 const p=fixtureProject();p.markings=[{id:id('legacy-paint'),name:'Existing legacy paint',color:'#2288cc',source,surfaceId:p.surface.id,topologyVersion:1,sourceHash:'',surfaceHash:'',view:'front',offsetXmm:0,offsetYmm:0,paths:[],surfaceShape:{origin:[0,0,0],axes:[[1,0,0],[0,1,0],[0,0,1]],anchorFaceId:id('lower'),...shape},fragments:[{faceId:id('lower'),rings:[[[.8,0,.2],[.2,.6,.2],[.2,0,.8]]]},{faceId:id('upper'),rings:[[[.8,.2,0],[.2,.8,0],[.2,.2,.6]]]}]}];return freeze(p);
}
async function fixture(p){let f;const calls=[];f=await mount(p,{mode:'mapping',controls:false,api:{editSurfaceMarking:async(...args)=>{calls.push(clone(args));const next=clone(f.store.data.project);next.revision++;next.markings[0].surfaceShape=clone(args[3]);return {ok:true,data:{...f.store.data,project:next}};}}});
 // Freeze the actual stored project, too: editing must work entirely on a draft.
 const before=clone(f.store.data.project);f.store.data.project=freeze(clone(before));await flush();
 await f.click(f.button('Front'));f.byLabel('Select attached marking').attrs['onUpdate:modelValue'](id('legacy-paint'));await flush();
 return {...f,calls,before,open:()=>f.click(f.byLabel('Edit attached marking nodes'))};
}
const checks=[];
async function check(name,run){try{checks.push({case:name,passed:true,...await run()});}catch(error){checks.push({case:name,passed:false,error:error.stack});}}
for(const [name,rx,ry]of [['circle',30,30],['ellipse',35,20]])await check('legacy 180-point '+name+' opens compact, cancels without writes, and confirms bounded editable cubic geometry',async()=>{
 const p=project({nodes:ellipse(rx,ry)}),input=clone(p),f=await fixture(p);try{
  await f.open();const knots=capture().handles.length;assert(knots>=3&&knots<24,`expected fewer than 24 knots, got ${knots}`);assert.equal(f.calls.length,0);assert.deepEqual(clone(f.store.data.project),f.before);
  await f.key('Escape');assert.equal(f.calls.length,0);assert.deepEqual(clone(f.store.data.project),f.before);assert.equal(capture().handles.length,0);
  await f.open();assert.equal(capture().handles.length,knots);await f.click(f.button('Confirm marking edit'));
  assert.equal(f.calls.length,1);assert.deepEqual(f.calls[0].slice(0,3),[id('project'),1,id('legacy-paint')]);const output=f.calls[0][3];assert.equal(output.nodes.length,knots);assert(output.curves?.length>0);assert(!output.spline);
  const boundary=contourBoundaryError(p.markings[0].surfaceShape,output);assert(boundary.certifiedUpperBoundMm<=.25,`independent two-way boundary bound ${boundary.certifiedUpperBoundMm} exceeds 0.25 mm`);
  assert.equal(f.store.data.project.revision,2);assert.deepEqual(f.store.data.project.markings[0].surfaceShape,output);assert.deepEqual(p,input,'the original frozen input is unchanged');
  return {originalNodes:180,editedNodes:knots,savedCurves:output.curves.length,boundary};
 }finally{f.app.unmount();}
});
await check('existing explicit cubic controls are preserved exactly on repeated edit/confirmation',async()=>{
 const k=30*.5522847498307936,nodes=[[80,50],[50,80],[20,50],[50,20]].map(([xMm,yMm])=>({xMm,yMm})),controls=[[[80,50+k],[50+k,80]],[[50-k,80],[20,50+k]],[[20,50-k],[50-k,20]],[[50+k,20],[80,50-k]]],curves=controls.map(([a,b],startIndex)=>({startIndex,c1:{xMm:a[0],yMm:a[1]},c2:{xMm:b[0],yMm:b[1]}}));
 const p=project({nodes,curves}),f=await fixture(p);try{for(let i=0;i<2;i++){await f.open();assert.equal(capture().handles.length,4);await f.click(f.button('Confirm marking edit'));assert.deepEqual(f.calls[i][3],p.markings[0].surfaceShape);}assert.equal(f.calls.length,2);return {editedNodes:4,curves:4,repeatedFits:0};}finally{f.app.unmount();}
});
await check('an existing spline keeps all original knots and its spline definition',async()=>{
 const p=project({nodes:ellipse(30,20,12),spline:{algorithm:'closed-catmull-rom-1',tension:.37,toleranceMm:.05}}),f=await fixture(p);try{await f.open();assert.equal(capture().handles.length,12);await f.click(f.button('Confirm marking edit'));assert.deepEqual(f.calls[0][3],p.markings[0].surfaceShape);return {editedNodes:12,splinePreserved:true};}finally{f.app.unmount();}
});
await check('reference-derived 180-point contours retain their original nodes without paint fitting',async()=>{
 const p=project({nodes:ellipse(35,20)},'reference'),f=await fixture(p);try{await f.open();assert.equal(capture().handles.length,180);assert.equal(f.calls.length,0);assert.deepEqual(clone(f.store.data.project),f.before);await f.click(f.button('Confirm marking edit'));assert.deepEqual(f.calls[0][3],p.markings[0].surfaceShape);return {originalNodes:180,editedNodes:180,curves:0};}finally{f.app.unmount();}
});

// Accepted-cut fixtures are structurally valid archive snapshots, including
// pieces/bindings. The component host validates them with projectSchema.
function archivedProject(source='surface',depth=1){
 const p=clone(project({nodes:ellipse(35,20)},source)),mesh=p.surface;
 p.markings[0].sourceHash=hash(p.markings[0].surfaceShape);p.markings[0].surfaceHash=hash(mesh);p.cuttingLibrary=[];
 const piece={id:id('archive-piece'),name:'Archived panel',color:'#2288cc',nodes:mesh.vertices.map((v,i)=>({id:id('archive-node'+i),xMm:v.xMm,yMm:v.yMm})),closed:true,allowanceMm:0,cutQty:1,mirror:false,material:'Fur',furRad:0};
 const binding={pieceId:piece.id,surfaceId:mesh.id,topologyVersion:1,geometryHash:'a'.repeat(64),surfaceHash:hash(mesh),report:{faceIds:mesh.faces.map(f=>f.id),uv:mesh.vertices.map(v=>({vertexId:v.id,xMm:v.xMm,yMm:v.yMm})),boundary:mesh.vertices.map(v=>v.id),areaErrorMax:0,edgeErrorMax:0,distortionMean:0,distortionP95:0,distortionMax:0,status:'acceptable'}};
 for(let i=0;i<depth;i++){
  const entry={id:id('archive-level'+i),name:'Archived paint '+i,createdAt:p.createdAt,sourceRevision:i+1,surface:clone(mesh),run:{sourceHash:hash(mesh),algorithm:'lscm-arap-1',accepted:true,pieces:[clone(piece)],bindings:[clone(binding)]},markings:clone(p.markings),seams:[]};
  p.cuttingLibrary.push(entry);p.markings=p.markings.map(m=>({...m,source:'cut-library',cutLibraryId:entry.id,cutLibrarySourceHash:m.sourceHash}));
 }
 return p;
}
for(const [name,depth]of [['once',1],['three times with legacy sourceHash fallback',3]])await check('surface paint archived '+name+' opens compact while cancel/confirmation preserve every historical snapshot',async()=>{
 const p=archivedProject('surface',depth);
 if(depth===3)delete p.markings[0].cutLibrarySourceHash;
 else{
  // A previously edited live archive copy has a new shape fingerprint. Its
  // explicit cutLibrarySourceHash must still resolve the original snapshot.
  p.markings[0].surfaceShape.nodes=ellipse(34,19);p.markings[0].sourceHash=hash(p.markings[0].surfaceShape);
 }
 freeze(p);const original=clone(p),f=await fixture(p);try{
  await f.open();const knots=capture().handles.length;assert(knots>=3&&knots<24,`archived surface paint exposes ${knots} knots`);assert.equal(f.calls.length,0);assert.deepEqual(clone(f.store.data.project),f.before);
  await f.key('Escape');assert.equal(f.calls.length,0);assert.deepEqual(clone(f.store.data.project),f.before);
  await f.open();assert.equal(capture().handles.length,knots);await f.click(f.button('Confirm marking edit'));assert.equal(f.calls.length,1);const output=f.calls[0][3];assert.equal(output.nodes.length,knots);assert(output.curves?.length>0);
  const boundary=contourBoundaryError(p.markings[0].surfaceShape,output);assert(boundary.certifiedUpperBoundMm<=.25);
  const expected=clone(f.before);expected.revision++;expected.markings[0].surfaceShape=clone(output);assert.deepEqual(clone(f.store.data.project),expected,'only current marking draft and revision change');
  assert.deepEqual(clone(f.store.data.project.cuttingLibrary),original.cuttingLibrary,'all archive snapshots retain raw 180-point geometry and provenance');assert.deepEqual(p,original);
  return {archiveDepth:depth,originalNodes:180,editedNodes:knots,savedCurves:output.curves.length,boundary,historyUnchanged:true};
 }finally{f.app.unmount();}
});
async function retainedArchive(name,p){
 await check(name,async()=>{freeze(p);const original=clone(p),f=await fixture(p);try{
  await f.open();assert.equal(capture().handles.length,180,'unproven or reference origins must retain exact original knots');assert.equal(f.calls.length,0);assert.deepEqual(clone(f.store.data.project),f.before);
  await f.key('Escape');assert.equal(f.calls.length,0);assert.deepEqual(clone(f.store.data.project),f.before);await f.open();await f.click(f.button('Confirm marking edit'));assert.equal(f.calls.length,1);assert.deepEqual(f.calls[0][3],original.markings[0].surfaceShape);
  assert.deepEqual(clone(f.store.data.project.cuttingLibrary),original.cuttingLibrary);assert.deepEqual(p,original);return {originalNodes:180,editedNodes:180,curves:0,historyUnchanged:true};
 }finally{f.app.unmount();}});
}
await retainedArchive('reference paint archived three times is never compacted as hand paint',archivedProject('reference',3));
for(const [name,mutate]of [
 ['missing archive link',p=>{delete p.markings[0].cutLibraryId;}],
 ['missing archive entry',p=>{p.markings[0].cutLibraryId=id('absent-archive');}],
 ['missing original marking id',p=>{p.cuttingLibrary[0].markings[0].id=id('different-original-marking');}],
 ['self-referencing archive cycle',p=>{p.cuttingLibrary[0].markings[0]=clone(p.markings[0]);}],
 ['two-archive provenance cycle',p=>{const first=p.cuttingLibrary[0].markings[0];first.source='cut-library';first.cutLibraryId=p.cuttingLibrary[1].id;first.cutLibrarySourceHash=p.markings[0].sourceHash;}],
 ['explicit archive hash mismatch',p=>{p.markings[0].cutLibrarySourceHash='f'.repeat(64);}],
 ['fallback archive hash mismatch',p=>{delete p.markings[0].cutLibrarySourceHash;p.markings[0].sourceHash='f'.repeat(64);}],
 ['non-paint original source',p=>{p.cuttingLibrary[0].markings[0].source='manual';}],
]){
 const p=archivedProject('surface',name==='two-archive provenance cycle'?2:1);mutate(p);await retainedArchive('archive with '+name+' retains the exact dense contour',p);
}
await check('wheel and zoom buttons spread existing edit knots up to 3200% without changing physical geometry, then clamp at 20% and cancel without writes',async()=>{
 const p=freeze(archivedProject('surface',1)),f=await fixture(p);try{
  await f.open();const count=capture().handles.length;assert.equal(count,4);
  const worldKnots=()=>{const c=capture().camera;assert.equal(c.perspective,false);return capture().handles.map(q=>({xMm:c.cx+(q.x-c.panX)/c.factor,yMm:c.cy-(q.y-c.panY)/c.factor}));};
  const spacing=()=>{const points=capture().handles;let min=Infinity;for(let i=0;i<points.length;i++)for(let j=i+1;j<points.length;j++)min=Math.min(min,Math.hypot(points[i].x-points[j].x,points[i].y-points[j].y));return min;};
  const originalKnots=worldKnots(),originalSpacing=spacing(),assertPhysical=()=>{assert.equal(capture().handles.length,count);const current=worldKnots();for(let i=0;i<count;i++)assert(Math.hypot(current[i].xMm-originalKnots[i].xMm,current[i].yMm-originalKnots[i].yMm)<1e-8,'zoom must not move any physical knot');assert.deepEqual(clone(f.store.data.project),f.before);assert.equal(f.calls.length,0);};
  assert.equal(capture().camera.zoom,1);await f.event('onWheel',360,270,{deltaY:-100});assert(Math.abs(capture().camera.zoom-1.1)<1e-12);assertPhysical();
  for(let i=0;i<45;i++)await f.click(f.byLabel('Zoom in 3D'));
  assert.equal(capture().camera.zoom,32);assertPhysical();const maximumSpacing=spacing();assert(Math.abs(maximumSpacing/originalSpacing-32)<1e-8,'screen separation must increase in proportion to zoom');assert(maximumSpacing>originalSpacing*5,'editing can magnify beyond the previous 500% limit');
  await f.event('onWheel',360,270,{deltaY:-100});assert.equal(capture().camera.zoom,32);assertPhysical();
  for(let i=0;i<70;i++)await f.event('onWheel',360,270,{deltaY:100});
  assert.equal(capture().camera.zoom,.2);assertPhysical();await f.click(f.byLabel('Zoom out 3D'));assert.equal(capture().camera.zoom,.2);assertPhysical();
  await f.key('Escape');assert.equal(capture().handles.length,0);assert.equal(f.calls.length,0);assert.deepEqual(clone(f.store.data.project),f.before);assert.deepEqual(p,f.before);
  return {editedNodes:count,minimumZoom:.2,maximumZoom:32,originalMinimumScreenSpacingPx:originalSpacing,maximumMinimumScreenSpacingPx:maximumSpacing,screenSpacingRatio:maximumSpacing/originalSpacing,physicalKnotsUnchanged:true,cancelWrites:0};
 }finally{f.app.unmount();}
});
await mkdir('test-results/current-cutting',{recursive:true});const passed=checks.every(c=>c.passed);
await writeFile('test-results/current-cutting/final-regression-legacy-paint-edit-component.json',JSON.stringify({passed,verification:'Actual SurfacePanel Vue handlers with custom display/DOM/IPC host; independent cubic/polygon bidirectional boundary oracle; no WebView2 or compute',checks},null,2));
console.log(JSON.stringify({passed,checks}));if(!passed)process.exitCode=1;
