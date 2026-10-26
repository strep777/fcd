import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {mkdir,mkdtemp,readFile,writeFile} from 'node:fs/promises';
import {resolve,relative} from 'node:path';
import {desktop} from './tauri-desktop.mjs';
import {desktopArgs,executablePath,testedBuild} from './desktop-launch.mjs';
import {chooseProject,workflow,waitForIdle} from './ui-navigation.mjs';
import {desktopScreenshot} from './desktop-screenshot.mjs';
import {assertDesignCutContract} from './cut-result-contract.mjs';
import {assertBodyModelScope,assertRegularBodyPieceBudget,characterFixture} from './fixtures/character-functional-oracle.mjs';
import {assertSurfaceRendered,surfacePixels} from './surface-renderer.mjs';

// Optional replay of a complete project captured by the real native workflow.
// The external hash pins the capture. Recompute a fresh cut with the real
// native worker; never accept the historical candidate's damaged boundaries.
assert(process.env.FPCAD_REAL_DUAL_REPLAY_PROJECT,'Set FPCAD_REAL_DUAL_REPLAY_PROJECT to a captured isolated project JSON');
assert(/^[a-f0-9]{64}$/i.test(process.env.FPCAD_REAL_DUAL_REPLAY_SHA256??''),'Set FPCAD_REAL_DUAL_REPLAY_SHA256 to the capture manifest SHA256');
const input=resolve(process.env.FPCAD_REAL_DUAL_REPLAY_PROJECT),localInput=relative(process.cwd(),input).replaceAll('\\','/');
assert(localInput.startsWith('test-results/')||localInput.startsWith('.local/tests/'),'Replay input must come from isolated test evidence');
const bytes=await readFile(input),fixtureHash=createHash('sha256').update(bytes).digest('hex');
assert.equal(fixtureHash,process.env.FPCAD_REAL_DUAL_REPLAY_SHA256.toLowerCase());
const fixture=JSON.parse(bytes),candidate=fixture.surfaceRun;
assert.equal(candidate?.pieces.length,49,'This replay uses the actual 49-piece acceptance regression');
assert.equal(candidate.accepted,false);assert.equal(fixture.pieces.length,0);
assert.equal(fixture.surface.vertices.length,4803);assert.equal(fixture.surface.faces.length,9512);
assertBodyModelScope(fixture.surface,'padded');const capturedPhysical=assertDesignCutContract(fixture);
assert.deepEqual(new Set(fixture.references.map(r=>r.view)),new Set(['front','back']));
assert(fixture.references.every(r=>r.resources.source.sha256===characterFixture.sha256),'Replay retains the pinned original JPEG resources');
await mkdir('.local/tests',{recursive:true});
const directory=await mkdtemp(resolve('.local/tests/real-dual-replay-')),output=resolve(process.env.FPCAD_REAL_DUAL_REPLAY_RESULTS??'test-results/real-dual-candidate-replay');
await mkdir(output,{recursive:true});
const env={...process.env,FPCAD_DATA_DIR:directory},checks=[],errors=[],report={passed:false,input,fixtureHash,directory,testedBuild,capturedPhysical,checks,errors};
report.nativeBuildSha256=createHash('sha256').update(await readFile(executablePath??'apps/desktop/src-tauri/target/debug/FurryPatternCAD.exe')).digest('hex');
let app,page;
async function launch(){app=await desktop.launch({args:desktopArgs,executablePath,env});page=await app.firstWindow();page.setDefaultTimeout(45000);page.on('pageerror',error=>errors.push(error.message));await page.setViewportSize({width:1440,height:1000});await page.waitForFunction(()=>!!window.fpcad);}
async function read(){const result=await page.evaluate(()=>window.fpcad.read());assert(result.ok,JSON.stringify(result));return result.data;}
async function idle(){await waitForIdle(page,{timeout:120000});}
async function saveDialog(path){await app.evaluate(({dialog},path)=>{dialog.showSaveDialog=async()=>({canceled:false,filePath:path});},path);}
async function refreshUi(){const revision=(await read()).project.revision;await app.evaluate(({DesktopWindow})=>DesktopWindow.getAllWindows()[0].contents.send('fpcad:changed'));await page.waitForFunction(revision=>document.querySelector('.app-shell>footer')?.textContent.includes('R'+revision),revision,{timeout:120000});}
async function history(redo=false){await refreshUi();const revision=(await read()).project.revision;await page.locator('.project-toolbar').getByRole('button',{name:redo?/重做/:/撤销/}).click();await idle();const project=(await read()).project;assert(project.revision>revision,'The actual document toolbar history action must commit before continuing');return project;}
try{
 await launch();assert(await app.evaluate(({DesktopWindow})=>DesktopWindow.getAllWindows().every(window=>!window.isVisible())));
 const created=await page.evaluate(()=>window.fpcad.create({name:'Actual 49-piece native acceptance replay',unit:'mm'}));assert(created.ok,JSON.stringify(created));
 const workflowFile=resolve(directory,'captured-workflow.json');await writeFile(workflowFile,JSON.stringify({format:'fpcad-workflow',version:1,project:fixture}));
 await app.evaluate(({dialog},path)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[path]});},workflowFile);
 const imported=await app.request({protocolVersion:1,requestId:randomUUID(),projectId:created.data.project.id,expectedRevision:created.data.project.revision,method:'workflow.file',payload:{action:'import'}});assert(imported.ok,JSON.stringify(imported));
 let project=(await read()).project;assert.deepEqual(project.surface,fixture.surface);assert.deepEqual(project.surfaceRun,candidate);assert.deepEqual(project.patternLibrary,fixture.patternLibrary);
 checks.push('Public workflow import restores the SHA-pinned original 9512-face mesh, references and captured 49-piece failure');
 const recalculated=await page.evaluate(async options=>{const p=(await window.fpcad.read()).data.project;return window.fpcad.unwrapSurface(p.id,p.revision,options);},candidate.options);assert(recalculated.ok,JSON.stringify(recalculated));
 project=(await read()).project;assert.deepEqual(project.surface,fixture.surface);assert.deepEqual(project.patternLibrary,fixture.patternLibrary);assert.equal(project.surfaceRun.accepted,false);
 const freshCandidate=structuredClone(project.surfaceRun),pieceCount=freshCandidate.pieces.length;
 assert(pieceCount>=10&&pieceCount<=50,'The fresh real cut must satisfy the 10–50-panel manufacturing budget');
 report.recalculation={capturedPieces:49,freshPieces:pieceCount,delta:pieceCount-49,physical:assertDesignCutContract(project),usability:assertRegularBodyPieceBudget(project)};
 checks.push('The real native worker recomputes the captured input with unchanged mesh/options, 10–50 fresh panels and full physical area/face coverage');
 await page.reload();await chooseProject(page);await workflow(page,'cutting');await page.locator('.run-report > strong').waitFor();
 assert((await page.locator('.run-report > strong').innerText()).includes(String(pieceCount)));
 const review=page.locator('.run-report .distortion-review input[type=checkbox]');if(await review.count())await review.check();
 await page.getByRole('button',{name:'确认版型并保存到裁切库（可撤销）',exact:true}).click();await idle();
 let state=await read();project=state.project;
 assert(project.surfaceRun?.accepted,'Actual candidate confirmation failed: '+JSON.stringify(await page.locator('.error-banner').allTextContents()));
 assert.equal(project.pieces.length,pieceCount);assert.equal(project.bindings.length,pieceCount);assert.equal(project.cuttingLibrary.length,1);
 assert.deepEqual(project.surface,fixture.surface);assert.deepEqual(project.pieces,freshCandidate.pieces);assert.deepEqual(project.bindings,freshCandidate.bindings);
 assert.deepEqual(state.geometry.flatMap(g=>g.issues.filter(issue=>issue.severity==='error')),[],'Every actual accepted cut must pass manufacturing checks');
 const acceptedPieces=structuredClone(project.pieces),acceptedBindings=structuredClone(project.bindings);
 checks.push('The visible confirmation control accepts every freshly computed piece with no manufacturing errors and one real archived cut');
 const undone=await history();assert.equal(undone.pieces.length,0);assert.equal(undone.surfaceRun.accepted,false);assert.deepEqual(undone.surfaceRun.pieces,freshCandidate.pieces);
 const redone=await history(true);assert.deepEqual(redone.pieces,acceptedPieces);assert.deepEqual(redone.bindings,acceptedBindings);assert.equal(redone.surfaceRun.accepted,true);
 checks.push('Acceptance is one atomic undo step and redo restores all exact real geometry');
 const configs=[{view:'front',seeds:[{color:'blue',x:938,y:322},{color:'yellow',x:997,y:403}]},{view:'back',seeds:[{color:'blue',x:433,y:368},{color:'yellow',x:497,y:493}]}],selected=[];
 for(const config of configs){const reference=fixture.references.find(r=>r.view===config.view),c=reference.calibration,dx=c.b.x-c.a.x,dy=c.b.y-c.a.y,k=c.distanceMm/(dx*dx+dy*dy);for(const seed of config.seeds){const x=k*(-dy*(seed.x-c.a.x)+dx*(seed.y-c.a.y)),y=k*(dx*(seed.x-c.a.x)+dy*(seed.y-c.a.y));const sources=fixture.patternLibrary.filter(source=>{if(source.view!==config.view)return false;const [r,g,b]=[1,3,5].map(index=>parseInt(source.piece.color.slice(index,index+2),16));return seed.color==='blue'?b>r*2&&g>r*2:r>b*2&&g>b*2;});assert(sources.length);const distance=source=>{const xs=source.piece.nodes.map(n=>n.xMm),ys=source.piece.nodes.map(n=>n.yMm);return Math.hypot(Math.max(Math.min(...xs)-x,0,x-Math.max(...xs)),Math.max(Math.min(...ys)-y,0,y-Math.max(...ys)));};const source=[...sources].sort((a,b)=>distance(a)-distance(b))[0];selected.push({id:source.piece.id,view:config.view,color:seed.color,seed});}}
 assert.equal(new Set(selected.map(source=>source.id)).size,4);report.selectedSources=selected;
 await workflow(page,'mapping');
 for(const source of selected){await page.locator('.marking-library.drawer [data-region-id="'+source.id+'"]').click();await page.getByRole('button',{name:'贴附到当前模型',exact:true}).click();await idle();const p=(await read()).project,marking=p.markings?.find(m=>m.sourcePieceId===source.id&&m.view===source.view);assert(marking,'Original JPEG source must attach to the accepted actual model: '+source.view+' '+source.color+' / '+JSON.stringify(await page.locator('.error-banner').allTextContents()));assert(marking.fragments.length>0&&marking.paths.length>0);assert(marking.fragments.every(f=>f.rings.every(r=>r.every(w=>Math.abs(w.reduce((sum,n)=>sum+n,0)-1)<1e-6))));}
 const rendered=await assertSurfaceRendered(page,9512);assert((await surfacePixels(page)).colored>100,'Actual viewport must display colored mapped pixels');report.rendered=rendered;
 project=(await read()).project;assert.deepEqual(project.surface,fixture.surface);assert.deepEqual(project.patternLibrary,fixture.patternLibrary);
 checks.push('The same four real front/back JPEG seed regions produce actual colored viewport pixels and bound 2D/3D paths');
 await workflow(page,'cutting');const dock=page.locator('#cutting-preview-dock');if(!await dock.isVisible())await page.locator('button[aria-controls="cutting-preview-dock"]').click();await dock.waitFor({state:'visible'});
 const nodes=project.pieces.flatMap(p=>p.nodes),width=Math.max(...nodes.map(n=>n.xMm))-Math.min(...nodes.map(n=>n.xMm)),height=Math.max(...nodes.map(n=>n.yMm))-Math.min(...nodes.map(n=>n.yMm));assert(width/height<8);
 const marking=project.markings[0],path=marking.paths[0];await page.getByRole('button',{name:'适应视图',exact:true}).click();await page.getByLabel('裁切版型预览裁片',{exact:true}).selectOption(path.pieceId);await page.evaluate(()=>new Promise(ok=>requestAnimationFrame(()=>requestAnimationFrame(ok))));
 const bounds=await page.locator('svg.canvas>g[data-piece-id="'+path.pieceId+'"]>path[stroke-dasharray="3 1.5"]').boundingBox();assert(bounds&&Math.max(bounds.width,bounds.height)>80,'The mapped real cut must remain readable in the actual 2D preview');report.selectedPreview=bounds;
 await desktopScreenshot(app,page,{path:resolve(output,'accepted-dual-preview.png')});checks.push('Actual accepted overview retains physical proportions and the mapped panel renders larger than 80 screen pixels');
 const lock=await page.evaluate(async id=>{const p=(await window.fpcad.read()).data.project;return window.fpcad.apply(p.id,p.revision,{type:'marking.lock',markingId:id,locked:true});},marking.id);assert(lock.ok,JSON.stringify(lock));const locked=(await read()).project;
 const refused=await page.evaluate(async({marking,path})=>{const p=(await window.fpcad.read()).data.project;return window.fpcad.editMarking(p.id,p.revision,marking.id,path.pieceId,path.rings);},{marking,path});assert(!refused.ok&&refused.error.code==='MARKING_LOCKED');assert.deepEqual((await read()).project,locked);
 await history();assert.deepEqual((await read()).project.markings,project.markings);
 const beforeOutside=(await read()).project,outside=path.rings.map(r=>r.map(n=>({...n,xMm:n.xMm+100000}))),rejected=await page.evaluate(async({id,pieceId,rings})=>{const p=(await window.fpcad.read()).data.project;return window.fpcad.editMarking(p.id,p.revision,id,pieceId,rings);},{id:marking.id,pieceId:path.pieceId,rings:outside});assert(!rejected.ok);assert.deepEqual((await read()).project,beforeOutside);
 checks.push('Locking rejects edits atomically, undo restores the markings and inverse mapping rejects out-of-domain real geometry without mutation');
 const archive=resolve(directory,'accepted-real-dual.fpcad');await saveDialog(archive);const saved=await page.evaluate(async()=>{const p=(await window.fpcad.read()).data.project;return window.fpcad.save(p.id,p.revision,true);});assert(saved.ok,JSON.stringify(saved));assert((await readFile(archive)).length>100);
 report.exports=[];for(const format of ['svg','dxf']){const file=resolve(directory,'accepted-real-dual.'+format);await saveDialog(file);const result=await page.evaluate(async format=>{const state=(await window.fpcad.read()).data,p=state.project;return window.fpcad.export(p.id,p.revision,format,state.geometry.flatMap(g=>g.issues.filter(i=>i.severity==='warning').map(i=>i.ruleId)));},format);assert(result.ok,JSON.stringify(result));const exported=await readFile(file);assert(exported.toString().includes(format==='svg'?'id="Marking"':'MARKING'));report.exports.push({format,file,bytes:exported.length,sha256:createHash('sha256').update(exported).digest('hex')});}
 checks.push('Native SVG and DXF exports contain actual mapped markings and the real project archive is saved');
 const expected=(await read()).project;await app.close();app=undefined;await launch();await chooseProject(page);assert.deepEqual((await read()).project,expected);assert(await app.evaluate(({DesktopWindow})=>DesktopWindow.getAllWindows().every(window=>!window.isVisible())));
 checks.push('Application restart preserves the freshly accepted real model, all mapped paths and all original resources exactly');
 assert.deepEqual(errors,[]);report.passed=true;console.log(JSON.stringify({passed:true,checks:checks.length,directory,fixtureHash,nativeBuildSha256:report.nativeBuildSha256}));
}catch(error){report.error=String(error.stack??error);await desktopScreenshot(app,page,{path:resolve(output,'failure.png')}).catch(()=>{});throw error;}finally{await app?.close();await writeFile(resolve(output,'report.json'),JSON.stringify(report,null,2));}
