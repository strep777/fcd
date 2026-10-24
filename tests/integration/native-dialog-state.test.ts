import {expect,it,vi} from 'vitest';
import {nativeDialogs} from '../../apps/desktop/main/native-dialogs';

function deferred<T>(){let resolve!:(value:T)=>void,reject!:(error:Error)=>void;const promise=new Promise<T>((accept,decline)=>{resolve=accept;reject=decline;});return {promise,resolve,reject};}

it('announces a dialog before invoking the host and closes it after confirmation',async()=>{
 const state=vi.fn(),pending=deferred<{canceled:boolean;filePaths:string[]}>(),options={title:'Select image'};
 const call=vi.fn(()=>{expect(state).toHaveBeenLastCalledWith('fpcad:dialog-state',{open:true});return pending.promise;});
 const result=nativeDialogs(call,state).open(options);expect(call).toHaveBeenCalledExactlyOnceWith('open',options);
 pending.resolve({canceled:false,filePaths:['selected.png']});expect(await result).toEqual({canceled:false,filePaths:['selected.png']});
 expect(state.mock.calls).toEqual([['fpcad:dialog-state',{open:true}],['fpcad:dialog-state',{open:false}]]);
});

it.each(['cancel','reject','throw'] as const)('closes a save dialog after %s without leaving feedback suspended',async outcome=>{
 const state=vi.fn(),pending=deferred<{canceled:boolean}>(),call=vi.fn(()=>{if(outcome==='throw')throw Error('Host unavailable');return pending.promise;});
 const dialogs=nativeDialogs(call,state),result=dialogs.save({});
 if(outcome==='cancel'){pending.resolve({canceled:true});expect(await result).toEqual({canceled:true});}
 else{const observed=expect(result).rejects.toThrow('Host unavailable');if(outcome==='reject')pending.reject(Error('Host unavailable'));await observed;}
 expect(state.mock.calls).toEqual([['fpcad:dialog-state',{open:true}],['fpcad:dialog-state',{open:false}]]);
 call.mockResolvedValue({canceled:true});await dialogs.save({});expect(state.mock.calls.slice(2)).toEqual([['fpcad:dialog-state',{open:true}],['fpcad:dialog-state',{open:false}]]);
});

it('keeps feedback suspended while another native dialog is still open',async()=>{
 const state=vi.fn(),first=deferred<{canceled:boolean;filePaths:string[]}>(),second=deferred<{canceled:boolean;filePath:string}>();
 const call=vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise),dialogs=nativeDialogs(call,state);
 const opening=dialogs.open({}),saving=dialogs.save({});expect(state).toHaveBeenCalledExactlyOnceWith('fpcad:dialog-state',{open:true});
 second.resolve({canceled:false,filePath:'export.svg'});await saving;expect(state).toHaveBeenCalledTimes(1);
 first.resolve({canceled:true,filePaths:[]});await opening;expect(state.mock.calls).toEqual([['fpcad:dialog-state',{open:true}],['fpcad:dialog-state',{open:false}]]);
});

it('hides processing feedback while the native print dialog waits for the user',async()=>{
 const state=vi.fn(),pending=deferred<void>(),call=vi.fn(()=>pending.promise);
 const printing=nativeDialogs(call,state).print({html:'<p>100 mm</p>'});
 expect(state).toHaveBeenLastCalledWith('fpcad:dialog-state',{open:true});
 expect(call).toHaveBeenCalledWith('print',{html:'<p>100 mm</p>'});
 pending.resolve();await printing;expect(state).toHaveBeenLastCalledWith('fpcad:dialog-state',{open:false});
});
