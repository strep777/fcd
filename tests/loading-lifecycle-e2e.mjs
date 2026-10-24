import assert from 'node:assert/strict';
import {mkdir,mkdtemp,readFile,writeFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {createCanvas} from '@napi-rs/canvas';
import {desktop} from './tauri-desktop.mjs';
import {desktopArgs,executablePath} from './desktop-launch.mjs';
import {hiddenWindowId} from './desktop-window.mjs';
import {desktopScreenshot} from './desktop-screenshot.mjs';
import {workflow,chooseProject} from './ui-navigation.mjs';

// Native dialogs are held by the existing debug dialog route. The backend gate
// delays real file I/O after selection; it never replaces an operation's result.
const results=resolve('test-results/loading-lifecycle');
await mkdir(results,{recursive:true});
const directory=await mkdtemp(resolve('.local/tests/loading-lifecycle-'));
const app=await desktop.launch({executablePath,args:desktopArgs,env:{...process.env,FPCAD_DATA_DIR:directory,FPCAD_PROFILE:'1'}});
const page=await app.firstWindow(),checks=[],errors=[],dialogGates=[];
page.on('pageerror',error=>errors.push(error.message));
page.setDefaultTimeout(30000);
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const deferred=()=>{let resolve;const promise=new Promise(done=>resolve=done);return {promise,resolve};};
const read=async()=>{const result=await page.evaluate(()=>window.fpcad.read());assert(result.ok,JSON.stringify(result));return result.data;};
const identity=session=>({project:session.project,history:session.history,canUndo:session.canUndo,canRedo:session.canRedo,savedRevision:session.savedRevision});
const toolbar=()=>page.locator('.project-toolbar');
const unlocked=async()=>{await page.waitForFunction(()=>!document.querySelector('.project-toolbar button')?.disabled);await page.locator('.task-activity').waitFor({state:'hidden'});};
async function assertNoLoading(label){
 await sleep(450); // Longer than the production activity delay.
 const state=await page.evaluate(()=>({tasks:document.querySelectorAll('.task-activity').length,inline:[...document.querySelectorAll('.inline-activity')].filter(element=>element.getClientRects().length).length,footer:document.querySelector('.app-shell>footer')?.textContent??'',loading:[...document.querySelectorAll('button,[role=status]')].filter(element=>element.getClientRects().length&&/Working…|Working, please wait|Importing…|Processing assistant|处理中|正在处理|正在导入|正在提取原图花纹|Extracting reference markings/.test(element.textContent??'')).map(element=>element.textContent)}));
 assert.equal(state.tasks,0,label+': global activity appeared while waiting for the user');
 assert.equal(state.inline,0,label+': inline activity appeared while waiting for the user');
 assert(!/Working…|处理中/.test(state.footer),label+': footer describes file selection as work');
 assert.deepEqual(state.loading,[],label+': loading copy appeared while waiting for the user');
 return state;
}
async function dialogGate(kind){
 const gate={...deferred(),entered:false,calls:0};
 dialogGates.push({kind,gate});
 await app.evaluate(({dialog})=>{dialog[kind==='open'?'showOpenDialog':'showSaveDialog']=async()=>{gate.entered=true;gate.calls++;return gate.promise;};});
 return gate;
}
async function waitDialog(gate){const deadline=Date.now()+30000;while(!gate.entered&&Date.now()<deadline)await sleep(20);assert(gate.entered,'native dialog was not requested');}
async function armIo(path,operation){
 await app.backendEvaluate((_,{path,operation})=>{
  globalThis.__loadingIo?.restore();
  const fs=process.getBuiltinModule('fs/promises'),module=process.getBuiltinModule('module'),original=fs[operation];let release;
  const pending=new Promise(resolve=>release=resolve),gate={entered:false,release,restore:()=>{fs[operation]=original;module.syncBuiltinESMExports();}};
  fs[operation]=async function(candidate,...args){if(String(candidate)===path||(operation==='open'&&String(candidate).startsWith(path+'.'))){gate.entered=true;await pending;}return original.call(this,candidate,...args);};
  globalThis.__loadingIo=gate;module.syncBuiltinESMExports();
 },{path,operation});
}
async function releaseIo(){await app.backendEvaluate(()=>{globalThis.__loadingIo?.restore();globalThis.__loadingIo?.release();delete globalThis.__loadingIo;});}
async function waitIo(){const deadline=Date.now()+30000;while(Date.now()<deadline){if(await app.backendEvaluate(()=>!!globalThis.__loadingIo?.entered))return;await sleep(20);}throw Error('real backend file I/O was not reached');}
async function assertWorking(label){
 await page.locator('.task-activity .task-spinner').waitFor();
 const animation=await page.locator('.task-spinner').evaluate(async element=>{const animation=element.getAnimations()[0];if(!animation)return {present:false};const before=animation.currentTime;await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));return {present:true,before,after:animation.currentTime};});
 assert(animation.present&&animation.after>animation.before,label+': native loading animation did not advance');
 assert(await toolbar().getByRole('button',{name:'Save as',exact:true}).isDisabled(),label+': mutation controls were unlocked during background work');
 return animation;
}
async function cancelCase(name,kind,start){
 const before=identity(await read()),gate=await dialogGate(kind);
 await start();await waitDialog(gate);const waiting=await assertNoLoading(name);
 // Native-disabled controls must reject a second synthetic click as well.
 await toolbar().getByRole('button',{name:'Save as',exact:true}).evaluate(element=>element.click());await sleep(50);assert.equal(gate.calls,1,name+': duplicate operation opened another dialog');
 gate.resolve(kind==='open'?{canceled:true,filePaths:[]}:{canceled:true});await unlocked();
 assert.deepEqual(identity(await read()),before,name+': cancelling changed project/history/save state');
 checks.push({case:name,passed:true,waiting,dialogCalls:gate.calls});
}
async function pendingCase(name,kind,start,path,operation,verify){
 const gate=await dialogGate(kind);await armIo(path,operation);
 try{await start();await waitDialog(gate);const waiting=await assertNoLoading(name);if(name.startsWith('save-as'))await desktopScreenshot(app,page,{path:join(results,'waiting-for-file-choice.png')});gate.resolve(kind==='open'?{canceled:false,filePaths:[path]}:{canceled:false,filePath:path});await waitIo();const animation=await assertWorking(name);if(name.startsWith('save-as'))await desktopScreenshot(app,page,{path:join(results,'processing-selected-file.png')});await releaseIo();await unlocked();await verify();checks.push({case:name,passed:true,waiting,animation});}
 finally{gate.resolve(kind==='open'?{canceled:true,filePaths:[]}:{canceled:true});await releaseIo();}
}
const saveAs=()=>toolbar().getByRole('button',{name:'Save as',exact:true}).click();
const open=()=>toolbar().getByRole('button',{name:'↗ Open project',exact:true}).click();
const importReference=async()=>{await workflow(page,'references');await page.getByRole('button',{name:'Import single image',exact:true}).click();};
const importModel=async()=>{await workflow(page,'model');await page.locator('.page-model').getByRole('button',{name:'Import triangulated OBJ / GLB',exact:true}).click();};
const exportSvg=async()=>{await toolbar().getByRole('button',{name:'Export ↗',exact:true}).click();await page.getByRole('dialog',{name:'Export patterns',exact:true}).getByRole('button',{name:'SVG ↗',exact:true}).click();};
try{
 await hiddenWindowId(app,page);await page.getByLabel('Language',{exact:true}).selectOption('en');
 await toolbar().getByRole('button',{name:'＋ New project',exact:true}).click();
 const create=page.getByRole('dialog',{name:'New millimetre project',exact:true});await create.locator('input').fill('Loading lifecycle');await create.getByRole('button',{name:/^Create/}).click();await page.locator('.workflow-nav').waitFor();await unlocked();
 const seeded=await page.evaluate(async()=>{const {data}=await window.fpcad.read(),piece={id:crypto.randomUUID(),name:'100 mm square',nodes:[[0,0],[100,0],[100,100],[0,100]].map(([xMm,yMm])=>({id:crypto.randomUUID(),xMm,yMm})),closed:true,allowanceMm:0,cutQty:1,mirror:false,material:'Cotton',furRad:0,color:'#73c9b6'};return window.fpcad.apply(data.project.id,data.project.revision,{type:'piece.put',piece});});assert(seeded.ok,JSON.stringify(seeded));await page.reload();await chooseProject(page);await toolbar().getByRole('button',{name:'Export ↗',exact:true}).waitFor();await page.waitForFunction(()=>!document.querySelector('.project-toolbar button.primary')?.disabled);
 await cancelCase('save-as cancellation hides activity and releases controls','save',saveAs);
 const archive=join(directory,'baseline.fpcad');await pendingCase('save-as shows activity only after choosing a destination','save',saveAs,archive,'open',async()=>{assert((await readFile(archive)).length>0);assert.equal((await read()).savedRevision,(await read()).project.revision);});
 await cancelCase('project-open cancellation preserves current state','open',open);
 await pendingCase('project-open shows activity only while reading chosen archive','open',open,archive,'readFile',async()=>{assert.equal((await read()).project.name,'Loading lifecycle');assert.equal((await read()).project.pieces.length,1);});
 await cancelCase('reference-import cancellation preserves current state','open',importReference);
 const image=join(directory,'reference.png'),canvas=createCanvas(64,64),context=canvas.getContext('2d');context.fillStyle='#73c9b6';context.fillRect(0,0,64,64);await writeFile(image,canvas.toBuffer('image/png'));
 await pendingCase('reference-import shows activity only while reading chosen image','open',importReference,image,'readFile',async()=>{const reference=(await read()).project.references.find(reference=>reference.view==='front');assert.equal(reference.width,64);assert.equal(reference.height,64);});
 // Save the changed reference first: final-export cancellation then has no
 // intentional preliminary project-save side effect to confuse its assertion.
 await app.evaluate(({dialog})=>{dialog.showSaveDialog=async()=>({canceled:false,filePath:archive});});await toolbar().getByRole('button',{name:/^Save Ctrl S$/}).click();await unlocked();
 await cancelCase('final-export cancellation preserves current state','save',exportSvg);
 await page.getByRole('dialog',{name:'Export patterns',exact:true}).getByRole('button',{name:'×',exact:true}).click();
 const output=join(directory,'pattern.svg');await pendingCase('SVG export shows activity only after choosing its output','save',exportSvg,output,'open',async()=>{const svg=await readFile(output,'utf8');assert(svg.includes('<svg'));assert(svg.includes('100'),'actual export must retain millimetre scale evidence');});
 await cancelCase('model-import cancellation preserves current state','open',importModel);
 const model=join(directory,'model.obj');await writeFile(model,'v 0 0 0\nv 100 0 0\nv 0 100 0\nf 1 2 3\n');
 await pendingCase('model-import shows activity only while reading the chosen mesh','open',importModel,model,'readFile',async()=>{const surface=(await read()).project.surface;assert.equal(surface.source,'obj');assert.equal(surface.faces.length,1);assert.equal(Math.max(...surface.vertices.map(vertex=>vertex.xMm)),100);});
 const corrupt=join(directory,'broken.png');await writeFile(corrupt,'not an image');const beforeFailure=identity(await read());await pendingCase('failed import clears loading and permits a later request','open',importReference,corrupt,'readFile',async()=>{assert.deepEqual(identity(await read()),beforeFailure);assert(await page.locator('.error-banner').isVisible());});
 await page.locator('.error-banner button').click();await cancelCase('retry remains available after failed import','open',importReference);
 assert.deepEqual(errors,[]);await hiddenWindowId(app,page);
}catch(error){checks.push({case:'suite failure',passed:false,error:error.stack??String(error)});process.exitCode=1;}
finally{for(const {kind,gate} of dialogGates)gate.resolve(kind==='open'?{canceled:true,filePaths:[]}:{canceled:true});await releaseIo().catch(()=>{});await app.close().catch(error=>{checks.push({case:'normal shutdown',passed:false,error:String(error)});process.exitCode=1;});const passed=checks.length>0&&checks.every(check=>check.passed)&&errors.length===0;await writeFile(join(results,'report.json'),JSON.stringify({passed,verification:'Hidden real Tauri/WebView2, native debug dialog route, real backend I/O delayed without replacing results',directory,checks,errors},null,2));console.log(JSON.stringify({passed,checks:checks.length,results}));}
