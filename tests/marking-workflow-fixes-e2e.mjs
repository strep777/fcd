import {desktop} from './tauri-desktop.mjs';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {desktopArgs,executablePath,testedBuild} from './desktop-launch.mjs';
import {workflow,surfaceCoordinates} from './ui-navigation.mjs';
import {waitForState} from './wait-state.mjs';
import {desktopScreenshot} from './desktop-screenshot.mjs';

const directory=await mkdtemp(resolve('.local/tests/complex-source-drop-')),env={...process.env,FPCAD_DATA_DIR:directory};
const app=await desktop.launch({executablePath,args:desktopArgs,env}),page=await app.firstWindow(),errors=[],checks=[];
page.on('pageerror',e=>errors.push(e.message));page.setDefaultTimeout(20000);
const read=async()=>{const r=await page.evaluate(()=>window.fpcad.read());assert(r.ok,JSON.stringify(r));return r.data.project;};
const changed=before=>waitForState(page,async n=>{const r=await window.fpcad.read();return r.ok&&r.data.project.revision>n;},before,{timeout:60000});
try{
 await page.setViewportSize({width:1440,height:960});await page.waitForFunction(()=>!!window.fpcad);
 assert((await page.evaluate(()=>window.fpcad.create({name:'Complex original curve drop',unit:'mm'}))).ok);
 await app.evaluate(({dialog},path)=>dialog.showOpenDialog=async()=>({canceled:false,filePaths:[path]}),resolve('tests/fixtures/character-blue-white-front-back.png'));
 let r=await page.evaluate(async()=>{const p=(await window.fpcad.read()).data.project;return window.fpcad.importReference(p.id,p.revision,'front');});assert(r.ok,JSON.stringify(r));
 r=await page.evaluate(async()=>{
  let r=await window.fpcad.read(),p=r.data.project;
  const vertices=[{id:crypto.randomUUID(),xMm:0,yMm:0,zMm:0},...Array.from({length:16},(_,i)=>({id:crypto.randomUUID(),xMm:150*Math.cos(i*Math.PI/8),yMm:150*Math.sin(i*Math.PI/8),zMm:0}))];
  const surface={id:crypto.randomUUID(),source:'obj',topologyVersion:1,vertices,faces:Array.from({length:16},(_,i)=>({id:crypto.randomUUID(),vertices:[vertices[0].id,vertices[i+1].id,vertices[(i+1)%16+1].id],region:'body'}))};
  r=await window.fpcad.apply(p.id,p.revision,{type:'surface.set',surface});if(!r.ok)return r;p=r.data.project;
  const count=160,step=2*Math.PI/count,nodes=Array.from({length:count},(_,i)=>({id:crypto.randomUUID(),xMm:60*Math.cos(i*step),yMm:60*Math.sin(i*step)})),control=a=>({id:crypto.randomUUID(),xMm:80*Math.cos(a),yMm:80*Math.sin(a)});
  const piece={id:crypto.randomUUID(),name:'Complex curved source',nodes,curves:nodes.map((n,i)=>({id:crypto.randomUUID(),startNodeId:n.id,endNodeId:nodes[(i+1)%count].id,c1:control((i+1/3)*step),c2:control((i+2/3)*step)})),closed:true,allowanceMm:0,cutQty:1,mirror:false,material:'Pigment',furRad:0,color:'#e23b58'};
  return window.fpcad.apply(p.id,p.revision,{type:'library.region.put',region:{piece,referenceId:p.references[0].id,view:'front',category:'body'}});
 });assert(r.ok,JSON.stringify(r));await page.reload();await workflow(page,'mapping');await page.locator('.surface-panel').getByRole('button',{name:'正面',exact:true}).click();

 const before=await read(),card=page.locator('.mapping-page .region-card').first(),drop=await surfaceCoordinates(page,5,4);
 await card.scrollIntoViewIfNeeded();const box=await card.locator('svg').boundingBox();
 await page.mouse.move(box.x+box.width/2,box.y+box.height/2);await page.mouse.down();
 await page.mouse.move(box.x+box.width/2+12,box.y+box.height/2,{steps:4});
 await page.mouse.move(drop.x,drop.y,{steps:24});await page.mouse.move(drop.x+1,drop.y,{steps:2});await page.mouse.up();
 await changed(before.revision);const after=await read();assert.equal(after.markings.length,1);assert.equal(after.markings[0].surfaceShape.nodes.length,160);assert.deepEqual(after.patternLibrary,before.patternLibrary);
 checks.push('real mouse drag from library to model creates a placement without synthetic drag events');
 await workflow(page,'references');assert.equal(await page.getByLabel('双视图布局',{exact:true}).inputValue(),'front-left');assert.equal(await page.getByLabel('参考图内容',{exact:true}).count(),0);assert.equal(await page.getByLabel('参考高度 mm',{exact:true}).count(),0);
 checks.push('layout selection remains explicit while obsolete extraction tuning controls stay removed');assert.deepEqual(errors,[]);
 await desktopScreenshot(app,page,{path:'test-results/marking-workflow-fixes.png'});
 await writeFile('test-results/marking-workflow-fixes.json',JSON.stringify({passed:true,checks,directory},null,2));console.log(checks.join('\n'));
}finally{await app.close();}
