import {onBeforeUnmount,onMounted,watch} from 'vue';
import {invoke,isTauri} from '@tauri-apps/api/core';
import {listen} from '@tauri-apps/api/event';

type NativeDraftCloseHost={listen:(closeRequested:()=>void)=>Promise<()=>void>;arm:(enabled:boolean)=>Promise<unknown>;setDirty:(dirty:boolean)=>Promise<unknown>;close:()=>Promise<void>};

/** Only the dirty bit crosses IPC; draft geometry stays in the renderer. */
export function createNativeDraftCloseGuard(host:NativeDraftCloseHost,dirty:()=>boolean,requestLeave:(close:()=>void)=>void){
 let disposed=false,enabled=false,armed=false,closing=false,unlisten:(()=>void)|undefined,nativeValue:boolean|undefined,requestedValue:boolean|undefined;
 let queue=Promise.resolve(),latest=Promise.resolve(true);
 const ready=Promise.resolve().then(()=>host.listen(()=>{
  if(disposed||!enabled||closing)return;
  // A busy save may finish while the dialog is open. Its existing disabled
  // buttons wait for that save; the confirmation then rechecks current drafts.
  requestLeave(()=>{void closeWhenClean();});
 })).then(async remove=>{
  if(disposed){remove();return false;}unlisten=remove;enabled=true;
  try{await host.arm(true);armed=true;return !disposed;}
  catch{enabled=false;unlisten?.();unlisten=undefined;return false;}
 },()=>false);
 function synchronize(value=dirty()):Promise<boolean>{
  if(disposed)return Promise.resolve(false);
  if(requestedValue===value)return latest;
  requestedValue=value;
  latest=queue.then(async()=>{
   if(!await ready||disposed)return false;
   try{await host.setDirty(value);nativeValue=value;return true;}
   catch{if(requestedValue===value)requestedValue=undefined;return false;}
  });
  queue=latest.then(()=>{});return latest;
 }
 async function flush(){let task:Promise<boolean>,saved:boolean;do{task=latest;saved=await task;}while(task!==latest);return saved;}
 async function closeWhenClean(){
  if(disposed||closing||dirty())return;
  closing=true;
  try{
   await synchronize(false);
   if(!await flush()||disposed||dirty()||nativeValue!==false)return;
   await host.close();
  }catch{/* A failed native close leaves the window available for another try. */}
  finally{closing=false;}
 }
 const started=synchronize();
 async function dispose(){
  if(disposed)return;disposed=true;unlisten?.();unlisten=undefined;
  await ready;await queue;
  // Clear a previously acknowledged flag after any in-flight write settles.
  // A late listener registration never enables the flag in the first place.
  if(nativeValue===true)try{await host.setDirty(false);nativeValue=false;}catch{}
  if(armed)try{await host.arm(false);armed=false;}catch{}
 }
 return {synchronize,ready:started,dispose};
}

let previousCleanup=Promise.resolve();
export function useNativeDraftCloseGuard(dirty:()=>boolean,requestLeave:(close:()=>void)=>void){
 if(typeof window==='undefined'||!isTauri())return;
 let guard:ReturnType<typeof createNativeDraftCloseGuard>|undefined;
 const stop=watch(dirty,value=>{void guard?.synchronize(value);},{flush:'sync'});
 onMounted(()=>{const cleanup=previousCleanup;guard=createNativeDraftCloseGuard({
  listen:async callback=>{await cleanup;return listen('fpcad:close-with-draft',callback);},
  arm:enabled=>invoke('set_renderer_close_guard',{enabled}),
  setDirty:value=>invoke('set_renderer_draft_dirty',{dirty:value}),
  close:()=>invoke<void>('confirm_renderer_close')
 },dirty,requestLeave);});
 onBeforeUnmount(()=>{stop();if(guard)previousCleanup=guard.dispose();});
}
