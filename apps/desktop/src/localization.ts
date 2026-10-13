import {ref} from 'vue';
import {japanese} from './japanese';
export type Locale='zh'|'en'|'ja';
export function systemLocale(language:string):Locale{return /^ja\b/i.test(language)?'ja':/^zh\b/i.test(language)?'zh':'en';}
function initialLocale():Locale{
 try{const saved=localStorage.getItem('fpcad.language');if(saved==='zh'||saved==='en'||saved==='ja')return saved;}catch{}
 return systemLocale(typeof window==='undefined'?'zh-CN':(window as unknown as {fpcadLocale?:string}).fpcadLocale??navigator.language);
}
export const locale=ref<Locale>(initialLocale());
export function setLocale(value:Locale){locale.value=value;try{localStorage.setItem('fpcad.language',value);}catch{}}
/** Only UI phrases call this helper. User names, IDs and geometry remain unchanged. */
export function localize(value:string):string{return locale.value==='ja'?(japanese[value]??value):value;}
export function localizeRecord<T extends Record<string,string>>(value:T):T{return Object.fromEntries(Object.entries(value).map(([key,text])=>[key,localize(text)])) as T;}
