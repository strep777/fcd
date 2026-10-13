import {_electron as electron} from 'playwright';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {desktopArgs,executablePath,testedBuild} from './desktop-launch.mjs';
import {workflow,surfaceCoordinates} from './ui-navigation.mjs';
import {waitForState} from './wait-state.mjs';
import {desktopScreenshot} from './desktop-screenshot.mjs';

const directory=await mkdtemp(resolve('.local/tests/complex-source-drop-')),env={...process.env,FPCAD_DATA_DIR:directory};delete env.ELECTRON_RUN_AS_NODE;
const app=await electron.launch({executablePath,args:desktopArgs,env}),page=await app.firstWindow(),errors=[],checks=[];
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
 const before=await read(),source=before.patternLibrary[0].piece,card=page.locator('.mapping-page .region-card').first(),transfer=await page.evaluateHandle(()=>new DataTransfer()),drop=await surfaceCoordinates(page,5,4);
 await card.dispatchEvent('dragstart',{dataTransfer:transfer});await transfer.evaluate((t,id)=>{t.setData('application/x-fpcad-region',id);t.setData('application/x-fpcad-anchor',JSON.stringify({xMm:0,yMm:0}));},source.id);
 await page.locator('.surface-view').dispatchEvent('drop',{dataTransfer:transfer,clientX:drop.x,clientY:drop.y});await card.dispatchEvent('dragend',{dataTransfer:transfer});await transfer.dispose();await changed(before.revision);
 let p=await read(),m=p.markings[0];assert.equal(p.markings.length,1);assert.equal(m.surfaceShape.nodes.length,160);assert.equal(m.surfaceShape.curves.length,160);assert(m.fragments.length>=8);assert.deepEqual(p.patternLibrary[0].piece,source);assert(!/超出|失败|无效/.test(await page.locator('.drop-message').innerText()));checks.push('Complex saved curves drag onto the real visible model without hitting a derived-sample limit');
 await page.mouse.click(drop.x,drop.y);await page.locator('.attached-selection').waitFor();
 const original=structuredClone(m.surfaceShape),width=Number(await page.getByLabel('Attached marking width',{exact:true}).inputValue());
 await page.getByLabel('Attached marking width',{exact:true}).fill(String(width/2));await page.getByRole('button',{name:'应用尺寸与旋转',exact:true}).click();await changed(p.revision);p=await read();m=p.markings[0];assert.equal(m.surfaceShape.curves.length,160);assert(Math.abs(m.surfaceShape.curves[0].c1.xMm/original.curves[0].c1.xMm-.5)<.001);
 await page.locator('.surface-summary').click();await page.keyboard.press('Control+z');await changed(p.revision);p=await read();assert.deepEqual(p.markings[0].surfaceShape,original);await page.keyboard.press('Control+Shift+z');await changed(p.revision);p=await read();assert.equal(p.markings[0].surfaceShape.curves.length,160);checks.push('Width edits preserve exact cubic controls and Ctrl+Z/redo restore the same geometry');
 await page.mouse.click(drop.x,drop.y);await page.getByRole('button',{name:'编辑已贴附花纹节点',exact:true}).click();assert.equal(await page.getByLabel('Surface drawing mode').isDisabled(),true);
 const beforeEdit=await read();await page.getByRole('button',{name:'确认花纹编辑',exact:true}).click();await changed(beforeEdit.revision);p=await read();assert.deepEqual(p.markings[0].surfaceShape,beforeEdit.markings[0].surfaceShape);checks.push('Opening and confirming the editable contour never replaces its curves by chords');
 await page.getByRole('button',{name:'编辑已贴附花纹节点',exact:true}).click();
 const beforeNode=await read(),shape=beforeNode.markings[0].surfaceShape,node=shape.nodes[0],world=shape.origin.map((v,i)=>v+shape.axes[0][i]*node.xMm+shape.axes[1][i]*node.yMm),a=await surfaceCoordinates(page,world[0]*1.5,-world[1]*1.5),b=await surfaceCoordinates(page,(world[0]-3)*1.5,-world[1]*1.5);
 await page.mouse.move(a.x,a.y);await page.mouse.down();await page.mouse.move(b.x,b.y,{steps:4});await page.mouse.up();await page.getByRole('button',{name:'确认花纹编辑',exact:true}).click();await changed(beforeNode.revision);p=await read();
 assert(Math.abs(p.markings[0].surfaceShape.nodes[0].xMm-node.xMm+3)<.01);assert(Math.abs(p.markings[0].surfaceShape.curves[0].c1.xMm-shape.curves[0].c1.xMm+3)<.01);assert.equal(p.markings[0].surfaceShape.curves.length,160);
 await page.locator('.surface-summary').click();await page.keyboard.press('Control+z');await changed(p.revision);p=await read();assert.deepEqual(p.markings[0].surfaceShape,shape);checks.push('Dragging a curved endpoint moves its adjacent control and undo restores the exact saved curve');
 await page.reload();await workflow(page,'mapping');assert.deepEqual((await read()).markings[0].surfaceShape,p.markings[0].surfaceShape);checks.push('The persisted curved attachment survives renderer reload');
 const legacy=JSON.parse(await readFile('tests/fixtures/legacy-curved-character-piece.json','utf8'));
 let real=await page.evaluate(async piece=>{let p=(await window.fpcad.read()).data.project;const vertices=[[-900,-900],[900,-900],[900,900],[-900,900]].map(([xMm,yMm])=>({id:crypto.randomUUID(),xMm,yMm,zMm:0})),surface={id:crypto.randomUUID(),source:'obj',topologyVersion:1,vertices,faces:[[0,1,2],[0,2,3]].map(ids=>({id:crypto.randomUUID(),vertices:ids.map(i=>vertices[i].id),region:'body'}))};let r=await window.fpcad.apply(p.id,p.revision,{type:'surface.set',surface});if(!r.ok)return r;p=r.data.project;return window.fpcad.apply(p.id,p.revision,{type:'library.region.put',region:{piece,referenceId:p.references[0].id,view:'front',category:'body'}});},legacy);assert(real.ok,JSON.stringify(real));
 await page.reload();await workflow(page,'mapping');await page.locator('.surface-panel').getByRole('button',{name:'正面',exact:true}).click();const realCard=page.locator('.mapping-page .region-card').last(),realTransfer=await page.evaluateHandle(()=>new DataTransfer()),realDrop=await surfaceCoordinates(page,0,0),xs=legacy.nodes.map(n=>n.xMm),ys=legacy.nodes.map(n=>n.yMm),realAnchor={xMm:(Math.min(...xs)+Math.max(...xs))/2,yMm:(Math.min(...ys)+Math.max(...ys))/2};
 await realCard.dispatchEvent('dragstart',{dataTransfer:realTransfer});await realTransfer.evaluate((t,{id,anchor})=>{t.setData('application/x-fpcad-region',id);t.setData('application/x-fpcad-anchor',JSON.stringify(anchor));},{id:legacy.id,anchor:realAnchor});await page.locator('.surface-view').dispatchEvent('drop',{dataTransfer:realTransfer,clientX:realDrop.x,clientY:realDrop.y});await realCard.dispatchEvent('dragend',{dataTransfer:realTransfer});await realTransfer.dispose();await changed(real.data.project.revision);const attached=(await read()).markings.at(-1);assert.equal(attached.surfaceShape.curves.length,318);assert.equal(attached.surfaceShape.holes.length,6);assert(attached.fragments.length);assert.deepEqual((await read()).patternLibrary.find(r=>r.piece.id===legacy.id).piece,legacy);await desktopScreenshot(app,page,{path:'test-results/complex-real-source-drop.png'});checks.push('Actual legacy character contour with 318 curves and six holes attaches through the same public drag-and-drop UI');
 assert.equal(await page.locator('.error-banner').count(),0);assert.deepEqual(errors,[]);assert(await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().every(w=>!w.isVisible())));
 await desktopScreenshot(app,page,{path:'test-results/complex-source-drop.png'});
}catch(error){errors.push(String(error));await desktopScreenshot(app,page,{path:'test-results/complex-source-drop-failure.png'}).catch(()=>{});throw error;}
finally{await writeFile('test-results/complex-source-drop.json',JSON.stringify({passed:checks.length===6&&!errors.length,testedBuild,directory,checks,errors},null,2));await app.close();}
