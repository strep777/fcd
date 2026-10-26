import {afterAll,beforeAll,beforeEach,expect,it,vi} from 'vitest';
import {randomUUID} from 'node:crypto';
import {mkdir,mkdtemp,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import UPNG from '@pdf-lib/upng';
import type {Marking,Project,Response,Session} from '../../packages/schema/index';
import {project,rectangle} from '../fixtures';
import {parseObj,pieceGeometryHash} from '../../apps/desktop/main/surface';
import {DomainError,hash} from '../../apps/desktop/main/repository';
import {pack} from '../../apps/desktop/main/archive';

// This suite exercises orchestration and persisted state. Native projection
// area and source ownership are checked separately in the batch suite.
const host=vi.hoisted(()=>{let ready!:()=>void;return {open:vi.fn(),receive:undefined as undefined|((channel:string,payload:unknown)=>Promise<unknown>),shutdown:undefined as undefined|(()=>Promise<void>),ready:new Promise<void>(resolve=>{ready=resolve;}),started:()=>ready()};});
const runtime=vi.hoisted(()=>({batch:vi.fn(),references:vi.fn()}));
vi.mock('../../apps/desktop/main/host-channel',()=>({dialogs:{open:host.open,save:vi.fn()},publish:vi.fn(),nativeCall:vi.fn(),serve:(receive:typeof host.receive,shutdown:typeof host.shutdown)=>{host.receive=receive;host.shutdown=shutdown;host.started();}}));
vi.mock('../../apps/desktop/main/surface-runtime',async original=>({...await original<typeof import('../../apps/desktop/main/surface-runtime')>(),runAutomaticPlacement:runtime.batch,runReferences:runtime.references}));
vi.mock('../../apps/desktop/main/worker',async original=>({...await original<typeof import('../../apps/desktop/main/worker')>(),analyze:vi.fn(async()=>[])}));

let directory:string,current:Project,published:Session,results:Marking[];
async function request(method:string,payload:unknown,scoped=true):Promise<Response>{return await host.receive!('fpcad:request',{protocolVersion:1,requestId:randomUUID(),method,payload,...(scoped?{projectId:current.id,expectedRevision:current.revision}:{})}) as Response;}
const identity=(session:Session)=>({project:session.project,history:session.history,canUndo:session.canUndo,canRedo:session.canRedo});
async function read(){const response=await request('session.read',{},false);if(!response.ok)throw Error(response.error.code);return response.data;}
function fixture(){
 const p=project();p.pieces=[];p.references=[];p.markings=[];p.surface=parseObj('v 0 0 0\nv 100 0 0\nv 100 100 0\nv 0 100 0\ng torso\nf 1 2 3\nf 1 3 4');
 p.patternLibrary=[0,1].map(index=>{const piece=rectangle(20,20);piece.name='Transaction pigment '+index;return {piece,referenceId:randomUUID(),view:'sheet' as const,category:'body',anatomy:{part:'body' as const,side:'center' as const,confidence:1,method:'silhouette-1' as const}};});return p;
}
beforeAll(async()=>{await mkdir(resolve('.local/tests'),{recursive:true});directory=await mkdtemp(resolve('.local/tests/automatic-batch-transaction-'));vi.stubEnv('FPCAD_DATA_DIR',directory);await import('../../apps/desktop/main/main');await host.ready;});
beforeEach(async()=>{
 const p=fixture(),path=join(directory,randomUUID()+'.fpcad');await writeFile(path,pack(p).bytes);host.open.mockReset().mockResolvedValue({canceled:false,filePaths:[path]});runtime.batch.mockReset();runtime.references.mockReset();
 const opened=await request('project.open',{},false);if(!opened.ok)throw Error(opened.error.code);current=opened.data.project!;published=opened.data;
 results=current.patternLibrary!.map(r=>({id:randomUUID(),name:r.piece.name,color:r.piece.color,source:'reference',sourcePieceId:r.piece.id,sourceHash:pieceGeometryHash(r.piece),surfaceId:current.surface!.id,topologyVersion:current.surface!.topologyVersion,surfaceHash:hash(JSON.stringify(current.surface)),view:'front',offsetXmm:0,offsetYmm:0,fragments:[{faceId:current.surface!.faces[0].id,rings:[[[1,0,0],[0,1,0],[0,0,1]]]}],paths:[]}));
});
afterAll(async()=>{await host.shutdown?.();vi.unstubAllEnvs();});

it.each(['sheet','separate','front-left','front-right'] as const)('importing with %s layout retains one complete native-resolution image through the main process',async layout=>{
 const codec=(UPNG as unknown as {default?:typeof UPNG}).default??UPNG,rgba=new Uint8Array(11*7*4);for(let y=0;y<7;y++)for(let x=0;x<11;x++)rgba.set([x*17,y*29,(x+y)*11,255],(y*11+x)*4);
 const png=Buffer.from(codec.encode([rgba.buffer],11,7,0)),path=join(directory,randomUUID()+'.png');await writeFile(path,png);host.open.mockReset().mockResolvedValue({canceled:false,filePaths:[path]});runtime.references.mockImplementation(async references=>({references,regions:[]}));
 const response=await request('reference.auto',{layout,heightMm:100,clusters:6,excludeBackground:true});expect(response.ok).toBe(true);if(!response.ok)return;
 expect(host.open).toHaveBeenCalledOnce();expect(runtime.references).toHaveBeenCalledOnce();expect(runtime.references.mock.calls[0][0]).toHaveLength(1);const reference=response.data.project!.references![0];expect(response.data.project!.references).toHaveLength(1);expect(reference).toMatchObject({view:'sheet',width:11,height:7});
 const decoded=codec.decode(Uint8Array.from(Buffer.from(reference.png.split(',')[1],'base64')).buffer);expect(new Uint8Array(codec.toRGBA8(decoded)[0])).toEqual(rgba);expect(response.data.project!.patternLibrary).toEqual([]);
});

it('one automatic request sends the complete selection to one batch and saves all returned markings in a single undo step',async()=>{
 runtime.batch.mockResolvedValue({markings:results,skipped:[]});const ids=current.patternLibrary!.map(r=>r.piece.id),response=await request('marking.auto',{pieceIds:ids});expect(response.ok).toBe(true);if(!response.ok)return;
 expect(runtime.batch).toHaveBeenCalledOnce();expect(runtime.batch.mock.calls[0][2]).toEqual(ids);expect(response.autoPlacementReport).toEqual({placed:2,skipped:[]});expect(response.data.project!.revision).toBe(current.revision+1);expect(response.data.project!.markings).toEqual(results);
 current=response.data.project!;const undone=await request('command.undo',{});expect(undone.ok&&undone.data.project!.markings).toEqual([]);
});

it('a valid cancellation at the batch result boundary rejects late results and preserves project, history and undo state',async()=>{
 let resolveBatch!:(result:{markings:Marking[];skipped:never[]})=>void,started!:()=>void,signal:AbortSignal|undefined;const ready=new Promise<void>(resolve=>{started=resolve;});
 runtime.batch.mockImplementation((_worker:string,_project:Project,_ids:string[],_parts:unknown,abort:AbortSignal)=>{signal=abort;started();return new Promise(resolve=>{resolveBatch=resolve;});});
 const before=identity(published),pending=request('marking.auto',{pieceIds:current.patternLibrary!.map(r=>r.piece.id)});await ready;
 const cancelled=await request('surface.cancel',{});expect(cancelled.ok&&cancelled.cancelled).toBe(true);expect(signal!.aborted).toBe(true);
 // A native worker may have emitted its last result before cancellation.
 // Deliver that result after the signal to verify the commit boundary itself.
 resolveBatch({markings:results,skipped:[]});expect(await pending).toMatchObject({ok:false,error:{code:'CANCELLED'}});expect(identity(await read())).toEqual(before);
});

it('a fatal batch error preserves every persisted field and does not leave a partial undo action',async()=>{
 runtime.batch.mockRejectedValue(new DomainError('PROJECTION_LIMIT'));const before=identity(published);expect(await request('marking.auto',{pieceIds:current.patternLibrary!.map(r=>r.piece.id)})).toMatchObject({ok:false,error:{code:'PROJECTION_LIMIT'}});expect(identity(await read())).toEqual(before);
});

it('a batch with only skipped unknown parts returns its reasons without writing a revision or history entry',async()=>{
 const skipped=current.patternLibrary!.map(r=>({pieceId:r.piece.id,name:r.piece.name,reason:'ANATOMY_REQUIRED'}));runtime.batch.mockResolvedValue({markings:[],skipped});const before=identity(published),response=await request('marking.auto',{pieceIds:current.patternLibrary!.map(r=>r.piece.id)});expect(response).toMatchObject({ok:true,autoPlacementReport:{placed:0,skipped}});expect(identity(await read())).toEqual(before);
});
