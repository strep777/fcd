import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {desktopClient,type DesktopTransport} from '../../packages/api/client';

const bridge=vi.hoisted(()=>({invoke:vi.fn(),listen:vi.fn()}));
vi.mock('@tauri-apps/api/core',()=>({invoke:bridge.invoke}));
vi.mock('@tauri-apps/api/event',()=>({listen:bridge.listen}));
let transport:DesktopTransport;
const response={ok:true,data:{project:null,geometry:[],canUndo:false,canRedo:false,savedRevision:null,recovery:[],history:[],recent:[],jobs:[]}};
beforeEach(async()=>{
 vi.resetModules();bridge.invoke.mockReset();bridge.listen.mockReset().mockResolvedValue(()=>{});vi.stubGlobal('window',{});vi.stubGlobal('navigator',{language:'en-US'});
 await import('../../apps/desktop/src/tauri-transport');transport=(window as any).fpcadTransport;
});
afterEach(()=>vi.unstubAllGlobals());

it('decodes raw UTF-8 replies once while preserving exact coordinate numbers and Unicode',async()=>{
 const coordinates=[-5.5108101000737325e-15,421.31319111392395,1.177772994699332,-59.95374217444337,.1,1800.0000000000002,Number.MIN_VALUE],reply={...response,data:{...response.data,extra:{name:'兽装 🐾',note:'a\nb\tc',coordinates}}};
 bridge.invoke.mockResolvedValue(new TextEncoder().encode(JSON.stringify(reply)).buffer);
 expect(await desktopClient(transport).read()).toEqual(reply);
 expect(bridge.invoke).toHaveBeenCalledExactlyOnceWith('desktop_request',{channel:'fpcad:request-text',payload:expect.objectContaining({method:'session.read'})});
});

it('accepts the existing string reply protocol for compatibility',async()=>{
 bridge.invoke.mockResolvedValue(JSON.stringify(response));expect(await desktopClient(transport).read()).toEqual(response);
});

it('keeps assistant settings and connection replies as ordinary objects from the host',async()=>{
 const config={ok:true,config:{providers:[]}},connection={ok:true,connection:{enabled:false}};
 bridge.invoke.mockResolvedValueOnce(config).mockResolvedValueOnce(connection);
 expect(await transport.assistantSettings({action:'read'})).toBe(JSON.stringify(config));expect(await transport.assistant('status')).toBe(JSON.stringify(connection));
});

it('rejects an unexpected host response before it can publish invalid session state',async()=>{
 bridge.invoke.mockResolvedValue(response);await expect(desktopClient(transport).read()).rejects.toThrow('INVALID_RESPONSE');
});
