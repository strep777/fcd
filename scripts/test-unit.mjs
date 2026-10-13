import {mkdirSync} from 'node:fs';
import {resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
import {installedPath} from './dependencies.mjs';
const temporary=resolve('.local/tests/runtime-tmp');mkdirSync(temporary,{recursive:true});
mkdirSync(resolve('test-results'),{recursive:true});
const result=spawnSync(process.execPath,[installedPath('node_modules/vitest/vitest.mjs'),'run','--configLoader','bundle',...process.argv.slice(2)],{stdio:'inherit',env:{...process.env,TEMP:temporary,TMP:temporary}});
if(result.error)console.error(result.error);process.exitCode=result.status??1;
