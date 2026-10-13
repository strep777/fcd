import {_electron as electron} from 'playwright';
import {DatabaseSync} from 'node:sqlite';
import {mkdtemp,writeFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import assert from 'node:assert/strict';
import {executablePath,desktopArgs} from './desktop-launch.mjs';
const directory=await mkdtemp(resolve('.local/tests/corrupt-startup-')),env={...process.env,FPCAD_DATA_DIR:directory};delete env.ELECTRON_RUN_AS_NODE;
let app;const errors=[],checks=[];
try{
 app=await electron.launch({executablePath,args:desktopArgs,env});let page=await app.firstWindow();await page.waitForFunction(()=>!!window.fpcad);
 const ids=await page.evaluate(async()=>{let r=await window.fpcad.create({name:'可恢复项目',unit:'mm'});if(!r.ok)throw Error(JSON.stringify(r));const good=r.data.recent[0].sessionId;r=await window.fpcad.create({name:'损坏的当前项目',unit:'mm'});if(!r.ok)throw Error(JSON.stringify(r));return {good,broken:r.data.recent[0].sessionId};});await app.close();app=undefined;
 const path=join(directory,'workspace.sqlite'),db=new DatabaseSync(path);try{db.prepare('UPDATE sessions SET state=? WHERE id=?').run('broken JSON',ids.broken);}finally{db.close();}
 app=await electron.launch({executablePath,args:desktopArgs,env});page=await app.firstWindow();page.on('pageerror',e=>errors.push(e.message));await page.locator('.error-banner').filter({hasText:'已保留原记录'}).waitFor();assert(await page.locator('.welcome').isVisible());const startup=await page.evaluate(()=>window.fpcad.read());assert(startup.ok&&startup.data.project===null&&startup.data.notice==='PROJECT_INVALID');checks.push('corrupt active session starts safely and displays a recovery notice');
 await page.locator('.local-sessions>button').click();await page.locator('.recent-list>button').filter({hasText:'可恢复项目'}).click();await page.locator('.project-title').filter({hasText:'可恢复项目'}).waitFor();const activated=await page.evaluate(()=>window.fpcad.read());assert(activated.ok&&activated.data.project.name==='可恢复项目'&&!activated.data.notice);checks.push('another local project remains available through the normal interface');
 const edited=await page.evaluate(async()=>{const r=await window.fpcad.read();return window.fpcad.apply(r.data.project.id,r.data.project.revision,{type:'project.rename',name:'恢复后仍可编辑'});});assert(edited.ok);await app.close();app=undefined;
 const retained=new DatabaseSync(path);try{assert.equal(retained.prepare('SELECT state FROM sessions WHERE id=?').get(ids.broken).state,'broken JSON');assert(Number(retained.prepare('SELECT count(*) AS n FROM recovery WHERE session_id=?').get(ids.broken).n)>0);}finally{retained.close();}checks.push('damaged records and recovery points are retained; healthy project edits still persist');
 assert.deepEqual(errors,[]);await writeFile('test-results/corrupt-session.json',JSON.stringify({passed:true,checks,errors,directory},null,2));console.log(JSON.stringify({passed:true,checks}));
}finally{if(app)await app.close();}
