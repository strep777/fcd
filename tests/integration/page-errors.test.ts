import {it,expect} from 'vitest';
import {createPinia,setActivePinia} from 'pinia';
import {useSession} from '../../apps/desktop/src/store';
it('keeps late operation errors on their originating page and restores only that page warning',async()=>{
 setActivePinia(createPinia());const store=useSession();store.setErrorScope('cutting');let finish!:(value:any)=>void;
 const running=store.run(()=>new Promise(resolve=>{finish=resolve;}));store.setErrorScope('model');finish({ok:false,error:{code:'UNWRAP_FAILED'}});expect(await running).toBe(false);expect(store.error).toBe('');store.setErrorScope('cutting');expect(store.error).toBe('UNWRAP_FAILED');store.error='';store.setErrorScope('model');expect(store.error).toBe('');
});
it('a late refresh tests the originating page before preserving or replacing its warning',async()=>{
 setActivePinia(createPinia());const store=useSession();store.setErrorScope('model');store.error='EXISTING_MODEL_WARNING';let finish!:(value:any)=>void;
 let pending=store.refresh(()=>new Promise(resolve=>{finish=resolve;}));store.setErrorScope('cutting');finish({ok:false,error:{code:'MODEL_REFRESH_FAILED'}});await pending;
 store.setErrorScope('model');expect(store.error).toBe('EXISTING_MODEL_WARNING');store.error='';
 pending=store.refresh(()=>new Promise(resolve=>{finish=resolve;}));store.setErrorScope('cutting');store.error='EXISTING_CUT_WARNING';finish({ok:false,error:{code:'MODEL_REFRESH_FAILED'}});await pending;
 expect(store.error).toBe('EXISTING_CUT_WARNING');store.setErrorScope('model');expect(store.error).toBe('MODEL_REFRESH_FAILED');
});
it('captures page identity for read-only previews that do not take the mutation lock',()=>{
 setActivePinia(createPinia());const store=useSession();store.setErrorScope('project-A:pattern');const reportError=store.captureError();store.setErrorScope('project-A:mapping');reportError('PREVIEW_FAILED');expect(store.error).toBe('');store.setErrorScope('project-A:pattern');expect(store.error).toBe('PREVIEW_FAILED');store.setErrorScope('project-B:pattern');expect(store.error).toBe('');
});
