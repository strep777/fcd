// Continue the fresh, reviewed whole-sheet project in its actual isolated
// library. Compute through the visible workflow control; never import a run.
import assert from 'node:assert/strict';
import {mkdir,readFile,writeFile,appendFile} from 'node:fs/promises';
import {resolve,sep} from 'node:path';
import {createHash} from 'node:crypto';
import {constants,setPriority,getPriority} from 'node:os';
import {desktop} from './tauri-desktop.mjs';
import {desktopArgs,executablePath} from './desktop-launch.mjs';
import {chooseProject,workflow} from './ui-navigation.mjs';
import {desktopScreenshot} from './desktop-screenshot.mjs';
import {observeNativeResponses} from './native-response-observer.mjs';
import {assertDesignCutContract} from './cut-result-contract.mjs';

assert(process.env.FPCAD_REFERENCE_SHEET_SOURCE,'Explicit fresh desktop evidence required');
const source=resolve(process.env.FPCAD_REFERENCE_SHEET_SOURCE),output=resolve(source,'native-cut');
const original=JSON.parse(await readFile(resolve(source,'report.json'),'utf8'));
assert(original.passed&&!original.resume,'Original whole-sheet desktop run must pass');
const directory=original.directory;assert(directory.startsWith(resolve('.local/tests')+sep));
const inputBytes=await readFile(resolve(source,'colored-cut-input.json')),input=JSON.parse(inputBytes);
assert(!input.surfaceRun&&input.markings.every(m=>m.placement?.reviewed));
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const points=input.markings.reduce((n,m)=>n+m.fragments.reduce((a,f)=>a+f.rings.reduce((b,r)=>b+r.length,0),0),0);
const report={passed:false,source,directory,started:new Date().toISOString(),inputSha256:sha(inputBytes),points,faces:input.surface.faces.length,nativeDeadlineMs:Math.min(900000,Math.max(60000,points*20,input.surface.faces.length*40)),pageErrors:[]};
report.build={};for(const file of ['target/release/fpcad-worker.exe','dist/bin/fpcad-worker.exe','dist/main/main.cjs','dist/main/surface-worker.cjs'])report.build[file]=sha(await readFile(resolve(file)));
await mkdir(output,{recursive:true});
let app,page,observer;
async function read(){return JSON.parse(await page.evaluate(async()=>{const r=await window.fpcad.read();if(!r.ok)throw Error(JSON.stringify(r));return JSON.stringify(r.data.project);}));}
try{
 app=await desktop.launch({args:desktopArgs,executablePath,env:{...process.env,FPCAD_DATA_DIR:directory}});page=await app.firstWindow();page.setDefaultTimeout(120000);
 setPriority(app.process().pid,constants.priority.PRIORITY_LOW);report.pid=app.process().pid;report.priority=getPriority(report.pid);
 assert(await app.evaluate(({DesktopWindow})=>DesktopWindow.getAllWindows().every(w=>!w.isVisible())));
 page.on('pageerror',e=>report.pageErrors.push(e.message));await chooseProject(page);assert.deepEqual(await read(),input,'Compute the unchanged fresh input');
 await workflow(page,'cutting');assert(await page.getByLabel('按花纹颜色拆分裁片',{exact:true}).isChecked());
 observer=await observeNativeResponses(page,directory,['surface.unwrap']);
 page.on('console',message=>{const text=message.text();if(text.startsWith('SHEET_CUT ')){console.log(text);appendFile(resolve(output,'progress.ndjson'),text.slice(10)+'\n').catch(()=>{});}});
 await page.evaluate(()=>{const start=performance.now();window.__sheetProgress=window.fpcad.onSurfaceProgress(p=>console.log('SHEET_CUT '+JSON.stringify({...p,elapsedMs:performance.now()-start})));});
 await writeFile(resolve(output,'report.json'),JSON.stringify(report,null,2));
 await page.getByRole('button',{name:'自动计算裁线并预览',exact:true}).click();
 // Observation permits response serialization after the unchanged production
 // deadline. It cannot extend, retry or replace the native calculation.
 await page.waitForFunction(()=>!!document.querySelector('.run-report > strong')||!!document.querySelector('.error-banner'),undefined,{timeout:920000});
 await page.evaluate(()=>window.__sheetProgress?.());
 const result=await read();await writeFile(resolve(output,'candidate-project.json'),JSON.stringify(result));
 const reply=await observer.waitFor('surface.unwrap',0,30000);report.requestTiming=reply.requestTiming;
 await writeFile(resolve(output,'native-response.json'),JSON.stringify(reply));
 report.banners=await page.locator('.error-banner').allTextContents();report.failureStateUnchanged=!result.surfaceRun?JSON.stringify(result)===JSON.stringify(input):null;
 assert(reply.result.ok,JSON.stringify(reply.result));assert.deepEqual(report.banners,[]);assert(result.surfaceRun&&!result.surfaceRun.accepted);
 for(const key of ['surface','references','patternLibrary'])assert.deepEqual(result[key],input[key]);
 report.physical=assertDesignCutContract(result);report.pieces=result.surfaceRun.pieces.length;
 assert(report.pieces>=10&&report.pieces<=50,'Expected economical whole-garment piece count');
 assert.deepEqual(report.pageErrors,[]);await desktopScreenshot(app,page,{path:resolve(output,'candidate.png')});report.passed=true;
}catch(error){report.error=String(error.stack??error);process.exitCode=1;console.error(report.error);}
finally{if(observer)await observer.stop();if(app){await app.close();report.closed=app.process().exitCode!==null||app.process().signalCode!==null;}report.finished=new Date().toISOString();await writeFile(resolve(output,'report.json'),JSON.stringify(report,null,2));}
