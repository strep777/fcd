import {hiddenWindowId} from './desktop-window.mjs';
import {_electron as electron} from 'playwright';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {randomUUID} from 'node:crypto';
import {desktopArgs,executablePath} from './desktop-launch.mjs';
const directory=await mkdtemp(resolve('.local/tests/late-cancel-')),env={...process.env,FPCAD_DATA_DIR:directory};delete env.ELECTRON_RUN_AS_NODE;
const args=process.env.FPCAD_CANCEL_BASELINE_APP?[...desktopArgs.slice(0,-1),process.env.FPCAD_CANCEL_BASELINE_APP]:desktopArgs;
const app=await electron.launch({executablePath,args,env}),page=await app.firstWindow(),errors=[],checks=[],cancellations=[];
page.on('pageerror',e=>errors.push(e.message));
const read=async()=>{const r=await page.evaluate(()=>window.fpcad.read());assert(r.ok);return r.data;};
const invoke=async(method,payload)=>{const p=(await read()).project,windowId=await hiddenWindowId(app,page);return app.evaluate(async({ipcMain,BrowserWindow},{windowId,request})=>{const w=BrowserWindow.fromId(windowId);if(!w||w.isVisible())throw Error('Expected hidden test window');return ipcMain._invokeHandlers.get('fpcad:request')({sender:w.webContents,senderFrame:w.webContents.mainFrame},request);},{windowId,request:{protocolVersion:1,requestId:randomUUID(),method,payload,projectId:p.id,expectedRevision:p.revision}});};
const identity=s=>({project:s.project,history:s.history,canUndo:s.canUndo,canRedo:s.canRedo});
async function armCancellation(){
 const p=(await read()).project,windowId=await hiddenWindowId(app,page);
 await app.evaluate(({ipcMain,BrowserWindow},{windowId,scope})=>{
  const {Worker}=process.getBuiltinModule('worker_threads'),original=Worker.prototype.emit;
  globalThis.cancelResult=null;globalThis.cancelHookFired=false;
  Worker.prototype.emit=function(event,...args){
   const result=original.call(this,event,...args);
   if(event==='message'&&args[0]?.kind==='result'&&!globalThis.cancelHookFired){
    globalThis.cancelHookFired=true;Worker.prototype.emit=original;
    const w=BrowserWindow.fromId(windowId);if(!w||w.isVisible())throw Error('Expected hidden cancellation test window');
    globalThis.cancelResult=ipcMain._invokeHandlers.get('fpcad:request')({sender:w.webContents,senderFrame:w.webContents.mainFrame},{protocolVersion:1,...scope,method:'surface.cancel',payload:{}});
   }
   return result;
  };
 },{windowId,scope:{requestId:randomUUID(),projectId:p.id,expectedRevision:p.revision}});
}
try{
 await page.waitForFunction(()=>!!window.fpcad);assert((await page.evaluate(()=>window.fpcad.create({name:'计算末尾取消复验',unit:'mm'}))).ok);
 const surface=await page.evaluate(()=>{const id=()=>crypto.randomUUID(),vertices=[[0,0,0],[100,0,0],[100,100,0],[0,100,0]].map(([xMm,yMm,zMm])=>({id:id(),xMm,yMm,zMm}));return {id:id(),topologyVersion:1,source:'obj',vertices,faces:[[0,1,2],[0,2,3]].map(indices=>({id:id(),vertices:indices.map(i=>vertices[i].id),region:'panel'}))};});
 assert((await invoke('command.apply',{type:'surface.set',surface})).ok);
 const shape={nodes:[{xMm:10,yMm:10},{xMm:90,yMm:10},{xMm:90,yMm:90},{xMm:10,yMm:90}],origin:[0,0,0],axes:[[1,0,0],[0,1,0],[0,0,1]]};
 for(const [label,method,payload] of [['surface marking result','marking.surface',{shape,color:'#ee964b',name:'花纹'}],['unwrap solver result','surface.unwrap',{}]]){
  const before=identity(await read());await armCancellation();const result=await invoke(method,payload);
  assert(await app.evaluate(()=>globalThis.cancelHookFired),label+' did not reach the exact result/cancel boundary');
  const cancellation=await app.evaluate(()=>globalThis.cancelResult);assert(cancellation.ok&&cancellation.cancelled,label+' cancel request was invalid: '+JSON.stringify(cancellation));
  cancellations.push({label,accepted:cancellation.ok&&cancellation.cancelled,resultOk:result.ok,resultCode:result.error?.code,revision:result.data?.project?.revision});
  assert(!result.ok&&result.error.code==='CANCELLED',label+' committed despite a valid cancellation: '+JSON.stringify({ok:result.ok,code:result.error?.code,revision:result.data?.project?.revision}));
  assert.deepEqual(identity(await read()),before,label+' modified state after cancellation');checks.push(label+' cancellation leaves project and history unchanged');
 }
 assert((await invoke('marking.surface',{shape,color:'#ee964b',name:'正常花纹'})).ok);assert((await invoke('surface.unwrap',{})).ok);assert((await invoke('surface.accept',{acknowledgeReview:true})).ok);checks.push('normal operations still succeed after cancellation');
 assert.deepEqual(errors,[]);await writeFile('test-results/late-cancel.json',JSON.stringify({passed:true,checks,cancellations,errors,directory},null,2));console.log(JSON.stringify({passed:true,checks:checks.length}));
}catch(error){await writeFile('test-results/late-cancel.json',JSON.stringify({passed:false,checks,cancellations,errors,error:String(error),directory},null,2));throw error;}finally{await app.close();}
