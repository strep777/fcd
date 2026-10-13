import {it,expect} from 'vitest';
import {zipSync,unzipSync,strToU8} from 'fflate';
import {createHash} from 'node:crypto';
import {project} from '../fixtures';
import {pack,unpack} from '../../apps/desktop/main/archive';
import {Repository} from '../../apps/desktop/main/repository';
import {projectSchema,parseProject} from '../../packages/schema/index';
const digest=(v:Uint8Array|string)=>createHash('sha256').update(v).digest('hex');
it('schema v1 archive upgrades in memory; source bytes remain unchanged and next save writes v2 modules',()=>{
 const p=project(),files=unzipSync(pack(p).bytes);files['project.json']=strToU8(JSON.stringify({...p,schemaVersion:1,pieces:undefined}));files['patterns.json']=strToU8(JSON.stringify({schemaVersion:1,pieces:p.pieces}));for(const key of ['body','uv','markings','seams','nesting','character','materials','simulation'])files[key+'.json']=strToU8(JSON.stringify({schemaVersion:1,items:[]}));const manifest=JSON.parse(new TextDecoder().decode(files['manifest.json']));manifest.schemaVersion=1;manifest.migrationVersion=0;manifest.files=Object.keys(files).filter(n=>n!=='manifest.json').sort((a,b)=>Buffer.compare(Buffer.from(a),Buffer.from(b))).map(path=>({path,size:files[path].length,sha256:digest(files[path])}));manifest.contentHash=digest(JSON.stringify(manifest.files));files['manifest.json']=strToU8(JSON.stringify(manifest));const source=zipSync(files,{level:0}),before=digest(source),upgraded=unpack(source);expect(upgraded).toEqual(p);expect(digest(source)).toBe(before);const saved=unzipSync(pack(upgraded).bytes);expect(JSON.parse(new TextDecoder().decode(saved['manifest.json'])).schemaVersion).toBe(2);
});
it('existing SQLite snapshots and old command history are readable without rewriting source rows',()=>{
 const repo=new Repository(':memory:'),p=project();repo.open(p,null);const old={...p,schemaVersion:1};repo.db.prepare('UPDATE sessions SET state=?').run(JSON.stringify(old));expect(repo.snapshot()).toEqual(p);expect(JSON.parse(String(repo.row()?.state)).schemaVersion).toBe(1);repo.close();expect(()=>parseProject({...old,schemaVersion:3})).toThrow();
});
it('duplicate piece IDs are refused',()=>{
 const p=project();p.pieces.push(structuredClone(p.pieces[0]));expect(projectSchema.safeParse(p).success).toBe(false);
});
