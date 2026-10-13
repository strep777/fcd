import {installedPath} from './dependencies.mjs';
import { cp,mkdir,readFile,writeFile,rename,readdir,lstat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join,resolve } from 'node:path';
import { collectNotices } from './notices.mjs';
import {removeGenerated} from './generated-output.mjs';
if(process.platform!=='win32')throw new Error('Only Windows internal packaging has been implemented');
const {version}=JSON.parse(await readFile('package.json','utf8'));
const digest=createHash('sha256');
async function hashTree(path){for(const e of (await readdir(path,{withFileTypes:true})).sort((a,b)=>a.name.localeCompare(b.name))){const p=join(path,e.name);if(e.isDirectory())await hashTree(p);else{digest.update(p);digest.update(await readFile(p));}}}
await hashTree('dist');const buildHash=digest.digest('hex');
const output=resolve(`release/FurryPatternCAD-${version}-win-x64-${buildHash.slice(0,8)}`);
await mkdir('release',{recursive:true});
if((await lstat('release')).isSymbolicLink())throw Error('Refusing linked release directory');
const staging=resolve(`release/.packaging-${process.pid}`),previous=resolve(`release/.previous-${process.pid}`);
await removeGenerated(staging);await mkdir(staging);
try{
await cp(installedPath('node_modules/electron/dist'),staging,{recursive:true});
await mkdir(join(staging,'resources/app'),{recursive:true});await cp('dist',join(staging,'resources/app/dist'),{recursive:true});
await writeFile(join(staging,'resources/app/package.json'),JSON.stringify({name:'furrypattern-cad',version,main:'dist/main/main.cjs'}));
await rename(join(staging,'electron.exe'),join(staging,'FurryPatternCAD.exe'));
await collectNotices(join(staging,'THIRD_PARTY_NOTICES'));
await writeFile(join(staging,'BUILD.json'),JSON.stringify({version,buildHash,platform:process.platform,arch:process.arch,signed:false,status:'internal-development-preview',electron:JSON.parse(await readFile(installedPath('node_modules/electron/package.json'),'utf8')).version},null,2));
let exists=false;try{const stat=await lstat(output);if(stat.isSymbolicLink())throw Error('Refusing linked package');exists=true;}catch(error){if(error.code!=='ENOENT')throw error;}
if(exists)await rename(output,previous);
try{await rename(staging,output);}catch(error){if(exists)await rename(previous,output);throw error;}
if(exists)await removeGenerated(previous);
}finally{await removeGenerated(staging);}
await writeFile('release/latest.json',JSON.stringify({directory:output,executable:join(output,'FurryPatternCAD.exe'),buildHash},null,2));
console.log(output);
