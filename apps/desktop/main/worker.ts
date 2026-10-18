import {parentPort} from 'node:worker_threads';
import {resolvePiece,materialIssues} from '../../../packages/manufacturing/material';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { pointSchema,pieceSchema,type Project,type Geometry,type Piece } from '../../../packages/schema/index';
import { DomainError } from './repository';
import {derivedName} from '../../../packages/schema/names';
/** Reuse one native process for the sequential solves in a single cut job.
 * Disposal/abort always kills it; it is never shared across projects or jobs. */
export function createWorkerSession(workerPath:string,signal?:AbortSignal){
 let proc:ReturnType<typeof spawn>|undefined,disposed=false;
 let pending:{resolve:(value:unknown)=>void;reject:(error:Error)=>void;timer:ReturnType<typeof setTimeout>;limit:number}|undefined;
 let chunks:Buffer[]=[],bytes=0;
 const dispose=(error:Error=new DomainError('CANCELLED'))=>{if(disposed)return;disposed=true;signal?.removeEventListener('abort',abort);if(pending){clearTimeout(pending.timer);pending.reject(error);pending=undefined;}chunks=[];bytes=0;try{proc?.kill();}catch{/* A process-exit race must not replace the geometry result. */}};
 const abort=()=>dispose();
 signal?.addEventListener('abort',abort,{once:true});
 const start=()=>{
  proc=spawn(workerPath,['--stream'],{windowsHide:true,stdio:['pipe','pipe','pipe']});
  parentPort?.postMessage({kind:'child',pid:proc.pid});
  proc.on('exit',()=>parentPort?.postMessage({kind:'childExit',pid:proc?.pid}));
  proc.on('error',()=>dispose(new DomainError('WORKER_CRASH')));
  proc.on('close',()=>dispose(new DomainError('WORKER_CRASH')));
  proc.stdin!.on('error',()=>dispose(new DomainError('WORKER_CRASH')));
  proc.stderr!.on('data',()=>{});
  proc.stdout!.on('data',(chunk:Buffer)=>{
   if(disposed)return;
   if(!pending)return dispose(new DomainError('WORKER_PROTOCOL'));
   bytes+=chunk.length;if(bytes>pending.limit+1)return dispose(new DomainError('RESOURCE_LIMIT'));
   chunks.push(chunk);const newline=chunk.indexOf(10);if(newline<0)return;
   if(newline!==chunk.length-1)return dispose(new DomainError('WORKER_PROTOCOL'));
   let result;try{result=JSON.parse(Buffer.concat(chunks,bytes).toString('utf8'));}catch{return dispose(new DomainError('WORKER_PROTOCOL'));}
   const task=pending;pending=undefined;chunks=[];bytes=0;clearTimeout(task.timer);
   if(result?.ok===false&&typeof result.code==='string')task.reject(new DomainError(result.code));else task.resolve(result);
  });
 };
 return {dispose,request(input:unknown,limits={timeoutMs:120000,bytes:64*1024*1024}):Promise<unknown>{
  if(disposed||signal?.aborted)return Promise.reject(new DomainError('CANCELLED'));
  if(pending)return Promise.reject(new DomainError('WORKER_PROTOCOL'));
  let encoded:string;try{encoded=JSON.stringify(input);if(typeof encoded!=='string')return Promise.reject(new DomainError('VALIDATION_ERROR'));}catch{return Promise.reject(new DomainError('VALIDATION_ERROR'));}if(Buffer.byteLength(encoded)>limits.bytes)return Promise.reject(new DomainError('RESOURCE_LIMIT'));
  return new Promise((resolve,reject)=>{pending={resolve,reject,limit:limits.bytes,timer:setTimeout(()=>dispose(new DomainError('TIMEOUT')),limits.timeoutMs)};if(!proc)start();proc!.stdin!.write(encoded+'\n');});
 }};
}
const geometrySchema=z.object({notchSegments:z.array(z.object({id:z.uuid(),start:pointSchema,end:pointSchema,label:z.string()})).optional(),id:z.uuid(),cut:z.array(pointSchema),seam:z.array(pointSchema).optional(),seamHoles:z.array(z.array(pointSchema)).optional(),cutHoles:z.array(z.array(pointSchema)).optional(),edgeLengths:z.array(z.object({nodeId:z.uuid(),endNodeId:z.uuid(),lengthMm:z.number().nonnegative().finite()})).optional(),areaMm2:z.number().finite(),perimeterMm:z.number().finite(),issues:z.array(z.object({ruleId:z.string(),severity:z.enum(['error','warning']),entityId:z.uuid(),messageKey:z.string()}))});
export function request(workerPath:string,input:unknown,signal?:AbortSignal,limits={timeoutMs:10000,bytes:8*1024*1024}):Promise<unknown>{return new Promise((resolve,reject)=>{
 if(signal?.aborted){reject(new DomainError('CANCELLED'));return;}
 const encoded=JSON.stringify(input);if(Buffer.byteLength(encoded)>limits.bytes){reject(new DomainError('RESOURCE_LIMIT'));return;}
 const proc=spawn(workerPath,[],{windowsHide:true,stdio:['pipe','pipe','pipe']});const chunks:Buffer[]=[];let bytes=0,done=false;parentPort?.postMessage({kind:'child',pid:proc.pid});proc.on('exit',()=>parentPort?.postMessage({kind:'childExit',pid:proc.pid}));
 const finish=(error?:Error,value?:unknown)=>{if(done)return;done=true;clearTimeout(timer);signal?.removeEventListener('abort',cancel);if(proc.pid!==undefined){try{proc.kill();}catch{/* A cleanup race must not replace the request's result. */}}if(error)reject(error);else resolve(value);};
 const cancel=()=>finish(new DomainError('CANCELLED'));
 const timer=setTimeout(()=>finish(new DomainError('TIMEOUT')),limits.timeoutMs);
 signal?.addEventListener('abort',cancel,{once:true});if(signal?.aborted)cancel();
 proc.stdout.on('data',(chunk:Buffer)=>{bytes+=chunk.length;if(bytes<=limits.bytes)chunks.push(chunk);if(bytes>limits.bytes)finish(new DomainError('RESOURCE_LIMIT'));});
 proc.stderr.on('data',()=>{});proc.on('error',()=>finish(new DomainError('WORKER_CRASH')));proc.stdin.on('error',()=>finish(new DomainError('WORKER_CRASH')));
 proc.on('close',code=>{if(done)return;if(code!==0)return finish(new DomainError('WORKER_CRASH'));try{const result=JSON.parse(Buffer.concat(chunks,bytes).toString('utf8'));if(result.ok===false&&typeof result.code==='string')return finish(new DomainError(result.code));finish(undefined,result);}catch{finish(new DomainError('WORKER_PROTOCOL'));}});
 proc.stdin.end(encoded);
});}
export async function analyze(workerPath:string,project:Project,signal?:AbortSignal):Promise<Geometry[]>{
 const geometry:Geometry[]=[];let batch:Piece[]=[],budget=0;const flush=async()=>{if(!batch.length)return;const result=z.object({ok:z.literal(true),protocolVersion:z.literal(1),geometry:z.array(geometrySchema)}).parse(await request(workerPath,{protocolVersion:1,pieces:batch.map(p=>resolvePiece(project,p))},signal));if(result.geometry.length!==batch.length||result.geometry.some((g,i)=>g.id!==batch[i].id))throw new DomainError('WORKER_PROTOCOL');geometry.push(...result.geometry);batch=[];budget=0;};for(const piece of project.pieces){const size=piece.nodes.length+(piece.holes??[]).reduce((s,h)=>s+h.length,0)+(piece.curves?.length??0)*20;if(batch.length>=50||budget+size>8000)await flush();batch.push(piece);budget+=size;}await flush();const result={geometry};
 if(result.geometry.length!==project.pieces.length||result.geometry.some((g,i)=>g.id!==project.pieces[i].id))throw new DomainError('WORKER_PROTOCOL');const issues=materialIssues(project);return result.geometry.map(g=>({...g,issues:[...g.issues,...issues.filter(i=>i.entityId===g.id)]}));
}
export async function booleanPieces(workerPath:string,a:Piece,b:Piece,operation:'union'|'difference'|'intersection'|'xor'):Promise<Piece[]>{
 if(a.id===b.id)throw new DomainError('INVALID_SELECTION');
 if(operation!=='difference'&&a.material!==b.material)throw new DomainError('MATERIAL_MISMATCH');
 const result=z.object({ok:z.literal(true),protocolVersion:z.literal(1),polygons:z.array(z.object({nodes:z.array(pointSchema),holes:z.array(z.array(pointSchema))})).max(100)}).parse(await request(workerPath,{protocolVersion:1,operation,pieces:[a,b]}));
 if(!result.polygons.length)throw new DomainError('emptyResult');
 return result.polygons.map((p,i)=>pieceSchema.parse({...a,id:randomUUID(),name:derivedName(a.name,` ${operation} ${i+1}`),nodes:p.nodes.map(n=>({...n,id:randomUUID()})),holes:p.holes.map(h=>h.map(n=>({...n,id:randomUUID()}))),curves:[],edgeAllowances:[],notches:[],labels:[]}));
}
