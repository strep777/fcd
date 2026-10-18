// CPU sampling of real undo/reaccept. Uses an isolated accepted database, no unwrap.
import {_electron as electron} from 'playwright';
import assert from 'node:assert/strict';
import {DatabaseSync,backup} from 'node:sqlite';
import {createHash} from 'node:crypto';
import {mkdir,mkdtemp,readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {setPriority,constants} from 'node:os';
import {desktopArgs,executablePath} from './desktop-launch.mjs';
import {hiddenWindowId} from './desktop-window.mjs';

const output=resolve(process.env.FPCAD_ACCEPTED_PROFILE_OUTPUT??'test-results/current-cutting/consolidated/accepted-cpu-profile');await mkdir(output,{recursive:true});
const sourceReport=JSON.parse(await readFile(resolve('test-results/current-cutting/consolidated/independent-current-seams/report.json'),'utf8'));
const sourcePath=resolve(sourceReport.directory,'workspace.sqlite'),userPath=resolve('.local/workspace/workspace.sqlite');
function dbHash(path){const db=new DatabaseSync(path,{readOnly:true}),h=createHash('sha256');try{for(const r of db.prepare('SELECT id,state FROM sessions ORDER BY id').iterate())h.update(JSON.stringify(r));for(const r of db.prepare('SELECT digest,json FROM resources ORDER BY digest').iterate())h.update(JSON.stringify(r));return h.digest('hex');}finally{db.close();}}
const userBefore=dbHash(userPath),baselineHash=dbHash(sourcePath),directory=await mkdtemp(resolve('.local/tests/current-accepted-profile-'));
const source=new DatabaseSync(sourcePath,{readOnly:true});let sessionId,initialRevision;
try{const row=source.prepare('SELECT id,state FROM sessions').all().find(r=>JSON.parse(r.state).id==='ce1cbbfb-e59a-46ca-8227-c45f278a03fa');assert(row);sessionId=row.id;const p=JSON.parse(row.state);initialRevision=p.revision;assert(p.surfaceRun.accepted&&p.pieces.length===175);await backup(source,resolve(directory,'workspace.sqlite'));}finally{source.close();}
let priority='below-normal';try{setPriority(0,constants.priority.PRIORITY_BELOW_NORMAL);}catch(error){priority=String(error);}
const report={passed:false,directory,hidden:true,noUnwrap:true,priority,args:desktopArgs,ordinaryGpuFlags:process.env.FPCAD_TEST_GPU==='1',userBefore,baselineHash,phases:[],errors:[]},mainLog=[];
const save=()=>writeFile(resolve(output,'report.json'),JSON.stringify(report,null,2));
let app,page,cdp,profiling=false,tracing=false;
async function startProfile(name){
 await page.evaluate(name=>{window.__profileUi={name,longtasks:[],states:[],clicks:[],gaps:[],start:performance.now()};let previous='',last=performance.now();window.__profileObserver?.disconnect();clearInterval(window.__profileTimer);window.__profileObserver=new PerformanceObserver(list=>{for(const e of list.getEntries())window.__profileUi.longtasks.push({at:e.startTime,ms:e.duration});});window.__profileObserver.observe({type:'longtask'});window.__profileTimer=setInterval(()=>{const at=performance.now(),delta=at-last;last=at;if(delta>300)window.__profileUi.gaps.push({at,ms:delta});const state=JSON.stringify({busy:!!document.querySelector('.task-activity:not(.complete)'),text:document.querySelector('.task-activity')?.textContent,title:document.querySelector('.project-title')?.textContent});if(state!==previous){window.__profileUi.states.push({at,state:JSON.parse(state)});previous=state;}},100);if(!window.__profileClickListener){window.__profileClickListener=e=>{const b=e.target.closest?.('button');if(b&&window.__profileUi)window.__profileUi.clicks.push({at:performance.now(),text:b.textContent});};document.addEventListener('click',window.__profileClickListener,true);}},name);
 await app.evaluate(async()=>{const inspector=process.getBuiltinModule?process.getBuiltinModule('inspector'):process.mainModule.require('node:inspector');const session=new inspector.Session();session.connect();globalThis.__acceptedCpuProfiler=session;const post=(m,p={})=>new Promise((ok,fail)=>session.post(m,p,(e,r)=>e?fail(e):ok(r)));await post('Profiler.enable');await post('Profiler.setSamplingInterval',{interval:1000});await post('Profiler.start');});
 await cdp.send('Profiler.enable');await cdp.send('Profiler.setSamplingInterval',{interval:1000});await cdp.send('Profiler.start');profiling=true;
 if(process.env.FPCAD_CAPTURE_TIMELINE==='1'){assert.equal(process.env.FPCAD_TEST_GPU,'1');assert(!desktopArgs.includes('--disable-gpu'));await cdp.send('Tracing.start',{transferMode:'ReturnAsStream',streamFormat:'json',traceConfig:{recordMode:'recordContinuously',includedCategories:['devtools.timeline','disabled-by-default-devtools.timeline','disabled-by-default-devtools.timeline.stack','toplevel','v8','blink.user_timing','gpu','disabled-by-default-gpu.service']}});tracing=true;}
 return {name,startedAt:new Date().toISOString(),performanceMetrics:(await cdp.send('Performance.getMetrics')).metrics,mainBefore:await app.evaluate(()=>process.cpuUsage()),rendererAtStart:await page.evaluate(()=>performance.now())};
}
async function stopProfile(row){
 const renderer=await cdp.send('Profiler.stop');const main=await app.evaluate(async()=>{const s=globalThis.__acceptedCpuProfiler;const result=await new Promise((ok,fail)=>s.post('Profiler.stop',(e,r)=>e?fail(e):ok(r)));s.disconnect();globalThis.__acceptedCpuProfiler=undefined;return JSON.stringify(result.profile);});profiling=false;
 row.mainAfter=await app.evaluate(()=>process.cpuUsage());row.ui=await page.evaluate(()=>window.__profileUi);row.endedAt=new Date().toISOString();
 if(tracing){const completed=new Promise(ok=>cdp.once('Tracing.tracingComplete',ok));await cdp.send('Tracing.end');const event=await completed;tracing=false;assert(event.stream);const chunks=[];for(;;){const chunk=await cdp.send('IO.read',{handle:event.stream,size:1024*1024});chunks.push(chunk.base64Encoded?Buffer.from(chunk.data,'base64'):Buffer.from(chunk.data));if(chunk.eof)break;}await cdp.send('IO.close',{handle:event.stream});await writeFile(resolve(output,row.name+'-timeline.json'),Buffer.concat(chunks));row.timeline=row.name+'-timeline.json';}
 await writeFile(resolve(output,row.name+'-main.cpuprofile'),main);await writeFile(resolve(output,row.name+'-renderer.cpuprofile'),JSON.stringify(renderer.profile));report.phases.push(row);await save();
}
async function waitRevision(revision){await page.waitForFunction(revision=>document.querySelector('.project-title span')?.textContent==='/ R'+revision&&!document.querySelector('.task-activity:not(.complete)'),revision,{timeout:180000});}
try{
 const env={...process.env,FPCAD_DATA_DIR:directory,FPCAD_PROFILE:'1'};delete env.ELECTRON_RUN_AS_NODE;
 app=await electron.launch({args:desktopArgs,executablePath,env});page=await app.firstWindow();page.setDefaultTimeout(180000);page.on('pageerror',e=>report.errors.push(e.message));app.process().stdout?.on('data',b=>mainLog.push({at:new Date().toISOString(),text:String(b)}));app.process().stderr?.on('data',b=>mainLog.push({at:new Date().toISOString(),text:String(b)}));await hiddenWindowId(app,page);await page.setViewportSize({width:1920,height:1080});cdp=await page.context().newCDPSession(page);await cdp.send('Performance.enable');
 await page.locator('.project-card[data-session-id="'+sessionId+'"]').click();await page.locator('.workflow-nav>button[data-stage="cutting"]').click();await page.locator('.run-report > strong').waitFor();await page.locator('.surface-cut-lines > g[opacity="0.5"] > line').first().waitFor();
 report.gpu={features:await app.evaluate(({app})=>app.getGPUFeatureStatus()),renderers:await page.locator('.surface-gpu .surface-canvas').evaluateAll(nodes=>nodes.map(c=>{const gl=c.getContext('webgl'),extension=gl?.getExtension('WEBGL_debug_renderer_info');return{backend:c.dataset.backend,renderer:extension?gl.getParameter(extension.UNMASKED_RENDERER_WEBGL):undefined};}))};
 for(const name of ['undo','reaccept']){
  report.stage=name;await save();console.log('PROFILE '+name);
  if(name==='reaccept'){const review=page.locator('.run-report .distortion-review input');if(await review.count())await review.check();}
  const row=await startProfile(name),started=performance.now();
  if(name==='undo')await page.locator('.project-toolbar').getByRole('button',{name:/撤销/}).click();
  else await page.getByRole('button',{name:'确认版型并保存到裁切库（可撤销）',exact:true}).click();
  await waitRevision(initialRevision+(name==='undo'?1:2));row.untilUiSettledMs=performance.now()-started;
  await page.evaluate(()=>new Promise(ok=>requestAnimationFrame(()=>requestAnimationFrame(ok))));
  row.activePageAfterCommit=await page.locator('main.workspace').getAttribute('class');if(name==='reaccept')assert(row.activePageAfterCommit.includes('page-assembly'),'Confirmation intentionally navigates to assembly');
  row.samePageVisibleSegments=await page.locator('.surface-cut-lines > g[opacity="0.5"] > line').count();row.untilSeamsAndFramesMs=performance.now()-started;await stopProfile(row);console.log('PROFILED '+name+' '+row.untilSeamsAndFramesMs.toFixed(1)+'ms');
  if(name==='reaccept'){const started=performance.now();await page.locator('.workflow-nav>button[data-stage="cutting"]').click();await page.locator('.surface-cut-lines > g[opacity="0.5"] > line').first().waitFor({timeout:10000});report.returnedCuttingSeams={ms:performance.now()-started,visibleSegments:await page.locator('.surface-cut-lines > g[opacity="0.5"] > line').count()};assert(report.returnedCuttingSeams.visibleSegments>0);}

 }
 const summary=await page.evaluate(async()=>{const r=await window.fpcad.read();if(!r.ok)throw Error(r.error.code);const p=r.data.project;return{revision:p.revision,accepted:p.surfaceRun.accepted,pieces:p.pieces.length,archive:p.cuttingLibrary.length,markings:p.markings.map(m=>({id:m.id,fragments:m.fragments.length,paths:m.paths.length}))};});assert(summary.accepted&&summary.pieces===175&&summary.archive===1&&summary.markings.length===2&&summary.markings.every(m=>m.paths>0));report.final=summary;assert.deepEqual(report.errors,[]);report.passed=true;
}catch(error){report.error=String(error);throw error;}
finally{if(profiling&&app&&page)await stopProfile({name:'interrupted'}).catch(()=>{});if(app)await app.close();report.windowsClosed=true;report.userAfter=dbHash(userPath);report.userUnchanged=userBefore===report.userAfter;report.baselineAfter=dbHash(sourcePath);report.baselineUnchanged=baselineHash===report.baselineAfter;await writeFile(resolve(output,'main-process-log.json'),JSON.stringify(mainLog,null,2));await save();assert(report.userUnchanged&&report.baselineUnchanged);}
console.log(JSON.stringify({passed:report.passed,directory,profiles:report.phases.length}));
