import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import {mount,fixtureProject,flush,id,walk} from './surface-viewport-host.mjs';
const checks=[];
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
function reply(store,extra={}){return {ok:true,data:{...JSON.parse(JSON.stringify(store.data)),project:{...JSON.parse(JSON.stringify(store.data.project)),revision:store.data.project.revision+1,...extra}}};}
async function check(name,run){try{await run();checks.push({case:name,passed:true});}catch(e){checks.push({case:name,passed:false,error:e.stack});}}
// Record lifecycle ownership without sleeping or leaving process timers alive.
const nativeInterval=globalThis.setInterval,nativeClear=globalThis.clearInterval;
let timerStarts=0,timerStops=0;const timers=new Map();
globalThis.setInterval=(callback,period)=>{const token=++timerStarts;timers.set(token,{callback,period});return token;};
globalThis.clearInterval=token=>{if(timers.delete(token))timerStops++;};
try{
 for(const succeeds of [true,false])await check(`allowance reply ${succeeds?'success':'failure'} after unmount does not start cut task or elapsed timer`,async()=>{
  const save=deferred(),calls=[],before=timerStarts;let unsubscribed=0;
  const f=await mount(fixtureProject(),{component:'unwrap',controls:false,api:{onSurfaceProgress:()=>()=>unsubscribed++,apply:(...args)=>{calls.push({method:'apply',args});return save.promise;},unwrapSurface:(...args)=>{calls.push({method:'unwrap',args});return Promise.resolve(reply(f.store));}}});
  try{
   f.byLabel('Cut seam allowance cm').attrs['onUpdate:modelValue'](2);await flush();const action=f.click(f.button('Cut and compute pattern candidate'));await flush();assert.deepEqual(calls.map(c=>c.method),['apply']);assert.equal(timerStarts,before);
   f.app.unmount();assert.equal(unsubscribed,1);save.resolve(succeeds?reply(f.store,{defaultAllowanceMm:20}):{ok:false,error:{code:'TEST_REJECTED'}});await action;await flush();
   assert.equal(timerStarts,before,'unmounted continuation cannot create elapsed timer');assert.equal(timers.size,0);assert.deepEqual(calls.map(c=>c.method),['apply'],'unmounted continuation cannot request unwrap');
   assert.equal(f.store.data.project.defaultAllowanceMm,succeeds?20:undefined,'the already requested allowance transaction retains its actual outcome');
  }finally{save.resolve({ok:false,error:{code:'TEST_END'}});f.app.unmount();for(const token of timers.keys())globalThis.clearInterval(token);}
 });
 await check('running task uses real stages, ignores foreign progress, routes cancel and removes listener/timer on unmount',async()=>{
  const cut=deferred(),calls=[];let listener,unsubscribed=0;const before=timerStarts,stops=timerStops;
  const f=await mount(fixtureProject(),{component:'unwrap',controls:false,api:{onSurfaceProgress:callback=>{listener=callback;return()=>unsubscribed++;},unwrapSurface:(...args)=>{calls.push({method:'unwrap',args});return cut.promise;},cancelSurface:async(...args)=>calls.push({method:'cancel',args})}});
  try{
   const action=f.click(f.button('Cut and compute pattern candidate'));await flush();assert.equal(timerStarts,before+1);assert.equal(timers.size,1);assert.deepEqual(calls[0].args.slice(0,2),[id('project'),1]);
   listener({projectId:id('project'),revision:1,stage:'unwrap',completed:2,total:10});await flush();assert(f.root.textContent.includes('Unwrapping pieces'));assert(f.root.textContent.includes('2 / 10'));assert(!f.root.textContent.includes('20%'));
   listener({projectId:id('other-project'),revision:1,stage:'validate'});await flush();assert(!f.root.textContent.includes('Validating patterns'));listener({projectId:id('project'),revision:2,stage:'validate'});await flush();assert(!f.root.textContent.includes('Validating patterns'));
   await f.click(f.button('Cancel unwrap'));assert.deepEqual(calls[1],{method:'cancel',args:[id('project'),1]});f.app.unmount();assert.equal(unsubscribed,1);assert.equal(timers.size,0);assert.equal(timerStops,stops+1);
   listener({projectId:id('project'),revision:1,stage:'validate'});cut.resolve(reply(f.store));await action;assert.equal(timerStarts,before+1);assert.equal(timers.size,0);assert(!walk(f.root).some(n=>n.tag==='button'));
  }finally{cut.resolve({ok:false,error:{code:'TEST_END'}});f.app.unmount();for(const token of timers.keys())globalThis.clearInterval(token);}
 });
}finally{globalThis.setInterval=nativeInterval;globalThis.clearInterval=nativeClear;}
const passed=checks.every(c=>c.passed);await writeFile('test-results/unwrap-lifecycle-component.json',JSON.stringify({passed,verification:'Actual UnwrapTools SFC lifecycle and IPC requests; custom Vue host and timer recorder, not Electron pixels',checks},null,2));console.log(JSON.stringify({passed,checks}));if(!passed)process.exitCode=1;
