import {desktopScreenshot} from './desktop-screenshot.mjs';
import {waitForState} from './wait-state.mjs';
import {_electron as electron} from 'playwright';
import assert from 'node:assert/strict';
import {mkdir,mkdtemp,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {executablePath,desktopArgs,testedBuild} from './desktop-launch.mjs';
import {workflow,openDetails} from './ui-navigation.mjs';
await mkdir('.local/tests',{recursive:true});await mkdir('test-results/audit',{recursive:true});
const directory=await mkdtemp(resolve('.local/tests/audit-')),env={...process.env,FPCAD_DATA_DIR:directory};delete env.ELECTRON_RUN_AS_NODE;
const app=await electron.launch({executablePath,args:desktopArgs,env}),page=await app.firstWindow();
page.setDefaultTimeout(5000);
const errors=[],results=[];page.on('pageerror',e=>errors.push(e.message));
const read=async()=>{const r=await page.evaluate(()=>window.fpcad.read());assert(r.ok,JSON.stringify(r));return r.data;};
const check=async(name,fn)=>{try{await fn();results.push({name,passed:true});console.log('PASS',name);}catch(e){results.push({name,passed:false,error:String(e.message)});console.log('FAIL',name,e.message);await desktopScreenshot(app,page,{path:resolve('test-results/audit',name+'.png')});}};
const seed=async(kind='rectangle')=>{
 await page.waitForFunction(()=>!!window.fpcad);
 await page.evaluate(async kind=>{
  const r=await window.fpcad.create({name:'审查项目',unit:'mm'}),p=r.data.project;
  const points=coords=>coords.map(([xMm,yMm])=>({id:crypto.randomUUID(),xMm,yMm}));
  const piece={id:crypto.randomUUID(),name:'审查裁片',nodes:points([[0,0],[100,0],[100,200],[0,200]]),closed:true,allowanceMm:10,cutQty:1,mirror:false,material:'毛皮',furRad:0,color:'#73c9b6'};
  if(kind==='hole')piece.holes=[points([[30,60],[70,60],[70,110],[30,110]])];
  const pieces=[piece];if(kind==='seam')pieces.push({...piece,id:crypto.randomUUID(),name:'第二片',nodes:points([[160,0],[260,0],[260,200],[160,200]])});
  let next=await window.fpcad.apply(p.id,p.revision,{type:'pieces.replace',removeIds:[],pieces});
  if(kind==='seam'){
   const side=i=>({pieceId:pieces[i].id,nodeId:pieces[i].nodes[0].id,endNodeId:pieces[i].nodes[1].id,start:0,end:1,reverse:false});
   next=await window.fpcad.apply(p.id,next.data.project.revision,{type:'seam.put',seam:{id:crypto.randomUUID(),name:'审查接缝',a:side(0),b:side(1),expectedEaseMm:0,toleranceMm:1,locked:false}});
  }
  if(!next.ok)throw Error(JSON.stringify(next));
 },kind);
 await page.reload();await workflow(page,'pattern');await page.getByLabel('界面模式',{exact:true}).selectOption('true');await page.locator('.cut-row>.piece-row').first().click();
};
try{
 await check('allowance-join',async()=>{
  await seed();const r=await page.evaluate(async()=>{const r=await window.fpcad.read(),p=r.data.project;return window.fpcad.offset(p.id,p.revision,p.pieces[0].id,15,'round');});assert(r.ok);
  await waitForState(page,async()=>{const r=await window.fpcad.read();return r.ok&&r.data.jobs[0]?.status==='succeeded';});
  const state=await page.evaluate(async()=>{const r=await window.fpcad.read(),p=r.data.project,j=r.data.jobs[0];return {response:await window.fpcad.acceptResult(p.id,p.revision,j.id,j.resultHash),job:j,projectId:p.id,revision:p.revision};});assert(state.response.ok,JSON.stringify(state));assert.equal(state.response.data.project.pieces[0].join,'round');assert(state.response.data.geometry[0].cut.length>8);
 });
 await check('node-coordinate-sync',async()=>{
  await seed();await page.locator('.pattern-icon-rail').getByRole('button',{name:'节点',exact:true}).click();await page.getByRole('checkbox',{name:'网格吸附 5 mm',exact:true}).uncheck();
  const node=page.locator('.canvas circle[cx="0"][cy="0"]').first(),box=await node.boundingBox();assert(box);
  await page.mouse.move(box.x+box.width/2,box.y+box.height/2);await page.mouse.down();await page.mouse.move(box.x+box.width/2+15,box.y+box.height/2-15,{steps:3});await page.mouse.up();
  await waitForState(page,async()=>{const r=await window.fpcad.read();return r.data.project.pieces[0].nodes[0].xMm!==0;});
  const point=(await read()).project.pieces[0].nodes[0],field=page.locator('.property-body label').filter({hasText:/^X 坐标 mm$/}).locator('input');
  assert(Math.abs(Number(await field.inputValue())-point.xMm)<.001);
  await page.keyboard.press('Control+z');await waitForState(page,async()=>{const r=await window.fpcad.read();return r.data.project.pieces[0].nodes[0].xMm===0;});assert.equal(Number(await field.inputValue()),0);
 });
 await check('hole-node-editing',async()=>{
  await seed('hole');await page.locator('.pattern-icon-rail').getByRole('button',{name:'节点',exact:true}).click();const handle=page.locator('.canvas circle[cx="30"][cy="-60"]');assert.equal(await handle.count(),1);
  await handle.click();const field=page.locator('.property-body label').filter({hasText:/^X 坐标 mm$/}).locator('input');await field.fill('35');await page.getByRole('button',{name:'应用节点坐标',exact:true}).click();
  assert.equal((await read()).project.pieces[0].holes[0][0].xMm,35);
 });
 await check('pan-after-resize',async()=>{
  await page.setViewportSize({width:1000,height:960});await seed();await page.setViewportSize({width:1440,height:680});
  const prior=await page.locator('.canvas').evaluate(s=>({view:[s.viewBox.baseVal.x,s.viewBox.baseVal.y],scale:s.getScreenCTM().a})),box=await page.locator('.canvas').boundingBox();
  await page.mouse.move(box.x+box.width/2,box.y+box.height/2);await page.mouse.down({button:'middle'});await page.mouse.move(box.x+box.width/2+40,box.y+box.height/2+20,{steps:3});await page.mouse.up({button:'middle'});
  const after=await page.locator('.canvas').evaluate(s=>[s.viewBox.baseVal.x,s.viewBox.baseVal.y]);assert(Math.abs(after[0]-prior.view[0]+40/prior.scale)<.01);assert(Math.abs(after[1]-prior.view[1]+20/prior.scale)<.01);
 });
 await check('failed-delete-selection',async()=>{
  await seed('seam');await page.getByRole('button',{name:'删除',exact:true}).click();await page.getByRole('alert').waitFor();assert(await page.locator('.piece-badge').isVisible());assert.equal((await read()).project.pieces.length,2);
 });
 await check('save-while-input-focused',async()=>{
  await seed();await app.evaluate(({dialog},path)=>dialog.showSaveDialog=async()=>({canceled:false,filePath:path}),resolve(directory,'focused.fpcad'));
  await page.locator('.property-body>label').first().locator('input').focus();assert.equal(await page.evaluate(()=>document.activeElement.tagName),'INPUT');await page.keyboard.press('Control+s');
  await waitForState(page,async()=>{const r=await window.fpcad.read();return r.data.savedRevision===r.data.project.revision;},{},{timeout:2000});
 });
 await check('english-minimum-layout',async()=>{
  await seed();await page.setViewportSize({width:1000,height:680});await page.locator('header select').selectOption('en');
  const controls=await page.locator('.pattern-editor .editor-top').evaluate(e=>{const r=e.getBoundingClientRect();return [...e.children].filter(c=>c.tagName==='BUTTON'||c.tagName==='LABEL').map(c=>({text:c.textContent,right:c.getBoundingClientRect().right,max:r.right}));});
  assert(controls.every(c=>c.right<=c.max+1),JSON.stringify(controls));
  await page.locator('header select').selectOption('zh');
 });
 await check('stale-seam-status',async()=>{
  await seed('seam');await page.evaluate(async()=>{const r=await window.fpcad.read(),p=r.data.project,old=p.pieces[1];const piece={...old,nodes:old.nodes.map(n=>({...n,id:crypto.randomUUID()}))};const next=await window.fpcad.apply(p.id,p.revision,{type:'piece.put',piece});if(!next.ok)throw Error(JSON.stringify(next));});
  await page.reload();await workflow(page,'workflow');await page.getByRole('tab',{name:'接缝',exact:true}).click();assert.match(await page.locator('.seam-row').innerText(),/失效|Stale/);assert(!await page.locator('.seam-row').getByRole('button',{name:'生成配对剪口',exact:true}).isEnabled());
 });
 await check('drafts-survive-background-refresh',async()=>{
  await seed();await openDetails(page,'缝份');const join=page.locator('.property-group select').first(),width=page.locator('.property-group label').filter({hasText:/^缝份/}).locator('input');await join.selectOption('bevel');await width.fill('23');
  await openDetails(page,'节点与三次 Bézier');const handle=page.locator('.advanced-tools label').filter({hasText:'C1 Y'}).locator('input');await handle.fill('-27');
  await page.evaluate(async()=>{const r=await window.fpcad.read(),p=r.data.project;return window.fpcad.offset(p.id,p.revision,p.pieces[0].id,10,'miter');});
  await page.locator('.activity-toggle').click();await page.locator('.activity-panel .tabs button').nth(1).click();await page.getByRole('button',{name:'采用结果',exact:true}).waitFor();
  assert.equal(await join.inputValue(),'bevel');assert.equal(await width.inputValue(),'23');assert.equal(await handle.inputValue(),'-27');
 });
 await check('reference-calibration-undo',async()=>{
  await seed();const png=await app.evaluate(({nativeImage})=>nativeImage.createFromBitmap(Buffer.alloc(20*20*4,255),{width:20,height:20}).toPNG().toString('base64')),path=resolve(directory,'calibration.png');await writeFile(path,Buffer.from(png,'base64'));
  await app.evaluate(({dialog},path)=>dialog.showOpenDialog=async()=>({canceled:false,filePaths:[path]}),path);await workflow(page,'references');await page.getByRole('button',{name:'导入单张原图',exact:true}).click();await page.locator('.image-tools').getByRole('button',{name:'两点标定',exact:true}).click();
  const field=page.getByLabel('标定真实距离',{exact:true});await field.fill('2000');await page.getByRole('button',{name:'保存标定',exact:true}).click();await page.getByRole('button',{name:'↶ 撤销',exact:true}).click();assert.equal(await field.inputValue(),'1800');
 });
 await check('pen-button-and-open-path-guards',async()=>{
  await page.locator('.image-tools').getByRole('button',{name:'钢笔选区',exact:true}).click();const svg=page.locator('.mask-view');await svg.scrollIntoViewIfNeeded();const box=await svg.boundingBox(),before=await svg.locator('.pen-node').count();assert(box);
  await page.mouse.click(box.x+box.width/2,box.y+box.height/2,{button:'right'});assert.equal(await svg.locator('.pen-node').count(),before);
  await page.mouse.click(box.x+box.width/2,box.y+box.height/2);assert.equal(await svg.locator('.pen-node').count(),before+1);assert(await page.getByRole('button',{name:'确认选区并加入花纹库',exact:true}).isDisabled());
 });
 await check('modal-keyboard-focus',async()=>{
  await seed();await page.getByRole('button',{name:'＋ 新建项目',exact:true}).click();await page.getByRole('dialog').waitFor();assert(await page.getByRole('dialog').evaluate(e=>e.contains(document.activeElement)));
  for(let i=0;i<6;i++)await page.keyboard.press('Tab');assert(await page.getByRole('dialog').evaluate(e=>e.contains(document.activeElement)));
 });
}finally{
 await app.close();await writeFile('test-results/audit/regressions.json',JSON.stringify({build:testedBuild,passed:results.every(r=>r.passed)&&!errors.length,results,errors},null,2));
}
assert.deepEqual(errors,[]);assert(results.every(r=>r.passed),JSON.stringify(results.filter(r=>!r.passed)));

