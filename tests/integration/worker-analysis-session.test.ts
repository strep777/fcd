import {spawn} from 'node:child_process';
import {resolve} from 'node:path';
import {beforeEach,expect,it,vi} from 'vitest';
import {analyze,createWorkerSession,request} from '../../apps/desktop/main/worker';
import {project,rectangle} from '../fixtures';

// Observe actual process creation; every request still reaches the real Rust
// binary, with no replacement executable, result fixture or simulated timer.
vi.mock('node:child_process',async original=>{const actual=await original<typeof import('node:child_process')>();return {...actual,spawn:vi.fn(actual.spawn)};});
const worker=resolve('target/release/fpcad-worker.exe'),starts=vi.mocked(spawn);
beforeEach(()=>{starts.mockClear();});

it('analyzes multiple bounded batches through one native process and closes it before returning',async()=>{
 const input=project();input.pieces=Array.from({length:120},(_,i)=>rectangle(100+i,200+i));
 const expected=await request(worker,{protocolVersion:1,pieces:input.pieces}) as {geometry:unknown};starts.mockClear();
 expect(await analyze(worker,input)).toEqual(expected.geometry);expect(starts).toHaveBeenCalledOnce();
 const child=starts.mock.results[0].value;expect(child.exitCode!==null||child.signalCode!==null).toBe(true);
});

it('keeps a caller-owned native session usable across separate analyses',async()=>{
 const session=createWorkerSession(worker),input=project();try{
  const first=await analyze(worker,input,undefined,session);input.pieces[0].allowanceMm=20;
  const second=await analyze(worker,input,undefined,session);
  const bounds=(points:typeof second[number]['cut'])=>({width:Math.max(...points.map(p=>p.xMm))-Math.min(...points.map(p=>p.xMm)),height:Math.max(...points.map(p=>p.yMm))-Math.min(...points.map(p=>p.yMm))});
  expect(second[0].areaMm2).toBe(first[0].areaMm2);expect(second[0].areaMm2).toBe(20000);
  expect(bounds(first[0].cut)).toEqual({width:120,height:220});expect(bounds(second[0].cut)).toEqual({width:140,height:240});expect(starts).toHaveBeenCalledOnce();
  const child=starts.mock.results[0].value;expect(child.exitCode).toBeNull();expect(child.signalCode).toBeNull();
 }finally{await session.dispose();}
});

it('does not launch a native process for an empty project or a pre-cancelled analysis',async()=>{
 const empty=project();empty.pieces=[];expect(await analyze('missing-worker',empty)).toEqual([]);
 const controller=new AbortController();controller.abort();await expect(analyze(worker,project(),controller.signal)).rejects.toMatchObject({code:'CANCELLED'});expect(starts).not.toHaveBeenCalled();
});
