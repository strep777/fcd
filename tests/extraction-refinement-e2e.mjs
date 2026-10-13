// Exercise actual renderer upload and re-extraction against isolated hidden
// Electron state. No user database or user source files are opened.
import {desktopScreenshot} from './desktop-screenshot.mjs';
import {fitReferenceView} from './reference-controls.mjs';
import {workflow} from './ui-navigation.mjs';
import {waitForState} from './wait-state.mjs';
import {_electron as electron} from 'playwright';
import {build} from 'esbuild';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {desktopArgs,executablePath,testedBuild} from './desktop-launch.mjs';

const directory=await mkdtemp(resolve('.local/tests/extraction-refinement-')),env={...process.env,FPCAD_DATA_DIR:directory};delete env.ELECTRON_RUN_AS_NODE;
const helper=join(directory,'geometry.mjs');await build({stdin:{contents:"export {calibratedPoint} from './apps/desktop/main/reference-segmentation'; export {pigmentFamily} from './packages/reference/illustration'; export {edgeArcPoints} from './packages/pattern/edit'; export {analyze} from './apps/desktop/main/worker';",resolveDir:process.cwd()},bundle:true,platform:'node',format:'esm',outfile:helper});
const {calibratedPoint,pigmentFamily,edgeArcPoints,analyze}=await import(pathToFileURL(helper));
const app=await electron.launch({args:desktopArgs,executablePath,env}),page=await app.firstWindow(),checks=[],errors=[];
page.on('pageerror',error=>errors.push(error.message));
const read=async()=>{const result=await page.evaluate(()=>window.fpcad.read());assert(result.ok,JSON.stringify(result));return result.data;};
const hidden=async()=>assert(await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().every(w=>!w.isVisible())),'All test windows must remain hidden');
const inside=(point,ring)=>{let yes=false;for(let i=0,j=ring.length-1;i<ring.length;j=i++){const a=ring[i],b=ring[j];if((a.yMm>point.yMm)!==(b.yMm>point.yMm)&&point.xMm<(b.xMm-a.xMm)*(point.yMm-a.yMm)/(b.yMm-a.yMm)+a.xMm)yes=!yes;}return yes;};
function inspect(project){
 const shapes=project.patternLibrary.map(region=>({region,outer:region.piece.nodes.flatMap(node=>edgeArcPoints(region.piece,node.id).slice(0,-1)),holes:region.piece.holes??[]}));
 const owner=(view,x,y,family)=>{
  const ref=project.references.find(r=>r.view===view);assert(ref?.calibration,view+' calibration');const point=calibratedPoint(x+.5,y+.5,ref.calibration);
  const found=shapes.filter(s=>s.region.view===view&&(family===undefined||pigmentFamily(s.region.piece.color)===family)&&inside(point,s.outer)&&!s.holes.some(r=>inside(point,r)));
  assert(found.length<=1,`Overlapping saved pieces at ${view} ${x},${y}`);return found[0]?.region;
 };
 const structures=[[178,55],[188,80],[218,140],[249,90],[265,125]],head=structures.map(([x,y])=>{const region=owner('front',x,y,2);assert(region,`Missing saved yellow structure ${x},${y}`);return region.piece.id;});
 assert.equal(new Set(head).size,5,'Saved horn, forehead and ear-fur pieces must be separate');const backEars=[[318,119],[418,80],[455,80]].map(([x,y])=>{const region=owner('back',x,y,2);assert(region,`Missing saved back ear pigment ${x},${y}`);return region.piece.id;});assert.equal(new Set(backEars).size,3,'Back-view yellow ear structures retain separate sources');assert.equal(owner('front',269,137,2)?.piece.id,head[4]);
 const padPoints=[[316,70],[155,72],[45,243],[70,244],[28,264],[63,272],[87,265],[37,291]],pads=padPoints.map(([x,y])=>{const region=owner('front',x,y,1);assert(region,`Missing real saved pink ear/pad ${x},${y}`);return region.piece.id;});
 assert.equal(new Set(pads).size,8,'Each visible inner-ear/pad retains its separate source');assert(owner('back',229,413,1),'Back-view pink pad must remain');
 for(const [x,y]of [[169,540],[355,564],[359,562],[311,565],[327,573]])assert(!owner('front',x,y,1),`False pink cast-shadow island at ${x},${y}`);
 for(const points of [[[541,440],[500,473],[530,415]],[[348,547],[350,556],[352,566],[331,573],[356,575]]]){
  const ids=points.map(([x,y])=>{const region=owner('front',x,y,2);assert(region,`Missing golden shadow ${x},${y}`);return region.piece.id;});assert.equal(new Set(ids).size,1,'Gradual shadow must not split the saved pigment source');
 }
 const curved=project.patternLibrary.filter(r=>r.piece.curves?.length).length;assert(curved>0&&curved<project.patternLibrary.length,'The real artwork retains measured arcs alongside unsmoothed straight contours');
 const yellow=project.patternLibrary.filter(r=>pigmentFamily(r.piece.color)===2);assert.equal(yellow.filter(r=>r.view==='front').length,13);assert.equal(yellow.filter(r=>r.view==='back').length,8);
 return {regions:project.patternLibrary.length,curved,frontYellow:13,backYellow:8,headPieceIds:head,pinkPieceIds:pads};
}
try{
 await page.setViewportSize({width:1500,height:1000});await page.waitForFunction(()=>!!window.fpcad);await hidden();
 const sentinel=await page.evaluate(async()=>{const r=await window.fpcad.create({name:'独立项目不得被重提取修改',unit:'mm'});if(!r.ok)throw Error(JSON.stringify(r));return (await window.fpcad.read()).data;});
 const created=await page.evaluate(()=>window.fpcad.create({name:'描线结构与阴影重提取回归',unit:'mm'}));assert(created.ok);
 await page.reload();await workflow(page,'references');
 await app.evaluate(({dialog},file)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[file]});},resolve('tests/fixtures/character-front-back.jpg'));
 await page.getByLabel('双视图布局',{exact:true}).selectOption('front-right');await page.getByLabel('参考高度 mm',{exact:true}).fill('1800');
 await page.getByRole('button',{name:'上传双视图并自动拆分',exact:true}).click();
 await waitForState(page,async()=>{const s=await window.fpcad.read(),failure=document.querySelector('.error-banner')?.textContent?.trim();if(failure)throw Error('UI upload failed: '+failure);return s.ok&&s.data.project.references?.length===2&&(s.data.project.patternLibrary?.length??0)>0;},undefined,{timeout:120000});
 const imported=(await read()).project;assert.equal(imported.references.find(r=>r.view==='front').width,666);assert.equal(imported.references.find(r=>r.view==='back').width,609);
 const geometry=await analyze(resolve('target/release/fpcad-worker.exe'),{...imported,pieces:imported.patternLibrary.map(r=>r.piece)});assert.deepEqual(geometry.flatMap(g=>g.issues.filter(i=>i.severity==='error')),[],'Every extracted editable contour must pass the native manufacturing validator');
 checks.push({name:'Actual upload button produces separate original-resolution structures and clean materials',...inspect(imported)});
 await page.locator('.region-card').first().waitFor();await fitReferenceView(page);await desktopScreenshot(app,page,{path:'test-results/extraction-refinement-upload.png'});await hidden();
 await page.waitForFunction(()=>{const button=[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='按当前标定重新拆分');return button&&!button.disabled;});
 await page.getByRole('button',{name:'按当前标定重新拆分',exact:true}).click();
 await waitForState(page,async revision=>{const r=await window.fpcad.read(),failure=document.querySelector('.error-banner')?.textContent?.trim();if(failure)throw Error('UI re-extraction failed: '+failure);return r.ok&&r.data.project.revision===revision+1&&(r.data.project.patternLibrary?.length??0)>0;},imported.revision,{timeout:120000});
 const refined=(await read()).project,inspection=inspect(refined),oldIds=new Set(imported.patternLibrary.map(r=>r.piece.id));assert(refined.patternLibrary.every(r=>!oldIds.has(r.piece.id)),'Re-extraction replaces old source IDs once');
 checks.push({name:'Actual current-calibration button replaces sources once with separated, edge-constrained results',revision:refined.revision,...inspection});
 await page.locator(`.region-card[data-region-id="${inspection.headPieceIds[1]}"]`).click();await page.locator('.region-settings').waitFor();
 assert.equal(await page.locator(`.mask-view [data-source-region-id="${inspection.headPieceIds[1]}"][data-selected="true"]`).count(),1,'A selected saved horn highlights only its own source');
 await desktopScreenshot(app,page,{path:'test-results/extraction-refinement-horn.png'});await hidden();
 await page.locator('.project-toolbar').getByRole('button',{name:/撤销/}).click();
 await waitForState(page,async id=>(await window.fpcad.read()).data.project.patternLibrary.some(r=>r.piece.id===id),imported.patternLibrary[0].piece.id);
 const undone=(await read()).project;assert.deepEqual(undone.patternLibrary,imported.patternLibrary);assert.deepEqual(undone.references,imported.references);checks.push({name:'One UI undo restores every previous source and reference'});
 await page.locator('.project-toolbar').getByRole('button',{name:/重做/}).click();await waitForState(page,async id=>(await window.fpcad.read()).data.project.patternLibrary.some(r=>r.piece.id===id),refined.patternLibrary[0].piece.id);assert.deepEqual((await read()).project.patternLibrary,refined.patternLibrary);
 await page.getByRole('button',{name:/本地项目/}).click();await page.locator('.recent-list').getByRole('button',{name:/独立项目不得被重提取修改/}).click();await waitForState(page,async id=>(await window.fpcad.read()).data.project.id===id,sentinel.project.id);assert.deepEqual((await read()).project,sentinel.project);checks.push({name:'A different isolated project remains exactly unchanged'});
 assert.deepEqual(errors,[]);await hidden();
 await writeFile('test-results/extraction-refinement.json',JSON.stringify({passed:true,testedBuild,directory,checks,errors},null,2));console.log(JSON.stringify({passed:true,testedBuild,checks}));
}catch(error){await desktopScreenshot(app,page,{path:'test-results/extraction-refinement-failure.png'}).catch(()=>{});await writeFile('test-results/extraction-refinement.json',JSON.stringify({passed:false,testedBuild,directory,checks,errors,error:String(error)},null,2));throw error;}finally{await app.close();}
