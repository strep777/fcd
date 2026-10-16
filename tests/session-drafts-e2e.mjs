import {chooseProject} from './ui-navigation.mjs';
import {_electron as electron} from 'playwright';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {desktopArgs,executablePath} from './desktop-launch.mjs';
import {workflow} from './ui-navigation.mjs';
const directory=await mkdtemp(resolve('.local/tests/session-drafts-')),env={...process.env,FPCAD_DATA_DIR:directory};delete env.ELECTRON_RUN_AS_NODE;
const app=await electron.launch({args:desktopArgs,executablePath,env}),page=await app.firstWindow(),checks=[],errors=[];page.setDefaultTimeout(10000);page.on('pageerror',e=>errors.push(e.message));
try{
 await page.waitForFunction(()=>!!window.fpcad);
 const seeded=await page.evaluate(async()=>{const vertices=[[0,0,0],[100,0,0],[100,100,0],[0,100,0]].map(([xMm,yMm,zMm])=>({id:crypto.randomUUID(),xMm,yMm,zMm})),surface={id:crypto.randomUUID(),source:'obj',topologyVersion:1,vertices,faces:[[0,1,2],[0,2,3]].map(t=>({id:crypto.randomUUID(),region:'body',vertices:t.map(i=>vertices[i].id)}))};for(const name of ['项目 A']){let r=await window.fpcad.create({name,unit:'mm'});if(!r.ok)return r;r=await window.fpcad.apply(r.data.project.id,r.data.project.revision,{type:'surface.set',surface});if(!r.ok)return r;}return {ok:true};});assert(seeded.ok);
 const file=resolve(directory,'same-project.fpcad');await app.evaluate(({dialog},file)=>{dialog.showSaveDialog=async()=>({canceled:false,filePath:file});dialog.showOpenDialog=async()=>({canceled:false,filePaths:[file]});},file);assert((await page.evaluate(async()=>{const r=await window.fpcad.read();return window.fpcad.save(r.data.project.id,r.data.project.revision,true);})).ok);assert((await page.evaluate(()=>window.fpcad.open())).ok);
 await page.reload();await chooseProject(page);await workflow(page,'mapping');await page.getByRole('button',{name:'绘制三维花纹',exact:true}).click();const view=page.locator('.surface-view'),b=await view.boundingBox();for(const [x,y] of [[.45,.4],[.55,.4],[.5,.6]])await page.mouse.click(b.x+b.width*x,b.y+b.height*y);assert(await page.getByRole('button',{name:'闭合并贴附',exact:true}).isEnabled());
 await page.locator('.local-sessions>button').click();await page.locator('.recent-list button').nth(1).click();await page.waitForFunction(()=>!document.querySelector('.recent-list'));
 assert.equal(await page.getByRole('button',{name:'闭合并贴附',exact:true}).count(),0,'A draft from another project survived the switch with shared model IDs');checks.push('switching sessions of the same archive clears uncommitted surface drafts');
 const result=await page.evaluate(()=>window.fpcad.read());assert.equal(result.data.project.markings?.length??0,0);checks.push('switch did not commit the abandoned draft');
}finally{await writeFile('test-results/session-drafts.json',JSON.stringify({passed:checks.length===2&&!errors.length,checks,errors},null,2));await app.close();}
