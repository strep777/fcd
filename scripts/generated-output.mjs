import {lstat,readdir,rm} from 'node:fs/promises';
import {resolve,relative,isAbsolute,join} from 'node:path';
import {fileURLToPath} from 'node:url';

const root=fileURLToPath(new URL('..',import.meta.url));
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
 await inspect(target);await rm(target,{recursive:true,force:true});
}
