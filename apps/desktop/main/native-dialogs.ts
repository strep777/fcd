type NativeCall=(method:string,payload:unknown)=>Promise<any>;
type DialogState=(event:'fpcad:dialog-state',payload:{open:boolean})=>void;

/** Choosing a path is user input, not background work. Concurrent native
 * dialogs keep processing feedback suspended until the final dialog closes. */
export function nativeDialogs(call:NativeCall,publish:DialogState){
 let open=0;
 async function choose<T>(method:'open'|'save'|'print',options:unknown):Promise<T>{
  if(open++===0)publish('fpcad:dialog-state',{open:true});
  try{return await call(method,options);}
  finally{if(--open===0)publish('fpcad:dialog-state',{open:false});}
 }
 return {
  open:(options:unknown)=>choose<{canceled:boolean;filePaths:string[]}>('open',options),
  save:(options:unknown)=>choose<{canceled:boolean;filePath?:string}>('save',options),
  print:(options:unknown)=>choose<void>('print',options),
 };
}
