import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
import electron from 'electron';

const root=fileURLToPath(new URL('..',import.meta.url));
const env={...process.env,FPCAD_DATA_DIR:process.env.FPCAD_DATA_DIR??resolve(root,'.local/workspace')};
delete env.ELECTRON_RUN_AS_NODE;
const child=spawn(electron,[root,...process.argv.slice(2)],{cwd:root,env,stdio:'inherit',windowsHide:true});
child.on('error',error=>{console.error(error.message);process.exitCode=1;});
child.on('exit',code=>{process.exitCode=code??1;});
