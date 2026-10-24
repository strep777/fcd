// Analytic positive/negative checks for the independent audit itself.
// This is a verification entry point: do not run before the coordinated freeze.
import assert from 'node:assert/strict';
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {resolve} from 'node:path';
const execute=promisify(execFile),output=resolve('test-results/current-repair'),directory=resolve(output,'oracle-fixtures');await mkdir(directory,{recursive:true});
const clone=value=>structuredClone(value),point=([xMm,yMm],id)=>({id,xMm,yMm});
function fixture({subdivision=false,reverse=false,scale=1,fold=false}={}){
 const surface={id:'mesh',topologyVersion:1,vertices:[[0,0],[100,0],[100,100],[0,100]].map(([xMm,yMm],i)=>({id:'v'+i,xMm,yMm,zMm:0})),faces:[{id:'f0',vertices:['v0','v1','v2']},{id:'f1',vertices:['v0','v2','v3']}]};
 const left=[['f0',[[0,0],[50,0],[50,50]]],...(subdivision?[
  ['f1',[[0,0],[50,50],[50,75]]],['f1',[[0,0],[50,75],[50,100]]],['f1',[[0,0],[50,100],[0,100]]]
 ]:[['f1',[[0,0],[50,50],[50,100]]],['f1',[[0,0],[50,100],[0,100]]]])];
 const right=fold?[
  ['f0',[[50,0],[100,0],[75,50]]],['f0',[[100,0],[100,100],[75,50]]],['f0',[[100,100],[50,50],[75,50]]],['f0',[[50,50],[50,0],[75,50]]],['f1',[[50,50],[100,100],[50,100]]]
 ]:[['f0',[[50,0],[100,0],[100,100]]],['f0',[[50,0],[100,100],[50,50]]],['f1',[[50,50],[100,100],[50,100]]]];
 const pieces=[],bindings=[];
 for(const [id,rows,ring] of [['left',left,[[0,0],[50,0],[50,100],[0,100]]],['right',right,[[50,0],[100,0],[100,100],[50,100]]]]){
  const transform=([x,y])=>[fold&&id==='right'&&x===75&&y===50?120:x,y*(id==='right'?scale:1)],all=new Map(),uvId=p=>id+':'+p.join(','),triangles=[];
  for(const [faceId,raw] of rows){const points=reverse?[...raw].reverse():raw;for(const p of points)all.set(uvId(p),point(transform(p),uvId(p)));triangles.push({faceId,vertices:points.map(uvId),barycentric:points.map(([x,y])=>faceId==='f0'?[1-x/100,(x-y)/100,y/100]:[1-y/100,x/100,(y-x)/100])});}
  pieces.push({id,nodes:ring.map(p=>point(transform(p),uvId(p))),holes:[],closed:true,curves:[]});bindings.push({pieceId:id,surfaceId:surface.id,topologyVersion:1,trim:{vertices:[...all.values()],triangles,boundary:ring.map(uvId),holes:[]},report:{faceIds:[...new Set(rows.map(r=>r[0]))]}});
 }
 return {input:{surface},candidate:{run:{pieces,bindings}}};
}
const cases=[
 {name:'exact-planar',value:fixture(),expected:{passed:true,geometryPassed:true,qualityPassed:true},check:r=>{assert.equal(r.coverage.sourceAreaMm2,10000);assert.equal(r.coverage.maxCoverageError,0);assert.equal(r.seams.sharedSegments,2);assert.equal(r.seams.chains,1);assert.equal(r.seams.chainMismatchMm.max,0);}},
 {name:'unequal-subdivision',value:fixture({subdivision:true}),expected:{passed:true,geometryPassed:true,qualityPassed:true},check:r=>{assert.equal(r.seams.sharedSegments,3);assert.equal(r.seams.chains,1);assert.equal(r.seams.unmatchedSegments,0);}},
 {name:'reversed-traversal',value:fixture({subdivision:true,reverse:true}),expected:{passed:true,geometryPassed:true,qualityPassed:true}},
 {name:'scaled-uv-seam',value:fixture({scale:1.05}),expected:{passed:false,geometryPassed:true,qualityPassed:false},check:r=>{assert(Math.abs(r.seams.chainMismatchMm.max-5)<1e-8);}},
 {name:'uv-foldover',value:fixture({fold:true}),expected:{passed:false,geometryPassed:false},check:r=>assert(r.uvInjectivity.overlapPairs>0)},
];
const missing=fixture();missing.candidate.run.bindings[0].trim.triangles.pop();cases.push({name:'missing-region',value:missing,expected:{passed:false,geometryPassed:false},check:r=>assert(r.coverage.maxCoverageError>0)});
const overlap=fixture();overlap.candidate.run.bindings[0].trim.triangles.push(clone(overlap.candidate.run.bindings[0].trim.triangles[0]));cases.push({name:'overlapping-region',value:overlap,expected:{passed:false,geometryPassed:false},check:r=>assert(r.coverage.maxOverlapRatio>0)});
// Coincident triangles with independent source vertex IDs have no sewing link.
const disconnected={input:{surface:{id:'mesh',topologyVersion:1,vertices:[0,1].flatMap(k=>[[0,0],[100,0],[0,100]].map(([xMm,yMm],i)=>({id:`d${k}v${i}`,xMm,yMm,zMm:0}))),faces:[0,1].map(k=>({id:'df'+k,vertices:[0,1,2].map(i=>`d${k}v${i}`)}))}},candidate:{run:{pieces:[],bindings:[]}}};
for(let k=0;k<2;k++){const id='dp'+k,vertices=[[0,0],[100,0],[0,100]].map((p,i)=>point(p,id+'v'+i));disconnected.candidate.run.pieces.push({id,nodes:vertices,closed:true,holes:[]});disconnected.candidate.run.bindings.push({pieceId:id,surfaceId:'mesh',topologyVersion:1,trim:{vertices,triangles:[{faceId:'df'+k,vertices:vertices.map(p=>p.id),barycentric:[[1,0,0],[0,1,0],[0,0,1]]}],boundary:vertices.map(p=>p.id),holes:[]},report:{faceIds:['df'+k]}});}
cases.push({name:'disconnected-coincident-faces',value:disconnected,expected:{passed:true,geometryPassed:true,qualityPassed:true},check:r=>assert.equal(r.seams.sharedSegments,0)});
const results=[];
for(const test of cases){
 const inputPath=resolve(directory,test.name+'-input.json'),candidatePath=resolve(directory,test.name+'-candidate.json'),name='oracle-'+test.name;await writeFile(inputPath,JSON.stringify(test.value.input));await writeFile(candidatePath,JSON.stringify(test.value.candidate));
 let exitCode=0,log='';try{const result=await execute(process.execPath,['tests/independent-cut-correspondence.mjs',inputPath,candidatePath,'--name',name,'--strict-seams'],{cwd:resolve('.'),windowsHide:true,maxBuffer:4*1024*1024});log=result.stdout+result.stderr;}catch(error){exitCode=error.code;log=(error.stdout??'')+(error.stderr??'');}
 await writeFile(resolve(directory,test.name+'.log'),log);const report=JSON.parse(await readFile(resolve(output,name+'.json'),'utf8'));
 for(const [key,value] of Object.entries(test.expected))assert.equal(key==='qualityPassed'?report.seams[key]:report[key],value,test.name+': '+key);
 assert.equal(exitCode,test.expected.passed?0:1,test.name+': process exit');test.check?.(report);results.push({name:test.name,passed:true,expected:test.expected});
}
await writeFile(resolve(output,'independent-cut-correspondence-oracle.json'),JSON.stringify({passed:true,source:'Explicit analytic coordinates; no production geometry solver',results},null,2));console.log(JSON.stringify({passed:true,cases:results.length}));
