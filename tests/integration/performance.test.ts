import {it,expect} from 'vitest';
import {writeFileSync,mkdirSync} from 'node:fs';
import {performance} from 'node:perf_hooks';
import {rectangle,project} from '../fixtures';
import {analyze} from '../../apps/desktop/main/worker';
import {pack,unpack} from '../../apps/desktop/main/archive';
import {resolve} from 'node:path';
it('500 piece projects analyze in bounded worker batches and archive without dropped IDs',async()=>{const p=project();p.pieces=Array.from({length:500},()=>rectangle(100,200));const started=performance.now(),geometry=await analyze(resolve('target/release/fpcad-worker.exe'),p),analyzeMs=performance.now()-started,startArchive=performance.now(),archive=pack(p),restored=unpack(archive.bytes),archiveMs=performance.now()-startArchive;expect(geometry.map(g=>g.id)).toEqual(p.pieces.map(p=>p.id));expect(geometry.every(g=>g.areaMm2===20000)).toBe(true);expect(restored).toEqual(p);mkdirSync('test-results',{recursive:true});writeFileSync('test-results/performance.json',JSON.stringify({scope:'500 rectangular pieces; not general 100k face certification',pieces:500,analyzeMs,archiveMs,archiveBytes:archive.bytes.length,node:process.version},null,2));},30000);
