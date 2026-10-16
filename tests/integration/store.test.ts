import {it,expect,beforeEach} from 'vitest';
import {createPinia,setActivePinia} from 'pinia';
import {useSession} from '../../apps/desktop/src/store';
import type {Response,Session} from '../../packages/schema/index';
import {watch} from 'vue';
const response=(savedRevision:number|null=null):Response=>({ok:true,data:{project:null,geometry:[],canUndo:false,canRedo:false,savedRevision,recovery:[],history:[],recent:[],jobs:[]} satisfies Session});
const deferred=()=>{let resolve!:(r:Response)=>void;const promise=new Promise<Response>(r=>resolve=r);return {promise,resolve};};
beforeEach(()=>setActivePinia(createPinia()));
it('background reads do not block a user edit or overwrite its newer response',async()=>{
 const store=useSession(),read=deferred();
 expect(typeof store.refresh).toBe('function');
 const refreshing=store.refresh(()=>read.promise);expect(store.busy).toBe(false);
 expect(await store.run(async()=>response(2))).toBe(true);
 read.resolve(response(1));await refreshing;expect(store.data.savedRevision).toBe(2);
});
it('only the latest read is published and refresh preserves a useful operation error',async()=>{
 const store=useSession(),older=deferred(),newer=deferred();
 expect(typeof store.refresh).toBe('function');
 store.error='SEAM_DEPENDENCY';const first=store.refresh(()=>older.promise),last=store.refresh(()=>newer.promise);
 newer.resolve(response(2));await last;older.resolve(response(1));await first;
 expect(store.data.savedRevision).toBe(2);expect(store.error).toBe('SEAM_DEPENDENCY');
});
it('session storage notices are visible after synchronous page scope changes',async()=>{
 const store=useSession();store.setErrorScope('none:home');
 const stop=watch(()=>store.data.sessionId,id=>store.setErrorScope((id??'none')+':home'),{flush:'sync'});
 try{const result=response();if(!result.ok)throw Error('fixture');result.data.sessionId='new-session';result.data.notice='STORAGE_RECLAIM_FAILED';await store.refresh(async()=>result);expect(store.error).toBe('STORAGE_RECLAIM_FAILED');store.setErrorScope('new-session:model');expect(store.error).toBe('STORAGE_RECLAIM_FAILED');store.error='ENTITY_MISSING';expect(store.error).toBe('ENTITY_MISSING');store.error='';expect(store.error).toBe('');}finally{stop();}
});
it('same-session reads retain an unread notice, respect dismissal and clear it on a project switch',async()=>{
 const store=useSession(),withNotice=response();if(!withNotice.ok)throw Error('fixture');withNotice.data.sessionId='first';withNotice.data.notice='STORAGE_RECLAIM_FAILED';
 await store.refresh(async()=>withNotice);const quiet=response();if(!quiet.ok)throw Error('fixture');quiet.data.sessionId='first';await store.refresh(async()=>quiet);expect(store.error).toBe('STORAGE_RECLAIM_FAILED');
 store.error='';await store.refresh(async()=>withNotice);expect(store.error).toBe('');await store.refresh(async()=>quiet);expect(store.error).toBe('');
 const second=response();if(!second.ok)throw Error('fixture');second.data.sessionId='second';await store.run(async()=>second);expect(store.error).toBe('');await store.run(async()=>withNotice);expect(store.error).toBe('STORAGE_RECLAIM_FAILED');
 await store.run(async()=>second);expect(store.error).toBe('');
});
