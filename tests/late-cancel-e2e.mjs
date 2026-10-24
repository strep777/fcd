import {hiddenWindowId} from './desktop-window.mjs';
import {desktop} from './tauri-desktop.mjs';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {randomUUID} from 'node:crypto';
import {desktopArgs,executablePath} from './desktop-launch.mjs';
const directory=await mkdtemp(resolve('.local/tests/late-cancel-')),env={...process.env,FPCAD_DATA_DIR:directory,FPCAD_PROFILE:'1'};
const args=process.env.FPCAD_CANCEL_BASELINE_APP?[...desktopArgs.slice(0,-1),process.env.FPCAD_CANCEL_BASELINE_APP]:desktopArgs;
const app=await desktop.launch({executablePath,args,env}),page=await app.firstWindow(),errors=[],checks=[],cancellations=[];
page.on('pageerror',e=>errors.push(e.message));
const read=async()=>{const r=await page.evaluate(()=>window.fpcad.read());assert(r.ok);return r.data;};
const invoke=async(method,payload)=>{const p=(await read()).project;await hiddenWindowId(app,page);return app.request({protocolVersion:1,requestId:randomUUID(),method,payload,projectId:p.id,expectedRevision:p.revision});};
const identity=s=>({project:s.project,history:s.history,canUndo:s.canUndo,canRedo:s.canRedo});
async function armCancellation(){
 const p=(await read()).project,windowId=await hiddenWindowId(app,page);
 await app.backendEvaluate(({request:receive},{scope})=>{
  const {Worker}=process.getBuiltinModule('worker_threads'),original=Worker.prototype.emit;
  globalThis.cancelResult=null;globalThis.cancelHookFired=false;
  Worker.prototype.emit=function(event,...args){
   const result=original.call(this,event,...args);
   if(event==='message'&&args[0]?.kind==='result'&&!globalThis.cancelHookFired){
    globalThis.cancelHookFired=true;Worker.prototype.emit=original;
    globalThis.cancelResult=receive({protocolVersion:1,...scope,method:'surface.cancel',payload:{}});
   }
   return result;
  };
 },{windowId,scope:{requestId:randomUUID(),projectId:p.id,expectedRevision:p.revision}});
}
async function armMappingCancellation(){
 const p=(await read()).project,windowId=await hiddenWindowId(app,page);
 await app.backendEvaluate(({request:receive},{scope})=>{
  const native=process.getBuiltinModule('child_process'),original=native.spawn;
  globalThis.mappingCancelFired=false;globalThis.mappingKilledOnCancel=false;globalThis.cancelResult=null;
  globalThis.restoreMappingCancellation=()=>{native.spawn=original;};
  native.spawn=function(...args){
   const child=original.apply(this,args),end=child.stdin.end;
   child.stdin.end=function(input,...rest){
    let request;try{request=JSON.parse(String(input));}catch{}
    if(request?.operation!=='geometry.clip'||globalThis.mappingCancelFired)return end.call(this,input,...rest);
    globalThis.mappingCancelFired=true;native.spawn=original;const kill=child.kill;let killed=false;
    child.kill=function(...killArgs){killed=true;return kill.apply(this,killArgs);};
    const result=end.call(this,input,...rest);
    globalThis.cancelResult=receive({protocolVersion:1,...scope,method:'surface.cancel',payload:{}});
    // Observe immediately: a normal successful native reply also cleans up the
    // child later, which must not count as cancellation reaching that child.
    globalThis.mappingKilledOnCancel=killed;return result;
   };
   return child;
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
  assert(await app.backendEvaluate(()=>globalThis.cancelHookFired),label+' did not reach the exact result/cancel boundary');
  const cancellation=await app.backendEvaluate(()=>globalThis.cancelResult);assert(cancellation.ok&&cancellation.cancelled,label+' cancel request was invalid: '+JSON.stringify(cancellation));
  cancellations.push({label,accepted:cancellation.ok&&cancellation.cancelled,resultOk:result.ok,resultCode:result.error?.code,revision:result.data?.project?.revision});
  assert(!result.ok&&result.error.code==='CANCELLED',label+' committed despite a valid cancellation: '+JSON.stringify({ok:result.ok,code:result.error?.code,revision:result.data?.project?.revision}));
  assert.deepEqual(identity(await read()),before,label+' modified state after cancellation');checks.push(label+' cancellation leaves project and history unchanged');
 }
 assert((await invoke('marking.surface',{shape,color:'#ee964b',name:'正常花纹'})).ok);assert((await invoke('surface.unwrap',{})).ok);assert((await invoke('surface.accept',{acknowledgeReview:true})).ok);checks.push('normal operations still succeed after cancellation');
 // Use real accepted color cuts so the following paint proceeds through the
 // main-process fragment-to-pattern mapping after its surface worker exits.
 assert((await invoke('surface.unwrap',{method:'lscm',partitionStrategy:'design',colorBoundaryCuts:true,automaticCuts:false,optimizeCuts:false})).ok);
 assert((await invoke('surface.accept',{acknowledgeReview:true})).ok);assert((await read()).project.bindings.some(binding=>binding.trim),'mapping cancellation requires a real trimmed binding');
 const beforeMapping=identity(await read());await armMappingCancellation();
 const mappedResult=await invoke('marking.surface',{shape,color:'#ee964b',name:'映射阶段取消的花纹'}),mappingCancellation=await app.backendEvaluate(()=>globalThis.cancelResult);
 assert(await app.backendEvaluate(()=>globalThis.mappingCancelFired),'the real native geometry.clip mapping request was not reached');
 assert(mappingCancellation?.ok&&mappingCancellation.cancelled,'mapping cancellation was not accepted');
 assert(await app.backendEvaluate(()=>globalThis.mappingKilledOnCancel),'cancellation did not immediately terminate the mapping native child');
 assert(!mappedResult.ok&&mappedResult.error.code==='CANCELLED','mapping continued to a successful commit after cancellation');
 assert.deepEqual(identity(await read()),beforeMapping,'mapping cancellation changed the project, history or undo state');
 checks.push('cancelling the main-process pattern mapping immediately kills its real native child and leaves project/history unchanged');
 assert.deepEqual(errors,[]);await writeFile('test-results/late-cancel.json',JSON.stringify({passed:true,checks,cancellations,errors,directory},null,2));console.log(JSON.stringify({passed:true,checks:checks.length}));
}catch(error){await writeFile('test-results/late-cancel.json',JSON.stringify({passed:false,checks,cancellations,errors,error:String(error),directory},null,2));throw error;}finally{await app.backendEvaluate(()=>globalThis.restoreMappingCancellation?.()).catch(()=>{});await app.close();}
