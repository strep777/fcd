import {inflateRawSync} from 'node:zlib';
import { zipSync, Unzip, strToU8, type UnzipDecoder, type AsyncFlateStreamHandler } from 'fflate';
import { z } from 'zod';
import { open, rename, unlink, stat, readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { projectSchema,parseProject, type Project } from '../../../packages/schema/index';
import { DomainError, hash } from './repository';
const modules=['character','body','markings','seams','uv','materials','nesting','simulation'];
const maxBytes=200*1024*1024;
function safePath(path:string){return path.length<240&&!path.includes('\\')&&!path.includes(':')&&!path.startsWith('/')&&path.split('/').every(p=>!!p&&p!=='.'&&p!=='..'&&!/[\x00-\x1f]/.test(p)&&!/[. ]$/.test(p)&&!/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\.|$)/i.test(p));}
const entry=z.object({path:z.string(),size:z.number().int().nonnegative().max(maxBytes),sha256:z.string().regex(/^[a-f0-9]{64}$/)}).strict();
const manifestSchema=z.object({format:z.literal('fpcad'),formatVersion:z.literal(1),schemaVersion:z.union([z.literal(1),z.literal(2)]),migrationVersion:z.union([z.literal(0),z.literal(1)]),applicationVersion:z.string(),unit:z.literal('mm'),createdAt:z.iso.datetime(),updatedAt:z.iso.datetime(),projectId:z.uuid(),contentHash:z.string(),files:z.array(entry).max(32)}).strict();
export function pack(project:Project){
  projectSchema.parse(project);
  const {pieces,materials,surface,surfaceRun,bindings,maskSources,references,referenceRun,markings,seams,nesting,...meta}=project;
  const files:Record<string,Uint8Array>={'project.json':strToU8(JSON.stringify(meta)),'patterns.json':strToU8(JSON.stringify({schemaVersion:2,pieces}))};
  const embed=(data:string,path:string)=>{files[path]=Buffer.from(data.slice(data.indexOf(',')+1),'base64');return 'asset:'+path;};
  const storedReferences=references?.map(r=>{if(!r.resources)return r;const a=r.resources,base='images/'+r.id,extension=a.source.mime==='image/jpeg'?'jpg':a.source.mime==='image/webp'?'webp':'png';return {...r,png:embed(r.png,base+'-original.png'),resources:{...a,source:{...a.source,data:embed(a.source.data,base+'-source.'+extension)},proxy:{...a.proxy,png:embed(a.proxy.png,base+'-proxy.png')},thumbnail:{...a.thumbnail,png:embed(a.thumbnail.png,base+'-thumbnail.png')}}};});
  for(const key of modules)files[`${key}.json`]=strToU8(JSON.stringify({schemaVersion:2,items:[]}));
  for(const [key,value] of Object.entries({materials:{schemaVersion:2,materials},body:{schemaVersion:2,surface,surfaceRun},uv:{schemaVersion:2,bindings},markings:{schemaVersion:2,maskSources,references:storedReferences,referenceRun,markings},seams:{schemaVersion:2,seams},nesting:{schemaVersion:2,nesting}}))files[key+'.json']=strToU8(JSON.stringify(value));
  if(Object.values(files).reduce((n,b)=>n+b.length,0)>maxBytes)throw new DomainError('RESOURCE_LIMIT');
  const entries=Object.keys(files).sort((a,b)=>Buffer.compare(Buffer.from(a),Buffer.from(b))).map(path=>({path,size:files[path].length,sha256:hash(files[path])}));
  const manifest={format:'fpcad',formatVersion:1,schemaVersion:2,migrationVersion:1,applicationVersion:'0.8.0',unit:'mm',createdAt:project.createdAt,updatedAt:project.updatedAt,projectId:project.id,contentHash:hash(JSON.stringify(entries)),files:entries};
  files['manifest.json']=strToU8(JSON.stringify(manifest));
  const bytes=zipSync(files,{level:0});if(bytes.length>maxBytes)throw new DomainError('RESOURCE_LIMIT');return {bytes,contentHash:manifest.contentHash};
}
/** Native bounded inflation preserves directory, expansion and hash checks. */
class NativeInflate implements UnzipDecoder {
 static compression=8;ondata!:AsyncFlateStreamHandler;private chunks:Uint8Array[]=[];
 push(data:Uint8Array,final:boolean){this.chunks.push(data);if(!final)return;let output:Buffer;try{output=inflateRawSync(Buffer.concat(this.chunks),{maxOutputLength:maxBytes});}catch(e){if((e as {code?:string}).code==='ERR_BUFFER_TOO_LARGE')throw new DomainError('RESOURCE_LIMIT');throw new DomainError('INVALID_ARCHIVE');}this.chunks=[];this.ondata(null,new Uint8Array(output.buffer as ArrayBuffer,output.byteOffset,output.byteLength),true);}
}
export function unpack(bytes:Uint8Array):Project{
  if(bytes.length>maxBytes)throw new DomainError('RESOURCE_LIMIT');
  validateDirectory(bytes);
  const files=new Map<string,Uint8Array>(),seen=new Set<string>();let total=0,count=0;
  const uz=new Unzip(file=>{
    if(++count>32 || !safePath(file.name) || seen.has(file.name.toLowerCase()))throw new DomainError('UNSAFE_ARCHIVE');seen.add(file.name.toLowerCase());
    if(file.originalSize!==undefined&&(file.originalSize>maxBytes||file.originalSize>Math.max(1,file.size??bytes.length)*200))throw new DomainError('RESOURCE_LIMIT');
    const chunks:Uint8Array[]=[];let size=0;
    file.ondata=(err,data,final)=>{if(err)throw new DomainError('INVALID_ARCHIVE');size+=data.length;total+=data.length;if(total>maxBytes || size>maxBytes || size>Math.max(1,file.size??bytes.length)*200)throw new DomainError('RESOURCE_LIMIT');chunks.push(data);if(final){if(chunks.length===1){files.set(file.name,chunks[0]);return;}const output=new Uint8Array(size);let offset=0;for(const chunk of chunks){output.set(chunk,offset);offset+=chunk.length;}files.set(file.name,output);}};
    file.start();
  });uz.register(NativeInflate);uz.push(bytes,true);
  const json=(name:string)=>{const b=files.get(name);if(!b)throw new DomainError('MISSING_FILE');return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(b));};
  const m=manifestSchema.parse(json('manifest.json'));
  const entries=m.files.map(e=>({path:e.path,size:e.size,sha256:e.sha256})).sort((a,b)=>Buffer.compare(Buffer.from(a.path),Buffer.from(b.path)));
  if(new Set(entries.map(e=>e.path)).size!==entries.length||files.size!==entries.length+1||hash(JSON.stringify(entries))!==m.contentHash)throw new DomainError('HASH_MISMATCH');
  for(const e of entries){const data=files.get(e.path);if(!data||data.length!==e.size||hash(data)!==e.sha256)throw new DomainError('HASH_MISMATCH');}
  const expected=new Set(['manifest.json','project.json','patterns.json',...modules.map(m=>m+'.json')]);
  const linkedAssets=new Set<string>();
  const patterns=z.object({schemaVersion:z.union([z.literal(1),z.literal(2)]),pieces:projectSchema.shape.pieces}).strict().parse(json('patterns.json'));
  const meta=z.object({schemaVersion:z.union([z.literal(1),z.literal(2)])}).passthrough().parse(json('project.json'));
  if(meta.schemaVersion!==m.schemaVersion||patterns.schemaVersion!==m.schemaVersion)throw new DomainError('HASH_MISMATCH');
  let extended:Record<string,unknown>={};
  if(m.schemaVersion===1){
    for(const key of modules)z.object({schemaVersion:z.literal(1),items:z.array(z.never()).length(0)}).strict().parse(json(key+'.json'));
  }else{
    for(const key of ['character','simulation'])z.object({schemaVersion:z.literal(2),items:z.array(z.never()).length(0)}).strict().parse(json(key+'.json'));
    const groups={materials:{materials:projectSchema.shape.materials,items:z.array(z.never()).length(0).optional()},body:{surface:projectSchema.shape.surface,surfaceRun:projectSchema.shape.surfaceRun},uv:{bindings:projectSchema.shape.bindings},markings:{maskSources:projectSchema.shape.maskSources,references:projectSchema.shape.references,referenceRun:projectSchema.shape.referenceRun,markings:projectSchema.shape.markings},seams:{seams:projectSchema.shape.seams},nesting:{nesting:projectSchema.shape.nesting}};
    for(const [key,shape] of Object.entries(groups)){const raw=json(key+'.json');if(key==='markings'&&Array.isArray(raw.references))for(const r of raw.references){const id=z.uuid().parse(r.id),a=r.resources;if(!a)continue;const readAsset=(data:unknown,suffix:string,mime:string)=>{if(typeof data!=='string')throw new DomainError('INVALID_ARCHIVE');if(!data.startsWith('asset:'))return data;const path='images/'+id+'-'+suffix;if(data!=='asset:'+path||!files.has(path))throw new DomainError('MISSING_FILE');linkedAssets.add(path);return 'data:'+mime+';base64,'+Buffer.from(files.get(path)!).toString('base64');};r.png=readAsset(r.png,'original.png','image/png');const mime=z.enum(['image/png','image/jpeg','image/webp']).parse(a.source?.mime);a.source.data=readAsset(a.source.data,'source.'+(mime==='image/jpeg'?'jpg':mime==='image/webp'?'webp':'png'),mime);a.proxy.png=readAsset(a.proxy.png,'proxy.png','image/png');a.thumbnail.png=readAsset(a.thumbnail.png,'thumbnail.png','image/png');}const {schemaVersion,...fields}=z.object({schemaVersion:z.literal(2),...shape}).strict().parse(raw);const {items,...domain}=fields as Record<string,unknown>;extended={...extended,...domain};}
    z.object(projectSchema.shape).strict().omit({materials:true,pieces:true,surface:true,surfaceRun:true,bindings:true,maskSources:true,references:true,referenceRun:true,markings:true,seams:true,nesting:true}).parse(meta);
  }
  if([...files.keys()].some(k=>!expected.has(k)&&!linkedAssets.has(k)))throw new DomainError('UNSUPPORTED_PROJECT_FEATURE');
  const project=parseProject({...meta,...extended,pieces:patterns.pieces});
  if(project.id!==m.projectId||project.createdAt!==m.createdAt||project.updatedAt!==m.updatedAt)throw new DomainError('HASH_MISMATCH');
  return project;
}
function validateDirectory(bytes:Uint8Array){
  const b=Buffer.from(bytes);let end=-1;
  for(let i=b.length-22;i>=Math.max(0,b.length-65557);i--)if(b.readUInt32LE(i)===0x06054b50&&i+22+b.readUInt16LE(i+20)===b.length){end=i;break;}
  if(end<0||b.readUInt16LE(end+4)!==0||b.readUInt16LE(end+6)!==0)throw new DomainError('INVALID_ARCHIVE');
  const count=b.readUInt16LE(end+10),length=b.readUInt32LE(end+12),start=b.readUInt32LE(end+16);
  if(count>32)throw new DomainError('RESOURCE_LIMIT');
  if(count!==b.readUInt16LE(end+8)||start+length!==end)throw new DomainError('INVALID_ARCHIVE');
  let offset=start;const seen=new Set<string>();
  for(let i=0;i<count;i++){
    if(offset+46>end||b.readUInt32LE(offset)!==0x02014b50)throw new DomainError('INVALID_ARCHIVE');
    const nameLength=b.readUInt16LE(offset+28),extraLength=b.readUInt16LE(offset+30),commentLength=b.readUInt16LE(offset+32),local=b.readUInt32LE(offset+42);
    if(offset+46+nameLength+extraLength+commentLength>end)throw new DomainError('INVALID_ARCHIVE');
    const name=b.subarray(offset+46,offset+46+nameLength).toString('utf8');
    if(!safePath(name)||seen.has(name.toLowerCase())||((b.readUInt32LE(offset+38)>>>16)&0xf000)===0xa000)throw new DomainError('UNSAFE_ARCHIVE');seen.add(name.toLowerCase());
    if((b.readUInt16LE(offset+8)&1)!==0||local+30>start||b.readUInt32LE(local)!==0x04034b50)throw new DomainError('INVALID_ARCHIVE');
    const localNameLength=b.readUInt16LE(local+26),localExtra=b.readUInt16LE(local+28);
    if(localNameLength!==nameLength||local+30+localNameLength+localExtra+b.readUInt32LE(offset+20)>start||!b.subarray(local+30,local+30+localNameLength).equals(b.subarray(offset+46,offset+46+nameLength)))throw new DomainError('INVALID_ARCHIVE');
    offset+=46+nameLength+extraLength+commentLength;
  }
  if(offset!==end)throw new DomainError('INVALID_ARCHIVE');
}
export async function atomicWrite(path:string,bytes:Uint8Array){const tmp=`${path}.${randomUUID()}.tmp`;try{const f=await open(tmp,'wx');try{await f.writeFile(bytes);await f.sync();}finally{await f.close();}await rename(tmp,path);}catch(e){await unlink(tmp).catch(()=>{});throw e;}}
export async function readProject(path:string){if((await stat(path)).size>maxBytes)throw new DomainError('RESOURCE_LIMIT');return unpack(await readFile(path));}
