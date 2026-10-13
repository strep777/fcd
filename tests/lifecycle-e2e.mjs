import {hiddenWindowId} from './desktop-window.mjs';
import {desktopScreenshot} from './desktop-screenshot.mjs';
import {chooseProject} from './ui-navigation.mjs';
import {_electron as electron} from 'playwright';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {desktopArgs,executablePath} from './desktop-launch.mjs';
const directory=await mkdtemp(resolve('.local/tests/lifecycle-')),env={...process.env,FPCAD_DATA_DIR:directory};delete env.ELECTRON_RUN_AS_NODE;
const app=await electron.launch({executablePath,args:desktopArgs,env}),page=await app.firstWindow(),checks=[],errors=[];
page.on('pageerror',e=>errors.push(e.message));
const read=async()=>{const r=await page.evaluate(()=>window.fpcad.read());assert(r.ok);return r.data;};
const invoke=async(method,payload)=>{const p=(await read()).project,windowId=await hiddenWindowId(app,page);return app.evaluate(async({ipcMain,BrowserWindow},{windowId,request})=>{const w=BrowserWindow.fromId(windowId);if(!w||w.isVisible())throw Error('Expected hidden test window');return ipcMain._invokeHandlers.get('fpcad:request')({sender:w.webContents,senderFrame:w.webContents.mainFrame},request);},{windowId,request:{protocolVersion:1,requestId:randomUUID(),method,payload,projectId:p.id,expectedRevision:p.revision}});};
const apply=async command=>{const r=await invoke('command.apply',command);assert(r.ok,JSON.stringify(r));return r.data;};
const identity=s=>({project:s.project,history:s.history,canUndo:s.canUndo,canRedo:s.canRedo});
const reject=async(label,method,payload,code)=>{const before=identity(await read()),r=await invoke(method,payload);assert(!r.ok&&r.error.code===code,label+': '+JSON.stringify({ok:r.ok,code:r.error?.code}));assert.deepEqual(identity(await read()),before,label+' changed state');checks.push(label);};
const pickSave=async path=>app.evaluate(({dialog},file)=>{dialog.showSaveDialog=async()=>({canceled:false,filePath:file});},path);
const pickOpen=async path=>app.evaluate(({dialog},file)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[file]});},path);
try{
 await page.waitForFunction(()=>!!window.fpcad);assert((await page.evaluate(()=>window.fpcad.create({name:'跨步骤功能复验',unit:'mm'}))).ok);
 const surface=await page.evaluate(()=>{const id=()=>crypto.randomUUID(),vertices=[[0,0,0],[100,0,0],[200,0,0],[0,100,0],[100,100,0],[200,100,0]].map(([xMm,yMm,zMm])=>({id:id(),xMm,yMm,zMm}));return {id:id(),topologyVersion:1,source:'obj',vertices,faces:[[0,1,4],[0,4,3],[1,2,4],[2,5,4]].map((indices,i)=>({id:id(),vertices:indices.map(i=>vertices[i].id),region:i<2?'left':'right'}))};});
 // This fixture tests lifecycle guards for two independent region-bound cuts.
 // Request mesh partitioning explicitly; default design cutting deliberately
 // merges this coplanar rectangle into one piece when no user seam exists.
 const unwrapOptions={partitionStrategy:'mesh'};
 await apply({type:'surface.set',surface});assert((await invoke('surface.unwrap',unwrapOptions)).ok);assert((await invoke('surface.accept',{acknowledgeReview:true})).ok);
 let current=(await read()).project;assert.equal(current.pieces.length,2);
 const [a,b]=current.pieces,side=p=>({pieceId:p.id,nodeId:p.nodes[0].id,endNodeId:p.nodes[1].id,start:0,end:1,reverse:false}),seam={id:randomUUID(),name:'左右接缝',a:side(a),b:side(b),expectedEaseMm:0,toleranceMm:1,locked:false};
 await apply({type:'seam.put',seam});assert((await invoke('seam.notches',{seamId:seam.id,count:3,depthMm:3})).ok);
 const pieces=(await read()).project.pieces;
 const other=structuredClone(surface);other.id=randomUUID();await apply({type:'surface.set',surface:other});assert.equal((await read()).project.pieces.length,0);
 await apply({type:'model.activate',modelId:surface.id});current=(await read()).project;assert.deepEqual(current.seams,[seam]);assert.deepEqual(current.pieces,pieces);checks.push('model switches restore seams and paired notches');
 const paper={widthMm:210,heightMm:297,marginMm:10,overlapMm:10},preview={pieceIds:[a.id],paper,warningAckIds:[]};assert((await invoke('patterns.preview',preview)).ok);checks.push('restored single cut passes actual manufacturing validation');
 assert((await invoke('surface.unwrap',unwrapOptions)).ok);await reject('re-cut cannot discard existing seams','surface.accept',{acknowledgeReview:true},'SEAM_DEPENDENCY');
 await apply({type:'seam.put',seam:{...seam,locked:true}});
 await reject('locked seam cannot be changed','command.apply',{type:'seam.put',seam:{...seam,locked:true,expectedEaseMm:8}},'SEAM_LOCKED');
 await reject('locked seam cannot be unlinked','command.apply',{type:'seam.delete',seamId:seam.id},'SEAM_LOCKED');
 await page.reload();await chooseProject(page);await page.waitForFunction(()=>!!document.querySelector('[data-stage="pattern"]'));await page.locator('[data-stage="pattern"]').click();await page.getByRole('tab',{name:'接缝',exact:true}).click();
 await page.locator('.seam-row').first().waitFor();const visibleRow=page.locator('.seam-row').first();
 assert(await visibleRow.getByLabel('接缝名称',{exact:true}).isDisabled());assert(await visibleRow.getByRole('button',{name:'解除关联',exact:true}).isDisabled());await visibleRow.getByRole('button',{name:'解锁',exact:true}).click();await page.waitForFunction(()=>!document.querySelector('.seam-row input')?.disabled);checks.push('locked seam UI disables edits and provides a working unlock action');
 const standalone=structuredClone(a);standalone.id=randomUUID();standalone.name='独立裁片';standalone.nodes=standalone.nodes.map(n=>({...n,id:randomUUID()}));standalone.notches=[];await apply({type:'piece.put',piece:standalone});
 const cross={...seam,id:randomUUID(),name:'跨模型接缝',b:side(standalone)};await apply({type:'seam.put',seam:cross});await reject('switch cannot silently drop a cross-model seam','command.apply',{type:'model.activate',modelId:other.id},'SEAM_DEPENDENCY');await apply({type:'seam.delete',seamId:cross.id});await apply({type:'piece.delete',pieceId:standalone.id});
 const flowPath=join(directory,'workflow.json'),zipPath=join(directory,'patterns.zip');
 for(const [method,path] of [['workflow.file',flowPath],['patterns.bundle',zipPath]]){
  await pickSave(path);assert((await invoke(method,{action:'export'})).ok);assert((await readFile(path)).length>100);await pickOpen(path);assert((await invoke(method,{action:'import'})).ok);assert.deepEqual((await read()).project.seams,[seam]);await apply({type:'model.activate',modelId:other.id});await apply({type:'model.activate',modelId:surface.id});assert.deepEqual((await read()).project.pieces,pieces);assert.deepEqual((await read()).project.seams,[seam]);
 }
 checks.push('workflow JSON and cuts ZIP preserve saved-model seam data through export, import and switching');
 const stale={...seam,locked:true,a:{...seam.a,endNodeId:randomUUID()}},p=(await read()).project;await writeFile(flowPath,JSON.stringify({format:'fpcad-workflow',version:1,project:{...p,seams:[stale]}}));await pickOpen(flowPath);assert((await invoke('workflow.file',{action:'import'})).ok);
 await reject('stale seam blocks selected printing','patterns.preview',preview,'INVALID_SEAMS');await apply({type:'seam.put',seam:{...stale,locked:false}});await apply({type:'seam.delete',seamId:seam.id});assert((await invoke('patterns.preview',preview)).ok);checks.push('stale imported locked seams can be unlocked and deleted to restore printable cuts');
 const shape={nodes:[{xMm:10,yMm:10},{xMm:90,yMm:10},{xMm:90,yMm:90},{xMm:10,yMm:90}],origin:[0,0,0],axes:[[1,0,0],[0,1,0],[0,0,1]]};assert((await invoke('marking.surface',{shape,color:'#ee964b',name:'裁片花纹'})).ok);
 current=(await read()).project;const marking=current.markings[0];await apply({type:'marking.lock',markingId:marking.id,locked:true});await reject('locked mapped cut cannot be removed','command.apply',{type:'piece.delete',pieceId:marking.paths[0].pieceId},'MARKING_LOCKED');await apply({type:'marking.lock',markingId:marking.id,locked:false});await apply({type:'piece.delete',pieceId:marking.paths[0].pieceId});
 current=(await read()).project;assert(current.bindings.every(binding=>current.pieces.some(p=>p.id===binding.pieceId)));assert(current.markings.every(m=>m.paths.every(path=>current.pieces.some(p=>p.id===path.pieceId))));assert((await invoke('patterns.preview',{...preview,pieceIds:current.pieces.map(p=>p.id)})).ok);checks.push('mapped cut deletion cleans references and the remaining cuts stay printable');
 await page.reload();await chooseProject(page);await page.waitForFunction(()=>!!document.querySelector('[data-stage="pattern"]'));await page.locator('[data-stage="pattern"]').click();const canvas=page.locator('.canvas:visible');await canvas.waitFor();const bounds=await canvas.boundingBox(),before=(await read()).project,cursor={x:Math.round(bounds.x+bounds.width*.2),y:Math.round(bounds.y+bounds.height*.3)};
 const point=await canvas.evaluate((svg,client)=>{const m=svg.getScreenCTM().inverse(),p=svg.createSVGPoint();p.x=client.x;p.y=client.y;const w=p.matrixTransform(m);return {x:w.x,y:w.y};},cursor);
 await page.mouse.move(cursor.x,cursor.y);await page.mouse.wheel(0,-100);await page.waitForTimeout(100);
 const after=await canvas.evaluate((svg,client)=>{const m=svg.getScreenCTM().inverse(),p=svg.createSVGPoint();p.x=client.x;p.y=client.y;const w=p.matrixTransform(m);return {x:w.x,y:w.y};},cursor);assert(Math.hypot(after.x-point.x,after.y-point.y)<1e-4,JSON.stringify({cursor,point,after}));assert.deepEqual((await read()).project,before);checks.push('2D cursor-anchored zoom changes only the camera, not millimetre geometry');
 assert.deepEqual(errors,[]);await writeFile('test-results/lifecycle.json',JSON.stringify({passed:true,checks,errors,directory},null,2));console.log(JSON.stringify({passed:true,checks:checks.length}));
}catch(error){await writeFile('test-results/lifecycle.json',JSON.stringify({passed:false,checks,errors,error:String(error),directory},null,2));await desktopScreenshot(app,page,{path:'test-results/lifecycle-failure.png'}).catch(()=>{});throw error;}finally{await app.close();}
