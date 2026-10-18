import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {mount,fixtureProject,flush,walk} from './surface-viewport-host.mjs';

const deferred=()=>{let resolve;const promise=new Promise(done=>{resolve=done;});return {promise,resolve};};
const checks=[];
async function check(name,run){try{await run();checks.push({case:name,passed:true});}catch(error){checks.push({case:name,passed:false,error:error.stack});}}
const originalInterval=globalThis.setInterval,originalClear=globalThis.clearInterval,timers=new Map();let nextTimer=0;
globalThis.setInterval=(callback,period)=>{const token=++nextTimer;timers.set(token,{callback,period});return token;};
globalThis.clearInterval=token=>{timers.delete(token);};
try{
 await check('a global spinner and elapsed time survive page scope changes and clear after ordinary completion',async()=>{
  const f=await mount(fixtureProject(),{component:'activity',controls:false}),work=deferred();
  try{
   const running=f.store.run(()=>work.promise);await flush();assert(f.root.textContent.includes('Working, please wait…'));assert(walk(f.root).some(node=>node.attrs.class==='task-spinner'));assert.equal(timers.size,1);assert(!walk(f.root).some(node=>node.tag==='button'),'unsupported cancellation is not offered');
   f.store.setErrorScope('mapping');f.store.task.startedAt=Date.now()-4000;for(const timer of timers.values())timer.callback();await flush();assert(f.root.textContent.includes('Elapsed 4 seconds'));
   work.resolve({ok:true,data:JSON.parse(JSON.stringify(f.store.data))});await running;await flush();assert.equal(timers.size,0);assert(!walk(f.root).some(node=>node.attrs.class?.includes('task-activity')));
  }finally{work.resolve({ok:false,error:{code:'TEST_END'}});f.app.unmount();}
 });
 await check('cancellable task shows pending cancellation and a dismissible final cancellation notice',async()=>{
  const f=await mount(fixtureProject(),{component:'activity',controls:false}),work=deferred(),requests=[];
  try{
   const running=f.store.run(()=>work.promise,{label:'Computing cut lines and patterns',cancel:async()=>{requests.push('cancel');return {ok:true,cancelled:true,data:JSON.parse(JSON.stringify(f.store.data))};}});await flush();assert(f.root.textContent.includes('Computing cut lines and patterns'));
   f.store.setErrorScope('mapping');await f.click(f.button('Cancel task'));assert.deepEqual(requests,['cancel']);assert(f.root.textContent.includes('Cancelling task…'));assert(f.button('Cancelling…').attrs.disabled);assert.equal(f.store.busy,true);
   work.resolve({ok:false,error:{code:'CANCELLED'}});await running;await flush();assert(f.root.textContent.includes('Task cancelled'));assert.equal(timers.size,0);assert.equal(f.store.error,'');await f.click(f.byLabel('Dismiss task notice'));assert(!walk(f.root).some(node=>node.attrs.class?.includes('task-activity')));
  }finally{work.resolve({ok:false,error:{code:'TEST_END'}});f.app.unmount();}
 });
 await check('cancel failure offers a retry and unmount removes the elapsed clock while work remains pending',async()=>{
  const f=await mount(fixtureProject(),{component:'activity',controls:false}),work=deferred();let attempts=0;
  try{
   const running=f.store.run(()=>work.promise,{cancel:async()=>{if(++attempts===1)throw Error('offline');return {ok:true,cancelled:true,data:JSON.parse(JSON.stringify(f.store.data))};}});await flush();await f.click(f.button('Cancel task'));assert(f.root.textContent.includes('Cancellation failed. You can try again.'));assert.equal(f.store.busy,true);assert(!f.button('Cancel task').attrs.disabled);
   await f.click(f.button('Cancel task'));assert.equal(attempts,2);assert(!f.root.textContent.includes('Cancellation failed.'));f.app.unmount();assert.equal(timers.size,0);work.resolve({ok:false,error:{code:'CANCELLED'}});await running;
  }finally{work.resolve({ok:false,error:{code:'TEST_END'}});f.app.unmount();}
 });
}finally{globalThis.setInterval=originalInterval;globalThis.clearInterval=originalClear;}
await mkdir('test-results/current-cutting',{recursive:true});const passed=checks.every(check=>check.passed);
await writeFile('test-results/current-cutting/task-activity-component.json',JSON.stringify({passed,verification:'Actual TaskActivity Vue SFC and session store; custom renderer and recorded timers, without Electron pixels',checks},null,2));
console.log(JSON.stringify({passed,checks}));if(!passed)process.exitCode=1;
