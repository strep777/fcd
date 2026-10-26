import {expect,it} from 'vitest';
import {randomUUID,createHash} from 'node:crypto';
import {mkdir,mkdtemp,writeFile,readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
import type {Binding,Surface,SurfaceRun} from '../../packages/schema/index';
import {project} from '../fixtures';

const delta=2**-23,t=1/32;
type Bary=[number,number,number];
const A:Bary=[1,0,0],B:Bary=[0,1,0],C:Bary=[0,0,1],F:Bary=[delta,0,1-delta],P:Bary=[delta*t,1-t,(1-delta)*t];
const signed=(tri:Bary[])=>{const [a,b,c]=tri;return(b[1]-a[1])*(c[2]-a[2])-(b[2]-a[2])*(c[1]-a[1]);};
function fixture(){
 const [a,b,c,d,f,p]=Array.from({length:6},()=>randomUUID()),vertices=[{id:a,xMm:0,yMm:10,zMm:0},{id:b,xMm:0,yMm:0,zMm:0},{id:c,xMm:10,yMm:0,zMm:0},{id:d,xMm:10,yMm:-10,zMm:0},{id:f,xMm:10*(1-delta),yMm:10*delta,zMm:0},{id:p,xMm:10*(1-delta)*t,yMm:10*delta*t,zMm:0}],left=randomUUID(),right=randomUUID();
 const surface:Surface={id:randomUUID(),source:'obj',topologyVersion:1,vertices:vertices.slice(0,4),faces:[{id:left,region:'analytic-left',vertices:[a,b,c]},{id:right,region:'analytic-right',vertices:[c,b,d]}]},paperId=randomUUID(),boundary=[a,b,d,c],uv=vertices.map(v=>({vertexId:v.id,xMm:v.xMm,yMm:v.yMm}));
 const binding:Binding={pieceId:paperId,surfaceId:surface.id,topologyVersion:1,geometryHash:'0'.repeat(64),surfaceHash:createHash('sha256').update(JSON.stringify(surface)).digest('hex'),report:{faceIds:[left,right],uv,boundary,holes:[],areaErrorMax:0,edgeErrorMax:0,distortionMean:0,distortionP95:0,distortionMax:0,status:'acceptable'},trim:{vertices:vertices.map(({id,xMm,yMm})=>({id,xMm,yMm})),boundary,holes:[],triangles:[{faceId:left,vertices:[a,b,p],barycentric:[A,B,P]},{faceId:left,vertices:[a,p,f],barycentric:[A,P,F]},{faceId:left,vertices:[f,b,c],barycentric:[F,B,C]},{faceId:right,vertices:[c,b,d],barycentric:[A,B,C]}]}};
 const piece={id:paperId,name:'Dyadic near-edge T partition',nodes:boundary.map(id=>{const v=vertices.find(v=>v.id===id)!;return{id,xMm:v.xMm,yMm:v.yMm};}),closed:true,allowanceMm:0,cutQty:1,mirror:false,material:'Fabric',furRad:0,color:'#315579'};
 // Keep the real source edge BC on both paper outlines. An internal T line
 // genuinely 3.7e-8 mm away must cancel on its face support, while BC sews
 // across the distinct source faces. Combining both faces into one paper
 // would also exercise an unrelated raw-boundary T cancellation oracle.
 const pieces=[[a,b,c],[c,b,d]].map((ids,index)=>({...piece,id:index?randomUUID():paperId,name:piece.name+' '+index,nodes:ids.map(id=>{const v=vertices.find(v=>v.id===id)!;return{id,xMm:v.xMm,yMm:v.yMm};})}));
 const bindings=pieces.map((item,index)=>{const ids=item.nodes.map(v=>v.id),triangles=binding.trim!.triangles.filter(v=>v.faceId===(index?right:left));return{...binding,pieceId:item.id,report:{...binding.report,uv:uv.map(v=>({...v})),faceIds:[index?right:left],boundary:ids},trim:{...binding.trim!,vertices:binding.trim!.vertices.map(v=>({...v})),boundary:ids,triangles}};});
 const run:SurfaceRun={sourceHash:binding.surfaceHash,algorithm:'lscm-arap-seamed-1',pieces,bindings,accepted:false};
 return{surface,run,project:{...project(),surface,pieces:[]}};
}
const limits={geometryMm:1e-5,barycentric:1e-8,coverageRatio:1e-6,mappingMm:1e-4,uvOverlapAreaMm2:1e-7,seamMm:.25,seamRelative:.0005,mappingTrianglesPerPiece:15};
async function audit(f:ReturnType<typeof fixture>,suffix='accepted'){
 const root=resolve('.local/tests');await mkdir(root,{recursive:true});const folder=await mkdtemp(resolve(root,'near-edge-dyadic-support-')),input=resolve(folder,'input.json'),run=resolve(folder,'run.json'),name='near-edge-dyadic-support-'+suffix;
 await writeFile(input,JSON.stringify(f.project));await writeFile(run,JSON.stringify(f.run));
 const result=spawnSync(process.execPath,[resolve('tests/independent-cut-correspondence.mjs'),input,run,'--strict-seams','--seam-mm','.25','--seam-relative','.0005','--mapping-samples','15','--name',name],{encoding:'utf8',maxBuffer:16*1024*1024,timeout:30000});
 await mkdir(resolve('test-results/current-repair'),{recursive:true});await writeFile(resolve('test-results/current-repair',name+'.log'),(result.stdout??'')+(result.stderr??''));expect(result.error).toBeUndefined();
 const report=JSON.parse(await readFile(resolve('test-results/current-repair',name+'.json'),'utf8'));expect(report.limits).toEqual(limits);
 return{report,result};
}

it('the dyadic near-edge T partition has exact positive coverage while its internal short edge remains distinct from the real source edge',()=>{
 expect(P[0]).toBe(2**-28);expect(P[0]).toBeGreaterThan(64*Number.EPSILON);expect(P[0]).toBeLessThan(1e-8);expect(F[0]).toBeGreaterThan(1e-8);
 for(const weights of [A,B,C,F,P]){expect(weights.reduce((s,w)=>s+w,0)).toBe(1);expect(Math.min(...weights)).toBeGreaterThanOrEqual(0);}
 const triangles=[[A,B,P],[A,P,F],[F,B,C]],ratios=triangles.map(signed);expect(ratios.every(n=>n>0)).toBe(true);expect(ratios.reduce((s,n)=>s+n,0)).toBe(1);
 // With source points A=(0,10), B=(0,0), C=(10,0), w0 gives exact
 // distance/10 from source edge BC. P and F are genuinely inside the face;
 // P lies on BF, not BC, despite its w0 fitting the input validation tolerance.
 const distanceToSourceBC=10*P[0];expect(distanceToSourceBC).toBe(10*2**-28);expect(distanceToSourceBC).toBeGreaterThan(0);expect(P.map((w,i)=>w-(B[i]*(1-t)+F[i]*t))).toEqual([0,0,0]);
 expect(ratios.reduce((sum,ratio)=>sum+ratio*50,0)).toBe(50);
});

it('the complete strict oracle accepts the real internal T line without relaxing input, coverage, geometry, mapping or sewing limits',async()=>{
 const {report:r,result}=await audit(fixture());
 expect(result.status,result.stdout+'\n'+result.stderr).toBe(0);expect(r.passed).toBe(true);expect(r.geometryPassed).toBe(true);expect(r.coverage.sourceAreaMm2).toBe(100);expect(r.coverage.coveredAreaMm2).toBe(100);expect(r.coverage.failedFaces).toBe(0);expect(r.uvInjectivity.overlapPairs).toBe(0);expect(r.seams.unmatchedSegments).toBe(0);expect(r.seams.nonmanifoldSegments).toBe(0);expect(r.mapping.failures).toBe(0);expect(r.seams.sharedSegments).toBe(1);
},45000);

it('the strict oracle still rejects barycentric coordinates outside the unchanged input tolerance',async()=>{
 const f=fixture();f.run.bindings[0].trim!.triangles[0].barycentric[1]=[-2e-8,1+2e-8,0];
 const {report:r,result}=await audit(f,'outside-rejected');expect(result.status).toBe(1);expect(r.passed).toBe(false);expect(r.issues.some((i:{kind:string})=>i.kind==='barycentric-outside-source')).toBe(true);
},45000);

it('the strict oracle still rejects missing real source material even when the near-edge T support itself is valid',async()=>{
 const f=fixture();f.run.bindings[0].trim!.triangles.splice(1,1);
 const {report:r,result}=await audit(f,'coverage-rejected');expect(result.status).toBe(1);expect(r.passed).toBe(false);expect(r.coverage.failedFaces).toBe(1);expect(r.coverage.coveredAreaMm2).toBeLessThan(100);
},45000);

it('the strict oracle still rejects sewing length distortion using the unchanged relative limit',async()=>{
 const f=fixture(),binding=f.run.bindings[1];
 for(const p of f.run.pieces[1].nodes)p.xMm*=1.01;
 for(const p of binding.trim!.vertices)p.xMm*=1.01;
 for(const p of binding.report.uv)p.xMm*=1.01;
 const {report:r,result}=await audit(f,'sewing-rejected');expect(result.status).toBe(1);expect(r.passed).toBe(false);expect(r.seams.failedLocalSegments).toBeGreaterThan(0);expect(r.seams.localMismatchRelative.max).toBeGreaterThan(limits.seamRelative);expect(r.seams.localMismatchMm.max).toBeLessThan(limits.seamMm);
},45000);
