// Sample the real backend for one UI undo/redo. Full project reads and the
// preparation rename/reload are deliberately outside both CPU samples.
import assert from 'node:assert/strict';
import {mkdir,writeFile,appendFile} from 'node:fs/promises';
import {resolve,sep} from 'node:path';
import {constants,setPriority} from 'node:os';
import {desktop} from './tauri-desktop.mjs';
import {desktopArgs,executablePath} from './desktop-launch.mjs';
import {chooseProject,waitForIdle} from './ui-navigation.mjs';
import {desktopScreenshot} from './desktop-screenshot.mjs';

assert(process.env.FPCAD_REFERENCE_SHEET_DATA_DIR);
const directory=resolve(process.env.FPCAD_REFERENCE_SHEET_DATA_DIR);assert(directory.startsWith(resolve('.local/tests')+sep));
const output=resolve(process.env.FPCAD_HISTORY_PROFILE_RESULTS??'test-results/2026-10-26-reference-sheet/history-profile');await mkdir(output,{recursive:true});
const report={passed:false,started:new Date().toISOString(),directory,scope:'Real production backend and real UI undo/redo only. No solver computation or candidate import. Full project reads, preparation and metadata verification are outside CPU sampling.',uiObservationTimeoutMs:120000,events:[],samples:[]};
let app,page,sampling;
async function persist(){await writeFile(resolve(output,'report.json'),JSON.stringify(report,null,2));}
async function metadata(){return page.evaluate(async()=>{const r=await window.fpcad.read();if(!r.ok)throw Error(JSON.stringify(r));const p=r.data.project;return {id:p.id,revision:p.revision,name:p.name,pieces:p.pieces.length,bindings:p.bindings.length,history:p.cuttingLibrary.length,activeCutId:p.activeCutId,accepted:p.surfaceRun?.accepted,canUndo:r.data.canUndo,canRedo:r.data.canRedo};});}
function method(request){if(!request.url().includes('ipc.localhost/desktop_request'))return;try{return request.postDataJSON()?.payload?.method;}catch{}}
function log(event){report.events.push(event);void appendFile(resolve(output,'events.ndjson'),JSON.stringify(event)+'\n');}
async function sample(action,label){
 const item={action,startedAt:new Date().toISOString(),before:await metadata()};report.samples.push(item);await persist();
 await page.evaluate(()=>{window.__historyProfileTransitions=[];window.__historyProfileObserver?.disconnect();const first=document.querySelector('.project-toolbar button');window.__historyProfileObserver=new MutationObserver(()=>window.__historyProfileTransitions.push({at:Date.now(),performanceNow:performance.now(),disabled:first.disabled}));window.__historyProfileObserver.observe(first,{attributes:true,attributeFilter:['disabled']});});
 await app.profileStart();sampling=action;item.sampleStart=Date.now();
 try{item.clickStart=Date.now();await page.locator('.project-toolbar').getByRole('button',{name:label}).click();item.clickReturned=Date.now();await waitForIdle(page,{timeout:120000});item.storeIdle=Date.now();}
 catch(error){item.error=String(error.stack??error);throw error;}
 finally{item.profileStopRequested=Date.now();const profile=await app.profileStop();sampling=undefined;item.profileStopReturned=Date.now();item.profilePath=resolve(output,action+'.cpuprofile');await writeFile(item.profilePath,profile);item.transitions=await page.evaluate(()=>{window.__historyProfileObserver?.disconnect();return window.__historyProfileTransitions;});item.requests=report.events.filter(e=>e.sampling===action);await persist();}
 item.after=await metadata();item.observedUiMs=item.storeIdle-item.clickStart;const errors=await page.locator('.error-banner').allTextContents();assert.deepEqual(errors,[]);await desktopScreenshot(app,page,{path:resolve(output,action+'.png')});await persist();return item;
}
try{
 app=await desktop.launch({args:desktopArgs,executablePath,env:{...process.env,FPCAD_DATA_DIR:directory,FPCAD_PROFILE:'1'}});page=await app.firstWindow();page.setDefaultTimeout(120000);setPriority(app.process().pid,constants.priority.PRIORITY_LOW);report.pid=app.process().pid;await page.setViewportSize({width:1600,height:1100});await chooseProject(page);assert(await app.evaluate(({DesktopWindow})=>DesktopWindow.getAllWindows().every(w=>!w.isVisible())));
 page.on('request',request=>{const name=method(request);if(name)log({event:'request',at:Date.now(),method:name,sampling,url:request.url()});});
 page.on('response',response=>{const name=method(response.request());if(name)log({event:'response-headers',at:Date.now(),method:name,sampling,status:response.status(),timing:response.request().timing()});});
 page.on('requestfinished',request=>{const name=method(request);if(name)log({event:'response-body-finished',at:Date.now(),method:name,sampling,timing:request.timing()});});
 page.on('requestfailed',request=>{const name=method(request);if(name)log({event:'request-failed',at:Date.now(),method:name,sampling,error:request.failure()});});
 report.before=await metadata();assert(report.before.accepted&&report.before.pieces>0);await persist();
 // Prepare one new ordinary history entry; this expensive read/write/reload is
 // expressly not part of either profile or the operation timing measurements.
 const prep=await page.evaluate(async()=>{const s=await window.fpcad.read();if(!s.ok)throw Error(JSON.stringify(s));const p=s.data.project,name=p.name+' profile probe',r=await window.fpcad.apply(p.id,p.revision,{type:'project.rename',name});return {ok:r.ok,error:r.error,name};});assert(prep.ok,JSON.stringify(prep));report.preparedName=prep.name;await page.reload();await chooseProject(page);await waitForIdle(page,{timeout:120000});await persist();
 const undo=await sample('undo',/撤销$/);assert.equal(undo.after.name,report.before.name);assert.equal(undo.after.pieces,report.before.pieces);assert.equal(undo.after.activeCutId,report.before.activeCutId);
 const redo=await sample('redo',/重做$/);assert.equal(redo.after.name,prep.name);assert.equal(redo.after.pieces,report.before.pieces);assert.equal(redo.after.activeCutId,report.before.activeCutId);report.passed=true;report.finished=new Date().toISOString();console.log(JSON.stringify({passed:true,output,samples:report.samples.map(s=>({action:s.action,observedUiMs:s.observedUiMs,profile:s.profilePath}))}));
}catch(error){report.error=String(error.stack??error);throw error;}
finally{await persist();if(app){try{await app.close();report.closed=true;}catch(error){report.closeError=String(error.stack??error);}}await persist();}
