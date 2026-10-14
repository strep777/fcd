import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
import electron from 'electron';
import {mkdirSync,appendFileSync,writeFileSync} from 'node:fs';

const root=fileURLToPath(new URL('..',import.meta.url));
const env={...process.env,FPCAD_DATA_DIR:process.env.FPCAD_DATA_DIR??resolve(root,'.local/workspace')};
delete env.ELECTRON_RUN_AS_NODE;
env.FPCAD_STARTUP_LOG='1';
const logDirectory=resolve(root,'test-results/startup');
mkdirSync(logDirectory,{recursive:true});
const logFile=resolve(logDirectory,'launcher.log');
writeFileSync(logFile,`${new Date().toISOString()}\nElectron: ${electron}\nWorkspace: ${env.FPCAD_DATA_DIR}\n`);
console.log(`Startup log: ${logFile}`);
// SW_HIDE can suppress the first GUI window on Windows, not just a console.
const child=spawn(electron,[root,...process.argv.slice(2)],{cwd:root,env,stdio:['inherit','pipe','pipe'],windowsHide:process.argv.includes('--fpcad-background-test')});
for(const [stream,output] of [[child.stdout,process.stdout],[child.stderr,process.stderr]]){
 stream.on('data',chunk=>{output.write(chunk);appendFileSync(logFile,chunk);});
}
child.on('error',error=>{console.error(error.message);appendFileSync(logFile,`${error.stack??error.message}\n`);process.exitCode=1;});
child.on('close',(code,signal)=>{
 const result=`Electron exited: ${code===null?signal:`${code} (0x${(code>>>0).toString(16).padStart(8,'0')})`}`;
 appendFileSync(logFile,`${result}\n`);
 if(code!==0)console.error(`${result}\nStartup failed. Details: ${logFile}`);
 // Windows native crash statuses may be negative, which CMD's IF ERRORLEVEL 1 misses.
 process.exitCode=code===0?0:1;
});
