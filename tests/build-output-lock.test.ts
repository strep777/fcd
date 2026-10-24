import {expect,it} from 'vitest';
import {copyFile,mkdir,mkdtemp,readFile,writeFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {assertOutputUnlocked} from '../scripts/generated-output.mjs';

it.runIf(process.platform==='win32')('rejects a running native runtime before cleanup can remove its other resources',async()=>{
 await mkdir('.local/tests',{recursive:true});const directory=await mkdtemp(resolve('.local/tests/build-lock-'));
 const executable=join(directory,'runtime.exe'),asset=join(directory,'asset.txt');
 await copyFile(process.execPath,executable);await writeFile(asset,'keep the working build');
 const child=spawn(executable,['-e',"process.stdout.write('ready');process.stdin.resume()"],{windowsHide:true,stdio:['pipe','pipe','pipe']});
 try{
  await Promise.race([once(child.stdout!,'data'),once(child,'error').then(([error])=>{throw error;})]);
  await expect(assertOutputUnlocked(directory)).rejects.toThrow('Existing output has been retained');
  expect(await readFile(asset,'utf8')).toBe('keep the working build');
 }finally{const exited=once(child,'exit');child.stdin!.end();await exited;}
 await expect(assertOutputUnlocked(directory)).resolves.toBeUndefined();
},30000);
