import { defineStore } from 'pinia';
import { ref,markRaw,computed } from 'vue';
import type { Session,Response } from '../../../packages/schema/index';
export const useSession=defineStore('session',()=>{
 const data=ref<Session>({project:null,geometry:[],canUndo:false,canRedo:false,savedRevision:null,recovery:[],history:[],recent:[],jobs:[]});
 const busy=ref(false),errorScope=ref('home'),pageErrors=ref<Record<string,string>>({}),notice=ref('');let generation=0,dismissedNotice='';
 const error=computed({get:()=>pageErrors.value[errorScope.value]||notice.value,set:(value:string)=>{pageErrors.value[errorScope.value]=value;if(!value){dismissedNotice=notice.value||dismissedNotice;notice.value='';}}});
 const setErrorScope=(scope:string)=>{errorScope.value=scope;};
 const setError=(scope:string,value:string)=>{pageErrors.value[scope]=value;};
 const captureError=()=>{const scope=errorScope.value;return (value:string)=>setError(scope,value);};
 function publish(session:Session){
  if((session.sessionId??session.project?.id)!==(data.value.sessionId??data.value.project?.id)){notice.value='';dismissedNotice='';}
  markRaw(session.geometry);
  for(const key of ['pieces','markings','surface','surfaceRun','bindings','references','patternLibrary','modelLibrary','cuttingLibrary','previewMarkings'] as const){const value=session.project?.[key];if(value)markRaw(value);}
  data.value=session;
  // Storage notices belong to the current session across subsequent navigation.
  if(session.notice&&session.notice!==dismissedNotice)notice.value=session.notice;
 }
 async function run(action:()=>Promise<Response>){
  if(busy.value)return false;
  const scope=errorScope.value;++generation;busy.value=true;setError(scope,'');
  try{const response=await action();if(!response.ok){setError(scope,response.error.code);return false;}publish(response.data);return !response.cancelled;}
  catch{setError(scope,'CONNECTION_ERROR');return false;}
  finally{busy.value=false;}
 }
 // Read-only notifications must not consume the mutation lock or replace newer edits.
 async function refresh(action:()=>Promise<Response>){
  if(busy.value)return false;const own=++generation,scope=errorScope.value;
  try{const response=await action();if(own!==generation||busy.value)return false;if(!response.ok){if(!pageErrors.value[scope])setError(scope,response.error.code);return false;}publish(response.data);return true;}
  catch{if(own===generation&&!pageErrors.value[scope])setError(scope,'CONNECTION_ERROR');return false;}
 }
 return {data,busy,error,run,refresh,setErrorScope,captureError};
});
