import { describe,it,expect } from 'vitest';
import { zipSync,unzipSync,strToU8 } from 'fflate';
import { pack,unpack,atomicWrite } from '../../apps/desktop/main/archive';
import { project } from '../fixtures';
import { mkdir,mkdtemp,readFile } from 'node:fs/promises';
describe('FPCAD snapshot boundary',()=>{
 it('TC-001-a complete polygon project roundtrips with stable semantic hash',()=>{const p=project();p.pieces[0].nodes[0].xMm=0.00001;const a=pack(p),q=unpack(a.bytes),b=pack(q);expect(q).toEqual(p);expect(a.contentHash).toBe(b.contentHash);expect(Object.keys(unzipSync(a.bytes))).toHaveLength(11);});
 it('TC-003-a rejects corrupt content and future required versions',()=>{const f=unzipSync(pack(project()).bytes);f['patterns.json']=strToU8('{}');expect(()=>unpack(zipSync(f))).toThrow('HASH_MISMATCH');const files=unzipSync(pack(project()).bytes);const manifest=JSON.parse(new TextDecoder().decode(files['manifest.json']));manifest.formatVersion=2;files['manifest.json']=strToU8(JSON.stringify(manifest));expect(()=>unpack(zipSync(files))).toThrow();});
 it.each(['../escape','C:/escape','\\server\\share','assets/CON','assets/file.','assets/name\u0000'])('TC-031-a refuses unsafe entry %s',path=>{const f=unzipSync(pack(project()).bytes);f[path]=strToU8('data');expect(()=>unpack(zipSync(f))).toThrow();});
 it('TC-031-b refuses case collisions and highly compressed resources',()=>{const f=unzipSync(pack(project()).bytes);f['PROJECT.JSON']=f['project.json'];expect(()=>unpack(zipSync(f))).toThrow('UNSAFE_ARCHIVE');expect(()=>unpack(zipSync({'bomb.json':new Uint8Array(2*1024*1024)}))).toThrow('RESOURCE_LIMIT');});
 it('TC-031-c rejects symbolic-link entries and mismatched local names',()=>{const bytes=Buffer.from(pack(project()).bytes);const central=bytes.indexOf(Buffer.from([0x50,0x4b,0x01,0x02]));const symlink=Buffer.from(bytes);symlink.writeUInt32LE(0xa1ff0000,central+38);expect(()=>unpack(symlink)).toThrow('UNSAFE_ARCHIVE');const mismatch=Buffer.from(bytes);mismatch[30]=88;expect(()=>unpack(mismatch)).toThrow('INVALID_ARCHIVE');});
 it('TC-002-c atomic replacement leaves a readable current snapshot',async()=>{await mkdir('.local/tests',{recursive:true});const dir=await mkdtemp('.local/tests/save-');const path=dir+'/工程.fpcad';const p=project();await atomicWrite(path,pack(p).bytes);p.name='new revision';p.revision++;await atomicWrite(path,pack(p).bytes);expect(unpack(await readFile(path))).toEqual(p);});
});
