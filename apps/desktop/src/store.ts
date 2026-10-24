import { defineStore } from 'pinia';
import { ref,shallowRef,markRaw,computed,watch } from 'vue';
import {useDelayedActivity} from './modules/useDelayedActivity';
import type { Session,Response } from '../../../packages/schema/index';
interface TaskOptions {label?:string;cancel?:()=>Promise<Response>}
export const useSession=defineStore('session',()=>{
 const data=ref<Session>({project:null,geometry:[],canUndo:false,canRedo:false,savedRevision:null,recovery:[],history:[],recent:[],jobs:[]});
 const busy=ref(false),errorScope=ref('home'),pageErrors=ref<Record<string,string>>({}),notice=ref('');let generation=0,dismissedNotice='';
 const task=shallowRef<{label?:string;startedAt:number;cancellable:boolean}>(),cancelling=ref(false),taskCancelFailed=ref(false),taskOutcome=ref<'cancelled'|''>('');let cancelAction:TaskOptions['cancel'],taskErrorScope='home',cancelFailureCode='';
 const working=useDelayedActivity(()=>busy.value);
 watch(working,active=>{if(active&&task.value)task.value.startedAt=Date.now();},{flush:'sync'});
 const error=computed({get:()=>pageErrors.value[errorScope.value]||notice.value,set:(value:string)=>{pageErrors.value[errorScope.value]=value;if(!value){dismissedNotice=notice.value||dismissedNotice;notice.value='';}}});
 const setErrorScope=(scope:string)=>{errorScope.value=scope;};
 const setError=(scope:string,value:string)=>{pageErrors.value[scope]=value;};
 const captureError=()=>{const scope=errorScope.value;return (value:string)=>setError(scope,value);};
 function clearCancelError(scope:string){if(cancelFailureCode&&pageErrors.value[scope]===cancelFailureCode)setError(scope,'');cancelFailureCode='';}
 function publish(session:Session){
  if((session.sessionId??session.project?.id)!==(data.value.sessionId??data.value.project?.id)){notice.value='';dismissedNotice='';}
  markRaw(session.geometry);
  for(const key of ['pieces','markings','surface','surfaceRun','bindings','references','patternLibrary','modelLibrary','cuttingLibrary','previewMarkings'] as const){const value=session.project?.[key];if(value)markRaw(value);}
  data.value=session;
  // Storage notices belong to the current session across subsequent navigation.
  if(session.notice&&session.notice!==dismissedNotice)notice.value=session.notice;
 }
 async function run(action:()=>Promise<Response>,options:TaskOptions={}){
  if(busy.value)return false;
  const scope=errorScope.value;++generation;busy.value=true;setError(scope,'');taskOutcome.value='';cancelling.value=false;taskCancelFailed.value=false;cancelFailureCode='';cancelAction=options.cancel;taskErrorScope=scope;task.value={label:options.label,startedAt:Date.now(),cancellable:!!options.cancel};
  try{const response=await action();if(!response.ok){if(cancelling.value&&response.error.code==='CANCELLED')taskOutcome.value='cancelled';else setError(scope,response.error.code);return false;}clearCancelError(scope);if(response.cancelled){if(cancelling.value)taskOutcome.value='cancelled';return false;}publish(response.data);return true;}
  catch{setError(scope,'CONNECTION_ERROR');return false;}
  finally{busy.value=false;task.value=undefined;cancelAction=undefined;cancelling.value=false;taskCancelFailed.value=false;cancelFailureCode='';}
 }
 async function cancelRun(){
  const active=task.value,action=cancelAction,scope=taskErrorScope;if(!busy.value||!active||!action||cancelling.value)return false;cancelling.value=true;taskCancelFailed.value=false;clearCancelError(scope);
  try{const response=await action();if(task.value!==active)return false;if(!response.ok){cancelFailureCode=response.error.code;setError(scope,cancelFailureCode);cancelling.value=false;taskCancelFailed.value=true;return false;}return true;}
  catch{if(task.value===active){cancelFailureCode='CONNECTION_ERROR';setError(scope,cancelFailureCode);cancelling.value=false;taskCancelFailed.value=true;}return false;}
 }
 // Read-only notifications must not consume the mutation lock or replace newer edits.
 async function refresh(action:()=>Promise<Response>){
  if(busy.value)return false;const own=++generation,scope=errorScope.value;
  try{const response=await action();if(own!==generation||busy.value)return false;if(!response.ok){if(!pageErrors.value[scope])setError(scope,response.error.code);return false;}publish(response.data);return true;}
  catch{if(own===generation&&!pageErrors.value[scope])setError(scope,'CONNECTION_ERROR');return false;}
 }
 return {data,busy,working,task,cancelling,taskCancelFailed,taskOutcome,error,run,cancelRun,refresh,setErrorScope,captureError};
});
