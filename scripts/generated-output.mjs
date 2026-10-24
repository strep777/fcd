import {lstat,readdir,rm,open} from 'node:fs/promises';
import {resolve,relative,isAbsolute,join} from 'node:path';
import {fileURLToPath} from 'node:url';

const root=fileURLToPath(new URL('..',import.meta.url));
// Windows denies write access to running executables and loaded native modules.
// Check all such files before deleting anything, so a running app retains its
// complete backend, worker and renderer when rebuilding is refused.
export async function assertOutputUnlocked(target){
 let stat;try{stat=await lstat(target);}catch(error){if(error.code==='ENOENT')return;throw error;}
 if(stat.isSymbolicLink())throw Error(`Refusing linked output: ${target}`);
 if(stat.isDirectory()){
  for(const child of await readdir(target))await assertOutputUnlocked(join(target,child));
 }else if(process.platform==='win32'&&/\.(exe|dll|node)$/i.test(target)){
  try{const handle=await open(target,'r+');await handle.close();}
  catch(error){throw new Error(`Build output is in use or not writable: ${target}. Close FurryPattern CAD and its tests before rebuilding. Existing output has been retained.`,{cause:error});}
 }
}
// Cleanup is restricted to generated outputs in this checkout, never user profiles.
export async function removeGenerated(path){
 const target=resolve(path),name=relative(root,target);
 if(isAbsolute(name)||name.startsWith('..')||!(name==='dist'||/^release[\\/](?:\.packaging-|\.previous-)[^\\/]+$/.test(name)))throw Error(`Not a generated output: ${target}`);
 async function inspect(path){
  let stat;try{stat=await lstat(path);}catch(error){if(error.code==='ENOENT')return;throw error;}
  if(stat.isSymbolicLink())throw Error(`Refusing linked output: ${path}`);
  if(stat.isDirectory())for(const child of await readdir(path))await inspect(join(path,child));
 }
 const parent=resolve(target,'..');
 if(parent!==resolve(root)){const stat=await lstat(parent);if(stat.isSymbolicLink())throw Error(`Refusing linked output parent: ${parent}`);}
 await inspect(target);await assertOutputUnlocked(target);await rm(target,{recursive:true,force:true});
}
