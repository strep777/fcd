import {collectNotices} from './notices.mjs';
import {installedPath} from './dependencies.mjs';
import { build } from 'esbuild';
import { build as viteBuild } from 'vite';
import {fileURLToPath} from 'node:url';
import {dirname,join} from 'node:path';
const dependency=(name,file)=>join(dirname(fileURLToPath(import.meta.resolve(name))),file);
import { mkdir, copyFile, cp } from 'node:fs/promises';
import {removeGenerated} from './generated-output.mjs';
await removeGenerated('dist');
await build({entryPoints:['apps/desktop/main/main.ts'],bundle:true,platform:'node',format:'cjs',external:['@napi-rs/canvas','node:sqlite'],outfile:'dist/main/main.cjs'});
await build({entryPoints:['apps/desktop/main/nesting-worker.ts'],bundle:true,platform:'node',format:'cjs',external:['node:sqlite'],outfile:'dist/main/nesting-worker.cjs'});
await build({entryPoints:['apps/desktop/main/assembly-worker.ts'],bundle:true,platform:'node',format:'esm',external:['node:sqlite'],outfile:'dist/main/assembly-worker.mjs'});
await build({entryPoints:['apps/desktop/main/surface-worker.ts'],bundle:true,platform:'node',format:'cjs',external:['node:sqlite'],outfile:'dist/main/surface-worker.cjs'});
await viteBuild({configLoader:'bundle'});
await mkdir('dist/bin',{recursive:true});
await copyFile(`target/release/fpcad-worker${process.platform==='win32'?'.exe':''}`,`dist/bin/fpcad-worker${process.platform==='win32'?'.exe':''}`);

await cp("assets", "dist/assets", {recursive:true});
await copyFile(dependency('@resvg/resvg-wasm','index_bg.wasm'), "dist/assets/resvg.wasm");

await copyFile(dependency('manifold-3d','manifold.js'),'dist/assets/manifold.mjs');
await copyFile(dependency('manifold-3d','manifold.wasm'),'dist/assets/manifold.wasm');

await copyFile(process.execPath,'dist/bin/node.exe');
await mkdir('dist/node_modules/@napi-rs',{recursive:true});
for(const name of ['canvas','canvas-win32-x64-msvc'])await cp(installedPath('node_modules/@napi-rs/'+name),'dist/node_modules/@napi-rs/'+name,{recursive:true});
await copyFile('apps/desktop/print.html','dist/renderer/print.html');

await collectNotices('dist/THIRD_PARTY_NOTICES');
