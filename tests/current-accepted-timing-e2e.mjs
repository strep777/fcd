// Diagnose the already accepted real project. No surface.unwrap request is made.
import {_electron as electron} from 'playwright';
import assert from 'node:assert/strict';
import {DatabaseSync,backup} from 'node:sqlite';
import {createHash} from 'node:crypto';
import {mkdir,mkdtemp,readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {setPriority,constants} from 'node:os';
import {desktopArgs,executablePath} from './desktop-launch.mjs';
import {desktopScreenshot} from './desktop-screenshot.mjs';
import {hiddenWindowId} from './desktop-window.mjs';

const output=resolve(process.env.FPCAD_ACCEPTED_TIMING_OUTPUT??'test-results/current-cutting/consolidated/accepted-timing');
await mkdir(output,{recursive:true});
const prior=JSON.parse(await readFile(resolve('test-results/current-cutting/consolidated/independent-current-seams/report.json'),'utf8'));
assert(prior.passed&&prior.windowsClosed);
const sourcePath=resolve(prior.directory,'workspace.sqlite'),userPath=resolve('.local/workspace/workspace.sqlite');
function dbHash(path){const db=new DatabaseSync(path,{readOnly:true}),h=createHash('sha256');try{for(const r of db.prepare('SELECT id,state FROM sessions ORDER BY id').iterate())h.update(JSON.stringify(r));for(const r of db.prepare('SELECT digest,json FROM resources ORDER BY digest').iterate())h.update(JSON.stringify(r));return h.digest('hex');}finally{db.close();}}
const baselineHash=dbHash(sourcePath),userBefore=dbHash(userPath),directory=await mkdtemp(resolve('.local/tests/current-accepted-timing-'));
const source=new DatabaseSync(sourcePath,{readOnly:true});let baseline,sessionId;
try{const row=source.prepare('SELECT id,state FROM sessions').all().find(r=>JSON.parse(r.state).id==='ce1cbbfb-e59a-46ca-8227-c45f278a03fa');assert(row);sessionId=row.id;baseline=JSON.parse(row.state);assert(baseline.surfaceRun.accepted&&baseline.pieces.length===175);await backup(source,resolve(directory,'workspace.sqlite'));}finally{source.close();}
let priority='below-normal';try{setPriority(0,constants.priority.PRIORITY_BELOW_NORMAL);}catch(error){priority=String(error);}
const env={...process.env,FPCAD_DATA_DIR:directory,FPCAD_PROFILE:'1'};delete env.ELECTRON_RUN_AS_NODE;
let app,page,cdp;const rows=[],errors=[],mainLog=[];const report={passed:false,directory,sourcePath,hidden:true,noUnwrap:true,priority,userBefore,baselineHash,rows,errors};
const save=()=>writeFile(resolve(output,'report.json'),JSON.stringify(report,null,2));
function installUiTrace(){
 const trace=window.__acceptedTiming={origin:performance.timeOrigin,createdAt:performance.now(),longtasks:[],gaps:[],states:[]};let last=performance.now(),previous='';
 try{new PerformanceObserver(list=>{for(const e of list.getEntries())trace.longtasks.push({at:e.startTime,ms:e.duration});}).observe({type:'longtask',buffered:true});}catch{}
 setInterval(()=>{const now=performance.now(),gap=now-last;last=now;if(gap>300)trace.gaps.push({at:now,ms:gap});const state=JSON.stringify({busy:!!document.querySelector('.task-activity:not(.complete)'),task:document.querySelector('.task-activity')?.textContent,footer:document.querySelector('.app-shell>footer')?.textContent,title:document.querySelector('.project-title')?.textContent,ready:!!document.querySelector('.workflow-nav'),seams:document.querySelectorAll('.surface-cut-lines > g[opacity="0.5"] > line').length});if(state!==previous){trace.states.push({at:now,state:JSON.parse(state)});previous=state;}},100);
}
const compact=async()=>page.evaluate(async()=>{const t=performance.now(),r=await window.fpcad.read(),done=performance.now();if(!r.ok)throw Error(r.error.code);const p=r.data.project;return{apiMs:done-t,revision:p.revision,accepted:p.surfaceRun?.accepted,pieces:p.pieces.length,library:p.cuttingLibrary?.length??0,markings:p.markings.map(m=>({id:m.id,fragments:m.fragments.length,paths:m.paths.length})),surfaceFaces:p.surface.faces.length};});
async function metric(){if(!page||page.isClosed())return;const [renderer,main]=await Promise.all([cdp.send('Performance.getMetrics'),app.evaluate(()=>({cpu:process.cpuUsage(),memory:process.memoryUsage()}))]);return{renderer:Object.fromEntries(renderer.metrics.filter(m=>['TaskDuration','ScriptDuration','LayoutDuration','RecalcStyleDuration','JSHeapUsedSize','Nodes'].includes(m.name)).map(m=>[m.name,m.value])),main};}
async function timed(name,operation){const row={name,startedAt:new Date().toISOString()};rows.push(row);report.stage=name;await save();console.log('START '+name);row.before=await metric();const start=performance.now();try{const result=await operation();row.ms=performance.now()-start;row.result=result;return result;}catch(error){row.ms=performance.now()-start;row.error=String(error);throw error;}finally{row.after=await metric();await save();console.log('END '+name+' '+row.ms.toFixed(1)+'ms');}}
async function visibleIdle(){await page.waitForFunction(()=>!!document.querySelector('.workflow-nav')&&!document.querySelector('.task-activity:not(.complete)'),undefined,{timeout:180000});}
async function tab(stage){await page.locator('.workflow-nav>button[data-stage="'+stage+'"]').click();await visibleIdle();if(stage==='mapping')await page.locator('.surface-cut-lines > g[opacity="0.5"] > line').first().waitFor({timeout:120000});if(stage==='cutting')await page.locator('.run-report > strong').waitFor();return page.evaluate(()=>({title:document.querySelector('.project-title')?.textContent,seams:document.querySelectorAll('.surface-cut-lines > g[opacity="0.5"] > line').length}));}
async function choose(){const picker=page.locator('.project-picker');if(await picker.isVisible())await page.locator('.project-card[data-session-id="'+sessionId+'"]').click();await visibleIdle();}
async function revision(expected){await page.waitForFunction(expected=>document.querySelector('.project-title span')?.textContent==='/ R'+expected,expected,{timeout:180000});await visibleIdle();}
try{
 const launchAt=performance.now();app=await electron.launch({args:desktopArgs,executablePath,env});page=await app.firstWindow();report.launchToWindowMs=performance.now()-launchAt;app.process().stdout?.on('data',b=>mainLog.push({at:new Date().toISOString(),stream:'stdout',text:String(b)}));app.process().stderr?.on('data',b=>mainLog.push({at:new Date().toISOString(),stream:'stderr',text:String(b)}));page.on('pageerror',e=>errors.push(e.message));page.setDefaultTimeout(180000);await hiddenWindowId(app,page);await page.setViewportSize({width:1920,height:1080});cdp=await page.context().newCDPSession(page);await cdp.send('Performance.enable');await page.addInitScript(installUiTrace);await page.evaluate(installUiTrace);
 await timed('startup-to-project-picker',async()=>{await page.locator('.project-picker,.workflow-nav').first().waitFor();return page.evaluate(()=>({body:document.body.innerText.slice(-1000),task:document.querySelector('.task-activity')?.textContent}));});
 await timed('open-existing-accepted-project',choose);
 await timed('tab-mapping-and-accepted-seams',()=>tab('mapping'));
 const initial=await timed('read-compact-renderer',compact);assert(initial.accepted&&initial.pieces===175&&initial.revision===baseline.revision);
 await timed('transport-read-and-JSON-parse',()=>page.evaluate(async()=>{const t=performance.now(),raw=await window.fpcadTransport.read(),received=performance.now();const parsed=JSON.parse(raw),end=performance.now();return{transportMs:received-t,jsonParseMs:end-received,rawCharacters:raw.length,ok:parsed.ok,revision:parsed.data.project.revision};}));
 let full;await timed('read-project-returned-over-CDP',async()=>{full=await page.evaluate(async()=>{const t=performance.now(),r=await window.fpcad.read();window.__lastAcceptedApiMs=performance.now()-t;if(!r.ok)throw Error(r.error.code);return r.data.project;});return{rendererApiMs:await page.evaluate(()=>window.__lastAcceptedApiMs),revision:full.revision,pieces:full.pieces.length};});
 await timed('test-project-JSON-serialization-only',async()=>{const text=JSON.stringify(full);return{characters:text.length,sha256:createHash('sha256').update(text).digest('hex')};});full=undefined;
 await timed('tab-cutting',()=>tab('cutting'));
 await timed('undo-accepted-result-no-compute',async()=>{await page.locator('.project-toolbar').getByRole('button',{name:/撤销/}).click();await revision(initial.revision+1);return page.locator('.run-report > strong').innerText();});
 const candidate=await timed('read-candidate-compact-renderer',compact);assert(!candidate.accepted&&candidate.pieces===0);
 const review=page.locator('.run-report .distortion-review input');if(await review.count())await review.check();
 await timed('reaccept-existing-candidate-UI',async()=>{await page.getByRole('button',{name:'确认版型并保存到裁切库（可撤销）',exact:true}).click();await revision(candidate.revision+1);return page.locator('.run-report > strong').innerText();});
 const accepted=await timed('read-reaccepted-compact-renderer',compact);assert(accepted.accepted&&accepted.pieces===175&&accepted.library===initial.library);assert.deepEqual(accepted.markings,initial.markings);
 await timed('tab-mapping-after-reaccept',()=>tab('mapping'));
 await timed('hidden-native-screenshot',async()=>{await desktopScreenshot(app,page,{path:resolve(output,'accepted-timed.png')});return{image:'accepted-timed.png'};});
 report.beforeReloadUi=await page.evaluate(()=>window.__acceptedTiming);
 await timed('reload-to-project-picker',async()=>{await page.reload({waitUntil:'domcontentloaded'});await page.locator('.project-picker,.workflow-nav').first().waitFor();});
 await timed('open-project-after-reload',choose);
 await timed('mapping-seams-after-reload',()=>tab('mapping'));
 const restored=await timed('read-reloaded-compact-renderer',compact);assert.deepEqual(restored.markings,initial.markings);assert.equal(restored.revision,accepted.revision);assert(restored.accepted&&restored.pieces===175);report.afterReloadUi=await page.evaluate(()=>window.__acceptedTiming);assert.deepEqual(errors,[]);report.passed=true;
}catch(error){report.error=String(error);if(page&&!page.isClosed()){report.failureUi=await page.evaluate(()=>window.__acceptedTiming).catch(()=>null);await desktopScreenshot(app,page,{path:resolve(output,'failure.png')}).catch(()=>{});}throw error;}
finally{if(app)await app.close();report.windowsClosed=true;report.userAfter=dbHash(userPath);report.userUnchanged=report.userAfter===userBefore;report.baselineAfter=dbHash(sourcePath);report.baselineUnchanged=report.baselineAfter===baselineHash;await writeFile(resolve(output,'main-process-log.json'),JSON.stringify(mainLog,null,2));await save();assert(report.userUnchanged&&report.baselineUnchanged);}
console.log(JSON.stringify({passed:report.passed,directory,stages:rows.length}));
