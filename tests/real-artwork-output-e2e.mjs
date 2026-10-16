import {_electron as electron} from 'playwright';
import assert from 'node:assert/strict';
import {mkdtemp,copyFile,readFile,writeFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {XMLParser} from 'fast-xml-parser';
import {desktopArgs,executablePath,testedBuild} from './desktop-launch.mjs';
import {desktopScreenshot} from './desktop-screenshot.mjs';
import {workflow} from './ui-navigation.mjs';

const input=process.env.FPCAD_REAL_CUT_PROJECT;
assert(input,'Set FPCAD_REAL_CUT_PROJECT to an accepted real-artwork test project');
const directory=await mkdtemp(resolve('.local/tests/real-artwork-output-')),projectFile=join(directory,'roundtrip.fpcad');
await copyFile(input,projectFile);
const env={...process.env,FPCAD_DATA_DIR:directory};delete env.ELECTRON_RUN_AS_NODE;
const app=await electron.launch({args:desktopArgs,executablePath,env}),page=await app.firstWindow(),checks=[],errors=[];
page.setDefaultTimeout(60000);page.on('pageerror',e=>errors.push(e.message));
const record=message=>{checks.push(message);console.log(message);};
async function state(){return page.evaluate(async()=>{
 const r=await window.fpcad.read();if(!r.ok)throw Error(JSON.stringify(r));const p=r.data.project,entry=p.cuttingLibrary[0];
 const stable=JSON.stringify(entry,(_key,value)=>value&&typeof value==='object'&&!Array.isArray(value)?Object.fromEntries(Object.keys(value).sort().map(key=>[key,value[key]])):value);
 return {pieces:p.pieces.length,markings:p.markings.length,archiveHash:Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(stable)))).map(v=>v.toString(16).padStart(2,'0')).join(''),errors:r.data.geometry.flatMap(g=>g.issues).filter(i=>i.severity==='error'),warnings:r.data.geometry.flatMap(g=>g.issues.filter(i=>i.severity==='warning')).length};
 });}
try{
 await page.setViewportSize({width:1440,height:1000});await page.waitForFunction(()=>!!window.fpcad);
 await app.evaluate(({dialog},path)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[path]});},projectFile);
 const opened=await page.evaluate(async()=>{const r=await window.fpcad.open();return r.ok?{ok:true}:r;});assert(opened.ok,JSON.stringify(opened));
 const before=await state();assert(before.pieces>100&&before.pieces<=500);assert.deepEqual(before.errors,[]);record('Saved real-artwork project reopens with valid manufacturing geometry');
 const svgPath=join(directory,'real-artwork.svg');await app.evaluate(({dialog},filePath)=>{dialog.showSaveDialog=async()=>({canceled:false,filePath});},svgPath);
 const exported=await page.evaluate(async()=>{const r=await window.fpcad.read(),p=r.data.project,ack=r.data.geometry.flatMap(g=>g.issues.filter(i=>i.severity==='warning').map(i=>i.ruleId)),out=await window.fpcad.export(p.id,p.revision,'svg',ack);return out.ok?{ok:true,ackCount:ack.length}:out;});assert(exported.ok,JSON.stringify(exported));
 const text=await readFile(svgPath,'utf8'),svg=new XMLParser({ignoreAttributes:false}).parse(text).svg,metadata=JSON.parse(svg.metadata),cut=svg.g.find(g=>g['@_id']==='Cut');
 assert.equal(new Set(metadata.pieces.map(p=>p.id)).size,before.pieces);assert.equal(cut.path.length,metadata.pieces.length);assert.equal(metadata.unit,'mm');
 const dimensions=svg['@_viewBox'].split(' ').map(Number);assert.equal(Number(svg['@_width'].replace('mm','')),dimensions[2]);assert.equal(Number(svg['@_height'].replace('mm','')),dimensions[3]);assert.equal(svg.path['@_d'],'M10 12 H110 M10 10 V14 M110 10 V14');assert(!/\b(?:NaN|Infinity)\b/.test(text));
 record('SVG contains every real-size cut and the 100 mm calibration line after acknowledging all warnings');
 const again=await page.evaluate(async()=>{const r=await window.fpcad.open();return r.ok?{ok:true}:r;});assert(again.ok,JSON.stringify(again));assert.equal((await state()).archiveHash,before.archiveHash);record('Export and subsequent project reopen preserve every archived cut');
 await page.reload();await workflow(page,'cutting');await desktopScreenshot(app,page,{path:'test-results/real-artwork-output.png'});assert.deepEqual(errors,[]);
 await writeFile('test-results/real-artwork-output.json',JSON.stringify({passed:true,build:testedBuild,directory,...before,ackCount:exported.ackCount,cutPaths:cut.path.length,checks,errors},null,2));
}catch(error){await writeFile('test-results/real-artwork-output.json',JSON.stringify({passed:false,build:testedBuild,directory,checks,errors,error:String(error)},null,2));throw error;}finally{await app.close();}
