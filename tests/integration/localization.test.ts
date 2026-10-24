import {afterEach,expect,it,vi} from 'vitest';
import {systemLocale} from '../../apps/desktop/src/localization';
afterEach(()=>{vi.unstubAllGlobals();vi.resetModules();});
it('follows Japanese and Chinese system languages and falls back to English',()=>{
 expect(['ja','ja-JP','JA-jp'].map(systemLocale)).toEqual(['ja','ja','ja']);
 expect(['zh-CN','zh-TW','zh-Hans'].map(systemLocale)).toEqual(['zh','zh','zh']);
 expect(['en-US','de-DE',''].map(systemLocale)).toEqual(['en','en','en']);
});
it('keeps a user language override across reloads and leaves user text unchanged',async()=>{
 const values=new Map<string,string>();vi.stubGlobal('localStorage',{getItem:(key:string)=>values.get(key)??null,setItem:(key:string,value:string)=>values.set(key,value)});
 vi.stubGlobal('window',{fpcadLocale:'ja-JP'});vi.stubGlobal('navigator',{language:'en-US'});
 vi.resetModules();let m=await import('../../apps/desktop/src/localization');expect(m.locale.value).toBe('ja');
 m.setLocale('zh');expect(values.get('fpcad.language')).toBe('zh');vi.resetModules();m=await import('../../apps/desktop/src/localization');expect(m.locale.value).toBe('zh');
 m.setLocale('ja');expect(m.localize('Save settings')).toBe('設定を保存');expect(m.localize('My custom project 7')).toBe('My custom project 7');
 expect(m.localizeRecord({save:'Save settings',id:'custom-id'})).toEqual({save:'設定を保存',id:'custom-id'});
});
it('translates loading, cancellation, preview and timeout notices in Japanese',async()=>{
 const m=await import('../../apps/desktop/src/localization');m.setLocale('ja');
 for(const phrase of ['Loading projects…','Projects could not be loaded','Loading local projects…','Please wait while your project list is prepared.','Local projects could not be loaded','Please try loading the project list again.','Retry loading projects','Task status','Cancelling task…','Working, please wait…','Task cancelled','Elapsed','seconds','Cancellation failed. You can try again.','Cancelling…','Cancel task','Dismiss task notice','Computing cut lines and patterns','Waiting for the cut task','Preparing cuts','Partitioning materials and cuts','Unwrapping pieces','Remapping markings','Validating patterns','Cancelling unwrap…','Cancel unwrap','Computing cut lines…','Computing color selection…','Creating selection contours…','Computing selection, please wait…','Processing assistant settings…','Updating the assistant connection…','Creating print preview…','Selection calculation could not start; your draft is preserved.','Cutting reached the 60-second limit. Your project is preserved. Reduce the cutting scope or add cut lines, then retry.','Could not read the skill file. Select it again.'])expect(m.localize(phrase),phrase).not.toBe(phrase);
 expect(m.localize('我的项目')).toBe('我的项目');m.setLocale('en');expect(m.localize('Loading projects…')).toBe('Loading projects…');
});
