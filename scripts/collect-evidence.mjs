import { mkdir,readdir,readFile,writeFile,copyFile,cp } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
const version=JSON.parse(await readFile('package.json','utf8')).version;const out=`test-results/evidence/${version}`;await mkdir(out,{recursive:true});
const sources=[];
async function scan(root){for(const e of (await readdir(root,{withFileTypes:true})).sort((a,b)=>a.name.localeCompare(b.name))){if(e.name==='__pycache__')continue;const path=join(root,e.name);if(e.isDirectory())await scan(path);else sources.push({path:path.replaceAll('\\','/'),sha256:createHash('sha256').update(await readFile(path)).digest('hex')});}}
for(const root of ['apps','packages','crates','scripts','tests','assets','Docs'])await scan(root);
for(const path of ['README.md','AGENTS.md','package.json','package-lock.json','Cargo.toml','Cargo.lock','rust-toolchain.toml','tsconfig.json','vite.config.ts','vitest.config.ts'])sources.push({path,sha256:createHash('sha256').update(await readFile(path)).digest('hex')});
await writeFile(out+'/source-manifest.json',JSON.stringify({recordedAt:new Date().toISOString(),gitCommit:null,sources},null,2));
const e2e=JSON.parse(await readFile('test-results/e2e.json','utf8'));await copyFile('test-results/e2e.json',out+'/e2e.json');await copyFile('test-results/workspace.png',out+'/workspace.png');
for(const name of ['output.svg','output.pdf','output.png','测试.fpcad'])await copyFile(join(e2e.directory,name),join(out,name));
await copyFile('test-results/crash-recovery.json',out+'/crash-recovery.json');
await copyFile('test-results/offline-e2e.json',out+'/offline-e2e.json');
await copyFile('test-results/offline-nesting.png',out+'/offline-nesting.png');
await copyFile('test-results/offline-reference.png',out+'/offline-reference.png');
const offline=JSON.parse(await readFile('test-results/offline-e2e.json','utf8'));await copyFile(join(offline.directory,'nested.dxf'),out+'/nested.dxf');
await copyFile('release/latest.json',out+'/build.json');
const lock=JSON.parse(await readFile('package-lock.json','utf8'));const deps=[];
for(const [path,value] of Object.entries(lock.packages??{})){if(!path)continue;let licenseFiles=[];try{licenseFiles=(await readdir(path)).filter(f=>/^(license|copying|notice)/i.test(f));}catch{}
deps.push({path,name:value.name??path.split('node_modules/').at(-1),version:value.version,license:value.license??'UNDECLARED',integrity:value.integrity,source:value.resolved,development:!!value.dev,licenseFiles:licenseFiles.map(f=>path+'/'+f),reviewStatus:'pending-release-review'});}
await writeFile(out+'/dependency-inventory.json',JSON.stringify({scope:'npm lockfile; Rust dependencies in Cargo.lock and .tools/vendor license files; not release approval',dependencies:deps},null,2));
console.log(`Collected ${sources.length} source hashes and ${deps.length} dependency entries`);

await copyFile('test-results/advanced-e2e.json',out+'/advanced-e2e.json');await copyFile('test-results/species-feline.png',out+'/species-feline.png');await copyFile('test-results/cross-piece-marking.png',out+'/cross-piece-marking.png');const advanced=JSON.parse(await readFile('test-results/advanced-e2e.json','utf8'));await copyFile(join(advanced.directory,'marked.dxf'),out+'/marked.dxf');

await copyFile('test-results/species-assembled.png',out+'/species-assembled.png');
await copyFile('test-results/assembly.json',out+'/assembly.json');

await copyFile('test-results/manufacturing-e2e.json',out+'/manufacturing-e2e.json');await copyFile('test-results/manufacturing.png',out+'/manufacturing.png');const manufacturing=JSON.parse(await readFile('test-results/manufacturing-e2e.json','utf8'));for(const name of ['manufacturing.svg','manufacturing.pdf','manufacturing.dxf','manufacturing.fpcad'])await copyFile(join(manufacturing.directory,name),join(out,name));

for(const suite of ['mask','template']){await copyFile('test-results/'+suite+'-e2e.json',out+'/'+suite+'-e2e.json');const record=JSON.parse(await readFile('test-results/'+suite+'-e2e.json','utf8'));await copyFile(join(record.directory,suite+'.fpcad'),out+'/'+suite+'.fpcad');}await copyFile('test-results/mask-editor.png',out+'/mask-editor.png');await copyFile('test-results/custom-template.png',out+'/custom-template.png');const template=JSON.parse(await readFile('test-results/template-e2e.json','utf8'));await copyFile(join(template.directory,'exported.fpctemplate'),out+'/exported.fpctemplate');

for(const name of ['completion-e2e.json','performance.json','normal-launch.json','normal-launch.log','import-perspective.png','body-edits.png'])await copyFile('test-results/'+name,out+'/'+name);const completion=JSON.parse(await readFile('test-results/completion-e2e.json','utf8'));for(const name of ['completion.fpcad','physical.svg','panel.glb','exported.glb'])await copyFile(join(completion.directory,name),join(out,name));

for(const name of ['resources-e2e.json','uv-texture.png','surface-drawing.png','inference-e2e.json','inference-spline.png'])await copyFile('test-results/'+name,out+'/'+name);

await cp('test-results/real-dual-view',out+'/real-dual-view',{recursive:true});
