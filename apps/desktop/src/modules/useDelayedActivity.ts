import {onScopeDispose,ref,watch} from 'vue';

// A request lock includes time spent choosing files; activity only describes work.
const nativeDialogOpen=ref(false);
export function setNativeDialogOpen(open:boolean){nativeDialogOpen.value=open;}
export const activityDelayMs=180;

export function useDelayedActivity(active:()=>boolean){
 const visible=ref(false);
 let timer:ReturnType<typeof setTimeout>|undefined;
 const clear=()=>{if(timer!==undefined){clearTimeout(timer);timer=undefined;}};
 watch(()=>active()&&!nativeDialogOpen.value,pending=>{
  clear();visible.value=false;
  if(pending)timer=setTimeout(()=>{timer=undefined;visible.value=true;},activityDelayMs);
 },{immediate:true,flush:'sync'});
 onScopeDispose(clear);
 return visible;
}
