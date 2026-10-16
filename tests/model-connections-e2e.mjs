import {_electron as electron} from 'playwright';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {desktopArgs,executablePath,testedBuild} from './desktop-launch.mjs';
import {desktopScreenshot} from './desktop-screenshot.mjs';
const directory=await mkdtemp(resolve('.local/tests/model-connections-')),env={...process.env,FPCAD_DATA_DIR:directory};delete env.ELECTRON_RUN_AS_NODE;
const app=await electron.launch({executablePath,args:desktopArgs,env}),page=await app.firstWindow(),errors=[];page.on('pageerror',e=>errors.push(e.message));
try{
 assert.equal(await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().some(w=>w.isVisible())),false);
 await page.getByRole('button',{name:'AI 助手',exact:true}).click();await page.getByRole('tab',{name:'模型管理',exact:true}).waitFor();
 assert.equal(await page.getByRole('tab',{name:'提供商',exact:true}).count(),0,'model management must be the single connection entry');
 await page.getByLabel('新增模型标识',{exact:true}).fill('shared-model');await page.getByLabel('新增模型的提供商',{exact:true}).selectOption('ollama');await page.getByRole('button',{name:'添加模型',exact:true}).click();
 const card=page.locator('.model-card').filter({has:page.getByRole('heading',{name:'shared-model',exact:true})});await card.waitFor();
 await card.getByLabel('添加提供商连接',{exact:true}).selectOption('lmstudio');await card.getByRole('button',{name:'添加连接',exact:true}).click();assert.equal(await card.locator('.model-provider').count(),2);
 const lm=card.locator('.model-provider').filter({hasText:'LM Studio'});await lm.getByRole('button',{name:'设为默认',exact:true}).click();await page.getByRole('button',{name:'保存设置',exact:true}).click();await page.getByRole('status').waitFor();
 await page.reload();await page.getByRole('button',{name:'AI 助手',exact:true}).click();await card.waitFor();assert.equal(await card.locator('.model-provider').count(),2);assert.equal(await lm.getByRole('button',{name:'当前默认',exact:true}).count(),1);
 await page.getByLabel('新增模型标识',{exact:true}).fill('shared-model');await page.getByLabel('新增模型的提供商',{exact:true}).selectOption('ollama');await page.getByRole('button',{name:'添加模型',exact:true}).click();assert.equal(await card.locator('.model-provider').count(),2,'adding the same pair must not duplicate a model');
 for(const width of [1000,1440]){await page.setViewportSize({width,height:960});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,'model connections must fit the viewport');}
 await desktopScreenshot(app,page,{path:'test-results/model-connections.png'});
 await lm.getByRole('button',{name:'编辑连接',exact:true}).click();assert.equal(await page.getByLabel('编辑提供商连接',{exact:true}).inputValue(),'lmstudio');
 await lm.getByRole('button',{name:'移除此连接',exact:true}).click();assert.equal(await card.locator('.model-provider').count(),1);assert.equal(await page.getByLabel('默认模型连接',{exact:true}).inputValue(),'');
 await page.getByRole('button',{name:'保存设置',exact:true}).click();await page.getByRole('status').waitFor();await page.reload();await page.getByRole('button',{name:'AI 助手',exact:true}).click();await card.waitFor();assert.equal(await card.locator('.model-provider').count(),1);
 assert.deepEqual(errors,[]);await writeFile('test-results/model-connections.json',JSON.stringify({passed:true,testedBuild,checks:['single models entry','one model with two providers','default pair persists','inline connection editing','unlink clears only selected pair','unlink persists'],errors},null,2));console.log('Model connections passed');
}finally{await app.close();}
