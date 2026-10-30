import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {randomUUID} from 'node:crypto';
import {desktopClient,type DesktopTransport} from '../../packages/api/client';
import type {Request} from '../../packages/schema/index';

const bridge=vi.hoisted(()=>({invoke:vi.fn(),listen:vi.fn()}));
vi.mock('@tauri-apps/api/core',()=>({invoke:bridge.invoke}));
vi.mock('@tauri-apps/api/event',()=>({listen:bridge.listen}));
const success=JSON.stringify({ok:true,data:{project:null,geometry:[],canUndo:false,canRedo:false,savedRevision:null,recovery:[],history:[],recent:[],jobs:[]}});
const cancelled=JSON.stringify({ok:false,error:{code:'CANCELLED',messageKey:'CANCELLED'}});
let transport:DesktopTransport;
type Deferred={request:Request;resolve:(reply:string)=>void;reject:(error:Error)=>void};
let pending:Deferred[];
const requests=()=>bridge.invoke.mock.calls.map(([,args])=>args.payload as Request);
const cancellations=()=>requests().filter((r):r is Extract<Request,{method:'surface.cancel'}>=>r.method==='surface.cancel');
const mask=(projectId:string,revision=4)=>desktopClient(transport).maskReference(projectId,revision,randomUUID(),'a'.repeat(64),{width:1,height:1,pixels:'1'},'#abcdef');

it('includes global spacing updates in cancellation but excludes ordinary project edits',async()=>{
 const projectId=randomUUID(),client=desktopClient(transport);
 const spacing=client.apply(projectId,4,{type:'patterns.allowance',widthMm:7});
 const edit=client.apply(projectId,4,{type:'project.rename',name:'Renamed'});
 await client.cancelSurface(projectId,4);
 expect(cancellations()[0].payload.targetRequestIds).toEqual([pending[0].request.requestId]);
 pending.forEach(task=>task.resolve(success));await Promise.all([spacing,edit]);
});

it('registers one atomic marking edit round as a single cancellable request and removes its intent after completion',async()=>{
 const projectId=randomUUID(),client=desktopClient(transport),edits=[{markingId:randomUUID(),shape:{origin:[0,0,0] as [number,number,number],axes:[[1,0,0],[0,1,0],[0,0,1]] as [[number,number,number],[number,number,number],[number,number,number]],nodes:[{xMm:0,yMm:0},{xMm:20,yMm:0},{xMm:0,yMm:20}]}}],work=client.editSurfaceMarkings(projectId,4,edits);
 await Promise.resolve();expect(pending).toHaveLength(1);expect(pending[0].request).toMatchObject({method:'marking.surface.editMany',projectId,expectedRevision:4,payload:{edits}});
 await client.cancelSurface(projectId,4);expect(cancellations()[0].payload).toEqual({targetRequestIds:[pending[0].request.requestId]});
 pending[0].resolve(success);await work;await client.cancelSurface(projectId,4);expect(cancellations()[1].payload).toEqual({targetRequestIds:[]});
});

beforeEach(async()=>{
 vi.resetModules();bridge.invoke.mockReset();bridge.listen.mockReset().mockResolvedValue(()=>{});pending=[];
 vi.stubGlobal('window',{});vi.stubGlobal('navigator',{language:'en-US'});
 await import('../../apps/desktop/src/tauri-transport');transport=(window as any).fpcadTransport;
 bridge.invoke.mockImplementation((_command,{payload:request}: {payload:Request})=>request.method==='surface.cancel'||request.method==='session.read'?Promise.resolve(success):new Promise<string>((resolve,reject)=>pending.push({request,resolve,reject})));
 await transport.read();bridge.invoke.mockClear();
});
afterEach(()=>vi.unstubAllGlobals());

it('registers mask intent synchronously before host invocation can reenter cancellation',async()=>{
 const projectId=randomUUID();let cancel!:Promise<unknown>,requestId='';
 bridge.invoke.mockImplementation((_command,{payload:request}: {payload:Request})=>{
  if(request.method==='surface.cancel')return Promise.resolve(success);
  requestId=request.requestId;cancel=desktopClient(transport).cancelSurface(projectId,4);return Promise.resolve(success);
 });
 await mask(projectId);await cancel;expect(requestId).not.toBe('');expect(cancellations()).toHaveLength(1);
 expect(cancellations()[0].payload).toEqual({targetRequestIds:[requestId]});
});

it('targets all and only currently flying cancellable requests for the selected project revision',async()=>{
 const projectId=randomUUID(),otherProject=randomUUID(),client=desktopClient(transport);
 const work=[mask(projectId),client.unwrapSurface(projectId,4,{}),mask(projectId,5),mask(otherProject)];
 await client.read();await client.cancelSurface(projectId,4);
 expect(cancellations()[0].payload).toEqual({targetRequestIds:expect.arrayContaining(pending.slice(0,2).map(p=>p.request.requestId))});
 expect(cancellations()[0].payload.targetRequestIds).toHaveLength(2);
 expect(cancellations()[0].payload.targetRequestIds).not.toContain(cancellations()[0].requestId);
 pending.forEach(p=>p.resolve(success));await Promise.all(work);
});

it.each(['success','cancelled response','rejection'] as const)('removes completed mask intent after %s and emits explicit empty targets',async outcome=>{
 const projectId=randomUUID(),work=mask(projectId);await Promise.resolve();const first=pending[0];
 if(outcome==='rejection'){const observed=expect(work).rejects.toThrow('IPC disconnected');first.reject(Error('IPC disconnected'));await observed;}
 else{first.resolve(outcome==='success'?success:cancelled);await work;}
 await desktopClient(transport).cancelSurface(projectId,4);expect(cancellations()[0].payload).toEqual({targetRequestIds:[]});
 const retry=mask(projectId);await Promise.resolve();const second=pending[1];expect(second.request.requestId).not.toBe(first.request.requestId);
 await desktopClient(transport).cancelSurface(projectId,4);expect(cancellations()[1].payload).toEqual({targetRequestIds:[second.request.requestId]});
 second.resolve(success);await retry;
});

it('cleans up intent even when the host invocation throws synchronously',async()=>{
 const projectId=randomUUID();bridge.invoke.mockImplementationOnce(()=>{throw Error('Host invoke unavailable');});
 await expect(mask(projectId)).rejects.toThrow('Host invoke unavailable');await desktopClient(transport).cancelSurface(projectId,4);
 expect(cancellations()[0].payload).toEqual({targetRequestIds:[]});
});

it('keeps a newer flying task after its same-revision predecessor finishes',async()=>{
 const projectId=randomUUID(),first=mask(projectId),second=mask(projectId);await Promise.resolve();pending[0].resolve(success);await first;
 await desktopClient(transport).cancelSurface(projectId,4);expect(cancellations()[0].payload).toEqual({targetRequestIds:[pending[1].request.requestId]});
 pending[1].resolve(success);await second;
});
