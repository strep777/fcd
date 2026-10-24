import {desktop} from './tauri-desktop.mjs';
import {desktopScreenshot} from './desktop-screenshot.mjs';
import {workflow} from './ui-navigation.mjs';
import {waitForState} from './wait-state.mjs';
import {mkdir,mkdtemp,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import assert from 'node:assert/strict';
await mkdir('.local/tests',{recursive:true});await mkdir('test-results/wearer',{recursive:true});
const directory=await mkdtemp(resolve('.local/tests/wearer-'));
const app=await desktop.launch({env:{...process.env,FPCAD_DATA_DIR:directory}}),page=await app.firstWindow();page.setDefaultTimeout(30000);
const results=[],savedModels=new Map();
try{
 await page.getByRole('button',{name:'＋ 新建项目',exact:true}).first().click();await page.getByRole('dialog').locator('input').fill('DTD 与一体填充验证');await page.getByRole('button',{name:'创建 →',exact:true}).click();
 await workflow(page,'model');await page.getByRole('button',{name:'物种全身模板',exact:true}).click();
 assert.equal(await page.getByLabel('模型生成模式',{exact:true}).inputValue(),'padded');
 for(const mode of ['dtd','padded']){
  await page.getByLabel('模型生成模式',{exact:true}).selectOption(mode);
  await page.getByRole('button',{name:'生成 / 更新物种模板',exact:true}).click();
  await waitForState(page,async mode=>{const button=document.querySelector('.project-toolbar button');if(!button||button.disabled)return false;const r=await window.fpcad.read();return r.ok&&r.data.project.surface?.template?.parameters.bodyMode===mode;},mode,{timeout:120000});
  const state=await page.evaluate(()=>window.fpcad.read());assert(state.ok);const mesh=state.data.project.surface;
  assert.equal(mesh.template.parameters.bodyMode,mode);assert.equal(mesh.assembly.components,1);assert(!mesh.template.parts.includes('tail'));
  savedModels.set(mode,structuredClone(mesh));
  await page.setViewportSize({width:1440,height:960});await desktopScreenshot(app,page,{path:resolve(`test-results/wearer/${mode}.png`)});
  results.push({mode,faces:mesh.faces.length,vertices:mesh.vertices.length,measurements:mesh.assembly.measurements});
 }
 const state=await page.evaluate(()=>window.fpcad.read());assert(state.data.project.modelLibrary.length>=2);
 assert.notEqual(savedModels.get('dtd').id,savedModels.get('padded').id);
 assert.notDeepEqual(savedModels.get('dtd').vertices,savedModels.get('padded').vertices);
 // Reload from the real repository, then activate both saved records twice.
 await page.reload();await workflow(page,'model');
 for(const mode of ['dtd','padded','dtd','padded']){
  const expected=savedModels.get(mode),before=await page.evaluate(()=>window.fpcad.read());
  const index=before.data.project.modelLibrary.findIndex(model=>model.id===expected.id);assert(index>=0);
  await page.locator('.model-library .model-record').nth(index).locator('button').first().click();
  await page.waitForFunction(id=>window.fpcad.read().then(r=>r.ok&&r.data.project.surface?.id===id),expected.id);
  const restored=await page.evaluate(()=>window.fpcad.read());assert(restored.ok);
  assert.deepEqual(restored.data.project.surface,expected,'Library activation must restore the exact independently saved '+mode+' mesh');
  for(const [otherMode,other] of savedModels)assert.deepEqual(restored.data.project.modelLibrary.find(model=>model.id===other.id)?.surface,other,'Switching models must preserve '+otherMode);
 }
 await writeFile('test-results/wearer/result.json',JSON.stringify({passed:true,directory,results},null,2));
}catch(e){await desktopScreenshot(app,page,{path:resolve('test-results/wearer/failure.png')}).catch(()=>{});throw e;}finally{await app.close();}
