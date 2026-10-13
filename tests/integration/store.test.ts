import {it,expect,beforeEach} from 'vitest';
import {createPinia,setActivePinia} from 'pinia';
import {useSession} from '../../apps/desktop/src/store';
import type {Response,Session} from '../../packages/schema/index';
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
