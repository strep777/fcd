import {expect,it,vi} from 'vitest';
import {createHash} from 'node:crypto';
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {project,rectangle} from '../fixtures';
import {cutPreview} from '../../apps/desktop/main/cut-preview';
import {editSurfaceCuts} from '../../apps/desktop/main/cut-tools';
import {projectMarking} from '../../apps/desktop/main/markings';
import {bindingIssues,validateSurface} from '../../apps/desktop/main/surface';
import {analyze} from '../../apps/desktop/main/worker';
import * as workerApi from '../../apps/desktop/main/worker';
import type {Surface,SurfaceRun} from '../../packages/schema/index';
// @ts-expect-error This independent test fixture deliberately imports no production geometry.
import {coplanarGarmentShell,subdivideCoplanarGarment,garmentOracle} from '../fixtures/coplanar-garment-shell.mjs';

type V=[number,number,number];type XY=[number,number];
const xyz=(p:{xMm:number;yMm:number;zMm:number}):V=>[p.xMm,p.yMm,p.zMm];
const minus=(a:number[],b:number[])=>a.map((v,i)=>v-b[i]);
const cross=(a:number[],b:number[]):V=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
const dot=(a:number[],b:number[])=>a.reduce((s,n,i)=>s+n*b[i],0);
const area=(a:V,b:V,c:V)=>Math.hypot(...cross(minus(b,a),minus(c,a)))/2;
const signed2=(r:XY[])=>r.reduce((s,a,i)=>{const b=r[(i+1)%r.length];return s+a[0]*b[1]-b[0]*a[1];},0);
const fixedId=(name:string)=>{const h=createHash('sha256').update(name).digest('hex');return h.slice(0,8)+'-'+h.slice(8,12)+'-4'+h.slice(13,16)+'-8'+h.slice(17,20)+'-'+h.slice(20,32);};
const point=(p:V)=>({id:fixedId('hand-seam:'+p.join(',')),xMm:p[0],yMm:p[1],zMm:p[2]});
const worker=resolve('target/release/fpcad-worker.exe'),assets=resolve('dist/assets');

function dimensions(mesh:Surface){const vs=new Map(mesh.vertices.map(v=>[v.id,xyz(v)])),edges=new Map<string,{a:V;b:V;count:number}>();let total=0;
  for(const face of mesh.faces){const p=face.vertices.map(id=>vs.get(id)!);total+=area(p[0],p[1],p[2]);face.vertices.forEach((a,i)=>{const b=face.vertices[(i+1)%3],key=[a,b].sort().join(':');const row=edges.get(key)??{a:vs.get(a)!,b:vs.get(b)!,count:0};row.count++;edges.set(key,row);});}
  expect([...edges.values()].every(e=>e.count===1||e.count===2)).toBe(true);
  return {areaMm2:total,boundaryLengthMm:[...edges.values()].filter(e=>e.count===1).reduce((s,e)=>s+Math.hypot(...minus(e.a,e.b)),0),bounds:[['xMm','yMm','zMm'].map(k=>Math.min(...mesh.vertices.map(v=>v[k as 'xMm']))),['xMm','yMm','zMm'].map(k=>Math.max(...mesh.vertices.map(v=>v[k as 'xMm'])))]};
}

// Independent source-space barycentric coordinates. This audits the persisted
// output, without using production mappings, tessellation or correspondence.
function weights(p:V,triangle:V[]):V|undefined{const [a,b,c]=triangle,ab=minus(b,a),ac=minus(c,a),n=cross(ab,ac),length=Math.hypot(...n);if(Math.abs(dot(minus(p,a),n))/length>1e-7)return;
  const skip=n.map(Math.abs).indexOf(Math.max(...n.map(Math.abs))),axes=[0,1,2].filter(i=>i!==skip),[x,y]=axes,den=(b[x]-a[x])*(c[y]-a[y])-(b[y]-a[y])*(c[x]-a[x]),u=((p[x]-a[x])*(c[y]-a[y])-(p[y]-a[y])*(c[x]-a[x]))/den,v=((b[x]-a[x])*(p[y]-a[y])-(b[y]-a[y])*(p[x]-a[x]))/den;return [1-u-v,u,v];
}
function intersection(a:XY[],b:XY[]){let ring=a;for(let i=0;i<b.length&&ring.length;i++){const start=b[i],end=b[(i+1)%b.length],side=(p:XY)=>(end[0]-start[0])*(p[1]-start[1])-(end[1]-start[1])*(p[0]-start[0]),output:XY[]=[];let previous=ring.at(-1)!,before=side(previous);for(const p of ring){const after=side(p);if((before>=0)!==(after>=0)){const t=before/(before-after);output.push([previous[0]+t*(p[0]-previous[0]),previous[1]+t*(p[1]-previous[1])]);}if(after>=0)output.push(p);previous=p;before=after;}ring=output;}return ring;}

function coarseCoverage(coarse:Surface,world:V[][]){const vertices=new Map(coarse.vertices.map(v=>[v.id,xyz(v)])),parents=coarse.faces.map(f=>({id:f.id,triangle:f.vertices.map(id=>vertices.get(id)!)})),rows=new Map<string,XY[][]>();
  for(const triangle of world){let owner:typeof parents[number]|undefined,local:V[]=[];for(const candidate of parents){const w=triangle.map(p=>weights(p,candidate.triangle));if(w.every(w=>w&&w.every(n=>n>=-1e-9&&n<=1+1e-9))){owner=candidate;local=w as V[];break;}}expect(owner,'Every output triangle must remain on its unchanged original physical face').toBeDefined();const t=local.map(w=>[w[1],w[2]] as XY);expect(signed2(t)).toBeGreaterThan(0);rows.set(owner!.id,[...(rows.get(owner!.id)??[]),t]);}
  expect(rows.size).toBe(coarse.faces.length);let maxAreaError=0,maxOverlap=0;
  for(const parent of parents){const ts=rows.get(parent.id)!;maxAreaError=Math.max(maxAreaError,Math.abs(ts.reduce((s,t)=>s+signed2(t),0)-1));for(let i=0;i<ts.length;i++)for(let j=i+1;j<ts.length;j++)maxOverlap=Math.max(maxOverlap,Math.abs(signed2(intersection(ts[i],ts[j]))));}
  expect(maxAreaError).toBeLessThanOrEqual(1e-8);expect(maxOverlap).toBeLessThanOrEqual(1e-9);return {faces:rows.size,maxAreaError,maxOverlap};
}

function outputMetrics(coarse:Surface,input:Surface,run:SurfaceRun){
  const vertices=new Map(input.vertices.map(v=>[v.id,xyz(v)])),faces=new Map(input.faces.map(f=>[f.id,f])),pieces=new Map(run.pieces.map(p=>[p.id,p])),world:V[][]=[],physicalColorArea:Record<string,number>={},paperColorArea:Record<string,number>={};let boundaryMm=0,userSeamCopiesMm=0;
  for(const binding of run.bindings){const trim=binding.trim!;expect(trim).toBeDefined();const locations=new Map<string,V>(),uv=new Map(trim.vertices.map(v=>[v.id,[v.xMm,v.yMm] as XY])),color=pieces.get(binding.pieceId)!.color;
    for(const t of trim.triangles){const source=faces.get(t.faceId)!.vertices.map(id=>vertices.get(id)!),points=t.barycentric.map(w=>[0,1,2].map(k=>w.reduce((s,n,i)=>s+n*source[i][k],0)) as V);world.push(points);
      t.vertices.forEach((id,i)=>{const existing=locations.get(id);if(existing)expect(Math.hypot(...minus(existing,points[i]))).toBeLessThanOrEqual(1e-6);locations.set(id,points[i]);});
      physicalColorArea[color]=(physicalColorArea[color]??0)+area(points[0],points[1],points[2]);paperColorArea[color]=(paperColorArea[color]??0)+Math.abs(signed2(t.vertices.map(id=>uv.get(id)!)))/2;
    }
    for(const ring of [trim.boundary,...trim.holes])for(let i=0;i<ring.length;i++){const a=locations.get(ring[i])!,b=locations.get(ring[(i+1)%ring.length])!;expect(a).toBeDefined();expect(b).toBeDefined();const length=Math.hypot(...minus(a,b));boundaryMm+=length;
      if([a,b].every(p=>Math.abs(p[1]-1050)<=1e-6&&Math.abs(p[2]-100)<=1e-6&&p[0]>=-220-1e-6&&p[0]<=220+1e-6))userSeamCopiesMm+=length;
    }
  }
  const coverage=coarseCoverage(coarse,world);expect(userSeamCopiesMm,'Both sides of the unchanged 440 mm drawn seam survive in physical output').toBeCloseTo(880,5);
  for(const [color,expected]of Object.entries(garmentOracle.colorAreaMm2))expect(Math.abs(physicalColorArea[color]-(expected as number)),color+' unchanged physical material area').toBeLessThanOrEqual(.01);
  for(const b of run.bindings){expect(b.report.areaErrorMax).toBeLessThanOrEqual(.15);expect(b.report.edgeErrorMax).toBeLessThanOrEqual(.1);expect(b.report.distortionMax).toBeLessThanOrEqual(.15);expect(b.report.seamLengthErrorMm??0).toBeLessThanOrEqual(.25);}
  return {pieces:run.pieces.length,physicalCutLengthMm:(boundaryMm-garmentOracle.boundaryLengthMm)/2,physicalColorArea,paperColorArea,userSeamCopiesMm,coverage};
}

it('the independent full garment fixture changes only coplanar triangles, not physical geometry',()=>{
  const coarse=coplanarGarmentShell() as Surface,fine=subdivideCoplanarGarment(coarse) as Surface;validateSurface(coarse);validateSurface(fine);
  expect(coplanarGarmentShell(),'Analytic fixture IDs and traversal must be reproducible').toEqual(coarse);expect(subdivideCoplanarGarment(coarse)).toEqual(fine);
  expect(fine.faces).toHaveLength(coarse.faces.length*4);expect(new Set(coarse.faces.map(f=>f.region))).toEqual(new Set(garmentOracle.parts));
  for(const mesh of [coarse,fine]){const d=dimensions(mesh);expect(d.areaMm2).toBe(garmentOracle.areaMm2);expect(d.boundaryLengthMm).toBe(garmentOracle.boundaryLengthMm);expect(d.bounds).toEqual(garmentOracle.bounds);}
  const vs=new Map(fine.vertices.map(v=>[v.id,xyz(v)]));coarseCoverage(coarse,fine.faces.map(f=>f.vertices.map(id=>vs.get(id)!)));
});

it('a connected seven-part garment retains physical sewing cuts, colors and coverage after exact four-way coplanar remeshing',async()=>{
  const output=resolve(process.env.FPCAD_TESSELLATION_RESULTS??'test-results/reported-functional-acceptance/garment-coplanar-remesh');await mkdir(output,{recursive:true});
  const coarse=coplanarGarmentShell() as Surface,fine=subdivideCoplanarGarment(coarse) as Surface;
  const report:{passed:boolean;workerSha256:string;scope:string;cases:unknown[];nativeFailures:unknown[];error?:string}={passed:false,workerSha256:createHash('sha256').update(await readFile(worker)).digest('hex'),scope:'Analytic connected seven-part garment; exact midpoint subdivision only. No smooth deformation, approximation, changed paint or changed hand seam.',cases:[],nativeFailures:[]};
  const results:ReturnType<typeof outputMetrics>[]=[],allBindingIssues:ReturnType<typeof bindingIssues>=[];
  let activeCase='setup';const nativeAnalyze=workerApi.analyze;
  // A read-only observer retains rejected real output for a reproducible
  // manufacturing failure. It never changes native input, output or gates.
  const observer=vi.spyOn(workerApi,'analyze').mockImplementation(async(...args:Parameters<typeof analyze>)=>{
    const geometry=await nativeAnalyze(...args),failed=geometry.filter(g=>g.issues.some(i=>i.severity==='error'));
    if(failed.length){const stem=activeCase+'-rejected-'+(report.nativeFailures.length+1),path=resolve(output,stem+'-project.json');await writeFile(path,JSON.stringify(args[1]));await writeFile(resolve(output,stem+'-geometry.json'),JSON.stringify(failed));report.nativeFailures.push({label:activeCase,path,pieces:failed.map(g=>({id:g.id,issues:g.issues}))});}
    return geometry;
  });
  try{
    for(const [label,mesh]of [['coarse',coarse],['four-way',fine]] as const){
      activeCase=label;
      const p=project();p.id=fixedId('garment-remesh-project');p.name='Independent garment remesh '+label;p.pieces=[];p.defaultAllowanceMm=0;p.surface=mesh;
      Object.assign(p,await editSurfaceCuts(worker,p,{type:'surface.curve',name:'Unchanged 440 mm chest seam',kind:'pen',closed:false,controlPoints:[point(garmentOracle.handSeam.a),point(garmentOracle.handSeam.b)],surfaceAnchored:true,projection:{origin:[0,0,0],axes:[[1,0,0],[0,1,0],[0,0,1]]},tension:1,symmetric:false}));
      const cyan=rectangle(700,1600),yellow=rectangle(700,700);cyan.allowanceMm=yellow.allowanceMm=0;cyan.color='#04a3f0';yellow.color='#f9e33c';yellow.nodes.forEach(n=>n.xMm-=700);
      for(const [i,piece]of [cyan,yellow].entries()){piece.id=fixedId('source:'+i);piece.nodes.forEach((n,j)=>n.id=fixedId('source:'+i+':node:'+j));}
      p.patternLibrary=[cyan,yellow].map((piece,i)=>({piece,referenceId:fixedId('reference:'+i),view:'front',category:'paint'}));p.markings=[];
      for(const source of [cyan,yellow])p.markings.push(await projectMarking(worker,p,source.id,'front',0,0));
      const before=JSON.stringify(p),started=Date.now();await writeFile(resolve(output,label+'-input.json'),before);
      const candidate=await cutPreview(worker,p.surface!,p,{method:'arap',partitionStrategy:'design',automaticCuts:true,colorBoundaryCuts:true,iterations:30,maxPieces:50},assets);
      await writeFile(resolve(output,label+'-candidate.json'),JSON.stringify(candidate));expect(JSON.stringify(p),'Candidate computation must not modify the supplied project').toBe(before);
      const metrics=outputMetrics(coarse,p.surface!,candidate.run),ready={...p,pieces:candidate.run.pieces,bindings:candidate.run.bindings,markings:candidate.markings};
      const issues=bindingIssues(ready);allBindingIssues.push(...issues);const manufacturingErrors=(await analyze(worker,ready)).flatMap(g=>g.issues.filter(i=>i.severity==='error'));
      expect(candidate.run.accepted,'A mesh comparison must never approve an unreviewed candidate').toBe(false);
      for(const issue of issues.filter(i=>i.messageKey==='SURFACE_DISTORTION'))expect(candidate.run.bindings.find(b=>b.pieceId===issue.entityId)?.report.status,'The existing 5% review warning remains needsReview').toBe('needsReview');
      results.push(metrics);report.cases.push({label,inputFaces:mesh.faces.length,cutInputFaces:p.surface!.faces.length,durationMs:Date.now()-started,...metrics,accepted:candidate.run.accepted,reviewStates:candidate.run.bindings.map(b=>({pieceId:b.pieceId,status:b.report.status})),bindingIssues:issues,manufacturingErrors});await writeFile(resolve(output,'report.json'),JSON.stringify(report,null,2));
      expect(manufacturingErrors).toEqual([]);
    }
    const [a,b]=results;expect(b.pieces,'Changing only mesh triangles must not manufacture extra paper panels').toBe(a.pieces);expect(Math.abs(b.physicalCutLengthMm-a.physicalCutLengthMm),'Physical sewing line length must not depend on coplanar tessellation').toBeLessThanOrEqual(.01);
    expect(Object.keys(b.physicalColorArea).sort()).toEqual(Object.keys(a.physicalColorArea).sort());
    for(const color of Object.keys(a.physicalColorArea)){expect(Math.abs(b.physicalColorArea[color]-a.physicalColorArea[color]),color+' physical area invariance').toBeLessThanOrEqual(.01);expect(Math.abs(b.paperColorArea[color]-a.paperColorArea[color]),color+' actual paper area invariance').toBeLessThanOrEqual(.01);}
    // Existing distortion warnings require review; they are recorded rather
    // than silently promoted to acceptance or treated as hard geometry errors.
    expect(allBindingIssues.filter(i=>i.severity==='error')).toEqual([]);report.passed=true;
  }catch(error){report.error=String(error instanceof Error?error.stack:error);throw error;}finally{observer.mockRestore();await writeFile(resolve(output,'report.json'),JSON.stringify(report,null,2));}
},180000);
