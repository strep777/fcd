import {describe,expect,it} from 'vitest';
import {spawnSync} from 'node:child_process';
import {copyFileSync,mkdirSync,mkdtempSync,readFileSync,writeFileSync} from 'node:fs';
import {join,resolve} from 'node:path';

type Invocation={args:string[];cwd:string;dataDir:string};

// These are CMD orchestration tests, not geometry or application substitutes.
// Keep fixtures and command evidence outside the user's project library.
function runLauncher(options:{installed?:boolean;entry?:'bat';args?:string[];failure?:{command:string;status:number}}={}){
 const evidenceRoot=resolve('test-results','launcher-regression');
 mkdirSync(evidenceRoot,{recursive:true});
 const directory=mkdtempSync(join(evidenceRoot,'中文 启动路径 '));
 const mockBin=join(directory,'mock-bin');
 mkdirSync(mockBin);
 for(const extension of ['bat'])copyFileSync(resolve(`启动新版FurryCAD.${extension}`),join(directory,`启动新版FurryCAD.${extension}`));
 if(options.installed){
  for(const file of ['node_modules/@tauri-apps/cli/tauri.js','node_modules/.bin/vite.cmd']){
   mkdirSync(resolve(directory,file,'..'),{recursive:true});
   writeFileSync(join(directory,file),'');
  }
 }
 const recorder=join(directory,'record.mjs'),invocationsFile=join(directory,'invocations.jsonl');
 writeFileSync(recorder,"import {appendFileSync} from 'node:fs';\nconst args=process.argv.slice(2);\nappendFileSync(process.env.FPCAD_TEST_INVOCATIONS,JSON.stringify({args,cwd:process.cwd(),dataDir:process.env.FPCAD_DATA_DIR})+'\\n');\nprocess.exit(args.join(' ')===process.env.FPCAD_TEST_FAIL_COMMAND?Number(process.env.FPCAD_TEST_FAIL_STATUS):0);\n");
 writeFileSync(join(mockBin,'npm.cmd'),[
  '@echo off',
  '"%FPCAD_TEST_NODE%" "%FPCAD_TEST_RECORDER%" %*',
  'exit /b %errorlevel%',''
 ].join('\r\n'));
 const launcher=join(directory,`启动新版FurryCAD.${options.entry??'bat'}`);
 const command=`call "${launcher}" ${(options.args??[]).map(arg=>`"${arg}"`).join(' ')}`;
 const result=spawnSync(process.env.ComSpec??'cmd.exe',['/d','/s','/c',command],{
  cwd:evidenceRoot,windowsHide:true,windowsVerbatimArguments:true,encoding:'utf8',input:'\r\n',timeout:10000,
  env:{...process.env,PATH:`${mockBin};${process.env.PATH??process.env.Path??''}`,
   FPCAD_TEST_NODE:process.execPath,FPCAD_TEST_RECORDER:recorder,FPCAD_TEST_INVOCATIONS:invocationsFile,
   FPCAD_TEST_FAIL_COMMAND:options.failure?.command??'never',FPCAD_TEST_FAIL_STATUS:String(options.failure?.status??0)}
 });
 writeFileSync(join(directory,'cmd-output.log'),`${result.stdout??''}\n${result.stderr??''}\nStatus: ${result.status}\nError: ${result.error?.message??''}\n`);
 const calls:Invocation[]=readFileSync(invocationsFile,'utf8').trim().split('\n').map(line=>JSON.parse(line));
 return {directory,result,calls};
}

describe.skipIf(process.platform!=='win32')('Windows source launcher',()=>{
 it('installs missing dependencies before Rust, application build and startup from a Chinese path with spaces',()=>{
  const {directory,result,calls}=runLauncher();
  expect(result.error).toBeUndefined();expect(result.status).toBe(0);
  expect(calls.map(call=>call.args)).toEqual([['ci'],['run','build:rust'],['run','build'],['start','--']]);
  for(const call of calls){expect(call.cwd).toBe(directory);expect(call.dataDir).toBe(join(directory,'.local','workspace'));}
 });
 it.each(['bat'] as const)('reuses dependencies and forwards arguments once through the %s entry',entry=>{
  const args=['--fixture-project','项目 with spaces.fpcad','--fpcad-background-test'];
  const {result,calls}=runLauncher({installed:true,entry,args});
  expect(result.error).toBeUndefined();expect(result.status).toBe(0);
  expect(calls.map(call=>call.args)).toEqual([['run','build:rust'],['run','build'],['start','--',...args]]);
 });
 it.each([
  {command:'ci',status:-1073741819,installed:false,expected:[['ci']]},
  {command:'run build:rust',status:-1073741819,installed:true,expected:[['run','build:rust']]},
  {command:'run build',status:2,installed:true,expected:[['run','build:rust'],['run','build']]},
  {command:'start --',status:-1073741819,installed:true,expected:[['run','build:rust'],['run','build'],['start','--']]}
 ])('halts after $command exits with $status and reports failure',({command,status,installed,expected})=>{
  const {result,calls}=runLauncher({installed,failure:{command,status}});
  expect(result.error).toBeUndefined();expect(result.status).toBe(1);
  expect(calls.map(call=>call.args)).toEqual(expected);
  expect(result.stdout).toContain('FurryPattern CAD could not start');
 });
});
