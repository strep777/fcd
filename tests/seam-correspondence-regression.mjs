// Analytic seam-oracle regressions; never launches a Rust worker or desktop app.
// --prepare-only writes inputs/expected candidates for future solver integration.
import assert from 'node:assert/strict';
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {resolve} from 'node:path';
import {seamCorrespondenceCases} from './fixtures/seam-correspondence-cases.mjs';
const output=resolve('test-results/current-repair'),directory=resolve(output,'seam-regressions'),execute=promisify(execFile),prepareOnly=process.argv.includes('--prepare-only');await mkdir(directory,{recursive:true});
const sub=(a,b)=>a.map((v,i)=>v-b[i]),cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]],length=a=>Math.hypot(...a);
function independentMetrics(project,candidate){
 const vertices=new Map(project.surface.vertices.map(v=>[v.id,[v.xMm,v.yMm,v.zMm]])),faces=new Map(project.surface.faces.map(f=>[f.id,f]));let maxAreaError=0,maxEdgeError=0,triangles=0;
 for(const binding of candidate.run.bindings){const points=new Map(binding.trim.vertices.map(v=>[v.id,[v.xMm,v.yMm]]));for(const t of binding.trim.triangles){const face=faces.get(t.faceId),world=t.barycentric.map(w=>[0,1,2].map(axis=>w.reduce((sum,n,i)=>sum+n*vertices.get(face.vertices[i])[axis],0))),uv=t.vertices.map(id=>points.get(id)),a=sub(uv[1],uv[0]),b=sub(uv[2],uv[0]),flatArea=Math.abs(a[0]*b[1]-a[1]*b[0])/2,worldArea=length(cross(sub(world[1],world[0]),sub(world[2],world[0])))/2;assert(worldArea>0&&flatArea>0,'Analytic triangles must be nondegenerate');maxAreaError=Math.max(maxAreaError,Math.abs(flatArea/worldArea-1));for(let i=0;i<3;i++)maxEdgeError=Math.max(maxEdgeError,Math.abs(length(sub(uv[i],uv[(i+1)%3]))/length(sub(world[i],world[(i+1)%3]))-1));triangles++;}}
 return {triangles,maxAreaError,maxEdgeError};
}
const manifest=[],results=[];
for(const test of seamCorrespondenceCases()){
 const inputPath=resolve(directory,test.name+'-input.json'),candidatePath=resolve(directory,test.name+'-candidate.json'),metrics=independentMetrics(test.input,test.candidate);
 assert(metrics.maxAreaError<=.15&&metrics.maxEdgeError<=.1,test.name+': preserve the original 15% area / 10% edge gates');if(test.expect.isometric)assert(metrics.maxAreaError<1e-9&&metrics.maxEdgeError<1e-9,test.name+': analytical triangle isometry');
 await writeFile(inputPath,JSON.stringify(test.input));await writeFile(candidatePath,JSON.stringify(test.candidate));manifest.push({name:test.name,inputPath,candidatePath,expected:test.expect,independentMetrics:metrics});
 if(prepareOnly)continue;
 const name='seam-regression-'+test.name;let exitCode=0,log='';try{const r=await execute(process.execPath,['tests/independent-cut-correspondence.mjs',inputPath,candidatePath,'--name',name,'--strict-seams','--seam-mm','1','--seam-relative','.01'],{cwd:resolve('.'),windowsHide:true,maxBuffer:4*1024*1024});log=r.stdout+r.stderr;}catch(error){exitCode=error.code;log=(error.stdout??'')+(error.stderr??'');}
 await writeFile(resolve(directory,test.name+'.log'),log);const report=JSON.parse(await readFile(resolve(output,name+'.json'),'utf8')),details=JSON.parse(await readFile(resolve(output,name+'-details.json'),'utf8'));
 // Every intentional seam-quality failure remains a valid, covered, invertible
 // manufacturing mesh, so an unrelated geometry error cannot fake this check.
 assert(report.geometryPassed,test.name+': independent geometry must pass');assert.equal(report.passed,test.expect.passed,test.name+': seam gate');assert.equal(exitCode,test.expect.passed?0:1,test.name+': process status');
 if(test.expect.sharedChainsAtLeast)assert(report.seams.chains>=test.expect.sharedChainsAtLeast,test.name+': shared physical chain must be found');
 if(test.expect.localMismatch)assert(report.seams.failedLocalSegments>0,test.name+': local mismatch must be observed, even below 1 mm');
 if(test.expect.totalLengthMatches){assert(report.seams.chainMismatchMm.max<1e-8,test.name+': equal chain total is deliberately insufficient');assert(report.seams.localMismatchRelative.max>.01,test.name+': unchanged 1% local policy');}
 if(test.expect.selfSeam)assert(details.chains.some(c=>c.selfSeam),test.name+': dart sides share one piece identity');
 if(test.expect.hole)assert(test.candidate.run.pieces.some(p=>p.holes.length>0),test.name+': actual inner sewing boundary');
 results.push({name:test.name,passed:true,independentMetrics:metrics,sharedChains:report.seams.chains,localFailures:report.seams.failedLocalSegments});
}
await writeFile(resolve(directory,'manifest.json'),JSON.stringify({nativeSolverInvoked:false,limits:{area:.15,edge:.1,seamMm:1,seamRelative:.01},fixtures:manifest},null,2));await writeFile(resolve(output,'seam-correspondence-regression.json'),JSON.stringify({preparedOnly:prepareOnly,passed:!prepareOnly,nativeSolverInvoked:false,prepared:manifest.length,results},null,2));console.log(JSON.stringify({preparedOnly:prepareOnly,prepared:manifest.length,checked:results.length}));
