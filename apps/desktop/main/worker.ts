import {parentPort} from 'node:worker_threads';
import {resolvePiece,materialIssues} from '../../../packages/manufacturing/material';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { pointSchema,pieceSchema,type Project,type Geometry,type Piece } from '../../../packages/schema/index';
import { DomainError } from './repository';
import {derivedName} from '../../../packages/schema/names';
const geometrySchema=z.object({notchSegments:z.array(z.object({id:z.uuid(),start:pointSchema,end:pointSchema,label:z.string()})).optional(),id:z.uuid(),cut:z.array(pointSchema),seam:z.array(pointSchema).optional(),seamHoles:z.array(z.array(pointSchema)).optional(),cutHoles:z.array(z.array(pointSchema)).optional(),edgeLengths:z.array(z.object({nodeId:z.uuid(),endNodeId:z.uuid(),lengthMm:z.number().nonnegative().finite()})).optional(),areaMm2:z.number().finite(),perimeterMm:z.number().finite(),issues:z.array(z.object({ruleId:z.string(),severity:z.enum(['error','warning']),entityId:z.uuid(),messageKey:z.string()}))});
export function request(workerPath:string,input:unknown,signal?:AbortSignal,limits={timeoutMs:10000,bytes:8*1024*1024}):Promise<unknown>{return new Promise((resolve,reject)=>{
 const encoded=JSON.stringify(input);if(Buffer.byteLength(encoded)>limits.bytes){reject(new DomainError('RESOURCE_LIMIT'));return;}
 const proc=spawn(workerPath,[],{windowsHide:true,stdio:['pipe','pipe','pipe']});const chunks:Buffer[]=[];let bytes=0,done=false;parentPort?.postMessage({kind:'child',pid:proc.pid});proc.on('exit',()=>parentPort?.postMessage({kind:'childExit',pid:proc.pid}));
 const finish=(error?:Error,value?:unknown)=>{if(done)return;done=true;clearTimeout(timer);signal?.removeEventListener('abort',cancel);proc.kill();if(error)reject(error);else resolve(value);};
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
