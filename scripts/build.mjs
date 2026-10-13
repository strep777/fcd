import { build } from 'esbuild';
import { build as viteBuild } from 'vite';
import {fileURLToPath} from 'node:url';
import {dirname,join} from 'node:path';
const dependency=(name,file)=>join(dirname(fileURLToPath(import.meta.resolve(name))),file);
import { mkdir, copyFile, cp } from 'node:fs/promises';
import {removeGenerated} from './generated-output.mjs';
await removeGenerated('dist');
await build({entryPoints:['apps/desktop/main/main.ts'],bundle:true,platform:'node',format:'cjs',external:['electron','node:sqlite'],outfile:'dist/main/main.cjs'});
await build({entryPoints:['apps/desktop/main/preload.ts'],bundle:true,platform:'node',format:'cjs',external:['electron'],outfile:'dist/main/preload.cjs'});
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
