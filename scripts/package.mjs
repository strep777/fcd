import {cp,mkdir,readFile,writeFile,rename,readdir,lstat} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {resolve,join} from 'node:path';
import {removeGenerated} from './generated-output.mjs';
const build=spawnSync(process.execPath,['scripts/tauri.mjs','build','--no-bundle'],{stdio:'inherit',windowsHide:true});if(build.status!==0)throw Error('Tauri build failed');
const {version}=JSON.parse(await readFile('package.json','utf8')),digest=createHash('sha256');
async function hashTree(path){for(const item of(await readdir(path,{withFileTypes:true})).sort((a,b)=>a.name.localeCompare(b.name))){const p=join(path,item.name);if(item.isDirectory())await hashTree(p);else{digest.update(p);digest.update(await readFile(p));}}}
await hashTree('dist');digest.update(await readFile('apps/desktop/src-tauri/target/release/FurryPatternCAD.exe'));const buildHash=digest.digest('hex');
const output=resolve(`release/FurryPatternCAD-${version}-win-x64-${buildHash.slice(0,8)}`),staging=resolve(`release/.packaging-${process.pid}`),previous=resolve(`release/.previous-${process.pid}`);
await mkdir('release',{recursive:true});if((await lstat('release')).isSymbolicLink())throw Error('Refusing linked release directory');
await mkdir(staging);
try{
 await cp('apps/desktop/src-tauri/target/release/FurryPatternCAD.exe',join(staging,'FurryPatternCAD.exe'));
 await cp('dist',join(staging,'dist'),{recursive:true});
 await cp('dist/THIRD_PARTY_NOTICES',join(staging,'THIRD_PARTY_NOTICES'),{recursive:true});
 await writeFile(join(staging,'BUILD.json'),JSON.stringify({version,buildHash,platform:process.platform,arch:process.arch,signed:false,status:'internal-development-preview',framework:'Tauri v2',webview:'system WebView2',node:process.version},null,2));
 let exists=false;try{if((await lstat(output)).isSymbolicLink())throw Error('Refusing linked package');exists=true;}catch(error){if(error.code!=='ENOENT')throw error;}
 if(exists)await rename(output,previous);
 try{await rename(staging,output);}catch(error){if(exists)await rename(previous,output);throw error;}
 if(exists)await removeGenerated(previous);
}finally{await removeGenerated(staging);}
await writeFile('release/latest.json',JSON.stringify({directory:output,executable:join(output,'FurryPatternCAD.exe'),buildHash},null,2));console.log(output);
