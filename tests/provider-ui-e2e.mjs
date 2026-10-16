import {_electron as electron} from 'playwright';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {mkdtemp,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {desktopArgs,executablePath,testedBuild} from './desktop-launch.mjs';
const directory=await mkdtemp(resolve('.local/tests/provider-ui-')),env={...process.env,FPCAD_DATA_DIR:directory};delete env.ELECTRON_RUN_AS_NODE;
const calls=[],server=createServer((req,res)=>{calls.push(req.url);res.setHeader('Content-Type','application/json');res.end(JSON.stringify(req.url==='/api/tags'?{models:[{name:'local-test:latest'}]}:{error:'wrong API'}));});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const app=await electron.launch({executablePath,args:desktopArgs,env}),page=await app.firstWindow(),errors=[],checks=[];page.on('pageerror',e=>errors.push(e.message));
try{
 assert.equal(await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().some(w=>w.isVisible())),false);
 await page.getByRole('button',{name:'AI 助手',exact:true}).click();await page.locator('.provider-card').first().waitFor();
 const card=page.locator('.provider-card').first();await card.locator('select').selectOption('ollama');
 assert.equal(await card.locator('input[type=url]').inputValue(),'http://127.0.0.1:11434');
 await card.locator('input[type=url]').fill(`http://127.0.0.1:${server.address().port}`);
 await card.getByRole('button',{name:'连接并获取模型',exact:true}).click();await page.getByRole('status').filter({hasText:'已获取模型：1'}).waitFor();
 assert.deepEqual(calls,['/api/tags']);checks.push('dropdown changes native defaults and actual connection uses Ollama /api/tags');
 await page.getByLabel('默认模型连接',{exact:true}).selectOption(JSON.stringify(['deepseek','local-test:latest']));await page.getByRole('button',{name:'保存设置',exact:true}).click();await page.getByRole('status').filter({hasText:'设置已保存'}).waitFor();
 await page.reload();await page.getByRole('button',{name:'AI 助手',exact:true}).click();await page.getByRole('tab',{name:'模型管理',exact:true}).click();assert.equal(await page.getByLabel('默认模型连接',{exact:true}).inputValue(),JSON.stringify(['deepseek','local-test:latest']));checks.push('native model selection persists through reload');
 await page.locator('.model-card').first().getByRole('button',{name:'编辑连接',exact:true}).click();await card.locator('input[type=url]').fill('HTTP://192.0.2.1:11434');await page.getByRole('button',{name:'保存设置',exact:true}).click();await page.getByRole('alert').filter({hasText:'允许 HTTP 连接'}).waitFor();assert(!await page.getByRole('alert').innerText().then(t=>t.includes('"path"')));
 await card.getByLabel('允许 HTTP 连接（适用于自建服务）').check();await page.getByRole('button',{name:'保存设置',exact:true}).click();await page.getByRole('status').filter({hasText:'设置已保存'}).waitFor();assert.equal(calls.length,1,'saving must not initiate a remote request');checks.push('explicit HTTP server setting saves without connecting, validation is localized');
 for(const width of [1000,1440]){await page.setViewportSize({width,height:960});const layout=await page.locator('.provider-grid').evaluate(el=>{const cards=[...el.children].map(c=>c.getBoundingClientRect());return {overflow:document.documentElement.scrollWidth>innerWidth,gap:parseFloat(getComputedStyle(el).gap),rows:cards.map(r=>({x:r.x,y:r.y,w:r.width,h:r.height})),controlGaps:[...el.querySelectorAll('.provider-card')].flatMap(c=>[...c.children].slice(1).map((child,i)=>child.getBoundingClientRect().top-c.children[i].getBoundingClientRect().bottom))};});assert(!layout.overflow);assert(layout.gap>=8);assert(layout.controlGaps.every(g=>g>=5));checks.push({width,layout});}
 await page.getByRole('button',{name:'AI 助手',exact:true}).click();await page.getByRole('button',{name:'＋ 新建项目',exact:true}).first().click();await page.getByRole('dialog').locator('input').fill('页面警告验证');await page.getByRole('button',{name:'创建 →',exact:true}).click();await page.locator('.workflow-nav>button[data-stage=model]').click();
 const invalid=resolve(directory,'invalid.obj');await writeFile(invalid,'not a valid mesh');await app.evaluate(({dialog},file)=>dialog.showOpenDialog=async()=>({canceled:false,filePaths:[file]}),invalid);await page.getByRole('button',{name:'导入三角 OBJ / GLB',exact:true}).click();await page.locator('.error-banner').waitFor();const failure=await page.locator('.error-banner').innerText();
 await page.locator('.workflow-nav>button[data-stage=references]').click();assert.equal(await page.locator('.error-banner').isVisible(),false);await page.locator('.workflow-nav>button[data-stage=model]').click();assert.equal(await page.locator('.error-banner').innerText(),failure);checks.push('real failed model import remains on model page only');
 assert.deepEqual(errors,[]);await writeFile('test-results/provider-ui.json',JSON.stringify({passed:true,testedBuild,checks,errors},null,2));console.log('Provider and scoped-error UI passed');
}finally{await app.close();server.closeAllConnections();await new Promise(r=>server.close(r));}
