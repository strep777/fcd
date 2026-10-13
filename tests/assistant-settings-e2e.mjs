import {desktopScreenshot} from './desktop-screenshot.mjs';
import {_electron as electron} from 'playwright';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {desktopArgs,executablePath,testedBuild} from './desktop-launch.mjs';
const directory=await mkdtemp(resolve('.local/tests/assistant-layout-')),env={...process.env,FPCAD_DATA_DIR:directory};delete env.ELECTRON_RUN_AS_NODE;
let app=await electron.launch({executablePath,args:desktopArgs,env}),page=await app.firstWindow();const errors=[];page.on('pageerror',e=>errors.push(e.message));
try{
 assert.equal(await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().some(w=>w.isVisible())),false,'test window must not steal focus');
 await page.getByRole('button',{name:'AI 助手',exact:true}).click();await page.getByRole('tab',{name:'模型管理',exact:true}).waitFor();await page.getByLabel('编辑提供商连接',{exact:true}).waitFor();assert.equal(await page.getByLabel('编辑提供商连接',{exact:true}).locator('option').count(),5);
 await page.getByRole('tab',{name:'技能',exact:true}).click();await page.getByRole('button',{name:'＋ 新建技能',exact:true}).click();await page.getByLabel('技能名称').fill('检查裁片');await page.getByLabel('技能内容').fill('核对接缝长度和裁片真实尺寸。');await page.getByRole('button',{name:'保存设置',exact:true}).click();await page.getByRole('status').waitFor();
 await page.getByRole('tab',{name:'MCP',exact:true}).click();await page.getByRole('button',{name:'＋ 添加 MCP',exact:true}).click();await page.getByLabel('MCP 名称').fill('本机裁片工具');await page.getByRole('button',{name:'保存设置',exact:true}).click();await page.getByRole('status').waitFor();
 await page.reload();await page.getByRole('button',{name:'AI 助手',exact:true}).click();await page.getByRole('tab',{name:'技能',exact:true}).click();await page.getByLabel('技能名称').waitFor();assert.equal(await page.getByLabel('技能名称').inputValue(),'检查裁片');assert.equal(await page.getByLabel('技能内容').inputValue(),'核对接缝长度和裁片真实尺寸。');
 await page.getByRole('button',{name:'＋ 新建项目',exact:true}).click();await page.getByRole('dialog').waitFor();await page.keyboard.press('Escape');await page.getByRole('dialog').waitFor({state:'detached'});
 await desktopScreenshot(app,page,{path:'test-results/assistant-settings.png'});assert.deepEqual(errors,[]);await writeFile('test-results/assistant-layout.json',JSON.stringify({passed:true,testedBuild,checks:['background window remains hidden','5 preset providers','skills create/save/reload','MCP create/save','modal keyboard in assistant'],errors},null,2));console.log('assistant settings passed');
}finally{await app.close();}
