import {desktopScreenshot} from './desktop-screenshot.mjs';
import { _electron as electron } from 'playwright';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {desktopArgs,executablePath,testedBuild} from './desktop-launch.mjs';
const directory=await mkdtemp(resolve('.local/tests/session-delete-')),env={...process.env,FPCAD_DATA_DIR:directory};delete env.ELECTRON_RUN_AS_NODE;
let app,page;const errors=[];
async function launch(){app=await electron.launch({executablePath,args:desktopArgs,env});page=await app.firstWindow();page.on('pageerror',e=>errors.push(String(e)));await page.waitForFunction(()=>!!window.fpcad);}
const read=()=>page.evaluate(async()=>{const r=await window.fpcad.read();if(!r.ok)throw Error(r.error.code);return r.data;});
async function remove(id){await page.locator(`[data-delete-session-id="${id}"]`).click();await page.getByRole('button',{name:'永久删除',exact:true}).click();await page.locator(`[data-delete-session-id="${id}"]`).waitFor({state:'detached'});}
try{
 await launch();const ids=[];
 for(const name of ['删除测试 A','保留测试 B','当前测试 C']){const r=await page.evaluate(name=>window.fpcad.create({name,unit:'mm'}),name);assert(r.ok);ids.push(r.data.sessionId);}
 const external=join(directory,'separately-saved.fpcad');await writeFile(external,'external copy');
 await page.reload();await page.locator('.project-card').first().waitFor();assert.equal(await page.locator('.project-card').count(),3);
 await page.locator(`[data-delete-session-id="${ids[0]}"]`).click();await page.getByRole('button',{name:'取消',exact:true}).click();assert.equal((await read()).recent.length,3);
 await desktopScreenshot(app,page,{path:'test-results/session-deletion-cards.png'});
 const locked=new DatabaseSync(join(directory,'workspace.sqlite'));locked.exec("CREATE TRIGGER fail_delete BEFORE DELETE ON sessions BEGIN SELECT RAISE(ABORT,'test rollback'); END;");
 await page.locator(`[data-delete-session-id="${ids[0]}"]`).click();await page.getByRole('button',{name:'永久删除',exact:true}).click();await page.locator('[role="dialog"] [role="alert"]').waitFor();assert.equal((await read()).recent.length,3);assert(await page.getByRole('button',{name:'永久删除',exact:true}).isEnabled());locked.exec('DROP TRIGGER fail_delete');locked.close();await page.getByRole('button',{name:'取消',exact:true}).click();
 await remove(ids[0]);assert.equal((await read()).sessionId,ids[2]);assert.equal((await read()).recent.length,2);
 await page.locator('.project-card').first().waitFor();await remove(ids[2]);assert.equal((await read()).project,null);assert.equal((await read()).recent.length,1);assert(await page.locator('.welcome').isVisible());
 await app.close();await launch();await page.locator('.project-card').waitFor();assert.equal(await page.locator('.project-card').count(),1);assert.equal((await read()).recent[0].sessionId,ids[1]);
 await remove(ids[1]);assert.equal((await read()).recent.length,0);assert.equal(await page.locator('.project-card').count(),0);assert((await page.evaluate(id=>window.fpcad.deleteSession(id),ids[1])).ok);
 await app.close();app=null;
 const db=new DatabaseSync(join(directory,'workspace.sqlite'),{readOnly:true});for(const table of ['sessions','commands','events','recovery','requests','resources','jobs'])assert.equal(db.prepare(`SELECT count(*) n FROM ${table}`).get().n,0,table);assert.equal(db.prepare("SELECT count(*) n FROM settings WHERE key='active'").get().n,0);db.close();
 assert.equal(await readFile(external,'utf8'),'external copy');await launch();assert.equal((await read()).recent.length,0);assert.deepEqual(errors,[]);await desktopScreenshot(app,page,{path:'test-results/session-deletion.png'});
 await writeFile('test-results/session-deletion.json',JSON.stringify({passed:true,testedBuild,directory,checks:['cancel preserves projects','storage failure preserves projects and keeps retry dialog','inactive deletion preserves active project','active deletion returns to homepage','restart does not restore deleted projects','last deletion clears every local project table','repeated deletion is safe','external files retained'],errors},null,2));console.log('session deletion passed');
}finally{await app?.close();}
