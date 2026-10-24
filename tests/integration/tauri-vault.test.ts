import {expect,it} from 'vitest';
import {mkdirSync,mkdtempSync,writeFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {createCipheriv,randomBytes} from 'node:crypto';
import {windowsVault} from '../../apps/desktop/main/windows-vault';

it.skipIf(process.platform!=='win32')('round trips current-user secrets and rejects modified ciphertext',()=>{
 const vault=windowsVault('unused'),secret='测试 key / test-only';
 const encrypted=vault.encrypt(secret);expect(encrypted.includes(Buffer.from(secret))).toBe(false);expect(vault.decrypt(encrypted)).toBe(secret);
 encrypted[encrypted.length-5]^=1;expect(()=>vault.decrypt(encrypted)).toThrow();
},30000);
it.skipIf(process.platform!=='win32')('reads existing v10 encrypted secrets with the original workspace Local State key',()=>{
 mkdirSync(resolve('.local/tests'),{recursive:true});const directory=mkdtempSync(resolve('.local/tests/vault-')),vault=windowsVault(directory),key=randomBytes(32),iv=randomBytes(12),secret='legacy-test-secret';
 // The local key itself was protected with current-user DPAPI.
 const encoded=vault.encrypt(key.toString('base64'));
 // Convert a binary key through the same OS primitive without exposing it in args.
 const {spawnSync}=require('node:child_process') as typeof import('node:child_process');
 const script='Add-Type -AssemblyName System.Security; $b=[Convert]::FromBase64String([Console]::In.ReadToEnd()); [Console]::Out.Write([Convert]::ToBase64String([Security.Cryptography.ProtectedData]::Protect($b,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser)))';
 const protectedKey=spawnSync('powershell.exe',['-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(script,'utf16le').toString('base64')],{input:key.toString('base64'),encoding:'utf8',windowsHide:true});expect(protectedKey.status).toBe(0);
 writeFileSync(join(directory,'Local State'),JSON.stringify({os_crypt:{encrypted_key:Buffer.concat([Buffer.from('DPAPI'),Buffer.from(protectedKey.stdout,'base64')]).toString('base64')}}));
 const cipher=createCipheriv('aes-256-gcm',key,iv),body=Buffer.concat([cipher.update(secret),cipher.final()]),legacy=Buffer.concat([Buffer.from('v10'),iv,body,cipher.getAuthTag()]);
 expect(vault.decrypt(legacy)).toBe(secret);expect(vault.decrypt(encoded)).toBe(key.toString('base64'));key.fill(0);
},30000);
