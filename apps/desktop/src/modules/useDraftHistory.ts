import {computed,onMounted,onBeforeUnmount,ref,watch} from 'vue';
import {DraftHistory} from '../../../../packages/ui/draft-history';
export type DraftHistoryRequest={redo:boolean;handled:boolean};
export const draftHistoryEvent='fpcad-draft-history';
export const draftRecordedEvent='fpcad-draft-recorded';
export function clearDraftRedo(){for(const owner of owners)owner.clearRedo();version.value++;}
type Owner={active:()=>boolean;can:(redo:boolean)=>boolean;order:(redo:boolean)=>number;finish:()=>void;clearRedo:()=>void;move:(redo:boolean)=>boolean};
const owners=new Set<Owner>(),version=ref(0);
const ordered=(redo=false)=>{version.value;return [...owners].filter(o=>o.active()).sort((a,b)=>redo?a.order(true)-b.order(true):b.order(false)-a.order(false));};
export const canUndoDraft=computed(()=>ordered().some(o=>o.can(false))),canRedoDraft=computed(()=>ordered().some(o=>o.can(true)));
/** Compare visible draft action times with the next committed undo/redo boundary. */
export function requestDraftHistory(redo=false,boundary?:number){for(const owner of owners)if(owner.active())owner.finish();for(const owner of ordered(redo)){if(owner.can(redo)&&boundary!==undefined&&(redo?owner.order(true)>=boundary:owner.order(false)<=boundary))return false;if(owner.move(redo))return true;}if(boundary!==undefined)return false;const detail:DraftHistoryRequest={redo,handled:false};window.dispatchEvent(new CustomEvent(draftHistoryEvent,{detail}));return detail.handled;}
export function useDraftHistory<T>(get:()=>T,set:(value:T)=>void,active:()=>boolean,busy:()=>boolean=()=>false){
 const history=new DraftHistory<T>();let restoring=false,previous=JSON.stringify(get()),pendingRestore:string|undefined;
 const read=()=>JSON.parse(JSON.stringify(get())) as T;
 const owner:Owner={active,can:redo=>!busy()&&(redo?history.canRedo:history.canUndo),order:redo=>redo?history.redoStamp:history.undoStamp,finish:finish,clearRedo:()=>history.clearRedo(),move};
 watch(()=>JSON.stringify(get()),value=>{if(value===pendingRestore){pendingRestore=undefined;previous=value;return;}if(!restoring){if(active()){for(const other of owners)if(other!==owner)other.clearRedo();if(!history.grouping){history.record(JSON.parse(previous) as T,JSON.parse(value) as T);if(typeof window!=='undefined')window.dispatchEvent(new Event(draftRecordedEvent));}}else history.clear();version.value++;}previous=value;},{flush:'sync'});
 function restore(value:T){restoring=true;pendingRestore=JSON.stringify(value);try{set(value);}finally{restoring=false;previous=JSON.stringify(value);if(JSON.stringify(get())===pendingRestore)pendingRestore=undefined;version.value++;}}
 function finish(){const before=history.undoStamp;history.end(read());if(history.undoStamp!==before&&active()&&typeof window!=='undefined')window.dispatchEvent(new Event(draftRecordedEvent));}
 function move(redo=false){if(busy()||!active())return false;finish();const value=history.move(read(),redo);if(value===undefined)return false;restore(value);return true;}
 onMounted(()=>{owners.add(owner);version.value++;});onBeforeUnmount(()=>{owners.delete(owner);version.value++;});
 return {canUndo:computed(()=>{version.value;return history.canUndo;}),canRedo:computed(()=>{version.value;return history.canRedo;}),begin:()=>{history.begin(read());version.value++;},end:()=>{finish();version.value++;},rollback(){const value=history.rollback();if(value!==undefined)restore(value);},move,reset(fn?:()=>void){restoring=true;pendingRestore=undefined;try{fn?.();history.clear();}finally{restoring=false;previous=JSON.stringify(get());version.value++;}}};
}
