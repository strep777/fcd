import {spawn,spawnSync} from 'node:child_process';
import {readFile,writeFile,mkdtemp,mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
await mkdir('.local/tests',{recursive:true});await mkdir('test-results',{recursive:true});
const build=JSON.parse(await readFile('release/latest.json','utf8')),directory=resolve(await mkdtemp('.local/tests/normal-launch-')),env={...process.env,FPCAD_DATA_DIR:directory};delete env.ELECTRON_RUN_AS_NODE;delete env.FPCAD_TEST_NO_SANDBOX;
const started=Date.now(),proc=spawn(build.executable,['--disable-gpu','--enable-logging=stderr'],{env,windowsHide:true,stdio:['ignore','pipe','pipe']});let log='',exitCode=null;proc.stdout.on('data',b=>log+=b);proc.stderr.on('data',b=>log+=b);proc.on('error',e=>log+=e.message);proc.on('exit',code=>exitCode=code);await new Promise(r=>setTimeout(r,5000));const alive=proc.exitCode===null&&exitCode===null;
await writeFile('test-results/normal-launch.log',log);await writeFile('test-results/normal-launch.json',JSON.stringify({executable:build.executable,normalSandbox:true,aliveAfter5Seconds:alive,durationMs:Date.now()-started,exitCode,interactiveAcceptance:false,directory},null,2));
if(alive)spawnSync('taskkill',['/PID',String(proc.pid),'/T','/F'],{windowsHide:true,stdio:'ignore'});console.log('Direct normal-sandbox launch alive after 5 seconds:',alive);if(!alive)process.exitCode=1;
