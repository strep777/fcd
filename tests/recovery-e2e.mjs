import {legacyPatternFixture} from './legacy-pattern-fixtures.mjs';
import {chooseProject} from './ui-navigation.mjs';
import {waitForState} from './wait-state.mjs';
import {workflow,production,activity,openDetails} from './ui-navigation.mjs';
import { _electron as electron } from 'playwright';
import { mkdir,mkdtemp,writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { once } from 'node:events';
import assert from 'node:assert/strict';
await mkdir('.local/tests',{recursive:true});await mkdir('test-results',{recursive:true});
const directory=resolve(await mkdtemp('.local/tests/crash-'));
const env={...process.env,FPCAD_DATA_DIR:directory};delete env.ELECTRON_RUN_AS_NODE;
const executablePath=process.env.FPCAD_TEST_EXECUTABLE;
const args=['--fpcad-background-test','--disable-gpu',...(process.env.FPCAD_TEST_NO_SANDBOX==='1'?['--no-sandbox']:[]),...(executablePath?[]:['.'])];
let app=await electron.launch({args,env,executablePath});
try{
 let page=await app.firstWindow();
 await page.getByRole('button',{name:'＋ 新建项目',exact:true}).first().click();
 await page.getByRole('dialog').locator('input').fill('强杀恢复验证');await page.getByRole('button',{name:'创建 →',exact:true}).click();
 let response;
 await workflow(page,'pattern');await legacyPatternFixture(page);
 await waitForState(page,async()=>{const r=await window.fpcad.read();return r.ok&&r.data.project?.pieces.length===1;});
 response=await page.evaluate(()=>window.fpcad.read());assert(response.ok);const expected=response.data.project;
 // Abruptly terminate Main: no close event, checkpoint, or graceful SQLite close.
 const descendants=await app.evaluate(({app})=>app.getAppMetrics().map(p=>p.pid));
 const child=app.process(),exited=once(child,'exit');assert(child.kill('SIGKILL'));await exited;
 for(const pid of descendants){if(pid===child.pid)continue;try{process.kill(pid,'SIGKILL');}catch(error){if(error.code!=='ESRCH')throw error;}}
 await new Promise(resolve=>setTimeout(resolve,500));
 app=await electron.launch({args,env,executablePath});page=await app.firstWindow();await chooseProject(page);await page.locator('.workspace').waitFor();
 response=await page.evaluate(()=>window.fpcad.read());assert(response.ok);assert.deepEqual(response.data.project,expected);assert(response.data.canUndo);
 response=await page.evaluate(async()=>{const r=await window.fpcad.read();return window.fpcad.undo(r.data.project.id,r.data.project.revision);});assert(response.ok);assert.equal(response.data.project.pieces.length,0);assert(response.data.project.revision>expected.revision);
 await writeFile('test-results/crash-recovery.json',JSON.stringify({passed:true,directory,executable:executablePath??'node_modules/electron',osSandboxDisabledForTest:process.env.FPCAD_TEST_NO_SANDBOX==='1',checks:['committed command survives Main SIGKILL','active project recovered','undo journal survives crash','revision remains monotonic'],revision:expected.revision},null,2));
 console.log('Abrupt Main termination recovery passed:',directory);
}finally{await app.close();}
