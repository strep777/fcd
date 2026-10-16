import {_electron as electron} from 'playwright';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {desktopArgs,executablePath,testedBuild} from './desktop-launch.mjs';

// A first launch must never touch the user's actual workspace.
const directory=resolve(await mkdtemp('.local/tests/clean-start-'));
const env={...process.env,FPCAD_DATA_DIR:directory};delete env.ELECTRON_RUN_AS_NODE;
const app=await electron.launch({executablePath,env,args:desktopArgs});
const errors=[];
try{
 const page=await app.firstWindow();page.on('pageerror',e=>errors.push(e.message));
 await page.waitForFunction(()=>!!window.fpcad);
 const result=await page.evaluate(()=>window.fpcad.read());assert(result.ok);
 assert.equal(result.data.project,null);assert.deepEqual(result.data.recent,[]);assert.deepEqual(result.data.jobs,[]);
 await page.getByRole('button',{name:'＋ 新建项目',exact:true}).first().waitFor();
 assert.deepEqual(errors,[]);
 const report={passed:true,directory,build:testedBuild,checks:['empty project','empty recent projects','empty jobs','new-project entry available','no renderer errors']};
 await writeFile('test-results/clean-start.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}finally{await app.close();}
