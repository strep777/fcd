import {beforeAll,afterAll,beforeEach,expect,it,vi} from 'vitest';
import {randomUUID} from 'node:crypto';
import {desktopClient,type DesktopTransport} from '../../packages/api/client';
const bridge=vi.hoisted(()=>({invoke:vi.fn(),listen:vi.fn(),unlisten:vi.fn()}));
vi.mock('@tauri-apps/api/core',()=>({invoke:bridge.invoke}));
vi.mock('@tauri-apps/api/event',()=>({listen:bridge.listen}));
let transport:DesktopTransport;
beforeAll(async()=>{vi.stubGlobal('window',{});vi.stubGlobal('navigator',{language:'en-US'});await import('../../apps/desktop/src/tauri-transport');transport=(window as any).fpcadTransport;});
afterAll(()=>vi.unstubAllGlobals());
beforeEach(()=>{bridge.listen.mockReset().mockResolvedValue(bridge.unlisten);bridge.unlisten.mockClear();});
it('validates progress and stops callbacks immediately even before async registration resolves',async()=>{
 let registered!:(stop:()=>void)=>void;bridge.listen.mockImplementation(()=>new Promise(resolve=>registered=resolve));
 const client=desktopClient(transport),callback=vi.fn(),unsubscribe=client.onSurfaceProgress(callback),listener=bridge.listen.mock.calls[0][1];
 const value={projectId:randomUUID(),revision:3,stage:'remap',completed:4,total:9};listener({payload:value});
 expect(Object.isFrozen(client)).toBe(true);expect(callback).toHaveBeenCalledExactlyOnceWith(value);
 unsubscribe();listener({payload:value});expect(callback).toHaveBeenCalledTimes(1);registered(bridge.unlisten);await Promise.resolve();expect(bridge.unlisten).toHaveBeenCalledTimes(1);
});
it('rejects unknown stages, unexpected fields and invalid progress ranges',()=>{
 const callback=vi.fn(),unsubscribe=desktopClient(transport).onSurfaceProgress(callback),listener=bridge.listen.mock.calls[0][1],value={projectId:randomUUID(),revision:3,stage:'prepare'};
 for(const payload of [{...value,stage:'done'},{...value,path:'C:/private'},{...value,completed:3,total:2}])listener({payload});expect(callback).not.toHaveBeenCalled();unsubscribe();
});
it('keeps serialized project replies and the existing public API',async()=>{
 const response={ok:true,data:{project:null,geometry:[],canUndo:false,canRedo:false,savedRevision:null,recovery:[],history:[],recent:[],jobs:[]}};
 bridge.invoke.mockResolvedValueOnce(JSON.stringify(response));expect(await desktopClient(transport).read()).toEqual(response);
 expect(bridge.invoke).toHaveBeenLastCalledWith('desktop_request',{channel:'fpcad:request-text',payload:expect.objectContaining({method:'session.read',payload:{}})});
 bridge.invoke.mockResolvedValueOnce({ok:true,config:{providers:[]}});expect(await transport.assistantSettings({action:'read'})).toBe(JSON.stringify({ok:true,config:{providers:[]}}));
});
