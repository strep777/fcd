// Read-only recovery of the real result when WebView2 evicts the large IPC
// response from its inspector cache. This never computes or imports a run.
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {constants,setPriority} from 'node:os';
import {desktop} from './tauri-desktop.mjs';
import {desktopArgs,executablePath} from './desktop-launch.mjs';
import {chooseProject,workflow} from './ui-navigation.mjs';
import {desktopScreenshot} from './desktop-screenshot.mjs';
import {assertDesignCutContract} from './cut-result-contract.mjs';
const source=resolve(process.env.FPCAD_REFERENCE_SHEET_SOURCE),output=resolve(source,'native-cut');
const initial=JSON.parse(await readFile(resolve(output,'report.json'),'utf8')),input=JSON.parse(await readFile(resolve(source,'colored-cut-input.json'),'utf8'));
assert(initial.closed&&initial.error.includes('evicted from inspector cache'));
const report={passed:false,scope:'Read-only inspection of persisted native candidate after observed original calculation; no recomputation',started:new Date().toISOString(),originalReport:resolve(output,'report.json')};
let app;
try{
 app=await desktop.launch({args:desktopArgs,executablePath,env:{...process.env,FPCAD_DATA_DIR:initial.directory}});setPriority(app.process().pid,constants.priority.PRIORITY_LOW);const page=await app.firstWindow();page.setDefaultTimeout(120000);await chooseProject(page);
 assert(await app.evaluate(({DesktopWindow})=>DesktopWindow.getAllWindows().every(w=>!w.isVisible())));
 const result=JSON.parse(await page.evaluate(async()=>{const r=await window.fpcad.read();if(!r.ok)throw Error(JSON.stringify(r));return JSON.stringify(r.data.project);}));
 await writeFile(resolve(output,'candidate-project.json'),JSON.stringify(result));assert(result.surfaceRun&&!result.surfaceRun.accepted);
 for(const key of ['surface','references','patternLibrary'])assert.deepEqual(result[key],input[key]);
 report.physical=assertDesignCutContract(result);report.pieces=result.surfaceRun.pieces.length;
 assert(report.pieces>=10&&report.pieces<=50,'Expected economical whole-garment piece count');
 await workflow(page,'cutting');await desktopScreenshot(app,page,{path:resolve(output,'candidate.png')});report.passed=true;
}catch(error){report.error=String(error.stack??error);console.error(report.error);process.exitCode=1;}
finally{if(app)await app.close();report.finished=new Date().toISOString();await writeFile(resolve(output,'inspection-report.json'),JSON.stringify(report,null,2));}
