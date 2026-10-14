import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import {mount,fixtureProject,capture,flush,walk,id} from './surface-viewport-host.mjs';
const checks=[];
async function check(name,run){try{await run();checks.push({case:name,passed:true});}catch(e){checks.push({case:name,passed:false,error:e.stack});}}
function project(){
 const p=fixtureProject(),barycentric=[[.8,.1,.1],[.2,.7,.1],[.2,.1,.7]],uv=barycentric.map(w=>[100*(w[1]+w[2]),100*w[2]]);
 const piece=name=>({id:id(name),name:name==='candidate'?'Candidate ear':'Overlap flap',color:name==='candidate'?'#2299cc':'#bb5522',nodes:uv.map(([xMm,yMm],i)=>({id:id(name+i),xMm,yMm})),closed:true,allowanceMm:0,cutQty:1,mirror:false,material:'Fur',furRad:0,curves:[],holes:[],labels:[]});
 const report=face=>({faceIds:[id(face)],uv:p.surface.vertices.map(v=>({vertexId:v.id,xMm:v.xMm,yMm:v.yMm})),boundary:['v0','v1','v2'].map(id),areaErrorMax:0,edgeErrorMax:0,distortionMean:0,distortionP95:0,distortionMax:0,status:'acceptable'});
 const binding=name=>({pieceId:id(name),surfaceId:id('surface'),topologyVersion:1,geometryHash:'a'.repeat(64),surfaceHash:'b'.repeat(64),trim:{vertices:uv.map(([xMm,yMm],i)=>({id:id('t'+i),xMm,yMm})),triangles:[{vertices:['t0','t1','t2'].map(id),faceId:id('lower'),barycentric}],boundary:['t0','t1','t2'].map(id),holes:[]},report:report('lower')});
 p.pieces=[{...piece('accepted-old'),name:'Old accepted piece',color:'#888888'}];p.bindings=[{pieceId:id('accepted-old'),surfaceId:id('surface'),topologyVersion:1,geometryHash:'a'.repeat(64),surfaceHash:'b'.repeat(64),report:report('upper')}];
 p.surfaceRun={sourceHash:'b'.repeat(64),algorithm:'lscm-arap-1',accepted:false,pieces:[piece('candidate')],bindings:[binding('candidate')]};return p;
}
for(const rect of [{x:0,y:0,width:720,height:540},{x:133,y:80,width:1120,height:450},{x:24,y:121,width:380,height:620}])await check(`${rect.width}x${rect.height}: unaccepted candidate click maps exact trim and chosen overlay contains only saved barycentric triangle`,async()=>{
 const p=project(),f=await mount(p,{mode:'cutting',rect,controls:false});try{
  await f.click(f.button('Front'));assert.equal(capture().faces.find(x=>x.id===id('lower')).pieceId,id('candidate'));assert.equal(capture().faces.find(x=>x.id===id('upper')).pieceId,undefined);
  await f.pointEvent('onClick',65,25);assert.deepEqual(f.emits.filter(e=>e.event==='select').map(e=>e.value),[id('candidate')]);const point=f.emits.find(e=>e.event==='point').value;assert(Math.hypot(point.xMm-65,point.yMm-25)<1e-7);assert.equal(point.pieceId,id('candidate'));
  f.props.selectedId=id('candidate');await flush();const overlay=capture().markings.find(m=>m.id==='selected-cut');assert(overlay);assert.deepEqual(overlay.fragments,[{faceId:id('lower'),rings:[p.surfaceRun.bindings[0].trim.triangles[0].barycentric]}]);assert.equal(overlay.fragments[0].rings[0].length,3);assert.notEqual(capture().faces.find(x=>x.id===id('lower')).color,'#ffffff','trim selection highlights its exact overlay rather than the whole source face');
  const before=f.emits.filter(e=>e.event==='select').length;await f.pointEvent('onClick',95,85);assert.equal(f.emits.filter(e=>e.event==='select').length,before,'click in original face but outside trim cannot pick candidate');
  f.props.selectedId='';await flush();assert(!capture().markings.some(m=>m.id==='selected-cut'));assert.equal(f.calls.length,0);assert.equal(f.store.data.project.revision,1);
 }finally{f.app.unmount();}
});
await check('overlapping unaccepted candidate choices show candidate names and explicitly select the requested trim',async()=>{
 const p=project();p.surfaceRun.pieces.push({...structuredClone(p.surfaceRun.pieces[0]),id:id('overlap'),name:'Overlap flap'});p.surfaceRun.bindings.push({...structuredClone(p.surfaceRun.bindings[0]),pieceId:id('overlap')});
 const f=await mount(p,{mode:'cutting',controls:false});try{
  await f.click(f.button('Front'));await f.pointEvent('onClick',65,25);assert.deepEqual(f.emits.findLast(e=>e.event==='choices').value,[id('candidate'),id('overlap')]);assert.equal(f.emits.filter(e=>e.event==='select').length,0);
  const choiceButtons=walk(f.root).filter(n=>n.tag==='button'&&n.textContent.includes(' / '));assert.equal(choiceButtons.length,2);assert(choiceButtons.some(n=>n.textContent.includes('Candidate ear')),'candidate chooser names come from current candidate run');assert(choiceButtons.some(n=>n.textContent.includes('Overlap flap')));
  await f.click(choiceButtons.find(n=>n.textContent.includes('Overlap flap')));assert.equal(f.emits.findLast(e=>e.event==='select').value,id('overlap'));assert.equal(f.calls.length,0);
 }finally{f.app.unmount();}
});
await check('accepted state uses saved bindings and candidate selection never leaks into mapping mode',async()=>{
 const p=project();p.surfaceRun.accepted=true;const f=await mount(p,{mode:'cutting',controls:false});try{
  await f.click(f.button('Front'));assert.equal(capture().faces.find(x=>x.id===id('lower')).pieceId,undefined);assert.equal(capture().faces.find(x=>x.id===id('upper')).pieceId,id('accepted-old'));
  f.props.selectedId=id('candidate');await flush();assert(!capture().markings.some(m=>m.id==='selected-cut'));
  f.store.data.project.surfaceRun.accepted=false;await flush();assert(capture().markings.some(m=>m.id==='selected-cut'));
  f.props.mode='mapping';await flush();assert(!capture().markings.some(m=>m.id==='selected-cut'));assert.equal(capture().faces.find(x=>x.id===id('upper')).pieceId,id('accepted-old'));
 }finally{f.app.unmount();}
});
const passed=checks.every(c=>c.passed);await writeFile('test-results/cut-selection-component.json',JSON.stringify({passed,verification:'Actual Vue candidate selection/render props; custom GPU host, not Electron pixels',checks},null,2));console.log(JSON.stringify({passed,checks}));if(!passed)process.exitCode=1;
