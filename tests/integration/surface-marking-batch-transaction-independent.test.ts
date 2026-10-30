import {afterAll,beforeAll,beforeEach,expect,it,vi} from 'vitest';
import {randomUUID} from 'node:crypto';
import {mkdir,mkdtemp,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {markingSchema,requestSchema,type Marking,type Project,type Response,type Session,type SurfaceMarkingEdit} from '../../packages/schema/index';
import {project} from '../fixtures';
import {parseObj} from '../../apps/desktop/main/surface';
import {DomainError,Repository,hash} from '../../apps/desktop/main/repository';
import {pack} from '../../apps/desktop/main/archive';

// Projection geometry has its own native tests. This suite verifies that the
// real request handler publishes and persists a whole edit round atomically.
const host=vi.hoisted(()=>{let ready!:()=>void;return {open:vi.fn(),receive:undefined as undefined|((channel:string,payload:unknown)=>Promise<unknown>),shutdown:undefined as undefined|(()=>Promise<void>),ready:new Promise<void>(resolve=>{ready=resolve;}),started:()=>ready()};});
const runtime=vi.hoisted(()=>({batch:vi.fn()}));
vi.mock('../../apps/desktop/main/host-channel',()=>({dialogs:{open:host.open,save:vi.fn()},publish:vi.fn(),nativeCall:vi.fn(),serve:(receive:typeof host.receive,shutdown:typeof host.shutdown)=>{host.receive=receive;host.shutdown=shutdown;host.started();}}));
vi.mock('../../apps/desktop/main/surface-runtime',async original=>({...await original<typeof import('../../apps/desktop/main/surface-runtime')>(),runEditSurfaceMarkings:runtime.batch}));
vi.mock('../../apps/desktop/main/worker',async original=>({...await original<typeof import('../../apps/desktop/main/worker')>(),analyze:vi.fn(async()=>[])}));

let directory:string,current:Project,published:Session,edits:SurfaceMarkingEdit[],results:Marking[];
const identity=(session:Session)=>({project:session.project,history:session.history,canUndo:session.canUndo,canRedo:session.canRedo,recovery:session.recovery});
const dispatch=(request:unknown)=>host.receive!('fpcad:request',request) as Promise<Response>;
const scoped=(method:string,payload:unknown)=>({protocolVersion:1,requestId:randomUUID(),method,projectId:current.id,expectedRevision:current.revision,payload});
async function read(){const response=await dispatch({protocolVersion:1,requestId:randomUUID(),method:'session.read',payload:{}});if(!response.ok)throw Error(response.error.code);return response.data;}
function fixture(){
 const p=project();p.pieces=[];p.surface=parseObj('v 0 0 0\nv 100 0 0\nv 100 100 0\nv 0 100 0\ng torso\nf 1 2 3\nf 1 3 4');
 p.markings=[0,1,2].map(index=>{
  const shape=markingSchema.shape.surfaceShape.unwrap().parse({origin:[0,0,0],axes:[[1,0,0],[0,1,0],[0,0,1]],nodes:[{xMm:10+index,yMm:10},{xMm:30+index,yMm:10},{xMm:20+index,yMm:30}]});
  return markingSchema.parse({id:randomUUID(),name:'Ordered layer '+index,color:['#ff0000','#0000ff','#ffffff'][index],source:'surface',fabrication:index===1?'detail':'sewn',locked:index===2,sourceHash:hash(JSON.stringify(shape)),surfaceId:p.surface!.id,topologyVersion:p.surface!.topologyVersion,surfaceHash:hash(JSON.stringify(p.surface)),surfaceShape:shape,view:'front',offsetXmm:0,offsetYmm:0,fragments:[{faceId:p.surface!.faces[0].id,rings:[[[.6,.2,.2],[.3,.5,.2],[.3,.2,.5]]]}],paths:[]});
 });return p;
}
beforeAll(async()=>{await mkdir(resolve('.local/tests'),{recursive:true});directory=await mkdtemp(resolve('.local/tests/surface-edit-many-'));vi.stubEnv('FPCAD_DATA_DIR',directory);await import('../../apps/desktop/main/main');await host.ready;});
beforeEach(async()=>{
 const path=join(directory,randomUUID()+'.fpcad');await writeFile(path,pack(fixture()).bytes);host.open.mockReset().mockResolvedValue({canceled:false,filePaths:[path]});runtime.batch.mockReset();
 const response=await dispatch({protocolVersion:1,requestId:randomUUID(),method:'project.open',payload:{}});if(!response.ok)throw Error(response.error.code);current=response.data.project!;published=response.data;
 edits=current.markings!.slice(0,2).map((marking,index)=>({markingId:marking.id,shape:{...structuredClone(marking.surfaceShape!),origin:[index+2,4,0]}}));
 results=edits.map(edit=>{const old=current.markings!.find(marking=>marking.id===edit.markingId)!;return markingSchema.parse({...old,surfaceShape:edit.shape,sourceHash:hash(JSON.stringify(edit.shape))});});
});
afterAll(async()=>{await host.shutdown?.();vi.unstubAllEnvs();});

it('keeps the single-edit contract and bounds the batch with the existing shape and 500-marking limits',()=>{
 const request=scoped('marking.surface.editMany',{edits});expect(requestSchema.parse(request)).toEqual(request);
 expect(requestSchema.parse(scoped('marking.surface.edit',edits[0]))).toMatchObject({method:'marking.surface.edit'});
 expect(requestSchema.safeParse(scoped('marking.surface.editMany',{edits:[]})).success).toBe(false);
 expect(requestSchema.safeParse(scoped('marking.surface.editMany',{edits:Array.from({length:501},()=>edits[0])})).success).toBe(false);
});

it('persists all transformed layers in one revision and undo action, preserving stacking order, untouched data and replay',async()=>{
 runtime.batch.mockResolvedValue(results);const request=scoped('marking.surface.editMany',{edits}),before=structuredClone(current),response=await dispatch(request);expect(response.ok).toBe(true);if(!response.ok)return;
 expect(runtime.batch).toHaveBeenCalledOnce();expect(runtime.batch.mock.calls[0][2]).toEqual(edits);expect(response.data.project!.revision).toBe(before.revision+1);
 const expected=before.markings!.map(marking=>results.find(result=>result.id===marking.id)??marking);expect(response.data.project!.markings).toEqual(expected);
 expect(response.data.project!.markings!.map(marking=>marking.id)).toEqual(before.markings!.map(marking=>marking.id));expect(response.data.history).toHaveLength(published.history.length+1);
 const replay=await dispatch(request);expect(replay.ok&&replay.data.project).toEqual(response.data.project);expect(runtime.batch).toHaveBeenCalledOnce();
 current=response.data.project!;const undone=await dispatch(scoped('command.undo',{}));expect(undone.ok&&undone.data.project!.markings).toEqual(before.markings);
 if(!undone.ok)return;current=undone.data.project!;const redone=await dispatch(scoped('command.redo',{}));expect(redone.ok&&redone.data.project!.markings).toEqual(expected);
});

it.each(['INVALID_GEOMETRY','NO_VISIBLE_PROJECTION','PROJECTION_LIMIT'])('a later edit failure %s publishes no partial result or undo history',async code=>{
 runtime.batch.mockRejectedValue(new DomainError(code));const before=identity(published);expect(await dispatch(scoped('marking.surface.editMany',{edits}))).toMatchObject({ok:false,error:{code}});expect(identity(await read())).toEqual(before);
});

it.each(['locked','missing','duplicate'] as const)('rejects a %s target before starting projection and retains the complete state',async kind=>{
 const invalid=kind==='locked'?[edits[0],{...edits[1],markingId:current.markings![2].id}]:kind==='missing'?[edits[0],{...edits[1],markingId:randomUUID()}]:[edits[0],edits[0]],code=kind==='locked'?'MARKING_LOCKED':kind==='missing'?'ENTITY_MISSING':'INVALID_SELECTION';
 expect(await dispatch(scoped('marking.surface.editMany',{edits:invalid}))).toMatchObject({ok:false,error:{code}});expect(runtime.batch).not.toHaveBeenCalled();expect(identity(await read())).toEqual(identity(published));
});

it('rejects a stale revision before projection and leaves every field unchanged',async()=>{
 expect(await dispatch({...scoped('marking.surface.editMany',{edits}),expectedRevision:current.revision+1})).toMatchObject({ok:false,error:{code:'REVISION_CONFLICT'}});expect(runtime.batch).not.toHaveBeenCalled();expect(identity(await read())).toEqual(identity(published));
});

it('cancels the entire round at its result boundary even when the worker returns completed edits late',async()=>{
 let finish!:(value:Marking[])=>void,started!:()=>void,signal:AbortSignal|undefined;const ready=new Promise<void>(resolve=>{started=resolve;});
 runtime.batch.mockImplementation((_worker:string,_project:Project,_edits:SurfaceMarkingEdit[],abort:AbortSignal)=>{signal=abort;started();return new Promise(resolve=>{finish=resolve;});});
 const request=scoped('marking.surface.editMany',{edits}),pending=dispatch(request);await ready;
 expect(await dispatch(scoped('surface.cancel',{targetRequestIds:[request.requestId]}))).toMatchObject({ok:true,cancelled:true});expect(signal!.aborted).toBe(true);
 finish(results);expect(await pending).toMatchObject({ok:false,error:{code:'CANCELLED'}});expect(identity(await read())).toEqual(identity(published));
});

it('a revision changed while calculating rejects the complete result and preserves the newer state',async()=>{
 let finish!:(value:Marking[])=>void,started!:()=>void;const ready=new Promise<void>(resolve=>{started=resolve;});runtime.batch.mockImplementation(()=>{started();return new Promise(resolve=>{finish=resolve;});});
 const pending=dispatch(scoped('marking.surface.editMany',{edits}));await ready;
 const other=new Repository(join(directory,'workspace.sqlite'));try{other.commit({type:'project.rename',name:'Newer committed project'},randomUUID(),'concurrent-edit');}finally{other.close();}
 const newer=await (async()=>{const other=new Repository(join(directory,'workspace.sqlite'));try{return other.snapshot()!;}finally{other.close();}})();
 finish(results);expect(await pending).toMatchObject({ok:false,error:{code:'REVISION_CONFLICT'}});const after=await read();expect(after.project).toEqual(newer);expect(after.project!.markings).toEqual(current.markings);expect(after.history).toHaveLength(published.history.length+1);
});

it.each(['incomplete','reordered'])('rejects an %s worker result before any database write',async kind=>{
 runtime.batch.mockResolvedValue(kind==='incomplete'?[results[0]]:[results[1],results[0]]);expect(await dispatch(scoped('marking.surface.editMany',{edits}))).toMatchObject({ok:false,error:{code:'WORKER_PROTOCOL'}});expect(identity(await read())).toEqual(identity(published));
});

it('batch replacement preserves existing paint layers even in reversed input order and appends only newly attached IDs',()=>{
 const repository=new Repository(':memory:');try{
  repository.open(current,null);const before=repository.snapshot()!,added={...structuredClone(results[0]),id:randomUUID(),name:'New symmetric layer'},batch=[results[1],added,results[0]];
  repository.commit({type:'markings.batch',markings:batch},randomUUID(),'mixed-new-and-existing');
  expect(repository.snapshot()!.markings).toEqual([results[0],results[1],before.markings![2],added]);repository.historyMove(false);expect(repository.snapshot()!.markings).toEqual(before.markings);repository.historyMove(true);expect(repository.snapshot()!.markings).toEqual([results[0],results[1],before.markings![2],added]);
 }finally{repository.close();}
});
