// Uses the isolated source-level acceptance snapshots, never the user database.
import {_electron as electron} from 'playwright';
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import assert from 'node:assert/strict';
import UPNG from '@pdf-lib/upng';
import {desktopArgs,executablePath} from './desktop-launch.mjs';
import {desktopScreenshot} from './desktop-screenshot.mjs';
import {workflow} from './ui-navigation.mjs';
const folder=resolve('.local/tests/mapping-registration-quality'),codec=UPNG.default??UPNG,checks=[],errors=[];
await mkdir('test-results',{recursive:true});
for(const state of ['before','after']){
 const env={...process.env,FPCAD_DATA_DIR:resolve(folder,state)};delete env.ELECTRON_RUN_AS_NODE;
 const app=await electron.launch({args:desktopArgs,executablePath,env});
 try{
  const page=await app.firstWindow();page.on('pageerror',error=>errors.push(error.message));page.setDefaultTimeout(15000);await page.setViewportSize({width:1440,height:960});await workflow(page,'mapping');
  const snapshot=await page.evaluate(()=>window.fpcad.read());assert(snapshot.ok,JSON.stringify(snapshot));assert.equal(snapshot.data.project.patternLibrary.length,85);assert.equal(snapshot.data.project.surface.faces.length,8534);assert(snapshot.data.project.markings.length>=59);
  const view=page.locator('.surface-view');
  for(const [name,suffix]of [['正面','front'],['背面','back'],['左侧','side']]){
   await page.locator('.surface-panel').getByRole('button',{name,exact:true}).click();
   const buffer=await desktopScreenshot(app,page,{clip:await view.boundingBox(),path:resolve(folder,`native-${state}-${suffix}.png`)}),decoded=codec.decode(buffer.buffer.slice(buffer.byteOffset,buffer.byteOffset+buffer.byteLength)),rgba=new Uint8Array(codec.toRGBA8(decoded)[0]);
   assert(rgba.some((v,i)=>i%4===0&&v<170),'Actual model must render in the hidden native capture');checks.push(`${state} real curved ${suffix} preview with original extracted fragments`);
  }
 }finally{await app.close();}
}
assert.deepEqual(errors,[]);await writeFile('test-results/mapping-registration-preview.json',JSON.stringify({checks,errors,passed:checks.length===6&&!errors.length},null,2));console.log(JSON.stringify({checks,errors}));
