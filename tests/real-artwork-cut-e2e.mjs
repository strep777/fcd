import {_electron as electron} from 'playwright';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile} from 'node:fs/promises';
import {build} from 'esbuild';
import {pathToFileURL} from 'node:url';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {desktopArgs,executablePath,testedBuild} from './desktop-launch.mjs';
import {workflow} from './ui-navigation.mjs';
import {desktopScreenshot} from './desktop-screenshot.mjs';
import {testedArtifacts} from './real-mapping-fixture-audit.mjs';

const directory=await mkdtemp(resolve('.local/tests/real-artwork-cut-')),env={...process.env,FPCAD_DATA_DIR:directory};delete env.ELECTRON_RUN_AS_NODE;
const app=await electron.launch({args:desktopArgs,executablePath,env}),page=await app.firstWindow(),errors=[],checks=[];
page.on('pageerror',e=>errors.push(e.message));page.setDefaultTimeout(30000);
const blueWhite=process.env.FPCAD_REAL_ARTWORK==='blue-white',evidenceName=blueWhite?'real-blue-white-cut':'real-artwork-cut';
const imagePath=resolve(blueWhite?'tests/fixtures/character-blue-white-front-back.png':'tests/fixtures/character-front-back.jpg'),imageSha256=createHash('sha256').update(await readFile(imagePath)).digest('hex');
const artifacts=await testedArtifacts(executablePath,process.env.FPCAD_TEST_APP_DIR);
const options={method:'arap',automaticCuts:true,colorBoundaryCuts:true,normalAngleDeg:Number(process.env.FPCAD_REAL_CUT_ANGLE??120),maxFacesPerPatch:Number(process.env.FPCAD_REAL_CUT_FACES??2000),iterations:30,optimizeCuts:true,searchPasses:3,maxPieces:500};
const record=message=>{checks.push(message);console.log(message);};
// Keep large CAD payloads inside the renderer: transferring every full archive
// through Playwright retains multiple copies unrelated to normal application use.
const summary=()=>page.evaluate(async()=>{const r=await window.fpcad.read();if(!r.ok)throw Error(JSON.stringify(r));const p=r.data.project,archive=p.cuttingLibrary?.[0];return {pieces:p.pieces.length,archiveCount:p.cuttingLibrary?.length??0,archiveId:archive?.id,activeCutId:p.activeCutId,archiveHash:archive?Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(archive,(_key,value)=>value&&typeof value==='object'&&!Array.isArray(value)?Object.fromEntries(Object.keys(value).sort().map(key=>[key,value[key]])):value))))).map(v=>v.toString(16).padStart(2,'0')).join(''):null,manufacturingErrors:r.data.geometry.flatMap(g=>g.issues).filter(i=>i.severity==='error')};});
try{
 assert.equal(resolve(await app.evaluate(({app})=>app.getAppPath())),artifacts.applicationDirectory);
 await page.setViewportSize({width:1440,height:1000});await page.waitForFunction(()=>!!window.fpcad);
 const runtime=resolve(directory,'parameters.mjs');await build({stdin:{contents:"export {speciesDefaults} from './packages/body/defaults';",resolveDir:process.cwd()},bundle:true,platform:'node',format:'esm',outfile:runtime});const parameters=(await import(pathToFileURL(runtime))).speciesDefaults('canine');
 await app.evaluate(({dialog},path)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[path]});},imagePath);
 const seeded=await page.evaluate(async ({parameters,blueWhite})=>{
  const check=r=>{if(!r.ok)throw Error(JSON.stringify(r));return r.data.project;};let p=check(await window.fpcad.create({name:'真实双视图裁切回归',unit:'mm'}));
  p=check(await window.fpcad.autoReference(p.id,p.revision,blueWhite?'front-left':'front-right',1800,8,true));p=check(await window.fpcad.generateSpecies(p.id,p.revision,parameters));
  const selected=p.patternLibrary.filter(s=>(s.anatomy?.contexts??[s.anatomy]).some(a=>a&&a.part!=='unknown')).map(s=>s.piece.id);p=check(await window.fpcad.autoPlaceMarkings(p.id,p.revision,selected));
  // Test acknowledgement is isolated to this generated fixture.
  p=check(await window.fpcad.apply(p.id,p.revision,{type:'marking.placement.review',markingIds:p.markings.filter(m=>m.placement).map(m=>m.id),reviewed:true}));
  return {sources:p.patternLibrary.length,markings:p.markings.length};
 },{parameters,blueWhite});assert(seeded.sources>=80);assert(seeded.markings>40);record('Original artwork imports, classifies and projects through the public desktop API');
 const start=Date.now(),cut=await page.evaluate(async options=>{const r=await window.fpcad.read(),p=r.data.project,result=await window.fpcad.unwrapSurface(p.id,p.revision,options);if(!result.ok)return result;const run=result.data.project.surfaceRun;return {ok:true,pieces:run.pieces.length,accepted:run.accepted,productionPieces:result.data.project.pieces.length,colorCutReport:run.colorCutReport,designCutReport:run.designCutReport,distortion:{area:Math.max(...run.bindings.map(b=>b.report.areaErrorMax)),edge:Math.max(...run.bindings.map(b=>b.report.edgeErrorMax)),max:Math.max(...run.bindings.map(b=>b.report.distortionMax)),needsReview:run.bindings.filter(b=>b.report.status==='needsReview').length}};},options);assert(cut.ok,JSON.stringify(cut));
 assert(cut.pieces>0&&cut.pieces<=500);assert(cut.distortion.area<=.15&&cut.distortion.edge<=.10&&cut.distortion.max<=.15,'Every panel respects the unchanged hard distortion maxima');assert.equal(cut.accepted,false);assert.equal(cut.productionPieces,0);record('Color cut produces a reviewable bounded candidate without prematurely changing production pieces');
 const accepted=await page.evaluate(async()=>{const r=await window.fpcad.read(),p=r.data.project,result=await window.fpcad.acceptSurface(p.id,p.revision,true);return result.ok?{ok:true}:result;});assert(accepted.ok,JSON.stringify(accepted));const state=await summary();
 const manufacturingErrors=state.manufacturingErrors;assert.deepEqual(manufacturingErrors,[]);assert.equal(state.archiveCount,1);assert.equal(state.activeCutId,state.archiveId);assert.equal(state.pieces,cut.pieces);record('Acceptance validates manufacturing geometry and saves the exact candidate to the cutting library');
 const undone=await page.evaluate(async()=>{const r=await window.fpcad.read(),p=r.data.project,result=await window.fpcad.undo(p.id,p.revision);return result.ok?{ok:true,pieces:result.data.project.pieces.length}:result;});assert(undone.ok);assert.equal(undone.pieces,0);
 const redone=await page.evaluate(async()=>{const r=await window.fpcad.read(),p=r.data.project,result=await window.fpcad.redo(p.id,p.revision);return result.ok?{ok:true}:result;});assert(redone.ok);assert.equal((await summary()).archiveHash,state.archiveHash);record('Accepted real-artwork cuts undo and redo without changing archive geometry');
 for(const [kind,name]of [['project','real-artwork.fpcad'],['bundle','real-artwork.zip']]){
  const path=resolve(directory,name);await app.evaluate(({dialog},filePath)=>{dialog.showSaveDialog=async()=>({canceled:false,filePath});},path);
  const saved=await page.evaluate(async kind=>{const r=await window.fpcad.read(),p=r.data.project,result=await(kind==='project'?window.fpcad.save(p.id,p.revision,true):window.fpcad.patternBundle(p.id,p.revision,'export'));return result.ok?{ok:true}:result;},kind);assert(saved.ok,JSON.stringify(saved));assert((await readFile(path)).length>1000);
 }record('The real result saves as a project and exports a complete editable cut bundle');
 const svgPath=resolve(directory,'real-artwork.svg');await app.evaluate(({dialog},filePath)=>{dialog.showSaveDialog=async()=>({canceled:false,filePath});},svgPath);
 const exported=await page.evaluate(async()=>{const r=await window.fpcad.read(),p=r.data.project,ack=r.data.geometry.flatMap(g=>g.issues.filter(i=>i.severity==='warning').map(i=>i.ruleId)),result=await window.fpcad.export(p.id,p.revision,'svg',ack);return result.ok?{ok:true}:result;});assert(exported.ok,JSON.stringify(exported));const svg=await readFile(svgPath,'utf8');assert(svg.includes('<svg')&&svg.includes('mm'));record('Acknowledged manufacturing warnings allow the complete real-size SVG output');
 await app.evaluate(({dialog},path)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[path]});},resolve(directory,'real-artwork.fpcad'));
 const reopened=await page.evaluate(async()=>{const result=await window.fpcad.open();return result.ok?{ok:true}:result;});assert(reopened.ok,JSON.stringify(reopened));assert.equal((await summary()).archiveHash,state.archiveHash);record('Opening the saved project preserves the complete real-artwork cutting archive');
 await page.reload();await workflow(page,'assembly');await page.waitForFunction(()=>Number(document.querySelector('.assembly-page canvas')?.dataset.triangles)>0);assert((await page.locator('.assembly-coverage').innerText()).includes('100.0%'));assert.equal(await page.locator('.assembly-problems').count(),0);await desktopScreenshot(app,page,{path:'test-results/'+evidenceName+'-assembly.png'});record('Every actual saved piece reconstructs the original model at full physical area coverage');
 await workflow(page,'pattern');await page.getByLabel('全选当前列表',{exact:true}).check();const warning=page.getByLabel(/已检查并确认当前制造警告/);if(await warning.count())await warning.check();await page.getByRole('button',{name:'选中裁片总览',exact:true}).click();const overview=page.getByRole('dialog',{name:'选中裁片总览',exact:true});await overview.waitFor();assert.equal(await overview.locator('.overview-cut').count(),cut.pieces);await desktopScreenshot(app,page,{path:'test-results/'+evidenceName+'-overview.png'});record('Selecting all real cuts displays every material piece in the manufacturing overview');await overview.getByRole('button',{name:'关闭裁片总览',exact:true}).click();
 await workflow(page,'cutting');await desktopScreenshot(app,page,{path:'test-results/'+evidenceName+'.png'});assert.deepEqual(errors,[]);
 await writeFile('test-results/'+evidenceName+'.json',JSON.stringify({passed:true,build:testedBuild,artifacts,directory,imagePath,imageSha256,options,...seeded,pieces:cut.pieces,colorCutReport:cut.colorCutReport,designCutReport:cut.designCutReport,distortion:cut.distortion,manufacturingErrors,checks,errors,durationMs:Date.now()-start},null,2));console.log('Real artwork cut workflow passed:',checks.length,'checks;',cut.pieces,'pieces');
}catch(error){await writeFile('test-results/'+evidenceName+'.json',JSON.stringify({passed:false,build:testedBuild,artifacts,directory,imagePath,imageSha256,options,checks,errors,error:String(error)},null,2));await desktopScreenshot(app,page,{path:'test-results/'+evidenceName+'-failure.png'}).catch(()=>{});console.error('Real artwork checks completed:',checks);throw error;}finally{await app.close();}
