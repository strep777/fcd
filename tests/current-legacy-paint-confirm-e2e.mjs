import {desktop} from './tauri-desktop.mjs';
import assert from 'node:assert/strict';
import {DatabaseSync,backup} from 'node:sqlite';
import {createHash} from 'node:crypto';
import {mkdtemp,realpath,writeFile} from 'node:fs/promises';
import {resolve,sep} from 'node:path';
import {desktopArgs,executablePath} from './desktop-launch.mjs';
import {hiddenWindowId} from './desktop-window.mjs';
import {desktopScreenshot} from './desktop-screenshot.mjs';
import {workflow} from './ui-navigation.mjs';
import {waitForState} from './wait-state.mjs';
import {focusLegacyPaintCamera} from './legacy-paint-camera.mjs';
const root=await realpath(resolve('.local/tests')),sourceDirectory=await realpath(resolve(process.env.FPCAD_INSPECT_DATA_DIR??'.'));
assert(sourceDirectory.startsWith(root+sep),'Read only an isolated accepted baseline');
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
function databaseHash(path){const db=new DatabaseSync(path,{readOnly:true}),h=createHash('sha256');try{for(const row of db.prepare('SELECT id,state FROM sessions ORDER BY id').iterate())h.update(JSON.stringify(row));for(const row of db.prepare('SELECT digest,json FROM resources ORDER BY digest').iterate())h.update(JSON.stringify(row));return h.digest('hex');}finally{db.close();}}
const baselinePath=resolve(sourceDirectory,'workspace.sqlite'),baselineBefore=databaseHash(baselinePath),directory=await mkdtemp(resolve('.local/tests/legacy-paint-confirm-')),source=new DatabaseSync(baselinePath,{readOnly:true});try{await backup(source,resolve(directory,'workspace.sqlite'));}finally{source.close();}
const env={...process.env,FPCAD_DATA_DIR:directory};
const app=await desktop.launch({args:desktopArgs,executablePath,env}),page=await app.firstWindow(),errors=[];page.setDefaultTimeout(60000);page.on('pageerror',e=>errors.push(e.message));
const read=async()=>{const r=await page.evaluate(()=>window.fpcad.read());assert(r.ok,JSON.stringify(r));return r.data;};
const stableProject=p=>({...p,revision:0,updatedAt:''});let report={passed:false,directory,sourceDirectory,baselineBefore,hidden:true};
try{
 await hiddenWindowId(app,page);await page.setViewportSize({width:1920,height:1080});await workflow(page,'mapping');
 const before=await read(),p=before.project;assert.equal(p.pieces.length,168);assert(p.surfaceRun.accepted);const marking=p.markings.find(m=>m.source==='cut-library'&&m.surfaceShape?.nodes.length===147&&!m.surfaceShape.curves?.length);assert(marking);assert(p.cuttingLibrary.length>0);
 await page.locator('#mapping-surface-controls').getByLabel('Select attached marking',{exact:true}).selectOption(marking.id);
 await page.locator('.surface-tool-rail').getByRole('button',{name:'编辑已贴附花纹节点',exact:true}).click();const label=page.locator('#mapping-surface-controls .surface-drawing > span');await label.waitFor();assert.equal(await label.innerText(),'18 点');assert(await page.getByLabel('Surface drawing mode',{exact:true}).isDisabled());assert.equal(await page.locator('.surface-view .curve-handles circle').count(),18);
 const focusedView=await focusLegacyPaintCamera(page);await desktopScreenshot(app,page,{path:'test-results/current-cutting/real-current-legacy-paint-focused-3200.png'});
 await page.locator('.surface-tool-rail').getByRole('button',{name:'取消三维绘制',exact:true}).click();const cancelled=await read();assert.equal(hash(cancelled.project),hash(p));assert.equal(hash(cancelled.geometry),hash(before.geometry));
 await page.locator('.surface-tool-rail').getByRole('button',{name:'编辑已贴附花纹节点',exact:true}).click();await label.waitFor();assert.equal(await label.innerText(),'18 点');
 await page.getByRole('button',{name:'确认花纹编辑',exact:true}).click();await waitForState(page,async revision=>{const r=await window.fpcad.read();return r.ok&&r.data.project.revision===revision;},p.revision+1);
 const saved=await read(),edited=saved.project.markings.find(m=>m.id===marking.id);assert.equal(edited.surfaceShape.nodes.length,18);assert.equal(edited.surfaceShape.curves.length,18);assert.equal(saved.project.revision,p.revision+1);assert.deepEqual(saved.project.cuttingLibrary,p.cuttingLibrary,'Editing current paint must preserve every archived snapshot');assert(edited.fragments.length>0&&edited.paths.length>0);assert.equal(await page.locator('.error-banner').count(),0);await desktopScreenshot(app,page,{path:'test-results/current-cutting/real-current-legacy-paint-confirmed.png'});
 await page.locator('.project-toolbar').getByRole('button',{name:/撤销/}).click();await waitForState(page,async revision=>{const r=await window.fpcad.read();return r.ok&&r.data.project.revision>revision&&r.data.project.markings[0]?.surfaceShape?.nodes.length===147;},saved.project.revision);
 const undone=await read();assert(Date.parse(saved.project.updatedAt)>Date.parse(p.updatedAt));assert(Date.parse(undone.project.updatedAt)>Date.parse(saved.project.updatedAt),'Undo updates the modification timestamp');assert.equal(hash(stableProject(undone.project)),hash(stableProject(p)),'Undo must restore the exact accepted business project, excluding revision and modification timestamp');assert.equal(hash(undone.geometry),hash(before.geometry));assert(undone.project.surfaceRun.accepted);assert.deepEqual(undone.project.cuttingLibrary,p.cuttingLibrary);assert.deepEqual(errors,[]);
 const baselineAfter=databaseHash(baselinePath);assert.equal(baselineAfter,baselineBefore);report={...report,passed:true,baselineAfter,baselineUnchanged:true,markingId:marking.id,beforeNodes:147,savedNodes:18,savedCurves:18,savedPaths:edited.paths.length,savedFragments:edited.fragments.length,focusedView,cancelledProjectHash:hash(cancelled.project),beforeProjectHash:hash(p),revisions:{before:p.revision,confirmed:saved.project.revision,undone:undone.project.revision},updatedAt:{before:p.updatedAt,confirmed:saved.project.updatedAt,undone:undone.project.updatedAt},archiveUnchanged:true,undoBusinessProjectExcludingRevisionAndUpdatedAt:{before:hash(stableProject(p)),after:hash(stableProject(undone.project))},geometry:{before:hash(before.geometry),after:hash(undone.geometry)},errors};
}catch(error){report.error=String(error);await desktopScreenshot(app,page,{path:'test-results/current-cutting/real-current-legacy-paint-confirm-failure.png'}).catch(()=>{});throw error;}finally{await app.close();report.windowsClosed=true;await writeFile('test-results/current-cutting/real-current-legacy-paint-confirm.json',JSON.stringify(report,null,2));}
console.log(JSON.stringify({passed:report.passed,directory,checks:3}));
