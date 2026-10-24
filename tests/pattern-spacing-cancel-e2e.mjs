import assert from 'node:assert/strict';
import {mkdir,mkdtemp,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
import {desktop} from './tauri-desktop.mjs';
import {desktopArgs,executablePath,testedBuild} from './desktop-launch.mjs';
import {hiddenWindowId} from './desktop-window.mjs';

await mkdir('.local/tests',{recursive:true});await mkdir('test-results',{recursive:true});
const directory=await mkdtemp(resolve('.local/tests/pattern-spacing-cancel-')),
 app=await desktop.launch({executablePath,args:desktopArgs,env:{...process.env,FPCAD_DATA_DIR:directory,FPCAD_PROFILE:'1'}}),page=await app.firstWindow(),checks=[],errors=[],report={testedBuild,directory,fixture:{pieceCount:300,nodesPerPiece:128},checks,errors};
page.on('pageerror',error=>errors.push(error.message));
const read=async()=>{const result=await page.evaluate(()=>window.fpcad.read());assert(result.ok,JSON.stringify(result));return result.data;};
const digest=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const content=({revision,updatedAt,...project})=>project;
// Geometry.areaMm2 describes the unchanged seam contour. Measure the actual
// returned cut polygon independently to verify that spacing expands it.
const cutArea=geometry=>{const area=ring=>{const origin=ring[0];return Math.abs(ring.reduce((sum,p,i)=>{const q=ring[(i+1)%ring.length];return sum+(p.xMm-origin.xMm)*(q.yMm-origin.yMm)-(q.xMm-origin.xMm)*(p.yMm-origin.yMm);},0))/2;};assert(geometry.cut.length>=3,'Each real cut must have a polygon');return area(geometry.cut)-(geometry.cutHoles??[]).reduce((sum,ring)=>sum+area(ring),0);};
const command={type:'patterns.allowance',widthMm:7,join:'round'};

try{
 await hiddenWindowId(app,page);
 const seeded=await page.evaluate(async({pieceCount,nodesPerPiece})=>{
  const created=await window.fpcad.create({name:'Global spacing cancellation transaction',unit:'mm'});if(!created.ok)throw Error(JSON.stringify(created));
  const p=created.data.project,pieces=Array.from({length:pieceCount},(_,index)=>({id:crypto.randomUUID(),name:'Actual contour '+index,color:'#73c9b6',closed:true,allowanceMm:index%3,join:index%2?'bevel':'miter',allowanceSource:'piece',cutQty:1,mirror:false,material:'test fabric',furRad:0,nodes:Array.from({length:nodesPerPiece},(_,i)=>{const angle=i*2*Math.PI/nodesPerPiece;return {id:crypto.randomUUID(),xMm:Math.cos(angle)*80+(index%15)*200,yMm:Math.sin(angle)*100+Math.floor(index/15)*240};})}));
  return window.fpcad.apply(p.id,p.revision,{type:'pieces.replace',removeIds:[],pieces});
 },report.fixture);assert(seeded.ok,JSON.stringify(seeded));assert.equal(seeded.data.project.pieces.length,report.fixture.pieceCount);assert(seeded.data.geometry.every(g=>!g.issues.some(issue=>issue.severity==='error')),'The real native worker must accept every fixture contour');checks.push('300 real valid contours with different existing spacing settings');

 // Populate both undo and redo before cancellation, then checkpoint through the
 // normal save API so an unrelated autosave timer cannot change the baseline.
 let p=(await read()).project;assert((await page.evaluate(({id,revision})=>window.fpcad.apply(id,revision,{type:'project.rename',name:'Rename to undo before spacing'}),p)).ok);
 p=(await read()).project;assert((await page.evaluate(({id,revision})=>window.fpcad.undo(id,revision),p)).ok);
 await app.evaluate(({dialog},path)=>{dialog.showSaveDialog=async()=>({canceled:false,filePath:path});},resolve(directory,'before-cancel.fpcad'));
 p=(await read()).project;assert((await page.evaluate(({id,revision})=>window.fpcad.save(id,revision,true),p)).ok);
 const before=await read();assert(before.canUndo&&before.canRedo,'Cancellation must preserve a nonempty undo and redo branch');assert.equal(before.savedRevision,before.project.revision);report.before={revision:before.project.revision,stateSha256:digest(before),history:before.history,canUndo:before.canUndo,canRedo:before.canRedo};

 // Observe genuine native input/exit without replacing a worker, changing its
 // input, delaying its execution, or issuing cancellation inside the backend.
 await app.backendEvaluate(()=>{
  const native=process.getBuiltinModule('child_process'),original=native.spawn,restores=[],{StringDecoder}=process.getBuiltinModule('string_decoder');let started;
  const probe={children:[],started:new Promise(resolve=>{started=resolve;}),restore:()=>{native.spawn=original;for(const restore of restores.splice(0))restore();}};globalThis.spacingCancelProbe=probe;
  native.spawn=function(...args){
   const child=original.apply(this,args);if(!String(args[0]).endsWith('fpcad-worker.exe')||!child.stdin)return child;
   const record={pid:child.pid,stream:args[1]?.includes('--stream')??false,exited:false,code:null,signal:null,bytes:0,writes:0,ends:0,requests:[],parseErrors:[]},write=child.stdin.write,end=child.stdin.end,decoder=new StringDecoder('utf8');let pending='',ending=false;
   probe.children.push(record);child.once('exit',(code,signal)=>{record.exited=true;record.code=code;record.signal=signal;});
   const request=line=>{if(!line.trim())return;let value;try{value=JSON.parse(line);}catch(error){record.parseErrors.push(String(error));return;}const pieces=Array.isArray(value?.pieces)?value.pieces:[],item={pieceCount:pieces.length,widths:[...new Set(pieces.map(piece=>piece.allowanceMm))],bytes:Buffer.byteLength(line)};record.requests.push(item);if(item.pieceCount>0&&item.widths.length===1&&item.widths[0]===7)started({pid:record.pid,stream:record.stream,...item});};
   const observe=(chunk,encoding,final=false)=>{
    if(typeof chunk==='string'||chunk instanceof Uint8Array){const bytes=typeof chunk==='string'?Buffer.from(chunk,typeof encoding==='string'?encoding:'utf8'):Buffer.from(chunk.buffer,chunk.byteOffset,chunk.byteLength);record.bytes+=bytes.length;pending+=decoder.write(bytes);}
    if(final)pending+=decoder.end();let newline;while((newline=pending.indexOf('\n'))>=0){const line=pending.slice(0,newline);pending=pending.slice(newline+1);request(line);}if(final&&pending){request(pending);pending='';}
   };
   // Observe only after forwarding unchanged arguments. Stream requests use
   // write(JSON + newline); the older one-shot path can still use end(JSON).
   child.stdin.write=function(...values){const result=write.apply(this,values);record.writes++;if(!ending)observe(values[0],values[1]);return result;};
   child.stdin.end=function(...values){let result;ending=true;try{result=end.apply(this,values);}finally{ending=false;}record.ends++;observe(values[0],values[1],true);return result;};
   restores.push(()=>{child.stdin.write=write;child.stdin.end=end;});return child;
  };
 });
 await page.evaluate(({id,revision,command})=>{window.spacingCancelOutcome=null;window.spacingCancelPending=window.fpcad.apply(id,revision,command).then(result=>{window.spacingCancelOutcome=result;return result;});},{id:before.project.id,revision:before.project.revision,command});
 report.nativeInput=await app.backendEvaluate(()=>new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('No actual spacing native input was observed')),10000);globalThis.spacingCancelProbe.started.then(value=>{clearTimeout(timer);resolve(value);});}));
 const cancellation=await page.evaluate(async({id,revision})=>{const completedBeforeCancel=window.spacingCancelOutcome!==null,cancel=await window.fpcad.cancelSurface(id,revision),result=await window.spacingCancelPending;return {completedBeforeCancel,cancel,result};},{id:before.project.id,revision:before.project.revision});
 report.cancellation={completedBeforeCancel:cancellation.completedBeforeCancel,accepted:cancellation.cancel.ok,cancelled:cancellation.cancel.cancelled,resultOk:cancellation.result.ok,resultCode:cancellation.result.error?.code};assert.equal(cancellation.completedBeforeCancel,false,'The actual batch must still be pending at the cancellation request');assert(cancellation.cancel.ok&&cancellation.cancel.cancelled,'Production cancelSurface IPC must accept the pending command');assert.equal(cancellation.result.ok,false,'Cancelled spacing must not commit successfully');assert.equal(cancellation.result.error.code,'CANCELLED');
 report.nativeChildren=await app.backendEvaluate(()=>{const probe=globalThis.spacingCancelProbe;probe.restore();return probe.children.map(record=>{let alive=true;try{process.kill(record.pid,0);}catch(error){if(error.code!=='ESRCH')throw error;alive=false;}return {...record,alive};});});assert(report.nativeChildren.length>0);assert(report.nativeChildren.every(child=>child.parseErrors.length===0),'The native input probe must parse every observed request without ignoring malformed input');assert(report.nativeChildren.every(child=>child.exited&&!child.alive),'Cancellation completion must leave no observed native child alive');
 const cancelled=await read();report.afterCancel={revision:cancelled.project.revision,stateSha256:digest(cancelled),history:cancelled.history,canUndo:cancelled.canUndo,canRedo:cancelled.canRedo};assert.deepEqual(cancelled,before,'Cancellation must preserve the whole session, geometry, project revision, history, recovery and undo/redo state');checks.push('real renderer IPC cancellation reaches native work and preserves the complete checkpointed session');

 // Reuse exactly the cancelled revision. A new normal client request must
 // succeed; no revision refresh, fallback operation or reduced fixture is used.
 const retried=await page.evaluate(({id,revision,command})=>window.fpcad.apply(id,revision,command),{id:before.project.id,revision:before.project.revision,command});assert(retried.ok,JSON.stringify(retried));const after=retried.data;assert.equal(after.project.revision,before.project.revision+1);assert.equal(after.project.defaultAllowanceMm,7);assert.equal(after.history.length,before.history.length+1);assert.equal(after.history[0].type,'patterns.allowance');assert.equal(after.canRedo,false,'The one successful command replaces the previous redo branch');assert.equal(after.project.pieces.length,before.project.pieces.length);
 for(const [i,piece] of after.project.pieces.entries()){assert.equal(piece.allowanceMm,7);assert.equal(piece.allowanceSource,'piece');assert.equal(piece.join,'round');assert(!piece.edgeAllowances?.length);assert.deepEqual(piece.nodes,before.project.pieces[i].nodes);assert.equal(piece.id,before.project.pieces[i].id);}
 assert(after.geometry.every((g,i)=>!g.issues.some(issue=>issue.severity==='error')&&g.areaMm2===before.geometry[i].areaMm2&&cutArea(g)>cutArea(before.geometry[i])),'Every real cut must remain valid, preserve its seam area and expand its cut polygon with the larger spacing');report.afterRetry={revision:after.project.revision,stateSha256:digest(after),history:after.history,geometryCount:after.geometry.length,minimumCutAreaIncreaseMm2:Math.min(...after.geometry.map((g,i)=>cutArea(g)-cutArea(before.geometry[i])))};checks.push('same revision retries successfully in one transaction and updates all 300 real cut contours');
 const undone=await page.evaluate(({id,revision})=>window.fpcad.undo(id,revision),after.project);assert(undone.ok,JSON.stringify(undone));assert.deepEqual(content(undone.data.project),content(before.project),'One undo must restore every original piece and default');assert(undone.data.canRedo);
 const redone=await page.evaluate(({id,revision})=>window.fpcad.redo(id,revision),undone.data.project);assert(redone.ok,JSON.stringify(redone));assert.deepEqual(content(redone.data.project),content(after.project),'One redo must restore the whole uniform-spacing result');checks.push('one undo and redo restores the exact complete before/after project content');
 await hiddenWindowId(app,page);assert.deepEqual(errors,[]);report.passed=true;console.log(JSON.stringify({passed:true,checks:checks.length,cancellation:report.cancellation}));
}catch(error){report.passed=false;report.error=error.stack??String(error);throw error;}
finally{await app.backendEvaluate(()=>globalThis.spacingCancelProbe?.restore()).catch(()=>{});try{await app.close();report.closedNormally=true;}catch(error){report.passed=false;report.closeError=String(error);throw error;}finally{await writeFile('test-results/pattern-spacing-cancel.json',JSON.stringify(report,null,2));}}
