import {_electron as electron} from 'playwright';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {desktopArgs,executablePath,testedBuild} from './desktop-launch.mjs';
import {workflow,chooseProject} from './ui-navigation.mjs';
import {waitForState} from './wait-state.mjs';
const directory=await mkdtemp(resolve('.local/tests/reference-repeat-')),env={...process.env,FPCAD_DATA_DIR:directory};delete env.ELECTRON_RUN_AS_NODE;
const app=await electron.launch({args:desktopArgs,executablePath,env}),page=await app.firstWindow(),report={testedBuild,directory,checks:[],passed:false};
try{
 await page.waitForFunction(()=>!!window.fpcad);
 assert((await page.evaluate(()=>window.fpcad.create({name:'重复双视图上传回归',unit:'mm'}))).ok);
 await page.reload();await chooseProject(page);await workflow(page,'references');
 const read=async()=>{const r=await page.evaluate(()=>window.fpcad.read());assert(r.ok,JSON.stringify(r));return r.data.project;};
 for(let n=0;n<3;n++){
  const alternate=n===1;await app.evaluate(({dialog},file)=>dialog.showOpenDialog=async()=>({canceled:false,filePaths:[file]}),resolve(alternate?'tests/fixtures/character-blue-white-front-back.png':'tests/fixtures/character-front-back.jpg'));
  const before=await read();await page.getByLabel('双视图布局',{exact:true}).selectOption(alternate?'front-left':'front-right');await page.getByRole('button',{name:'上传双视图并自动拆分',exact:true}).click();
  await waitForState(page,async revision=>{const failure=document.querySelector('.error-banner')?.textContent?.trim();if(failure)throw Error(failure);const r=await window.fpcad.read();return r.ok&&r.data.project.revision===revision+1;},before.revision,{timeout:120000});const after=await read();assert.equal(after.revision,before.revision+1);assert(after.patternLibrary.length>10);assert.equal(after.references.length,2);assert(after.patternLibrary.every(p=>after.references.some(r=>r.id===p.referenceId)));assert(after.references.every(r=>r.calibration.distanceMm===1800));report.checks.push({upload:n+1,alternate,revision:after.revision,regions:after.patternLibrary.length,references:after.references.map(r=>({view:r.view,width:r.width,height:r.height}))});
  if(alternate){const undo=await page.evaluate(async()=>{const p=(await window.fpcad.read()).data.project;return window.fpcad.undo(p.id,p.revision);});assert(undo.ok,JSON.stringify(undo));assert.deepEqual((await read()).references,before.references);assert.deepEqual((await read()).patternLibrary,before.patternLibrary);const redo=await page.evaluate(async()=>{const p=(await window.fpcad.read()).data.project;return window.fpcad.redo(p.id,p.revision);});assert(redo.ok,JSON.stringify(redo));assert.deepEqual((await read()).references,after.references);assert.deepEqual((await read()).patternLibrary,after.patternLibrary);report.checks.push({name:'One undo/redo restores the complete previous/current dual-view source set'});await page.reload();await chooseProject(page);await workflow(page,'references');}
 }
 const before=await read(),r=await page.evaluate(async()=>{const p=(await window.fpcad.read()).data.project;return window.fpcad.splitAllReferences(p.id,p.revision,1800,6,true,'simple','character');});assert(r.ok,JSON.stringify(r));assert.equal((await read()).revision,before.revision+1);
 assert.equal(await page.getByRole('button',{name:'交换正面 / 背面并重新拆分',exact:true}).count(),0);assert.equal(await page.getByRole('button',{name:'按当前标定重新拆分',exact:true}).count(),1);
 assert(await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().every(w=>!w.isVisible())));report.passed=true;console.log(JSON.stringify(report));
}catch(e){report.error=String(e);throw e;}finally{await writeFile('test-results/reference-repeat.json',JSON.stringify(report,null,2));await app.close();}
