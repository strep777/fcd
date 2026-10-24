import {spawnSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {createDecipheriv} from 'node:crypto';
// Current-user DPAPI; values travel on stdin, never in process arguments.
function dpapi(value:Buffer,protect:boolean){
 const script=`Add-Type -AssemblyName System.Security; $b=[Convert]::FromBase64String([Console]::In.ReadToEnd()); $r=[Security.Cryptography.ProtectedData]::${protect?'Protect':'Unprotect'}($b,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser); [Console]::Out.Write([Convert]::ToBase64String($r))`;
 const result=spawnSync('powershell.exe',['-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(script,'utf16le').toString('base64')],{input:value.toString('base64'),encoding:'utf8',windowsHide:true,timeout:15000});
 if(result.status!==0||result.error)throw Error('SECURE_STORAGE_UNAVAILABLE');return Buffer.from(result.stdout.trim(),'base64');
}
export function windowsVault(directory:string){return {
 available:()=>process.platform==='win32',
 encrypt:(value:string)=>Buffer.concat([Buffer.from('dp1'),dpapi(Buffer.from(value),true)]),
 decrypt:(value:Buffer)=>{
  if(value.subarray(0,3).toString()==='dp1')return dpapi(value.subarray(3),false).toString();
  if(value.subarray(0,3).toString()==='v10'){
   // Preserve secrets in existing workspaces, using their original protected key.
   const state=JSON.parse(readFileSync(join(directory,'Local State'),'utf8')),wrapped=Buffer.from(state.os_crypt.encrypted_key,'base64');
   if(wrapped.subarray(0,5).toString()!=='DPAPI')throw Error('SECURE_STORAGE_FORMAT');
   const key=dpapi(wrapped.subarray(5),false),decipher=createDecipheriv('aes-256-gcm',key,value.subarray(3,15));
   decipher.setAuthTag(value.subarray(-16));try{return Buffer.concat([decipher.update(value.subarray(15,-16)),decipher.final()]).toString();}finally{key.fill(0);}
  }
  return dpapi(value,false).toString();
 }
};}
