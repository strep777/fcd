import {_electron as electron} from 'playwright';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {desktopArgs,executablePath,testedBuild} from './desktop-launch.mjs';
import {desktopScreenshot} from './desktop-screenshot.mjs';
const directory=await mkdtemp(resolve('.local/tests/japanese-ui-')),env={...process.env,FPCAD_DATA_DIR:directory};delete env.ELECTRON_RUN_AS_NODE;
const app=await electron.launch({executablePath,args:desktopArgs,env}),page=await app.firstWindow(),checks=[],errors=[];page.on('pageerror',e=>errors.push(e.message));
try{
 await page.getByLabel('Language',{exact:true}).selectOption('ja');await page.reload();assert.equal(await page.getByLabel('Language',{exact:true}).inputValue(),'ja');assert.match(await page.locator('.welcome').innerText(),/[\u3040-\u30ff]/);checks.push('Japanese selection survives reload');
 await page.getByLabel('Language',{exact:true}).selectOption('zh');await page.getByRole('button',{name:'＋ 新建项目',exact:true}).first().click();await page.getByRole('dialog').locator('input').fill('Keep My Project 名称');await page.getByRole('button',{name:'创建 →',exact:true}).click();await page.locator('.workflow-nav>button[data-stage]').first().waitFor();
 await page.getByLabel('Language',{exact:true}).selectOption('ja');for(const stage of ['guide','references','model','mapping','cutting','assembly','pattern']){await page.locator('.workflow-nav>button[data-stage="'+stage+'"]').click();const label=await page.locator('.workflow-nav>button[data-stage="'+stage+'"]').innerText();assert.match(label,/[\u3040-\u30ff\u3400-\u9fff]/);assert(!/User guide|Extract|Model management|Mapping|Cutting|Production/.test(label));checks.push({stage,label});}
 await page.locator('.workflow-nav>button[data-stage=assembly]').click();assert.match(await page.locator('.assembly-page').innerText(),/組み立て/);assert(!(await page.locator('.assembly-page').innerText()).includes('No bound cuts'));checks.push('New assembly page is localized');await page.locator('.workflow-nav>button[data-stage=guide]').click();assert.match(await page.locator('.guide-page').innerText(),/プロジェクト/);assert(!(await page.locator('.guide-page').innerText()).includes('在项目首页'));assert((await page.locator('.project-title').innerText()).includes('Keep My Project 名称'));
 await page.getByLabel('Language',{exact:true}).selectOption('en');assert.match(await page.locator('.guide-page').innerText(),/Open or create a project/);assert(!(await page.locator('.guide-page').innerText()).includes('在项目首页'));
 await page.getByLabel('Language',{exact:true}).selectOption('ja');await page.getByRole('button',{name:/AI/}).filter({hasText:'AI'}).first().click();await page.locator('.assistant-page').waitFor();assert.match(await page.locator('.assistant-page').innerText(),/設定/);assert.equal(await page.locator('.provider-card').count(),1);assert.equal(await page.locator('.connection-settings>label select option').count(),5);
 await desktopScreenshot(app,page,{path:'test-results/japanese-assistant.png'});assert.deepEqual(errors,[]);await writeFile('test-results/japanese-ui.json',JSON.stringify({passed:true,testedBuild,checks,errors},null,2));console.log('Japanese UI passed');
}finally{await app.close();}
