import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdir,writeFile} from 'node:fs/promises';
import {mount,fixtureProject,capture,flush,id,walk} from './surface-viewport-host.mjs';

// Real SurfacePanel SFC and handlers; only the display child and host DOM/IPC
// are substituted. No WebView2 window or production geometry mock is used.
function layeredProject(){
 const p=fixtureProject(),mesh=p.surface;mesh.vertices=[];mesh.faces=[];
 for(const [name,zMm]of [['front',10],['rear',-10]]){
  for(const [i,[xMm,yMm]]of [[0,0],[100,0],[100,100],[0,100]].entries())mesh.vertices.push({id:id(name+i),xMm,yMm,zMm});
  for(const [i,vs]of [[0,1,2],[0,2,3]].entries())mesh.faces.push({id:id(name+'face'+i),vertices:vs.map(i=>id(name+i)),region:name});
 }
 mesh.cutConstraints=['front','rear'].map(name=>({a:id(name+0),b:id(name+2),locked:true}));
 return p;
}
const digest=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
function candidate(p){
 const pieces=['front','rear'].map(name=>({id:id(name+'-piece'),name:name+' piece',nodes:[[0,0],[100,0],[100,100],[0,100]].map(([xMm,yMm],i)=>({id:id(name+'-node'+i),xMm,yMm})),closed:true,allowanceMm:0,cutQty:1,mirror:false,material:'Test fabric',furRad:0,color:'#73c9b6'}));
 const sourceHash=digest(p.surface),bindings=['front','rear'].map((name,i)=>({pieceId:pieces[i].id,surfaceId:p.surface.id,topologyVersion:1,geometryHash:digest({nodes:pieces[i].nodes,holes:[],curves:[]}),surfaceHash:sourceHash,report:{faceIds:[id(name+'face0'),id(name+'face1')],uv:pieces[i].nodes.map((node,j)=>({vertexId:id(name+j),xMm:node.xMm,yMm:node.yMm})),boundary:[0,1,2,3].map(j=>id(name+j)),areaErrorMax:0,edgeErrorMax:0,distortionMean:0,distortionP95:0,distortionMax:0,status:'acceptable'}}));
 return {sourceHash,algorithm:'lscm-cg-1',accepted:false,pieces,bindings};
}
async function waitForCuts(count,filter=()=>true){const deadline=Date.now()+2000;do{await flush();if(capture().cuts.filter(filter).length===count)return;await new Promise(resolve=>setTimeout(resolve,5));}while(Date.now()<deadline);assert.equal(capture().cuts.filter(filter).length,count);}

const checks=[];
async function check(name,run){try{await run();checks.push({case:name,passed:true});}catch(error){checks.push({case:name,passed:false,error:error.stack});}}
for(const mode of ['cutting','mapping'])await check(`${mode}: saved and candidate rear seams disappear in orthographic and perspective view; candidate alpha remains 50%`,async()=>{
 const f=await mount(layeredProject(),{mode,controls:false});try{
  await f.click(f.button('Front'));f.store.data.project.surfaceRun=candidate(f.store.data.project);await flush();
  for(const perspective of [false,true]){
   const control=walk(f.root).find(n=>n.tag==='label'&&n.textContent==='Perspective camera').children.find(n=>n.tag==='input');control.attrs['onUpdate:modelValue'](perspective);await flush();
   assert.equal(capture().camera.perspective,perspective);
   const lines=capture().cuts,saved=lines.filter(l=>!l.key.startsWith('candidate-')),proposed=lines.filter(l=>l.key.startsWith('candidate-'));
   assert.equal(saved.length,1,'only the front saved diagonal is visible');assert.equal(proposed.length,4,'only the front candidate island perimeter is visible');
   for(const line of lines)for(const point of [line.a,line.b])assert(Math.abs(point.z-10)<1e-7,'every displayed seam is on the near sheet');
   for(const line of proposed){assert.equal(line.opacity,.5);assert.equal(line.nodes,false);}
  }
  const candidateToggle=walk(f.root).find(n=>n.tag==='label'&&n.textContent==='Auto seam preview 50%').children.find(n=>n.tag==='input');candidateToggle.attrs['onUpdate:modelValue'](false);await flush();assert.equal(capture().cuts.length,1,'the candidate display switch is available in both workspaces');candidateToggle.attrs['onUpdate:modelValue'](true);await flush();assert.equal(capture().cuts.filter(l=>l.key.startsWith('candidate-')).length,4);
  const project=f.store.data.project;project.pieces=JSON.parse(JSON.stringify(project.surfaceRun.pieces));project.bindings=JSON.parse(JSON.stringify(project.surfaceRun.bindings));project.surfaceRun.accepted=true;await waitForCuts(4,line=>line.key.startsWith('accepted-seam-'));assert.equal(capture().cuts.filter(line=>line.key.startsWith('candidate-')).length,0,'acceptance removes the candidate overlay');
  for(const line of capture().cuts.filter(line=>line.key.startsWith('accepted-seam-'))){assert.equal(line.opacity,.5);assert.equal(line.nodes,false);for(const point of [line.a,line.b])assert(Math.abs(point.z-10)<1e-7,'accepted boundaries still obey occlusion');}
  const acceptedToggle=walk(f.root).find(n=>n.tag==='label'&&n.textContent==='Saved cut seams 50%').children.find(n=>n.tag==='input');acceptedToggle.attrs['onUpdate:modelValue'](false);await flush();assert.equal(capture().cuts.length,1,'the saved boundary switch only changes display');acceptedToggle.attrs['onUpdate:modelValue'](true);await waitForCuts(4,line=>line.key.startsWith('accepted-seam-'));
  const sourceHash=project.surfaceRun.sourceHash;project.surfaceRun={...project.surfaceRun,sourceHash:'f'.repeat(64)};await waitForCuts(0,line=>line.key.startsWith('accepted-seam-'));project.surfaceRun={...project.surfaceRun,sourceHash};await waitForCuts(4,line=>line.key.startsWith('accepted-seam-'));
  f.store.data.geometry=[{id:project.pieces[0].id,issues:[{ruleId:'stale-test',entityId:project.pieces[0].id,severity:'error',messageKey:'STALE_BINDING'}]}];await waitForCuts(0,line=>line.key.startsWith('accepted-seam-'));f.store.data.geometry=[];await waitForCuts(4,line=>line.key.startsWith('accepted-seam-'));
  project.bindings=project.bindings.map((binding,i)=>i===0?{...binding,geometryHash:'e'.repeat(64)}:binding);await waitForCuts(0,line=>line.key.startsWith('accepted-seam-'));

  assert.equal(f.store.data.project.revision,1);assert.equal(f.calls.length,0);
 }finally{f.app.unmount();}
});
await check('section handle belongs to a clipped visible segment and dragging it updates only the draft',async()=>{
 const f=await mount(layeredProject(),{mode:'cutting',controls:false});try{
  await f.click(f.button('Front'));const before=JSON.parse(JSON.stringify(f.store.data.project));f.props.cutRequest={kind:'section',token:1};await flush();
  const sections=()=>capture().cuts.filter(l=>l.key.startsWith('section-preview-'));
  assert.equal(sections().length,2,'rear sheet sections are hidden');assert.equal(capture().handles.length,1);
  const first=sections()[0],handle={...capture().handles[0]};assert(Math.abs(handle.x-(first.a.x+first.b.x)/2)<1e-8);assert(Math.abs(handle.y-(first.a.y+first.b.y)/2)<1e-8);
  for(const l of sections())for(const q of [l.a,l.b])assert(Math.abs(q.z-10)<1e-7);
  await f.event('onPointerdown',handle.x+360,handle.y+270);await f.event('onPointermove',handle.x+360,handle.y+282);await f.event('onPointerup',handle.x+360,handle.y+282);
  assert.equal(capture().handles.length,1);assert(Math.abs(capture().handles[0].y-handle.y-12)<1e-7,'the clipped handle remains pickable after visibility adds key suffixes');
  assert(sections().length>0);for(const l of sections())for(const q of [l.a,l.b])assert(Math.abs(q.z-10)<1e-7);
  assert.deepEqual(JSON.parse(JSON.stringify(f.store.data.project)),before,'dragging does not commit section geometry');assert.equal(f.calls.length,0);
  await f.key('Escape');assert.equal(sections().length,0);assert.equal(capture().handles.length,0);assert.deepEqual(JSON.parse(JSON.stringify(f.store.data.project)),before);
 }finally{f.app.unmount();}
});
await mkdir('test-results/current-cutting',{recursive:true});const passed=checks.every(c=>c.passed);
await writeFile('test-results/current-cutting/final-regression-line-visibility-component.json',JSON.stringify({passed,verification:'Actual SurfacePanel Vue custom renderer; display children and DOM/IPC host substituted; no WebView2 pixels',checks},null,2));
console.log(JSON.stringify({passed,checks}));if(!passed)process.exitCode=1;
