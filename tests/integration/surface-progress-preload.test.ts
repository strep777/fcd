import {beforeAll,afterAll,beforeEach,expect,it,vi} from 'vitest';
import {randomUUID} from 'node:crypto';
import {desktopClient,type DesktopTransport} from '../../packages/api/client';
const bridge=vi.hoisted(()=>({expose:vi.fn(),ipc:{invoke:vi.fn(),on:vi.fn(),removeListener:vi.fn()}}));
vi.mock('electron',()=>({contextBridge:{exposeInMainWorld:bridge.expose},ipcRenderer:bridge.ipc}));
let transport:DesktopTransport;
beforeAll(async()=>{vi.stubGlobal('navigator',{language:'en-US'});await import('../../apps/desktop/main/preload');transport=bridge.expose.mock.calls.find(call=>call[0]==='fpcadTransport')![1] as DesktopTransport;});
afterAll(()=>{vi.unstubAllGlobals();});
beforeEach(()=>{bridge.ipc.on.mockClear();bridge.ipc.removeListener.mockClear();});
it('validated progress subscribes synchronously through the public frozen client and exposes only its value',()=>{
 const client=desktopClient(transport),callback=vi.fn(),unsubscribe=client.onSurfaceProgress(callback),listener=bridge.ipc.on.mock.calls[0][1];
 expect(Object.isFrozen(client)).toBe(true);expect(typeof unsubscribe).toBe('function');expect(bridge.ipc.on.mock.calls[0][0]).toBe('fpcad:surface-progress');
 const value={projectId:randomUUID(),revision:3,stage:'remap',completed:4,total:9};listener({sender:bridge.ipc,ports:[]},value);
 expect(callback).toHaveBeenCalledExactlyOnceWith(value);expect(callback.mock.calls[0]).toHaveLength(1);unsubscribe();expect(bridge.ipc.removeListener).toHaveBeenCalledWith('fpcad:surface-progress',listener);
});
it('a different renderer sender, arbitrary stage and extra IPC payload fields are ignored',()=>{
 const callback=vi.fn(),unsubscribe=desktopClient(transport).onSurfaceProgress(callback),listener=bridge.ipc.on.mock.calls[0][1],value={projectId:randomUUID(),revision:3,stage:'prepare'};
 listener({sender:{}},value);listener({sender:bridge.ipc},{...value,stage:'done'});listener({sender:bridge.ipc},{...value,path:'C:/private'});listener({sender:bridge.ipc},{...value,completed:3,total:2});expect(callback).not.toHaveBeenCalled();unsubscribe();
});
