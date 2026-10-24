import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {mkdir,mkdtemp,writeFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {createCanvas} from '@napi-rs/canvas';
import {desktop} from './tauri-desktop.mjs';
import {desktopArgs,executablePath,testedBuild} from './desktop-launch.mjs';
import {hiddenWindowId} from './desktop-window.mjs';
import {desktopScreenshot} from './desktop-screenshot.mjs';
import {workflow,waitForIdle} from './ui-navigation.mjs';
import {waitForState} from './wait-state.mjs';

// Public commands seed small fixtures; every control under review is exercised
// through the real hidden WebView2. Candidate geometry uses the native worker.
const output=resolve(process.env.FPCAD_TEST_RESULTS_DIR??'test-results/current-task-functional/reference-candidate-controls');
await mkdir(output,{recursive:true});await mkdir('.local/tests',{recursive:true});
const directory=await mkdtemp(resolve('.local/tests/reference-candidate-controls-'));
const app=await desktop.launch({args:desktopArgs,executablePath,env:{...process.env,FPCAD_DATA_DIR:directory}});
const page=await app.firstWindow(),checks=[],errors=[],observations=[];
page.setDefaultTimeout(30000);page.on('pageerror',error=>errors.push(error.message));
const read=async()=>{const response=await page.evaluate(()=>window.fpcad.read());assert(response.ok,JSON.stringify(response));return response.data;};
const apply=async command=>{const p=(await read()).project,response=await page.evaluate(({id,revision,command})=>window.fpcad.apply(id,revision,command),{id:p.id,revision:p.revision,command});assert(response.ok,JSON.stringify(response));return response.data;};
const screenshot=async name=>{await hiddenWindowId(app,page);await desktopScreenshot(app,page,{path:join(output,name+'.png')});};
const sourceHash=reference=>reference.resources?.source?.sha256??createHash('sha256').update(reference.png).digest('hex');
const sources=project=>project.references.map(reference=>({id:reference.id,view:reference.view,hash:sourceHash(reference)})).sort((a,b)=>a.id.localeCompare(b.id));
async function action(name){const before=(await read()).project;await page.getByRole('button',{name,exact:true}).click();await waitForState(page,async revision=>{const error=document.querySelector('.error-banner')?.textContent?.trim();if(error)throw Error(error);const r=await window.fpcad.read();return r.ok&&r.data.project.revision===revision+1;},before.revision,{timeout:120000});await waitForIdle(page);return (await read()).project;}
async function route(files){await app.evaluate(({dialog},files)=>{let index=0;dialog.showOpenDialog=async()=>({canceled:false,filePaths:[files[Math.min(index++,files.length-1)]]});},files);}
async function image(path,back=false,dual=false){const c=createCanvas(dual?448:208,224),ctx=c.getContext('2d');ctx.fillStyle='white';ctx.fillRect(0,0,c.width,c.height);const draw=(x,isBack)=>{ctx.fillStyle=isBack?'#3366cc':'#dd8844';ctx.fillRect(x+32,16,144,192);ctx.fillStyle=isBack?'#66bbcc':'#eecc55';ctx.fillRect(x+64,64,80,96);};draw(0,back);if(dual)draw(240,true);await writeFile(path,c.toBuffer('image/png'));}
const ring=nodes=>nodes.map((n,i)=>`${i?'L':'M'}${n.xMm},${-n.yMm}`).join(' ')+' Z';
try{
 await page.waitForFunction(()=>!!window.fpcad);await hiddenWindowId(app,page);await page.setViewportSize({width:1440,height:960});
 assert((await page.evaluate(()=>window.fpcad.create({name:'正背控件与候选二维预览',unit:'mm'}))).ok);await page.reload();await workflow(page,'references');
 const front=join(directory,'front.png'),back=join(directory,'back.png'),dual=join(directory,'front-left-back-right.png');await image(front);await image(back,true);await image(dual,false,true);
 const layout=page.getByLabel('双视图布局',{exact:true}),single=page.getByLabel('单张原图朝向',{exact:true});assert.equal(await layout.inputValue(),'front-left');
 await route([dual]);let project=await action('上传双视图并自动拆分');assert.equal(project.references.length,2);assert.equal(project.references.find(r=>r.view==='front').sheet.x,0);assert(project.references.find(r=>r.view==='back').sheet.x>0);assert(project.patternLibrary.length>=4);await screenshot('01-front-left-controls');
 await layout.selectOption('front-right');const beforeResplit=sources(project);project=await action('按当前标定重新拆分');assert.deepEqual(sources(project),beforeResplit,'Changing the next upload layout must not change existing reference views or bytes');
 project=await action('交换正背并重新拆分');for(const old of beforeResplit){const current=sources(project).find(r=>r.id===old.id);assert.equal(current.hash,old.hash);assert.notEqual(current.view,old.view);}assert(project.patternLibrary.every(region=>project.references.some(reference=>region.referenceId===reference.id&&region.view===reference.view)));
 const swapped=sources(project);project=await action('按当前标定重新拆分');assert.deepEqual(sources(project),swapped);await page.reload();await workflow(page,'references');assert.deepEqual(sources((await read()).project),swapped);checks.push('Default front-left upload, layout changes, ordinary resplit, explicit swap and reload preserve the expected source bytes and views');
 await layout.selectOption('front-right');await route([dual]);project=await action('上传双视图并自动拆分');assert(project.references.find(r=>r.view==='front').sheet.x>0);assert.equal(project.references.find(r=>r.view==='back').sheet.x,0);
 await layout.selectOption('separate');await route([front,back]);project=await action('上传双视图并自动拆分');assert.deepEqual(project.references.map(r=>r.view).sort(),['back','front']);assert(project.references.every(r=>r.width===208&&r.height===224));assert.notEqual(sourceHash(project.references[0]),sourceHash(project.references[1]));
 const priorBack=project.references.find(r=>r.view==='back');await single.selectOption('front');await route([front]);project=await action('导入单张原图');assert.equal(sourceHash(project.references.find(r=>r.view==='back')),sourceHash(priorBack));const priorFront=project.references.find(r=>r.view==='front');await single.selectOption('back');await route([back]);project=await action('导入单张原图');assert.equal(sourceHash(project.references.find(r=>r.view==='front')),sourceHash(priorFront));await screenshot('02-separate-and-single-view');checks.push('Front-right and separate uploads, plus both single-image directions, follow the visible controls and preserve the other view');

 // Two disconnected, differently sized planar components keep the native solve
 // small and make all/single selection observably different.
 const vertices=[[0,0,0],[140,0,0],[140,200,0],[0,200,0],[280,0,0],[350,0,0],[350,90,0],[280,90,0]].map(([xMm,yMm,zMm])=>({id:randomUUID(),xMm,yMm,zMm}));
 await apply({type:'surface.set',surface:{id:randomUUID(),topologyVersion:1,source:'obj',vertices,faces:[[0,1,2],[0,2,3],[4,5,6],[4,6,7]].map((ids,i)=>({id:randomUUID(),vertices:ids.map(index=>vertices[index].id),region:i<2?'large-panel':'small-panel'}))}});
 await page.reload();await workflow(page,'cutting');await page.getByRole('button',{name:'自动计算裁线并预览',exact:true}).click();
 await waitForState(page,async()=>{const error=document.querySelector('.error-banner')?.textContent?.trim();if(error)throw Error(error);const r=await window.fpcad.read();return r.ok&&r.data.project.surfaceRun?.accepted===false&&r.data.project.surfaceRun.pieces.length>=2;},undefined,{timeout:120000});await waitForIdle(page);
 let session=await read();const run=structuredClone(session.project.surfaceRun);assert.equal(run.pieces.length,2);assert.equal(run.cutPreview.length,2);assert.equal(session.project.pieces.length,0,'Calculating must retain a separate unaccepted candidate');
 const collision=run.pieces[1],far=structuredClone(collision);far.name='Saved geometry with candidate ID';far.nodes.forEach(n=>{n.xMm+=90000;n.yMm+=60000;});await apply({type:'piece.put',piece:far});await page.reload();await workflow(page,'cutting');session=await read();assert.deepEqual(session.project.surfaceRun,run);const old=session.geometry.find(g=>g.id===collision.id),candidate=run.cutPreview.find(g=>g.id===collision.id);assert(old);assert.notEqual(ring(old.cut),ring(candidate.cut),'The persisted collision must really differ from the candidate');
 const dock=page.locator('#cutting-preview-dock'),canvas=dock.locator('svg.canvas'),picker=dock.getByLabel('裁切版型预览裁片',{exact:true}),zoom=dock.getByLabel('预览缩放百分比',{exact:true});
 const assertPieces=async ids=>{await page.waitForFunction(ids=>{const shown=[...document.querySelectorAll('#cutting-preview-dock svg.canvas>g[data-piece-id]')].map(n=>n.dataset.pieceId);return JSON.stringify(shown)===JSON.stringify(ids);},ids);};
 const assertFit=async label=>{await page.waitForFunction(()=>{const c=document.querySelector('#cutting-preview-dock svg.canvas'),z=document.querySelector('#cutting-preview-dock .canvas-zoom input');if(!c||!z)return false;const b=c.viewBox.baseVal;return Number(z.value)===100&&c.clientWidth>0&&c.clientHeight>0&&Math.abs(b.width/b.height-c.clientWidth/c.clientHeight)<.01;});const evidence=await canvas.evaluate(c=>({viewBox:c.getAttribute('viewBox'),width:c.clientWidth,height:c.clientHeight,pieces:[...c.querySelectorAll(':scope>g[data-piece-id]')].map(g=>{const b=g.getBBox(),v=c.viewBox.baseVal;return {id:g.dataset.pieceId,bounds:{x:b.x,y:b.y,width:b.width,height:b.height},inside:b.x>=v.x-1&&b.y>=v.y-1&&b.x+b.width<=v.x+v.width+1&&b.y+b.height<=v.y+v.height+1};})}));assert(evidence.pieces.every(p=>p.inside),label+': fitted contours and labels must remain inside the visible canvas');observations.push({phase:label,...evidence});};
 const frozen=structuredClone(session.project);await picker.selectOption(collision.id);await assertPieces([collision.id]);await assertFit('single candidate');assert.equal(await canvas.locator(`g[data-piece-id="${collision.id}"]>path`).first().getAttribute('d'),[candidate.cut,...(candidate.cutHoles??[])].map(ring).join(' '));assert.notEqual(await canvas.locator(`g[data-piece-id="${collision.id}"]>path`).first().getAttribute('d'),ring(old.cut));await screenshot('03-single-candidate-own-cut');
 await picker.selectOption('');await assertPieces(run.pieces.map(p=>p.id));await assertFit('all candidates');const allView=await canvas.getAttribute('viewBox');await screenshot('04-all-candidates');
 await picker.selectOption(collision.id);await assertPieces([collision.id]);assert.notEqual(await canvas.getAttribute('viewBox'),allView);await zoom.fill('3200');await zoom.press('Tab');await page.getByRole('button',{name:'放大二维预览',exact:true}).click();await assertFit('expanded single');await screenshot('05-expanded-single');
 await zoom.fill('37');await zoom.press('Tab');await page.getByRole('button',{name:'缩小二维预览',exact:true}).click();await assertFit('reduced single');await page.getByRole('button',{name:'收起二维预览',exact:true}).click();assert.equal(await dock.isVisible(),false);await page.setViewportSize({width:1100,height:800});await page.getByRole('button',{name:'二维预览',exact:true}).click();await assertFit('reopened after hidden resize');await assertPieces([collision.id]);
 await picker.selectOption('');await assertPieces(run.pieces.map(p=>p.id));await assertFit('all after reopen');await screenshot('06-reopened-all-small-window');assert.deepEqual((await read()).project,frozen,'Selection, zoom, expansion and hiding must never modify persisted data');checks.push('Real candidate outlines ignore conflicting saved geometry; single/all focus, expand/reduce and hide-resize-reopen fit the actual viewport without edits');
 await page.reload();await workflow(page,'cutting');assert.deepEqual((await read()).project,frozen);await hiddenWindowId(app,page);assert.deepEqual(errors,[]);checks.push('Candidate and conflicting saved geometry persist exactly across reload with no renderer errors');
 await writeFile(join(output,'result.json'),JSON.stringify({passed:true,testedBuild,directory,checks,errors,observations},null,2));
 console.log(JSON.stringify({passed:true,checks,output}));
}catch(error){await screenshot('failure').catch(()=>{});await writeFile(join(output,'result.json'),JSON.stringify({passed:false,testedBuild,directory,checks,errors,observations,error:String(error.stack)},null,2));throw error;}finally{await app.close();}
