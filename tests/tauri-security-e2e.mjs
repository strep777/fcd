import assert from 'node:assert/strict';
import {mkdtemp,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {desktop} from './tauri-desktop.mjs';
const directory=await mkdtemp(resolve('.local/tests/tauri-security-')),app=await desktop.launch({env:{...process.env,FPCAD_DATA_DIR:directory}}),page=await app.firstWindow();
try{
 const result=await page.evaluate(async()=>{
  const invoke=window.__TAURI_INTERNALS__.invoke,rejected=async(command,args)=>{try{await invoke(command,args);return false;}catch{return true;}};
  return {node:typeof window.require,process:typeof window.process,frozen:Object.isFrozen(window.fpcad),unknown:await rejected('desktop_request',{channel:'shell:execute',payload:{command:'unused'}}),emit:await rejected('plugin:event|emit',{event:'fpcad:changed',payload:null}),shell:await rejected('plugin:shell|execute',{program:'unused'}),files:await rejected('plugin:fs|read_text_file',{path:'unused'})};
 });
 assert.deepEqual(result,{node:'undefined',process:'undefined',frozen:true,unknown:true,emit:true,shell:true,files:true});
 const url=page.url(),pages=page.context().pages().length;
 await page.evaluate(()=>{window.open('https://example.com/');location.href='https://example.com/';});
 await page.waitForTimeout(250);assert.equal(page.url(),url);assert.equal(page.context().pages().length,pages);
 await writeFile('test-results/tauri-security.json',JSON.stringify({passed:true,result,navigationBlocked:true,newWindowBlocked:true},null,2));console.log('Tauri command permissions and navigation guards passed');
}finally{await app.close();}
