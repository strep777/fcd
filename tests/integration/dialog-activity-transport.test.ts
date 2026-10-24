import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {effectScope,ref} from 'vue';

const bridge=vi.hoisted(()=>({invoke:vi.fn(),listen:vi.fn()}));
vi.mock('@tauri-apps/api/core',()=>({invoke:bridge.invoke}));
vi.mock('@tauri-apps/api/event',()=>({listen:bridge.listen}));
beforeEach(()=>{vi.resetModules();vi.useFakeTimers();bridge.invoke.mockReset();bridge.listen.mockReset();vi.stubGlobal('window',{});vi.stubGlobal('navigator',{language:'en'});});
afterEach(()=>{vi.useRealTimers();vi.unstubAllGlobals();});

it('registers dialog events before invoking the host and hides activity for the whole choice',async()=>{
 let ready!:(stop:()=>void)=>void;
 bridge.listen.mockImplementation(()=>new Promise(resolve=>{ready=resolve;}));
 bridge.invoke.mockResolvedValue('{}');
 const {useDelayedActivity,activityDelayMs}=await import('../../apps/desktop/src/modules/useDelayedActivity');
 await import('../../apps/desktop/src/tauri-transport');
 const scope=effectScope(),pending=ref(true),visible=scope.run(()=>useDelayedActivity(()=>pending.value))!;
 try{
  const request=(window as any).fpcadTransport.open();
  expect(bridge.invoke).not.toHaveBeenCalled();
  expect(bridge.listen.mock.calls[0][0]).toBe('fpcad:dialog-state');
  ready(()=>{});await request;expect(bridge.invoke).toHaveBeenCalledTimes(1);
  const listener=bridge.listen.mock.calls[0][1];listener({payload:{open:true}});
  await vi.advanceTimersByTimeAsync(5000);expect(visible.value).toBe(false);
  listener({payload:{open:'false'}});await vi.advanceTimersByTimeAsync(500);expect(visible.value).toBe(false);
  listener({payload:{open:false}});await vi.advanceTimersByTimeAsync(activityDelayMs);expect(visible.value).toBe(true);
  pending.value=false;expect(visible.value).toBe(false);
 }finally{scope.stop();}
});

it('a failed event registration rejects cleanly and the next request retries registration',async()=>{
 bridge.listen.mockRejectedValueOnce(Error('offline')).mockResolvedValue(()=>{});
 bridge.invoke.mockResolvedValue('{}');await import('../../apps/desktop/src/tauri-transport');
 await expect((window as any).fpcadTransport.read()).rejects.toThrow('offline');expect(bridge.invoke).not.toHaveBeenCalled();
 await (window as any).fpcadTransport.read();expect(bridge.listen).toHaveBeenCalledTimes(2);expect(bridge.invoke).toHaveBeenCalledTimes(1);
});
