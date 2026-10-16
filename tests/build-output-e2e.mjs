import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {writeFile,mkdir,access,readFile,readdir} from 'node:fs/promises';
import {join} from 'node:path';
import {removeGenerated} from '../scripts/generated-output.mjs';

function run(script){const result=spawnSync(process.execPath,[script],{encoding:'utf8'});assert.equal(result.status,0,result.stdout+result.stderr);}
async function absent(path){await assert.rejects(access(path),{code:'ENOENT'});}
await assert.rejects(removeGenerated('.local/workspace'),/Not a generated output/);
await assert.rejects(removeGenerated('../dist'),/Not a generated output/);
await mkdir('dist/assets',{recursive:true});
await writeFile('dist/assets/obsolete-audit-sentinel.txt','obsolete');
run('scripts/build.mjs');
await absent('dist/assets/obsolete-audit-sentinel.txt');
run('scripts/package.mjs');
const first=JSON.parse(await readFile('release/latest.json','utf8'));
await writeFile(join(first.directory,'obsolete-audit-sentinel.txt'),'obsolete');
run('scripts/package.mjs');
const second=JSON.parse(await readFile('release/latest.json','utf8'));
assert.deepEqual(second,first);
await absent(join(second.directory,'obsolete-audit-sentinel.txt'));
await access(second.executable);
await access(join(second.directory,'resources/app/dist/bin/fpcad-worker.exe'));
assert.equal((await readdir('release')).filter(name=>/^\.(packaging|previous)-/.test(name)).length,0);
console.log('PASS: obsolete build/package files removed; repeat package stable; user-data cleanup rejected');
