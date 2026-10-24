import {existsSync} from 'node:fs';
import {installedPath} from './dependencies.mjs';
import { mkdir,readdir,readFile,writeFile,copyFile,cp } from 'node:fs/promises';
import { join,resolve } from 'node:path';
import {homedir} from 'node:os';
/** Keep the original attribution text with every internal binary build. */
export async function collectNotices(output){
 const records=[];
 async function copy(source,name,version,license){
  const files=(await readdir(source)).filter(f=>/^(license|copying|notice|copyright)([.-]|$)/i.test(f));
  if(!files.length)throw new Error(`Missing license texts: ${name}`);
  const destination=join(output,name.replaceAll('/','_'));await mkdir(destination,{recursive:true});
  for(const file of files)await copyFile(join(source,file),join(destination,file));
  records.push({name,version,license,files:files.map(f=>`${name.replaceAll('/','_')}/${f}`)});
 }
 const lock=JSON.parse(await readFile('package-lock.json','utf8'));
 // Only runtime dependency trees are shipped. Manifold's raw JS/WASM binding is self-contained;
 // its npm CAD/GLTF command-line helpers and their dependencies are not copied into the portable application.
 const included=new Set();function visit(name,parent=''){let path=(parent?parent+'/':'')+'node_modules/'+name;while(!lock.packages[path]&&parent){parent=parent.includes('/node_modules/')?parent.slice(0,parent.lastIndexOf('/node_modules/')):'';path=(parent?parent+'/':'')+'node_modules/'+name;}const p=lock.packages[path];if(!p||included.has(path))return;included.add(path);if(name==='manifold-3d')return;for(const dependency of Object.keys(p.dependencies??{}))visit(dependency,path);}
 for(const name of Object.keys(lock.packages[''].dependencies))visit(name);
 for(const [path,p] of Object.entries(lock.packages)){if(path&&included.has(path)){const name=p.name??path.split('node_modules/').at(-1);const source=name==='@nodable/entities'?'assets/notices/nodable-entities':name==='@pdf-lib/fontkit'?'assets/notices/fontkit':name==='@resvg/resvg-wasm'?'assets/notices/resvg-wasm':installedPath(path);await copy(source,name,p.version,p.license??'UNDECLARED');}}
 await copy('assets/fonts','FurryPatternSansSC','Fontsource-5.3.0','OFL-1.1');
 const vendor=['.tools/vendor'].find(existsSync);if(!vendor)throw Error('Missing Rust dependency attribution directory');
 for(const entry of await readdir(vendor,{withFileTypes:true})){if(!entry.isDirectory())continue;const path=join(vendor,entry.name),toml=await readFile(join(path,'Cargo.toml'),'utf8');await copy(path,`rust-${entry.name}`,toml.match(/^version = "([^"]+)"/m)?.[1],toml.match(/^license = "([^"]+)"/m)?.[1]??'UNDECLARED');}
 await copy('assets/notices/node','Node.js','24.19.0','MIT and bundled dependencies');
 const cargoRoot=existsSync('.tools/cargo')?resolve('.tools/cargo'):process.env.CARGO_HOME??join(homedir(),'.cargo'),registry=join(cargoRoot,'registry/src');
 if(existsSync(registry)){
  const caches=await readdir(registry),lock=await readFile('apps/desktop/src-tauri/Cargo.lock','utf8');
  for(const block of lock.split('[[package]]').slice(1)){
   if(!block.includes('source = "registry+'))continue;const name=block.match(/\nname = "([^"]+)"/)?.[1],version=block.match(/\nversion = "([^"]+)"/)?.[1];
   const source=caches.map(cache=>join(registry,cache,`${name}-${version}`)).find(existsSync);if(!source)continue;
   const destination=join(output,`tauri-rust-${name}-${version}`);await mkdir(destination,{recursive:true});
   const files=(await readdir(source)).filter(file=>/^(licen[sc]e|copying|notice|copyright)([.-]|$)/i.test(file));
   for(const file of files)await cp(join(source,file),join(destination,file),{recursive:true});
   await copyFile(join(source,'Cargo.toml'),join(destination,'Cargo.toml'));
   records.push({name,version,files:files.map(file=>`tauri-rust-${name}-${version}/${file}`),manifest:`tauri-rust-${name}-${version}/Cargo.toml`});
  }
 }
 await writeFile(join(output,'inventory.json'),JSON.stringify({status:'attribution inventory; formal release review remains pending',dependencies:records},null,2));
}
