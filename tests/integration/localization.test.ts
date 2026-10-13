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
