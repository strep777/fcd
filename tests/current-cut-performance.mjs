// Read a real project without opening or writing its database. The production
// background worker, native solver, color partition, remap and validation run.
import {DatabaseSync} from 'node:sqlite';
import {Worker} from 'node:worker_threads';
import {createHash} from 'node:crypto';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import assert from 'node:assert/strict';
import os from 'node:os';
const output=resolve(process.env.FPCAD_PERFORMANCE_OUTPUT??'test-results/current-cutting/consolidated/performance');
await mkdir(output,{recursive:true});
const digest=value=>createHash('sha256').update(typeof value==='string'?value:JSON.stringify(value)).digest('hex');
const fixture=process.argv[2]??process.env.FPCAD_CUT_PERFORMANCE_INPUT;
let project;
if(fixture)project=JSON.parse(await readFile(resolve(fixture),'utf8'));
else{
const db=new DatabaseSync(resolve(process.env.FPCAD_CUT_PERFORMANCE_DB??'.local/workspace/workspace.sqlite'),{readOnly:true});
function hydrate(value){
 if(typeof value==='string'&&/^sqlite-resource:[a-f0-9]{64}$/.test(value)){const hash=value.slice(16),row=db.prepare('SELECT json FROM resources WHERE digest=?').get(hash);assert(row&&digest(row.json)===hash,'Resource integrity');return hydrate(JSON.parse(row.json));}
 if(Array.isArray(value))return value.map(hydrate);
 if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,hydrate(v)]));return value;
}
const rows=db.prepare('SELECT state FROM sessions ORDER BY rowid DESC').all();
project=rows.map(row=>hydrate(JSON.parse(row.state))).find(p=>p.surface?.faces.length>8000&&p.markings?.length);
db.close();
}
assert(project?.surface?.faces.length>8000&&project.markings?.length,'Real whole-model fixture is required');
const inputHash=digest(project),options={method:'arap',automaticCuts:true,partitionStrategy:'design',colorBoundaryCuts:true,iterations:30,maxPieces:500,normalAngleDeg:60};
await writeFile(resolve(output,'input.json'),JSON.stringify(project));
const report={inputHash,faces:project.surface.faces.length,markings:project.markings.length,sources:project.patternLibrary.length,seams:project.surface.cutLines?.length,revision:project.revision,options,environment:{node:process.version,cpu:os.cpus()[0].model,cpus:os.cpus().length,os:os.release()},stages:[],profiles:[],children:[],limitMs:60000};
const started=performance.now();
const profile=process.env.FPCAD_CPU_PROFILE==='1',entry=resolve(process.env.FPCAD_PERFORMANCE_WORKER??'dist/main/surface-worker.cjs');
const wrapper=`const {Session}=require('node:inspector');const {parentPort,workerData}=require('node:worker_threads');const {writeFileSync}=require('node:fs');const session=new Session();session.connect();session.post('Profiler.enable',()=>session.post('Profiler.start',()=>{const send=parentPort.postMessage.bind(parentPort);parentPort.postMessage=(message)=>{if(message.kind==='result'||message.kind==='error')session.post('Profiler.stop',(error,result)=>{if(!error)writeFileSync(workerData.profilePath,JSON.stringify(result.profile));session.disconnect();send(message);});else send(message);};require(workerData.entry);}));`;
const worker=new Worker(profile?wrapper:entry,{eval:profile,workerData:{kind:'cut-preview',entry,profilePath:resolve(output,'worker.cpuprofile'),workerPath:resolve(process.env.FPCAD_NATIVE_WORKER??'target/release/fpcad-worker.exe'),surface:project.surface,project,options,directory:resolve('dist/assets')},env:{...process.env,FPCAD_PROFILE_UNWRAP:'1'}});
try{
 const result=await new Promise((res,rej)=>{worker.on('error',rej);worker.on('exit',code=>{if(code!==0)rej(Error('worker exit '+code));});worker.on('message',m=>{if(m.kind==='progress'){report.stages.push({ms:performance.now()-started,...m.value});if(process.env.FPCAD_PERFORMANCE_TRACE==='1')console.log(JSON.stringify({ms:performance.now()-started,...m.value}));}if(m.kind==='profile')report.profiles.push(m.value);if(m.kind==='child')report.children.push(m.pid);if(m.kind==='error')rej(Error(m.code));if(m.kind==='result')res(m.value);});});
 report.elapsedMs=performance.now()-started;
 report.pieces=result.run.pieces.length;report.maxAreaError=Math.max(...result.run.bindings.map(b=>b.report.areaErrorMax));report.maxEdgeError=Math.max(...result.run.bindings.map(b=>b.report.edgeErrorMax));
 const coverage=new Map(project.surface.faces.map(f=>[f.id,0]));
 for(const binding of result.run.bindings){assert(binding.trim,'Exact source correspondence');for(const t of binding.trim.triangles){const [a,b,c]=t.barycentric,area=(b[1]-a[1])*(c[2]-a[2])-(b[2]-a[2])*(c[1]-a[1]);assert(area>0,'Positive trimmed triangle');assert(coverage.has(t.faceId));coverage.set(t.faceId,coverage.get(t.faceId)+area);}}
 report.maxCoverageError=Math.max(...[...coverage.values()].map(v=>Math.abs(v-1)));report.colors=[...new Set(result.run.pieces.map(p=>p.color))];
 await writeFile(resolve(output,'candidate.json'),JSON.stringify(result));
 assert.equal(digest(project),inputHash,'Computation must not mutate input');assert(report.maxCoverageError<1e-6);assert(report.maxAreaError<=.15+1e-8);assert(report.maxEdgeError<=.1+1e-8);assert(report.elapsedMs<report.limitMs,'Whole model must finish in less than one minute');report.passed=true;
}catch(error){report.elapsedMs??=performance.now()-started;report.passed=false;report.error=String(error);process.exitCode=1;}
finally{await worker.terminate();await writeFile(resolve(output,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({...report,stages:report.stages.length}));}
