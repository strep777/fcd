// Resume the actual accepted round4 archive without another cut or acceptance.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdir,mkdtemp,readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {constants,setPriority,getPriority} from 'node:os';
import {desktop} from './tauri-desktop.mjs';
import {desktopArgs,executablePath} from './desktop-launch.mjs';
import {chooseProject,workflow} from './ui-navigation.mjs';
import {desktopScreenshot} from './desktop-screenshot.mjs';

const source=resolve(process.env.FPCAD_JPEG_RESUME_INPUT??'test-results/reported-functional-acceptance/jpeg-padded-chain-round4');
const output=resolve(process.env.FPCAD_JPEG_RESUME_RESULTS??'test-results/reported-functional-acceptance/jpeg-padded-chain-round4-resume');
await mkdir(output,{recursive:true});
const directory=process.env.FPCAD_JPEG_RESUME_DATA_DIR?resolve(process.env.FPCAD_JPEG_RESUME_DATA_DIR):await mkdtemp(resolve('.local/tests/jpeg-padded-resume-'));
assert(directory.startsWith(resolve('.local/tests')+'\\'),'Resume only an isolated test library');
const digest=value=>createHash('sha256').update(value).digest('hex');
const expected=JSON.parse(await readFile(resolve(source,'accepted-project.json'),'utf8'));
const keys=['pieces','surface','markings','cuttingLibrary','activeCutId','patternLibrary','references'];
const expectedHashes=Object.fromEntries(keys.map(k=>[k,digest(JSON.stringify(expected[k]))]));
const hostPath=resolve(executablePath??'apps/desktop/src-tauri/target/debug/FurryPatternCAD.exe');
const report={passed:false,started:new Date().toISOString(),source,directory,steps:[],pageErrors:[],processes:[],qualityIssues:[{kind:'colored-piece-count',actual:expected.pieces.length,required:[10,50]}],scope:'Existing built native host and actual round4 archive only; newer JPEG source repairs are not part of this binary.'};
let app,page;
const launchOptions={args:desktopArgs,executablePath,env:{...process.env,FPCAD_DATA_DIR:directory}};
async function record(){await writeFile(resolve(output,'report.json'),JSON.stringify(report,null,2));}
async function launch(){
  app=await desktop.launch(launchOptions);page=await app.firstWindow();page.setDefaultTimeout(120000);
  const pid=app.process().pid;setPriority(pid,constants.priority.PRIORITY_LOW);
  report.processes.push({pid,priority:getPriority(pid),closed:false});
  page.on('pageerror',e=>report.pageErrors.push(e.message));
  await page.setViewportSize({width:1440,height:1000});
  assert(await app.evaluate(({DesktopWindow})=>DesktopWindow.getAllWindows().every(w=>!w.isVisible())));
  return pid;
}
async function close(){if(app){await app.close();report.processes.at(-1).closed=app.process().exitCode!==null||app.process().signalCode!==null;app=undefined;}}
async function step(name,callback){console.log('START '+name);try{const evidence=await callback();report.steps.push({name,passed:true,evidence});console.log('PASS '+name);}catch(error){report.steps.push({name,passed:false,error:String(error.stack??error)});await desktopScreenshot(app,page,{path:resolve(output,name+'-failure.png')}).catch(()=>{});throw error;}finally{await record();}}
async function hashes(all=false){return page.evaluate(async({keys,all})=>{
  const r=await window.fpcad.read();if(!r.ok)throw Error(JSON.stringify(r));const p=r.data.project;
  const sha=async s=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(s))),b=>b.toString(16).padStart(2,'0')).join('');
  const fields={};for(const key of keys)fields[key]=await sha(JSON.stringify(p[key]));
  return {fields,...(all?{complete:await sha(JSON.stringify(p))}:{}),pieces:p.pieces.length,archives:p.cuttingLibrary.length,revision:p.revision};
},{keys,all});}
try{
  report.hostSha256=digest(await readFile(hostPath));assert.equal(report.hostSha256,'b0987259be6199103789833ce202d1d17226de14bd07101bff6910463012feb6');
  report.archive={path:resolve(source,'real-jpeg-padded.fpcad'),sha256:digest(await readFile(resolve(source,'real-jpeg-padded.fpcad')))};
  const firstPid=await launch();
  if(process.env.FPCAD_JPEG_RESUME_PREVIEW_ONLY==='1'){
    report.scope+=' Preview-only continuation of the existing isolated test library; previous archive/export/restart results remain in their original report.';
    await chooseProject(page);
    await step('existing-test-library-data',async()=>{const actual=await hashes();assert.deepEqual(actual.fields,expectedHashes);return actual;});
    await step('restarted-paper-and-assembly-previews',async()=>{
      await workflow(page,'pattern');await page.locator('svg.canvas').first().waitFor();const pieces=await page.locator('svg.canvas g[data-piece-id]').count();assert(pieces>0);await desktopScreenshot(app,page,{path:resolve(output,'restarted-paper.png')});
      await workflow(page,'assembly');await page.waitForFunction(()=>Number(document.querySelector('.assembly-page canvas')?.dataset.triangles)>0);const coverage=await page.locator('.assembly-page .assembly-coverage').innerText();assert(coverage.includes('100.0%'));await desktopScreenshot(app,page,{path:resolve(output,'restarted-assembly.png')});return {renderedPieces:pieces,coverage};
    });
  }else{
  await step('open-existing-real-archive',async()=>{
    await app.evaluate(({dialog},path)=>dialog.showOpenDialog=async()=>({canceled:false,filePaths:[path]}),report.archive.path);
    const r=await page.evaluate(async()=>{const r=await window.fpcad.open();return {ok:r.ok,error:r.error};});assert(r.ok,JSON.stringify(r));
    const actual=await hashes();assert.deepEqual(actual.fields,expectedHashes);assert.equal(actual.pieces,120);assert.equal(actual.archives,1);return actual;
  });
  await page.reload();await chooseProject(page);
  await step('native-svg-export',async()=>{
    const path=resolve(output,'resumed-real-jpeg-padded.svg');await app.evaluate(({dialog},path)=>dialog.showSaveDialog=async()=>({canceled:false,filePath:path}),path);
    const r=await page.evaluate(async()=>{const s=await window.fpcad.read(),p=s.data.project;const r=await window.fpcad.export(p.id,p.revision,'svg',s.data.geometry.flatMap(g=>g.issues.filter(i=>i.severity==='warning').map(i=>i.ruleId)));return {ok:r.ok,error:r.error};});assert(r.ok,JSON.stringify(r));
    const svg=await readFile(path,'utf8');assert(svg.includes('mm')&&svg.includes('M10 12 H110'));return {path,bytes:Buffer.byteLength(svg),sha256:digest(svg)};
  });
  await step('accepted-assembly-preview',async()=>{
    await workflow(page,'assembly');await page.waitForFunction(()=>Number(document.querySelector('.assembly-page canvas')?.dataset.triangles)>0,undefined,{timeout:180000});
    const coverage=await page.locator('.assembly-page .assembly-coverage').innerText();assert(coverage.includes('100.0%'));await desktopScreenshot(app,page,{path:resolve(output,'assembly.png')});return {coverage,triangles:await page.locator('.assembly-page canvas').getAttribute('data-triangles')};
  });
  const before=await hashes(true);await close();
  const secondPid=await launch();assert.notEqual(secondPid,firstPid);await chooseProject(page);
  await step('real-native-process-restart',async()=>{const after=await hashes(true);assert.deepEqual(after,before);assert.equal(digest(await readFile(hostPath)),report.hostSha256);return {firstPid,secondPid,...after};});
  await step('restarted-paper-and-assembly-previews',async()=>{
    await workflow(page,'pattern');await page.locator('svg.canvas').first().waitFor();const pieces=await page.locator('svg.canvas g[data-piece-id]').count();assert(pieces>0);await desktopScreenshot(app,page,{path:resolve(output,'restarted-paper.png')});
    await workflow(page,'assembly');await page.waitForFunction(()=>Number(document.querySelector('.assembly-page canvas')?.dataset.triangles)>0);const coverage=await page.locator('.assembly-page .assembly-coverage').innerText();assert(coverage.includes('100.0%'));await desktopScreenshot(app,page,{path:resolve(output,'restarted-assembly.png')});return {renderedPieces:pieces,coverage};
  });
  }
  assert.deepEqual(report.pageErrors,[]);report.functionalPassed=true;report.qualityPassed=report.qualityIssues.length===0;report.passed=report.functionalPassed&&report.qualityPassed;
}catch(error){report.error=String(error.stack??error);process.exitCode=1;console.error(report.error);}
finally{await close();report.finished=new Date().toISOString();await record();}
