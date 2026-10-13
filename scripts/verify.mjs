import {installedPath} from './dependencies.mjs';
import { spawnSync } from 'node:child_process';
import { mkdirSync,writeFileSync,readFileSync } from 'node:fs';
const version=JSON.parse(readFileSync('package.json','utf8')).version;const output=`test-results/evidence/${version}`;mkdirSync(output,{recursive:true});const results=[];
for(const [id,args] of [
 ['typecheck',[installedPath('node_modules/vue-tsc/bin/vue-tsc.js'),'--noEmit']],
 ['vitest',['scripts/test-unit.mjs','--reporter=json',`--outputFile=${output}/vitest.json`]],
 ['rust-tests',['scripts/cargo.mjs','test','--workspace','--locked']],
 ['rustfmt',['scripts/cargo.mjs','fmt','--check']],
 ['clippy',['scripts/cargo.mjs','clippy','--all-targets','--offline','--','-D','warnings']],
 ['build',['scripts/build.mjs']]
]){const start=Date.now();const r=spawnSync(process.execPath,args,{encoding:'utf8'});writeFileSync(`${output}/${id}.log`,(r.stdout??'')+(r.stderr??'')+(r.error?.message??''));results.push({id,command:['node',...args],exitCode:r.status,durationMs:Date.now()-start});console.log(id,r.status===0?'passed':'FAILED');if(r.status!==0){console.error(r.stdout,r.stderr);break;}}
writeFileSync(`${output}/verification.json`,JSON.stringify({time:new Date().toISOString(),node:process.version,platform:process.platform,results},null,2));
if(results.length!==6||results.some(r=>r.exitCode!==0))process.exitCode=1;
