import {spawn} from 'node:child_process';
import {existsSync} from 'node:fs';
import {resolve,delimiter} from 'node:path';
import {installedPath} from './dependencies.mjs';
const env={...process.env,CARGO_BUILD_JOBS:process.env.CARGO_BUILD_JOBS??'3'};
if(existsSync('.tools/cargo/bin/cargo.exe')){
 env.CARGO_HOME=resolve('.tools/cargo');env.RUSTUP_HOME=resolve('.tools/rustup');
 env.PATH=resolve('.tools/cargo/bin')+delimiter+(env.PATH??env.Path??'');delete env.Path;
}
const args=process.argv.slice(2);if(args[0]==='build'&&!args.includes('--locked'))args.push('--','--locked');
const child=spawn(process.execPath,[installedPath('node_modules/@tauri-apps/cli/tauri.js'),...args],{cwd:resolve(process.env.FPCAD_TAURI_PROJECT??'apps/desktop'),env,stdio:'inherit',windowsHide:true});
child.on('error',error=>{console.error(error);process.exitCode=1;});child.on('exit',code=>{process.exitCode=code??1;});
