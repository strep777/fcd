import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {createRenderer,defineComponent,ref} from 'vue';
import {createNativeDraftCloseGuard,useNativeDraftCloseGuard} from '../../apps/desktop/src/modules/useNativeDraftCloseGuard';

const bridge=vi.hoisted(()=>({invoke:vi.fn(),listen:vi.fn(),isTauri:vi.fn(),close:vi.fn()}));
vi.mock('@tauri-apps/api/core',()=>({invoke:bridge.invoke,isTauri:bridge.isTauri}));
vi.mock('@tauri-apps/api/event',()=>({listen:bridge.listen}));
vi.mock('@tauri-apps/api/window',()=>({getCurrentWindow:()=>({close:bridge.close})}));
const renderer=createRenderer<any,any>({createElement:type=>({type,children:[]}),insert:(node,parent)=>parent.children.push(node),remove(){},createText:text=>({text}),createComment:text=>({text}),setText(){},setElementText(){},parentNode:()=>null,nextSibling:()=>null,patchProp(){}});
const flush=async()=>{for(let i=0;i<12;i++)await Promise.resolve();};
function deferred<T>(){let resolve!:(value:T)=>void,reject!:(error:Error)=>void;const promise=new Promise<T>((accept,decline)=>{resolve=accept;reject=decline;});return{promise,resolve,reject};}
function fixture(initial=true){
 let dirty=initial,event!:()=>void,action:(()=>void)|undefined;
 const host={listen:vi.fn(async(callback:()=>void)=>{event=callback;return vi.fn();}),arm:vi.fn(async(_value:boolean)=>{}),setDirty:vi.fn(async(_value:boolean)=>{}),close:vi.fn(async()=>{})},requestLeave=vi.fn((close:()=>void)=>{action=close;});
 const guard=createNativeDraftCloseGuard(host,()=>dirty,requestLeave);
 return{guard,host,requestLeave,event:()=>event(),confirm:()=>action?.(),cancel:()=>{action=undefined;},dirty:(value:boolean)=>{dirty=value;return guard.synchronize(value);}};
}
beforeEach(()=>{bridge.invoke.mockReset().mockResolvedValue(undefined);bridge.listen.mockReset().mockResolvedValue(()=>{});bridge.isTauri.mockReset().mockReturnValue(false);bridge.close.mockReset().mockResolvedValue(undefined);});
afterEach(()=>vi.unstubAllGlobals());

it('registers the close listener before enabling the native dirty bit and serializes only boolean transitions',async()=>{
 const registration=deferred<()=>void>(),host={listen:vi.fn(()=>registration.promise),arm:vi.fn(async(_value:boolean)=>{}),setDirty:vi.fn(async(_value:boolean)=>{}),close:vi.fn(async()=>{})};let dirty=true;
 const guard=createNativeDraftCloseGuard(host,()=>dirty,()=>{});await flush();expect(host.listen).toHaveBeenCalledOnce();expect(host.setDirty).not.toHaveBeenCalled();
 dirty=false;const clean=guard.synchronize(false);dirty=true;const changed=guard.synchronize(true);registration.resolve(()=>{});expect(await guard.ready).toBe(true);await clean;await changed;
 expect(host.setDirty.mock.calls).toEqual([[true],[false],[true]]);await guard.synchronize(true);expect(host.setDirty).toHaveBeenCalledTimes(3);await guard.dispose();
});

it('cancel leaves the window and all drafts open, and a later X opens the same decision again',async()=>{
 const f=fixture();try{await f.guard.ready;f.event();expect(f.requestLeave).toHaveBeenCalledOnce();f.cancel();await flush();expect(f.host.close).not.toHaveBeenCalled();expect(f.host.setDirty.mock.calls).toEqual([[true]]);f.event();expect(f.requestLeave).toHaveBeenCalledTimes(2);}finally{await f.guard.dispose();}
});

it('a failed save cannot close while its draft remains dirty',async()=>{
 const f=fixture();try{await f.guard.ready;f.event();f.confirm();await flush();expect(f.host.close).not.toHaveBeenCalled();expect(f.host.setDirty.mock.calls).toEqual([[true]]);}finally{await f.guard.dispose();}
});

it.each(['save','discard'])('%s waits for the native false acknowledgement before requesting the normal close',async()=>{
 const f=fixture(),ack=deferred<void>();try{
  await f.guard.ready;f.event();f.host.setDirty.mockImplementation(async value=>{if(!value)await ack.promise;});const synced=f.dirty(false);f.confirm();await flush();
  expect(f.host.close).not.toHaveBeenCalled();expect(f.host.setDirty.mock.calls).toEqual([[true],[false]]);ack.resolve();await synced;await flush();expect(f.host.close).toHaveBeenCalledOnce();
 }finally{ack.resolve();await f.guard.dispose();}
});

it('can confirm a close after an earlier save already removed every draft while the dialog was open',async()=>{
 const f=fixture();try{
  await f.guard.ready;f.event();expect(f.requestLeave).toHaveBeenCalledOnce();f.confirm();await flush();expect(f.host.close).not.toHaveBeenCalled();
  await f.dirty(false);f.confirm();await flush();expect(f.host.close).toHaveBeenCalledOnce();expect(f.host.setDirty.mock.calls).toEqual([[true],[false]]);
 }finally{await f.guard.dispose();}
});

it('a failed native dirty acknowledgement retains the window and a later close can retry',async()=>{
 const f=fixture();try{
  await f.guard.ready;f.host.setDirty.mockRejectedValue(Error('Host temporarily unavailable'));expect(await f.dirty(false)).toBe(false);f.event();f.confirm();await flush();expect(f.host.close).not.toHaveBeenCalled();
  f.host.setDirty.mockResolvedValue(undefined);f.event();f.confirm();await flush();expect(f.host.close).toHaveBeenCalledOnce();expect(f.host.setDirty).toHaveBeenLastCalledWith(false);
 }finally{f.host.setDirty.mockResolvedValue(undefined);await f.guard.dispose();}
});

it('a new draft arriving while false is in flight restores true and prevents an obsolete close',async()=>{
 const f=fixture(),ack=deferred<void>();try{
  await f.guard.ready;f.event();f.host.setDirty.mockImplementation(async value=>{if(!value)await ack.promise;});const clean=f.dirty(false);f.confirm();await flush();const changed=f.dirty(true);
  ack.resolve();await clean;await changed;await flush();expect(f.host.setDirty.mock.calls).toEqual([[true],[false],[true]]);expect(f.host.close).not.toHaveBeenCalled();
 }finally{ack.resolve();await f.guard.dispose();}
});

it('repeated native X requests and repeated confirmations do not dispatch overlapping native closes',async()=>{
 const f=fixture(),ack=deferred<void>();try{
  await f.guard.ready;f.event();f.event();expect(f.requestLeave).toHaveBeenCalledTimes(2);f.host.setDirty.mockImplementation(async value=>{if(!value)await ack.promise;});const synced=f.dirty(false);f.confirm();f.confirm();f.event();await flush();
  expect(f.requestLeave).toHaveBeenCalledTimes(2);expect(f.host.close).not.toHaveBeenCalled();ack.resolve();await synced;await flush();expect(f.host.close).toHaveBeenCalledOnce();
 }finally{ack.resolve();await f.guard.dispose();}
});

it('unmount before listener registration removes a late listener without enabling a native guard',async()=>{
 const registration=deferred<()=>void>(),remove=vi.fn(),host={listen:vi.fn(()=>registration.promise),arm:vi.fn(async(_value:boolean)=>{}),setDirty:vi.fn(async()=>{}),close:vi.fn(async()=>{})},requestLeave=vi.fn();
 const guard=createNativeDraftCloseGuard(host,()=>true,requestLeave);await flush();const disposed=guard.dispose();registration.resolve(remove);await disposed;expect(await guard.ready).toBe(false);expect(remove).toHaveBeenCalledOnce();expect(host.setDirty).not.toHaveBeenCalled();
});

it('unmount waits out an in-flight true and then clears it; late close messages cannot affect a disposed owner',async()=>{
 const f=fixture(),ack=deferred<void>();f.host.setDirty.mockImplementationOnce(async()=>{await ack.promise;});await flush();const disposed=f.guard.dispose();f.event();expect(f.requestLeave).not.toHaveBeenCalled();ack.resolve();await disposed;expect(f.host.setDirty.mock.calls).toEqual([[true],[false]]);expect(f.host.close).not.toHaveBeenCalled();
});

it('an unavailable listener leaves native shutdown usable instead of enabling a flag without a handler',async()=>{
 const host={listen:vi.fn(async()=>{throw Error('No event host');}),arm:vi.fn(async(_value:boolean)=>{}),setDirty:vi.fn(async()=>{}),close:vi.fn(async()=>{})},guard=createNativeDraftCloseGuard(host,()=>true,()=>{});
 expect(await guard.ready).toBe(false);expect(host.setDirty).not.toHaveBeenCalled();await guard.dispose();
});

it('the component host and a browser without Tauri register no native calls',async()=>{
 vi.stubGlobal('window',{});const app=renderer.createApp(defineComponent({setup(){useNativeDraftCloseGuard(()=>true,()=>{});return()=>null;}}));app.mount({children:[]});app.unmount();await flush();expect(bridge.invoke).not.toHaveBeenCalled();expect(bridge.listen).not.toHaveBeenCalled();expect(bridge.close).not.toHaveBeenCalled();
});

it('the real composable sends one boolean update for arbitrarily many edits while dirty, then clears on disposal',async()=>{
 vi.stubGlobal('window',{});bridge.isTauri.mockReturnValue(true);const dirty=ref(false),edits=ref(0),app=renderer.createApp(defineComponent({setup(){useNativeDraftCloseGuard(()=>dirty.value,()=>{});return()=>edits.value?null:null;}}));
 app.mount({children:[]});await flush();expect(bridge.listen).toHaveBeenCalledWith('fpcad:close-with-draft',expect.any(Function));expect(bridge.invoke.mock.calls).toEqual([['set_renderer_close_guard',{enabled:true}],['set_renderer_draft_dirty',{dirty:false}]]);
 dirty.value=true;for(let i=0;i<100;i++)edits.value++;await flush();expect(bridge.invoke.mock.calls.filter(([method])=>method==='set_renderer_draft_dirty')).toEqual([['set_renderer_draft_dirty',{dirty:false}],['set_renderer_draft_dirty',{dirty:true}]]);
 app.unmount();await flush();expect(bridge.invoke.mock.calls.slice(-2)).toEqual([['set_renderer_draft_dirty',{dirty:false}],['set_renderer_close_guard',{enabled:false}]]);
});

it('immediate unmount/remount waits for old cleanup instead of a late false clearing the new dirty owner',async()=>{
 vi.stubGlobal('window',{});bridge.isTauri.mockReturnValue(true);const cleanupAck=deferred<void>(),component=()=>defineComponent({setup(){useNativeDraftCloseGuard(()=>true,()=>{});return()=>null;}}),first=renderer.createApp(component());
 first.mount({children:[]});await flush();bridge.invoke.mockImplementation(async(_command:string,{dirty}:{dirty:boolean})=>{if(!dirty)await cleanupAck.promise;});first.unmount();const second=renderer.createApp(component());second.mount({children:[]});await flush();expect(bridge.listen).toHaveBeenCalledTimes(1);
 cleanupAck.resolve();await flush();expect(bridge.listen).toHaveBeenCalledTimes(2);expect(bridge.invoke.mock.calls.filter(([method])=>method==='set_renderer_draft_dirty').map(([,payload])=>payload)).toEqual([{dirty:true},{dirty:false},{dirty:true}]);second.unmount();await flush();
});

it('an armed close during a delayed true update consults the live renderer draft instead of the old native false bit',async()=>{
 const f=fixture(false),ack=deferred<void>();try{
  await f.guard.ready;expect(f.host.arm).toHaveBeenCalledWith(true);f.host.setDirty.mockImplementation(async value=>{if(value)await ack.promise;});const syncing=f.dirty(true);await flush();
  f.event();expect(f.requestLeave).toHaveBeenCalledOnce();f.confirm();await flush();expect(f.host.close).not.toHaveBeenCalled();ack.resolve();await syncing;expect(f.host.setDirty.mock.calls).toEqual([[false],[true]]);
 }finally{ack.resolve();await f.guard.dispose();}
});

it('an older native host that cannot arm retains its original close path without setting a stale dirty bit',async()=>{
 const host={listen:vi.fn(async()=>vi.fn()),arm:vi.fn(async()=>{throw Error('Unknown command');}),setDirty:vi.fn(async()=>{}),close:vi.fn(async()=>{})},guard=createNativeDraftCloseGuard(host,()=>true,()=>{});
 expect(await guard.ready).toBe(false);expect(host.setDirty).not.toHaveBeenCalled();await guard.dispose();
});

it('a clean renderer continues through the normal native shutdown without requiring another close click',async()=>{
 let event!:()=>void;const host={listen:vi.fn(async(callback:()=>void)=>{event=callback;return()=>{};}),arm:vi.fn(async()=>{}),setDirty:vi.fn(async()=>{}),close:vi.fn(async()=>{})},guard=createNativeDraftCloseGuard(host,()=>false,close=>close());
 try{await guard.ready;event();await flush();expect(host.close).toHaveBeenCalledOnce();expect(host.setDirty.mock.calls).toEqual([[false]]);}finally{await guard.dispose();}
});
