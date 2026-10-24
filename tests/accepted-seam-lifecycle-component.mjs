import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdir,writeFile} from 'node:fs/promises';
import {mount,fixtureProject,capture,flush,id,walk} from './surface-viewport-host.mjs';

const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
function acceptedProject(){const p=fixtureProject(),piece={id:id('accepted-life-piece'),name:'Accepted square',nodes:[[0,0],[100,0],[100,100],[0,100]].map(([xMm,yMm],i)=>({id:id('accepted-life-node-'+i),xMm,yMm})),closed:true,allowanceMm:0,cutQty:1,mirror:false,material:'Test fabric',furRad:0,color:'#73c9b6'},sourceHash=hash(p.surface),binding={pieceId:piece.id,surfaceId:p.surface.id,topologyVersion:1,geometryHash:hash({nodes:piece.nodes,holes:[],curves:[]}),surfaceHash:sourceHash,report:{faceIds:p.surface.faces.map(f=>f.id),uv:piece.nodes.map((node,i)=>({vertexId:id('v'+i),xMm:node.xMm,yMm:node.yMm})),boundary:[0,1,2,3].map(i=>id('v'+i)),areaErrorMax:0,edgeErrorMax:0,distortionMean:0,distortionP95:0,distortionMax:0,status:'acceptable'}};p.pieces=[piece];p.bindings=[binding];p.surfaceRun={sourceHash,algorithm:'lscm-cg-1',accepted:true,pieces:[piece],bindings:[binding]};return p;}
const clone=value=>JSON.parse(JSON.stringify(value));
const accepted=()=>capture().cuts.filter(line=>line.key.startsWith('accepted-seam-'));
const candidate=()=>capture().cuts.filter(line=>line.key.startsWith('candidate-'));
async function waitFor(test,message){const until=Date.now()+2000;do{await flush();if(test())return;await new Promise(resolve=>setTimeout(resolve,5));}while(Date.now()<until);assert(test(),message);}
async function publish(f,p){assert(await f.store.run(async()=>({ok:true,data:{...clone(f.store.data),project:p}})));await flush();}
const checks=[];
async function check(name,run){try{await run();checks.push({case:name,passed:true});}catch(error){checks.push({case:name,passed:false,error:error.stack});}}

await check('the same cutting viewport restores accepted seams after undo and reaccept through actual store publications',async()=>{
 const f=await mount(acceptedProject(),{mode:'cutting',controls:false});try{
  await f.click(f.button('Front'));await waitFor(()=>accepted().length===4,'initial accepted perimeter must be visible');const initial=clone(accepted());
  const undo=clone(f.store.data.project);undo.revision++;undo.surfaceRun.accepted=false;undo.pieces=[];undo.bindings=[];await publish(f,undo);await waitFor(()=>accepted().length===0&&candidate().length===4,'undo must restore candidate seams in this viewport');
  const reaccepted=clone(undo);reaccepted.revision++;reaccepted.surfaceRun.accepted=true;reaccepted.pieces=clone(reaccepted.surfaceRun.pieces);reaccepted.bindings=clone(reaccepted.surfaceRun.bindings);await publish(f,reaccepted);await waitFor(()=>accepted().length===4&&candidate().length===0,'reaccept must restore accepted seams without navigation or remount');
  assert.equal(f.props.mode,'cutting');assert.deepEqual(accepted(),initial);for(const line of accepted()){assert.equal(line.opacity,.5);assert.equal(line.nodes,false);}assert.equal(f.calls.length,0);
 }finally{f.app.unmount();}
});
await check('the non-cutting assembly viewport intentionally hides accepted seams and their display control',async()=>{
 const f=await mount(acceptedProject(),{mode:'cutting',controls:false});try{
  await f.click(f.button('Front'));await waitFor(()=>accepted().length===4,'initial cutting viewport shows accepted seams');const before=clone(f.store.data.project);
  f.props.mode='references';await flush();await waitFor(()=>accepted().length===0,'assembly uses references mode and does not display cutting overlays');assert(!walk(f.root).some(n=>n.tag==='label'&&n.textContent==='Saved cut seams 50%'));assert.deepEqual(clone(f.store.data.project),before);assert.equal(f.calls.length,0);
 }finally{f.app.unmount();}
});
await mkdir('test-results/current-cutting/consolidated',{recursive:true});const report={passed:checks.every(c=>c.passed),verification:'Actual SurfacePanel and unchanged session.run publication. The first case retains one mounted cutting viewport through undo and reaccept; the second separately checks the intentional assembly/references display mode. Independently constructed square perimeter and fingerprints; no native solver or WebView2.',checks};await writeFile('test-results/current-cutting/consolidated/accepted-seam-lifecycle-component.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));if(!report.passed)process.exitCode=1;
