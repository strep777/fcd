import {createHash} from 'node:crypto';
import {DomainError} from './repository';
import type {Project} from '../../../packages/schema/index';

const prefix='archive-geometry:';
const fields=['surface','pieces','bindings','markings','previewMarkings','patternLibrary','maskSources','seams'] as const;
type RecordValue=Record<string,unknown>;
const record=(value:unknown):RecordValue=>{
 if(!value||typeof value!=='object'||Array.isArray(value))throw new DomainError('INVALID_ARCHIVE');
 return value as RecordValue;
};
const digest=(json:string)=>createHash('sha256').update(json).digest('hex');

/** Persist exact shared geometry once. Current state, inactive models and cut
 * history keep all their values; only their storage representation changes.
 * References occur solely in declared geometry fields, never in user text. */
export function shareArchiveGeometry(project:Project){
 const resources:RecordValue={},known=new Map<unknown,unknown>();
 const share=(value:unknown)=>{
  if(value===undefined)return value;
  if(known.has(value))return known.get(value);
  const json=JSON.stringify(value);if(Buffer.byteLength(json)<64*1024)return value;
  const key=digest(json),ref=prefix+key;
  if(key in resources&&JSON.stringify(resources[key])!==json)throw new DomainError('RESOURCE_INTEGRITY');
  resources[key]=value;known.set(value,ref);return ref;
 };
 const geometry=(input:RecordValue)=>{
  const output={...input};for(const key of fields)if(key in output)output[key]=share(output[key]);
  return output;
 };
 const output=geometry(project);
 if(project.surfaceRun)output.surfaceRun=geometry(project.surfaceRun);
 if(project.modelLibrary)output.modelLibrary=project.modelLibrary.map(model=>geometry(model));
 if(project.cuttingLibrary)output.cuttingLibrary=project.cuttingLibrary.map(entry=>({...entry,surface:share(entry.surface),markings:share(entry.markings),run:geometry(entry.run)}));
 return{project:output,resources};
}

/** Resources contain ordinary domain values, not another reference graph.
 * Resolve each once and let the unchanged project schema check every owner.
 * The archive's existing 200 MiB unique-content budget remains in force. */
export function restoreArchiveGeometry(project:RecordValue,raw:unknown){
 const envelope=record(raw);if(envelope.version!==1||Object.keys(envelope).some(k=>!['version','resources'].includes(k)))throw new DomainError('INVALID_ARCHIVE');
 const resources=record(envelope.resources),used=new Set<string>();
 for(const [key,value]of Object.entries(resources)){
  if(!/^[a-f0-9]{64}$/.test(key)||!value||typeof value!=='object'||digest(JSON.stringify(value))!==key)throw new DomainError('HASH_MISMATCH');
 }
 const restore=(value:unknown)=>{
  if(typeof value!=='string')return value;
  if(!value.startsWith(prefix)||!Object.hasOwn(resources,value.slice(prefix.length)))throw new DomainError('MISSING_FILE');
  const key=value.slice(prefix.length);used.add(key);return resources[key];
 };
 const geometry=(input:unknown)=>{
  const output={...record(input)};for(const key of fields)if(key in output)output[key]=restore(output[key]);
  return output;
 };
 const output=geometry(project);
 if(project.surfaceRun!==undefined)output.surfaceRun=geometry(project.surfaceRun);
 if(project.modelLibrary!==undefined){if(!Array.isArray(project.modelLibrary))throw new DomainError('INVALID_ARCHIVE');output.modelLibrary=project.modelLibrary.map(geometry);}
 if(project.cuttingLibrary!==undefined){if(!Array.isArray(project.cuttingLibrary))throw new DomainError('INVALID_ARCHIVE');output.cuttingLibrary=project.cuttingLibrary.map(value=>{const entry=record(value);return{...entry,surface:restore(entry.surface),markings:restore(entry.markings),run:geometry(entry.run)};});}
 if(used.size!==Object.keys(resources).length)throw new DomainError('INVALID_ARCHIVE');
 return output;
}
