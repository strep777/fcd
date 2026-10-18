import {afterEach,describe,expect,it} from 'vitest';
import {resolve} from 'node:path';
import {createWorkerSession,request} from '../../apps/desktop/main/worker';
import {parseObj} from '../../apps/desktop/main/surface';
import {surfaceReportSchema} from '../../packages/schema/index';
import {rectangle} from '../fixtures';

// These are real native protocol/geometry tests. Do not substitute a JavaScript
// executable, mocked spawn, fake clock, or cached geometry for the Rust worker.
const worker=resolve('target/release/fpcad-worker.exe');
const sessions=new Set<ReturnType<typeof createWorkerSession>>();
function session(signal?:AbortSignal){const value=createWorkerSession(worker,signal);sessions.add(value);return value;}
afterEach(()=>{for(const value of sessions)value.dispose();sessions.clear();});

const flat='v 0 0 0\nv 100 0 0\nv 100 200 0\nv 0 200 0\nf 1 2 3\nf 1 3 4';
const curved='v 0 0 0\nv 100 0 0\nv 100 100 60\nv 0 100 0\nv 50 50 35\nf 1 2 5\nf 2 3 5\nf 3 4 5\nf 4 1 5';
function unwrapInput(obj=flat,method:'lscm'|'arap'|'arap-balanced'='lscm'){
 const surface=parseObj(obj);
 return {protocolVersion:1,operation:'surface.unwrap',mesh:{vertices:surface.vertices,faces:surface.faces,repair_cuts:false,method,iterations:30}};
}
function reports(value:unknown){
 expect(value).toMatchObject({ok:true,protocolVersion:1});
 return surfaceReportSchema.array().parse((value as {patches:unknown}).patches);
}

describe('native worker sessions',()=>{
 it.each([
  {label:'flat LSCM',obj:flat,method:'lscm' as const},
  {label:'flat ARAP',obj:flat,method:'arap' as const},
  {label:'curved ARAP',obj:curved,method:'arap' as const},
  {label:'curved balanced ARAP',obj:curved,method:'arap-balanced' as const},
 ])('$label has the same measured geometry through EOF and repeated stream requests',async({obj,method})=>{
  const input=unwrapInput(obj,method),before=structuredClone(input),oneShot=await request(worker,input),stream=session();
  const first=await stream.request(input),second=await stream.request(input);
  expect(first).toEqual(oneShot);expect(second).toEqual(oneShot);expect(input).toEqual(before);
  const patches=reports(first);
  expect(patches.flatMap(p=>p.faceIds).sort()).toEqual(input.mesh.faces.map(f=>f.id).sort());
  expect(patches.every(p=>p.uv.every(v=>Number.isFinite(v.xMm)&&Number.isFinite(v.yMm)))).toBe(true);
  if(obj===flat){expect(patches).toHaveLength(1);expect(patches[0].edgeErrorMax).toBeLessThan(1e-8);expect(patches[0].areaErrorMax).toBeLessThan(1e-8);}
  else {expect(patches[0].arap).toBeDefined();expect(patches[0].arap!.energyAfter).toBeLessThanOrEqual(patches[0].arap!.energyBefore+1e-12);}
 });

 it('alternates real manufacturing analysis and unwrap without retaining the previous request or response',async()=>{
  const stream=session(),piece={...rectangle(30,70),allowanceMm:0,name:'流式\n纸样 🦊'},analyze={protocolVersion:1,pieces:[piece]},unwrap=unwrapInput();
  const expectedAnalysis=await request(worker,analyze),expectedUnwrap=await request(worker,unwrap);
  expect(await stream.request(analyze)).toEqual(expectedAnalysis);
  expect(expectedAnalysis).toMatchObject({ok:true,geometry:[{id:piece.id,areaMm2:2100,perimeterMm:200}]});
  expect(await stream.request(unwrap)).toEqual(expectedUnwrap);
  expect(await stream.request(analyze)).toEqual(expectedAnalysis);
 });

 it('survives consecutive native protocol, mesh and resource errors and then solves a valid physical patch',async()=>{
  const stream=session(),input=unwrapInput(),piece=rectangle();
  const failures:[unknown,string][]=[
   [{protocolVersion:999,pieces:[]},'PROTOCOL_UNSUPPORTED'],
   [{protocolVersion:1,operation:'surface.unwrap',mesh:{}},'INVALID_MESH'],
   [{protocolVersion:1,pieces:Array.from({length:501},()=>piece)},'RESOURCE_LIMIT'],
   [{protocolVersion:1,operation:'surface.unwrap',mesh:{...input.mesh,vertices:[],faces:[]}},'MESH_LIMIT'],
  ];
  for(const [invalid,code] of failures){
   await expect(request(worker,invalid)).rejects.toMatchObject({code});
   await expect(stream.request(invalid)).rejects.toMatchObject({code});
  }
  expect(await stream.request(input)).toEqual(await request(worker,input));
  expect(reports(await stream.request(input))[0].edgeErrorMax).toBeLessThan(1e-8);
 });

 it('rejects a concurrent request without replacing or corrupting the in-flight native solve',async()=>{
  const stream=session(),input=unwrapInput(curved,'arap'),expected=await request(worker,input),first=stream.request(input);
  const competing=expect(stream.request(unwrapInput())).rejects.toMatchObject({code:'WORKER_PROTOCOL'});
  await competing;expect(await first).toEqual(expected);
  expect(await stream.request(input)).toEqual(expected);
 });

 it('rejects an already aborted session and does not make a later valid request possible',async()=>{
  const controller=new AbortController();controller.abort();const stream=session(controller.signal);
  await expect(stream.request(unwrapInput())).rejects.toMatchObject({code:'CANCELLED'});
  await expect(stream.request(unwrapInput())).rejects.toMatchObject({code:'CANCELLED'});
 });

 it('aborts an in-flight real native request and permanently refuses subsequent work',async()=>{
  const controller=new AbortController(),stream=session(controller.signal),pending=stream.request(unwrapInput(curved,'arap'));
  const rejected=expect(pending).rejects.toMatchObject({code:'CANCELLED'});controller.abort();await rejected;
  await expect(stream.request(unwrapInput())).rejects.toMatchObject({code:'CANCELLED'});
  stream.dispose();stream.dispose();
 });

 it('can dispose before startup repeatedly and refuses every later request',async()=>{
  const stream=session();stream.dispose();stream.dispose();
  await expect(stream.request(unwrapInput())).rejects.toMatchObject({code:'CANCELLED'});
 });

 it('disposes an in-flight native request and never exposes its late answer to a new request',async()=>{
  const stream=session(),pending=stream.request(unwrapInput(curved,'arap'));
  const rejected=expect(pending).rejects.toMatchObject({code:'CANCELLED'});stream.dispose();await rejected;
  await expect(stream.request(unwrapInput())).rejects.toMatchObject({code:'CANCELLED'});
 });

 it('rejects an over-budget UTF-8 request before writing it and keeps a valid session usable',async()=>{
  const stream=session(),piece={...rectangle(),name:'🦊'.repeat(100)},input={protocolVersion:1,pieces:[piece]},bytes=Buffer.byteLength(JSON.stringify(input));
  expect(bytes).toBeGreaterThan(JSON.stringify(input).length);
  await expect(stream.request(input,{timeoutMs:10000,bytes:bytes-1})).rejects.toMatchObject({code:'RESOURCE_LIMIT'});
  expect(await stream.request(input)).toEqual(await request(worker,input));
 });

 it('rejects non-serializable requests asynchronously without poisoning subsequent native geometry',async()=>{
  const stream=session(),circular:{self?:unknown}={};circular.self=circular;
  for(const input of [undefined,1n,circular]){
   let rejected:Promise<unknown>|undefined;
   expect(()=>{rejected=stream.request(input);}).not.toThrow();
   await expect(rejected!).rejects.toMatchObject({code:'VALIDATION_ERROR'});
  }
  expect(reports(await stream.request(unwrapInput()))[0].areaErrorMax).toBeLessThan(1e-8);
 });

 it('enforces the native response budget and cannot reuse a truncated response as another result',async()=>{
  const input=unwrapInput(),expected=await request(worker,input),inputBytes=Buffer.byteLength(JSON.stringify(input)),outputBytes=Buffer.byteLength(JSON.stringify(expected));
  // A real report contains UV, face metrics and boundary data beyond this mesh.
  // Keep the request legal while cutting off the actual native report.
  expect(outputBytes).toBeGreaterThan(inputBytes+128);
  const stream=session();
  await expect(stream.request(input,{timeoutMs:10000,bytes:inputBytes+32})).rejects.toMatchObject({code:'RESOURCE_LIMIT'});
  await expect(stream.request(input)).rejects.toMatchObject({code:'CANCELLED'});
 });

 it('times out a native startup/solve using a real timer and closes the session permanently',async()=>{
  const stream=session();
  // This budget deliberately expires at startup; it is not a solve benchmark.
  await expect(stream.request(unwrapInput(curved,'arap'),{timeoutMs:0,bytes:64*1024*1024})).rejects.toMatchObject({code:'TIMEOUT'});
  await expect(stream.request(unwrapInput())).rejects.toMatchObject({code:'CANCELLED'});
 });
});
