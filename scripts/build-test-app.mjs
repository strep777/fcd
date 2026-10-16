// A fresh isolated build lets independent UI tests run without replacing dist.
import {build} from 'esbuild';
import {build as viteBuild} from 'vite';
import {mkdtemp,mkdir,cp,copyFile,writeFile} from 'node:fs/promises';
import {resolve,join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
const dependency=(name,file)=>join(dirname(fileURLToPath(import.meta.resolve(name))),file);
await mkdir('.local/tests',{recursive:true});
const root=await mkdtemp(resolve('.local/tests/isolated-app-')),dist=join(root,'dist');
for(const [name,format] of [['main','cjs'],['preload','cjs'],['nesting-worker','cjs'],['assembly-worker','esm'],['surface-worker','cjs']])await build({entryPoints:[`apps/desktop/main/${name}.ts`],bundle:true,platform:'node',format,external:['electron','node:sqlite'],outfile:join(dist,`main/${name}.${format==='esm'?'mjs':'cjs'}`)});
await viteBuild({configLoader:'bundle',build:{outDir:join(dist,'renderer')}});
await mkdir(join(dist,'bin'),{recursive:true});await copyFile(`target/release/fpcad-worker${process.platform==='win32'?'.exe':''}`,join(dist,`bin/fpcad-worker${process.platform==='win32'?'.exe':''}`));
await cp('assets',join(dist,'assets'),{recursive:true});
for(const [pkg,source,target] of [['@resvg/resvg-wasm','index_bg.wasm','resvg.wasm'],['manifold-3d','manifold.js','manifold.mjs'],['manifold-3d','manifold.wasm','manifold.wasm']])await copyFile(dependency(pkg,source),join(dist,'assets',target));
await writeFile(join(root,'package.json'),JSON.stringify({name:'furrypattern-cad',version:'0.8.0',main:'dist/main/main.cjs'}));
await writeFile('.local/tests/latest-test-app.json',JSON.stringify({directory:root},null,2));console.log(root);
