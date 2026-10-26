// Run only after the owner freezes/rebuilds the application. No cutting/building.
import assert from 'node:assert/strict';
import {mkdir,mkdtemp,readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {constants,setPriority,getPriority} from 'node:os';
import {desktop} from './tauri-desktop.mjs';
import {desktopArgs,executablePath,testedBuild} from './desktop-launch.mjs';
import {desktopScreenshot} from './desktop-screenshot.mjs';
import {workflow,surfaceCoordinates,chooseProject,waitForIdle} from './ui-navigation.mjs';
import {auditRuntime,testedArtifacts,sha256} from './real-mapping-fixture-audit.mjs';
import {assertBodyModelScope} from './fixtures/character-functional-oracle.mjs';
import {observeNativeResponses} from './native-response-observer.mjs';

assert(process.env.FPCAD_PLACEMENT_FREEZE,'Set FPCAD_PLACEMENT_FREEZE to the approved rebuilt freeze name; this test must not silently run against an old host.');
assert(process.env.FPCAD_PLACEMENT_EXPECT_HOST_SHA,'Set the owner-approved FPCAD_PLACEMENT_EXPECT_HOST_SHA before running the native freeze.');
const output=resolve(process.env.FPCAD_PLACEMENT_RESULTS??'test-results/reported-functional-acceptance/native-placement-position-matrix');
const groups=new Set((process.env.FPCAD_PLACEMENT_GROUPS??'manual,automatic').split(',').filter(Boolean));
assert(groups.size>0&&[...groups].every(g=>['manual','automatic'].includes(g)),'Supported groups are manual,automatic');
await mkdir(output,{recursive:true});
const directory=await mkdtemp(resolve('.local/tests/native-placement-matrix-'));
const launchOptions={args:desktopArgs,executablePath,env:{...process.env,FPCAD_DATA_DIR:directory}};
const report={passed:false,started:new Date().toISOString(),freeze:process.env.FPCAD_PLACEMENT_FREEZE,groups:[...groups],testedBuild,directory,processes:[],checks:[],pageErrors:[],scope:'Actual hidden native host, fresh original JPEG extraction, default padded physical model. Only explicitly selected groups are accepted. Original unscaled library card uses trusted pointer drag/drop; manual movement uses pointer events. Automatic cases use the actual per-card UI button. No cuts, injected surface/marking results, source reclassification or source resizing. Automatic matching has front/back source views; flank coverage is manual, not an invented automatic side mode.'};
let app,page;
const read=async()=>{const r=await page.evaluate(()=>window.fpcad.read());assert(r.ok,JSON.stringify(r));return r.data.project;};
const record=async()=>writeFile(resolve(output,'report.json'),JSON.stringify(report,null,2));
async function capture(name){const p=await read();await writeFile(resolve(output,name+'.json'),JSON.stringify(p));return p;}
async function launch(){
 app=await desktop.launch(launchOptions);page=await app.firstWindow();page.setDefaultTimeout(45000);
 const pid=app.process().pid;setPriority(pid,constants.priority.PRIORITY_LOW);report.processes.push({pid,priority:getPriority(pid),closed:false});
 page.on('pageerror',e=>report.pageErrors.push(e.message));await page.setViewportSize({width:1600,height:1100});await page.waitForFunction(()=>!!window.fpcad);
 assert(await app.evaluate(({DesktopWindow})=>DesktopWindow.getAllWindows().every(w=>!w.isVisible())),'Native test windows stay hidden');
}
async function close(){if(app){await app.close();report.processes.at(-1).closed=app.process().exitCode!==null||app.process().signalCode!==null;app=undefined;}}
async function step(name,callback){console.log('START '+name);try{const evidence=await callback();report.checks.push({name,passed:true,evidence});console.log('PASS '+name);return evidence;}catch(e){report.checks.push({name,passed:false,error:String(e.stack??e)});if(app){await capture(name+'-failed-project').catch(()=>{});const observation=await page.evaluate(()=>({events:window.__positionEvents,replies:window.__positionReplies,banners:[...document.querySelectorAll('.error-banner,.drop-message,.attach-notice')].map(e=>e.textContent)})).catch(()=>undefined);if(observation)await writeFile(resolve(output,name+'-failed-observation.json'),JSON.stringify(observation,null,2));await desktopScreenshot(app,page,{path:resolve(output,name+'-failure.png')}).catch(()=>{});}throw e;}finally{await record();}}
const xyz=p=>[p.xMm,p.yMm,p.zMm];
function inside(point,ring){let yes=false;for(let i=0,j=ring.length-1;i<ring.length;j=i++){const a=ring[i],b=ring[j];if((a[1]>point[1])!==(b[1]>point[1])&&point[0]<(b[0]-a[0])*(point[1]-a[1])/(b[1]-a[1])+a[0])yes=!yes;}return yes;}
function geometry(surface){const vertices=new Map(surface.vertices.map(v=>[v.id,xyz(v)]));return surface.faces.map(face=>{const p=face.vertices.map(id=>vertices.get(id));return {face,p,center:[0,1,2].map(i=>p.reduce((s,v)=>s+v[i]/3,0))};});}
// Independent all-original-triangle orthographic ray oracle. No production
// picker, decal chart, anatomical fit or projection ownership is imported.
function nearest(rows,point,view){
 // UI left preset uses screen-right=-Z and eye=+X; right uses
 // screen-right=+Z and eye=-X. These are camera directions, not region names
 // or character-side labels, which must never decide the visible ray hit.
 const axis=['left','right'].includes(view)?0:2,sign=['right','back'].includes(view)?-1:1,[x,y]=axis===2?[0,1]:[2,1];let result;
 for(const row of rows){const [a,b,c]=row.p,det=(b[x]-a[x])*(c[y]-a[y])-(b[y]-a[y])*(c[x]-a[x]);if(Math.abs(det)<1e-12)continue;
  const u=((point[x]-a[x])*(c[y]-a[y])-(point[y]-a[y])*(c[x]-a[x]))/det,v=((b[x]-a[x])*(point[y]-a[y])-(b[y]-a[y])*(point[x]-a[x]))/det;if(u< -1e-9||v< -1e-9||u+v>1+1e-9)continue;
  const position=[0,1,2].map(i=>(1-u-v)*a[i]+u*b[i]+v*c[i]),depth=sign*position[axis];if(!result||depth>result.depth)result={faceId:row.face.id,region:row.face.region,position,depth,weights:[1-u-v,u,v]};
 }return result;
}
const sites=[
 {name:'chest',region:'torso',yf:.7,view:'front'},
 {name:'abdomen',region:'torso',yf:.35,view:'front'},
 ...['left','right'].flatMap(side=>[
  {name:side+'-shoulder',region:'arm-'+side,yf:.8,xf:.12,view:'front'},
  {name:side+'-upper-arm',region:'arm-'+side,yf:.6,xf:.4,view:'front'},
  {name:side+'-thigh',region:'leg-'+side,yf:.72,view:'front'},
  {name:side+'-calf',region:'leg-'+side,yf:.3,view:'front'},
 ]),
 {name:'back',region:'torso',yf:.7,view:'back'},
 {name:'left-flank',region:'torso',yf:.7,view:'left'},
 {name:'right-flank',region:'torso',yf:.7,view:'right'},
];
function anchor(rows,site){
 const candidates=rows.filter(r=>r.face.region===site.region);assert(candidates.length,site.name+' region exists');
 const b=[0,1,2].map(i=>[Math.min(...candidates.flatMap(r=>r.p.map(v=>v[i]))),Math.max(...candidates.flatMap(r=>r.p.map(v=>v[i])))]),side=site.region.endsWith('left')?-1:1;
 const point=[site.xf===undefined?(b[0][0]+b[0][1])/2:side*(Math.min(Math.abs(b[0][0]),Math.abs(b[0][1]))+site.xf*(b[0][1]-b[0][0])),b[1][0]+site.yf*(b[1][1]-b[1][0]),(b[2][0]+b[2][1])/2],horizontal=['left','right'].includes(site.view)?2:0;
 candidates.sort((a,b)=>((a.center[horizontal]-point[horizontal])**2+(a.center[1]-point[1])**2)-((b.center[horizontal]-point[horizontal])**2+(b.center[1]-point[1])**2));
 for(const row of candidates){const hit=nearest(rows,row.center,site.view);if(hit&&Math.hypot(...hit.position.map((v,i)=>v-row.center[i]))<1e-6)return row.center;}
 throw Error('No independently visible '+site.name+' target');
}
function bounds(surface){const b=['xMm','yMm','zMm'].map(k=>[Math.min(...surface.vertices.map(v=>v[k])),Math.max(...surface.vertices.map(v=>v[k]))]);return {center:b.map(([a,b])=>(a+b)/2),factor:450/Math.max(...b.map(([a,b])=>b-a))};}
function projected(point,b,view){const d=point.map((v,i)=>v-b.center[i]),x=view==='back'?-d[0]:view==='left'?-d[2]:view==='right'?d[2]:d[0];return [x*b.factor,-d[1]*b.factor];}
function unprojectEvent(event,b,view){const v=event.viewport,x=(event.clientX-v.x-v.width/2)/v.scale/b.factor,y=-(event.clientY-v.y-v.height/2)/v.scale/b.factor,p=[...b.center];p[1]+=y;if(view==='front')p[0]+=x;else if(view==='back')p[0]-=x;else if(view==='left')p[2]-=x;else p[2]+=x;return p;}
function contourUnchanged(shape,piece,grab){
 const check=(actual,expected)=>{assert.equal(actual.length,expected.length);actual.forEach((p,i)=>{assert(Math.abs(p.xMm-(expected[i].xMm-grab.xMm))<1e-6);assert(Math.abs(p.yMm-(expected[i].yMm-grab.yMm))<1e-6);});};
 check(shape.nodes,piece.nodes);assert.equal(shape.holes?.length??0,piece.holes?.length??0);(shape.holes??[]).forEach((h,i)=>check(h,piece.holes[i]));
 assert.equal(shape.curves?.length??0,piece.curves?.length??0);(shape.curves??[]).forEach((curve,i)=>{const original=piece.curves[i],index=piece.nodes.findIndex(n=>n.id===original.startNodeId);assert(index>=0);assert.equal(piece.nodes[(index+1)%piece.nodes.length].id,original.endNodeId);assert.equal(curve.startIndex,index);check([curve.c1,curve.c2],[original.c1,original.c2]);});
}
async function observe(){await page.evaluate(()=>{
 window.__positionEvents=[];window.__positionReplies=[];
 const viewport=view=>{const canvas=view instanceof HTMLCanvasElement?view:view.querySelector('canvas'),r=canvas.getBoundingClientRect(),s=getComputedStyle(canvas),n=v=>parseFloat(v)||0,left=n(s.borderLeftWidth)+n(s.paddingLeft),top=n(s.borderTopWidth)+n(s.paddingTop),width=r.width-left-n(s.borderRightWidth)-n(s.paddingRight),height=r.height-top-n(s.borderBottomWidth)-n(s.paddingBottom);return {x:r.x+left,y:r.y+top,width,height,scale:Math.min(width/720,height/540)};};
 for(const type of ['dragstart','drop','pointerup'])document.addEventListener(type,event=>{const view=event.target instanceof Element&&event.target.closest('.surface-view');if(type==='pointerup'&&!view)return;window.__positionEvents.push({type,trusted:event.isTrusted,clientX:event.clientX,clientY:event.clientY,...(event.dataTransfer?{sourceId:event.dataTransfer.getData('application/x-fpcad-region'),anchor:event.dataTransfer.getData('application/x-fpcad-anchor')}:{}),...(view?{viewport:viewport(view)}:{})});});
 });}
async function history(forward){const before=await read();await page.locator('.project-toolbar').getByRole('button',{name:forward?/^↷/:/^↶/}).click();await waitForIdle(page);assert((await read()).revision>before.revision,'Actual UI history action completes');}
async function save(name){const path=resolve(output,name+'.fpcad');await app.evaluate(({dialog},path)=>dialog.showSaveDialog=async()=>({canceled:false,filePath:path}),path);const r=await page.evaluate(async()=>{const p=(await window.fpcad.read()).data.project;return window.fpcad.save(p.id,p.revision,true);});assert(r.ok,JSON.stringify(r));const bytes=await readFile(path);assert(bytes.length>1000);return {path,bytes:bytes.length,sha256:sha256(bytes)};}
async function open(path){await app.evaluate(({dialog},path)=>dialog.showOpenDialog=async()=>({canceled:false,filePaths:[path]}),path);const r=await page.evaluate(()=>window.fpcad.open());assert(r.ok,JSON.stringify(r));await page.reload();await chooseProject(page);}
async function reopenAndRestart(name,expected){
 const file=await save(name);await open(file.path);let p=await read();for(const k of ['surface','patternLibrary','references','markings'])assert.deepEqual(p[k],expected[k],k+' survives actual file reopening');
 await close();await launch();await chooseProject(page);p=await read();for(const k of ['surface','patternLibrary','references','markings'])assert.deepEqual(p[k],expected[k],k+' survives actual process restart');return {...file,actualRestart:true};
}
try{
 await launch();report.hostSha256=sha256(await readFile(resolve(executablePath??'apps/desktop/src-tauri/target/debug/FurryPatternCAD.exe')));report.artifacts=await testedArtifacts(undefined,await app.evaluate(({host})=>host.getAppPath()));report.webview=await app.webviewLaunchInfo();
 if(process.env.FPCAD_PLACEMENT_EXPECT_HOST_SHA)assert.equal(report.hostSha256,process.env.FPCAD_PLACEMENT_EXPECT_HOST_SHA.toLowerCase());
 const helpers=await auditRuntime(directory),imagePath=resolve('tests/fixtures/character-front-back.jpg');report.imageSha256=sha256(await readFile(imagePath));
 await step(process.env.FPCAD_PLACEMENT_INPUT?'original-jpeg-native-archive-default-padded':'fresh-original-jpeg-default-padded',async()=>{
  if(process.env.FPCAD_PLACEMENT_INPUT){const path=resolve(process.env.FPCAD_PLACEMENT_INPUT);report.inputArchive={path,sha256:sha256(await readFile(path)),policy:'Reuse the immutable unmapped archive created by the actual fresh JPEG/default-model native run, avoiding another extraction while correcting test observation. No project geometry/library injection.'};await open(path);assert.equal((await read()).markings?.length??0,0,'Only an unmapped original archive may seed this matrix');}
  else{
   await app.evaluate(({dialog},path)=>dialog.showOpenDialog=async()=>({canceled:false,filePaths:[path]}),imagePath);
   const r=await page.evaluate(async parameters=>{let r=await window.fpcad.create({name:'Original library native position matrix',unit:'mm'});if(!r.ok)return r;let p=r.data.project;r=await window.fpcad.autoReference(p.id,p.revision,'front-right',1800,8,true);if(!r.ok)return r;p=r.data.project;return window.fpcad.generateSpecies(p.id,p.revision,parameters);},helpers.speciesDefaults('canine','padded'));assert(r.ok,JSON.stringify(r));
  }
  const p=await capture('baseline-project'),scope=assertBodyModelScope(p.surface,'padded');report.baseline=await save('baseline-unmapped');return {sources:p.patternLibrary.length,faces:p.surface.faces.length,scope};
 });
 let p=await read();const originalLibrary=structuredClone(p.patternLibrary),rows=geometry(p.surface),b=bounds(p.surface);
 const candidates=p.patternLibrary.filter(s=>{const n=s.piece.nodes,x=n.map(p=>p.xMm),y=n.map(p=>p.yMm),w=Math.max(...x)-Math.min(...x),h=Math.max(...y)-Math.min(...y);return s.view==='front'&&s.piece.color==='#f9e33c'&&(s.piece.curves?.length??0)>=1&&w>=40&&w<=80&&h>=50&&h<=90;});
 assert.equal(candidates.length,1,'Select the original yellow inner-leg accent by color/physical size/curves, without using unstable IDs or editing its classification');const source=candidates[0].piece;report.manualSource={...candidates[0],policy:'Unmodified original extracted library piece reused at each manual target; no resized synthetic replacement.'};
 await page.reload();await workflow(page,'mapping');await observe();
 if(groups.has('manual')){
 for(const site of sites)await step('original-card-'+site.name,async()=>{
  const panel=page.locator('.surface-panel');await panel.getByRole('button',{name:{front:'正面',back:'背面',left:'左侧',right:'右侧'}[site.view],exact:true}).click();
  const card=page.locator('.mapping-page .region-card[data-region-id="'+source.id+'"]');await card.scrollIntoViewIfNeeded();
  const sourcePosition=await card.evaluate(card=>{const svg=card.querySelector('svg'),path=svg.querySelector('path'),box=path.getBBox(),c=card.getBoundingClientRect(),matrix=svg.getScreenCTM(),options=[];for(let yi=1;yi<10;yi++)for(let xi=1;xi<10;xi++){const point=new DOMPoint(box.x+box.width*xi/10,box.y+box.height*yi/10);if(path.isPointInFill(point)){const screen=point.matrixTransform(matrix);options.push({x:screen.x-c.x,y:screen.y-c.y,d:(xi-5)**2+(yi-5)**2});}}options.sort((a,b)=>a.d-b.d);if(!options.length)throw Error('No actual filled original thumbnail grab point');return {x:options[0].x,y:options[0].y};});
  const point=anchor(rows,site),screen=await surfaceCoordinates(page,...projected(point,b,site.view)),view=page.locator('.surface-view'),rect=await view.boundingBox(),before=await read();await page.evaluate(()=>window.__positionEvents=[]);
  await card.dragTo(view,{sourcePosition,targetPosition:{x:screen.x-rect.x,y:screen.y-rect.y}});await waitForIdle(page,{timeout:120000});
  const after=await read(),events=await page.evaluate(()=>window.__positionEvents),drop=events.find(e=>e.type==='drop'),start=events.find(e=>e.type==='dragstart');
  await writeFile(resolve(output,site.name+'-events.json'),JSON.stringify(events,null,2));assert(start?.trusted&&drop?.trusted,'Actual trusted browser drag/drop required; dispatched DataTransfer events do not qualify');assert.equal(drop.sourceId,source.id);assert(drop.anchor,'The original pointer grab point is transferred by the UI');assert.equal(after.markings.length,(before.markings?.length??0)+1,JSON.stringify({events,dropMessage:await page.locator('.drop-message').allTextContents(),errors:await page.locator('.error-banner').allTextContents()}));
  const mark=after.markings.at(-1),grab=JSON.parse(drop.anchor),hit=nearest(rows,unprojectEvent(drop,b,site.view),site.view);assert(hit);assert.equal(hit.region,site.region);assert(mark.fragments.length>0);assert(Math.hypot(...mark.surfaceShape.origin.map((v,i)=>v-hit.position[i]))<1e-4,'Original grabbed point must land on independently nearest actual visible triangle');
  assert(mark.fragments.filter(f=>f.faceId===hit.faceId).some(f=>f.rings.reduce((yes,ring)=>yes!==inside([hit.weights[1],hit.weights[2]],ring.map(w=>[w[1],w[2]])),false)),'The independently visible grabbed material point is actually painted');
  for(const f of mark.fragments)for(const ring of f.rings)for(const weights of ring){assert(weights.every(v=>Number.isFinite(v)&&v>=-1e-8&&v<=1+1e-8));assert(Math.abs(weights.reduce((s,v)=>s+v,0)-1)<1e-8);}contourUnchanged(mark.surfaceShape,source,grab);assert.deepEqual(after.patternLibrary,originalLibrary);
  await history(false);assert.deepEqual((await read()).markings??[],before.markings??[],'Undo removes exactly this original card copy');await history(true);assert.deepEqual((await read()).markings,after.markings,'Redo restores exact fragments/frame');
  // Drag the actual attached material point; never call a shape-transform API.
  await page.mouse.move(drop.clientX,drop.clientY);await page.mouse.down();await page.mouse.move(drop.clientX+5,drop.clientY+3,{steps:8});await page.mouse.up();await waitForIdle(page,{timeout:120000});
  const moved=await read(),m=moved.markings.find(m=>m.id===mark.id);assert(moved.revision>after.revision);assert.notDeepEqual(m.surfaceShape.origin,mark.surfaceShape.origin,'Actual pointer move changes the attachment');assert(m.fragments.length>0);contourUnchanged(m.surfaceShape,source,grab);assert.deepEqual(moved.patternLibrary,originalLibrary);await history(false);assert.deepEqual((await read()).markings,after.markings,'Undo move restores all earlier attachments');await history(true);assert.deepEqual((await read()).markings,moved.markings,'Redo move restores exact persisted result');
  await desktopScreenshot(app,page,{path:resolve(output,site.name+'.png')});return {region:site.region,view:site.view,markingId:mark.id,sourceId:source.id,grab,independentHit:hit,fragments:m.fragments.length,originalContourPreserved:true,trustedDrag:true,manualPointerMove:true,undoRedo:true};
 });
 await step('manual-matrix-save-open-actual-restart',async()=>reopenAndRestart('manual-position-matrix',await capture('manual-position-project')));
 }
 if(groups.has('automatic')){
 await step('automatic-original-library-ui-matrix',async()=>{
  await open(report.baseline.path);await workflow(page,'mapping');await observe();const baseline=await read(),library=baseline.patternLibrary;
  const observer=await observeNativeResponses(page,directory,['marking.auto']);
  const contexts=s=>s.anatomy?.method!=='manual'&&s.anatomy?.contexts?.length?s.anatomy.contexts:s.anatomy?[s.anatomy]:[],sources=library.filter(s=>contexts(s).some(a=>['body','arm','leg','foot','paw'].includes(a.part)));
  const calls=[];for(const source of sources){const card=page.locator('.mapping-page .region-card[data-region-id="'+source.piece.id+'"]');await card.click();const index=observer.records.length;await page.locator('.mapping-page .marking-library').getByRole('button',{name:'自动匹配此花纹的模型部位',exact:true}).click();const reply=await observer.waitFor('marking.auto',index);await waitForIdle(page);assert.deepEqual(reply.request.payload.pieceIds,[source.piece.id]);calls.push({sourceId:source.piece.id,view:source.view,contexts:contexts(source),...reply,notice:await page.locator('.mapping-page .attach-notice').allTextContents()});await writeFile(resolve(output,'automatic-ui-responses.json'),JSON.stringify(calls,null,2));console.log('AUTO '+calls.length+'/'+sources.length+' '+source.piece.name+' '+JSON.stringify(reply.result.autoPlacementReport??reply.result.error));assert(reply.result.ok,JSON.stringify(reply));}await observer.stop();
  await writeFile(resolve(output,'automatic-ui-responses.json'),JSON.stringify(calls,null,2));const after=await capture('automatic-position-project'),actual=new Set(after.markings.filter(m=>m.placement).map(m=>m.placement.part+':'+m.placement.side));
  const regions=new Set(after.surface.faces.map(f=>f.region)),presentPart=part=>part==='body'?regions.has('torso'):[...regions].some(r=>r===part||r.startsWith(part+'-'));
  const required=['body:center',...['arm','leg','foot','paw'].filter(presentPart).flatMap(part=>['left','right'].map(side=>part+':'+side))],missing=required.filter(part=>!actual.has(part));assert.deepEqual(missing,[],'Original source contexts cover every supported physical body part through the actual UI auto button');assert(after.markings.every(m=>m.fragments.length&&m.placement&&!m.placement.reviewed),'All inferred positions keep real fragments and remain unreviewed');assert.deepEqual(after.patternLibrary,originalLibrary,'Automatic placement must preserve original pixels/contours/classification');
  const skipped=calls.flatMap(c=>c.result.autoPlacementReport?.skipped??[]);assert.equal(skipped.filter(s=>s.reason==='AMBIGUOUS_PROJECTION').length,0,'Ordinary original source auto matching must not reintroduce coplanar ambiguity');
  assert.equal(skipped.filter(s=>s.reason==='NO_VISIBLE_PROJECTION').length,0,'The previously repaired original leg/back-body sources must not silently disappear from automatic placement');
  const absentParts=[];for(const part of ['foot','paw'].filter(part=>!presentPart(part))){const absent=sources.filter(s=>contexts(s).some(a=>a.part===part));assert(absent.length>0,'Original '+part+' sources remain in the library');for(const source of absent)assert(skipped.some(s=>s.pieceId===source.piece.id&&s.reason==='MODEL_PART_MISSING'),'Actual UI explicitly reports missing '+part+': '+source.piece.name);assert(!after.markings.some(m=>m.placement?.part===part),'No missing '+part+' source is relabeled onto a leg');absentParts.push({part,sourceIds:absent.map(s=>s.piece.id),reason:'MODEL_PART_MISSING'});}
  const placedCalls=calls.filter(c=>c.result.autoPlacementReport?.placed>0);assert(placedCalls.length>0);const previousIds=placedCalls.length>1?placedCalls.at(-2).result.markingIds:[],current=new Map(after.markings.map(m=>[m.id,m]));
  await history(false);const undone=await read();assert.deepEqual((undone.markings??[]).map(m=>m.id),previousIds,'Automatic batch undo removes exactly the last successful UI placement, including after later missing-part skips');for(const m of undone.markings??[])assert.deepEqual(m,current.get(m.id),'Earlier automatic attachments survive undo unchanged');await history(true);assert.deepEqual((await read()).markings,after.markings,'Automatic UI redo restores exact placement metadata and fragments');
  for(const [view,label]of [['front','正面'],['left','左侧'],['back','背面']]){await page.locator('.surface-panel').getByRole('button',{name:label,exact:true}).click();await desktopScreenshot(app,page,{path:resolve(output,'automatic-'+view+'.png')});}
  report.automatic={clickedSources:sources.length,markings:after.markings.length,parts:[...actual],requiredParts:required,absentParts,skipped,actualUiUndoRedo:true,views:['front','back'].map(view=>({view,markings:after.markings.filter(m=>m.view===view).length,regions:[...new Set(after.markings.filter(m=>m.view===view).flatMap(m=>m.placement.regions))]}))};return report.automatic;
 });
 await step('automatic-save-open-actual-restart',async()=>reopenAndRestart('automatic-position-matrix',await read()));
 }else report.automatic={status:'NOT_RUN',reason:'Automatic group was not selected'};
 assert.deepEqual(report.pageErrors,[]);report.passed=true;
}catch(e){report.error=String(e.stack??e);console.error(report.error);process.exitCode=1;}finally{await close();report.finished=new Date().toISOString();await record();}
