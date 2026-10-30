import {expect,it} from 'vitest';
import {randomUUID} from 'node:crypto';
import {resolve} from 'node:path';
import {mkdirSync,writeFileSync} from 'node:fs';
import {project,rectangle} from '../fixtures';
import {importedGarment} from '../fixtures/imported-garment';
import {automaticPlacement} from '../../apps/desktop/main/automatic-placement';
import {projectMarking,surfaceMarking,projectReferenceGeometry,staleMarkingIds} from '../../apps/desktop/main/markings';
import {Repository} from '../../apps/desktop/main/repository';
import {pack,unpack} from '../../apps/desktop/main/archive';
import {prepareDesignSurface} from '../../apps/desktop/main/design-cuts';
import {designComponents} from '../../packages/surface/design-partition';
import {parseObj} from '../../apps/desktop/main/surface';
import {garmentAnatomy} from '../../packages/surface/garment-anatomy';
import {placementMatchesModel} from '../../packages/reference/placement-review';
import {sourceSurfaceShape} from '../../packages/surface/source-drop';
import {surfaceDragShape} from '../../packages/surface/attached-edit';
import type {Project,Marking,Surface} from '../../packages/schema/index';
import {parseProject} from '../../packages/schema/index';

const worker=resolve(process.env.FPCAD_VISIBILITY_WORKER??'target/release/fpcad-worker.exe');
type XY=[number,number];
const area=(r:XY[])=>r.reduce((s,p,i)=>{const q=r[(i+1)%r.length];return s+p[0]*q[1]-q[0]*p[1];},0)/2;
function projectFixture(fold=true){
 const p=project();p.pieces=[];p.surface=importedGarment();
 if(fold){const v=p.surface.vertices.find(v=>v.xMm===0&&v.yMm===1050&&v.zMm===100)!;v.xMm=120.8;v.zMm=300;}
 const piece=rectangle(520,734.75);piece.allowanceMm=0;piece.nodes.forEach(n=>{n.xMm-=260;n.yMm+=815.25;});
 p.patternLibrary=[{piece,referenceId:randomUUID(),view:'front',category:'body',anatomy:{part:'body',side:'center',confidence:1,method:'manual'}}];return p;
}
function fragmentAreas(p:Project,m:Marking){
 const vs=new Map(p.surface!.vertices.map(v=>[v.id,v])),fs=new Map(p.surface!.faces.map(f=>[f.id,f]));
 return new Map(m.fragments.map(f=>{const triangle=fs.get(f.faceId)!.vertices.map(id=>vs.get(id)!);return[f.faceId,f.rings.reduce((s,r)=>s+area(r.map(w=>[w.reduce((s,n,i)=>s+n*triangle[i].xMm,0),w.reduce((s,n,i)=>s+n*triangle[i].yMm,0)])),0)];}));
}
function clipRectangle(ring:XY[],box=[-260,260,815.25,1550]){
 let r=ring;for(const distance of [(p:XY)=>p[0]-box[0],(p:XY)=>box[1]-p[0],(p:XY)=>p[1]-box[2],(p:XY)=>box[3]-p[1]]){
  const next:XY[]=[];for(let i=0;i<r.length;i++){const a=r[i],b=r[(i+1)%r.length],da=distance(a),db=distance(b);if(da>=0)next.push(a);if((da<0&&db>0)||(da>0&&db<0)){const t=da/(da-db);next.push([a[0]+t*(b[0]-a[0]),a[1]+t*(b[1]-a[1])]);}}r=next;
 }return r;
}
it('registered front pigment covers physical front folds despite flipped normals while manual projection retains orientation and visibility',async()=>{
 const p=projectFixture(),before=structuredClone(p);expect(garmentAnatomy(p.surface!)).toBeDefined();
 const result=await automaticPlacement(worker,p,[p.patternLibrary![0].piece.id]);expect(result.skipped).toEqual([]);expect(result.markings).toHaveLength(1);const automatic=result.markings[0];
 expect(automatic.placement!.reviewed).toBe(false);expect(placementMatchesModel({...p,markings:[automatic]},automatic)).toBe(true);
 const manual=await projectMarking(worker,p,p.patternLibrary![0].piece.id,'front',0,0),automaticAreas=fragmentAreas(p,automatic),manualAreas=fragmentAreas(p,manual),vertices=new Map(p.surface!.vertices.map(v=>[v.id,v]));
 let expectedArea=0,hiddenWitnesses=0,flippedFrontWitnesses=0,grazingFrontWitnesses=0;for(const face of p.surface!.faces){const triangle=face.vertices.map(id=>vertices.get(id)!),xy=triangle.map(v=>[v.xMm,v.yMm] as XY),expected=triangle.every(v=>v.zMm>0)?Math.abs(area(clipRectangle(xy))):0;expectedArea+=expected;
  expect(automaticAreas.get(face.id)??0,face.id+' physical selected area').toBeCloseTo(expected,6);
  if(area(xy)<-1e-6){expect(manualAreas.get(face.id)??0).toBe(0);if(expected>1){flippedFrontWitnesses++;const world=triangle.map(v=>[v.xMm,v.yMm,v.zMm] as XYZ),normalZ=area(xy)/physicalArea(world);if(normalZ>-.008&&normalZ<-.002)grazingFrontWitnesses++;}}
  if(expected>1&&(manualAreas.get(face.id)??0)<expected-1)hiddenWitnesses++;
 }
 expect(hiddenWitnesses).toBeGreaterThan(0);expect(flippedFrontWitnesses).toBeGreaterThan(0);expect(grazingFrontWitnesses).toBeGreaterThan(0);expect([...automaticAreas.values()].reduce((s,a)=>s+a,0)).toBeCloseTo(expectedArea,6);expect(p).toEqual(before);
});

type XYZ=[number,number,number];
function physicalArea(ring:XYZ[]){
 if(ring.length<3)return 0;const vector=[0,0,0],origin=ring[0];for(let i=0;i<ring.length;i++){const a=ring[i].map((n,k)=>n-origin[k]),b=ring[(i+1)%ring.length].map((n,k)=>n-origin[k]);for(let k=0;k<3;k++)vector[k]+=a[(k+1)%3]*b[(k+2)%3]-a[(k+2)%3]*b[(k+1)%3];}return Math.hypot(...vector)/2;
}
function projectionAreaRoundoffBudget(triangle:XYZ[],stationCount:number){
 const [a,b,c]=triangle,e1=b.map((n,i)=>n-a[i]),e2=c.map((n,i)=>n-a[i]),det=e1[0]*e2[1]-e1[1]*e2[0],jx=e1.map((n,i)=>(n*e2[1]-e2[i]*e1[1])/det),jy=e1.map((n,i)=>(e2[i]*e1[0]-n*e2[0])/det);
 const coordinateMagnitude=Math.max(1,...triangle.flat().map(Math.abs)),xyRoundingMm=.5e-12+16*Number.EPSILON*coordinateMagnitude,jacobianL1Bound=Math.hypot(...jx)+Math.hypot(...jy),positionBudgetMm=xyRoundingMm*jacobianL1Bound;
 const perimeter=triangle.reduce((sum,p,i)=>sum+Math.hypot(...p.map((n,k)=>n-triangle[(i+1)%3][k])),0);
 // Each XY coordinate has at most half a 12-digit grid step, plus bounded
 // floating evaluation. The inverse projection maps it through [Jx Jy].
 // A polygon's area changes by at most P*d + N*d*d/2 under point errors d.
 // Both half-triangle perimeters sum to at most 3 times the source perimeter.
 const quantizationAreaBudgetMm2=3*perimeter*positionBudgetMm+stationCount*positionBudgetMm**2/2,areaEvaluationBudgetMm2=32*Number.EPSILON*Math.max(1,physicalArea(triangle),perimeter*coordinateMagnitude);
 return {xyRoundingMm,jacobianL1Bound,positionBudgetMm,quantizationAreaBudgetMm2,areaEvaluationBudgetMm2,totalAreaBudgetMm2:quantizationAreaBudgetMm2+areaEvaluationBudgetMm2};
}
function physicalClip(ring:XYZ[],view:'front'|'back',middle:number){
 let r=ring;for(const distance of [(p:XYZ)=>p[0]+260,(p:XYZ)=>260-p[0],(p:XYZ)=>p[1]-815.25,(p:XYZ)=>1550-p[1],(p:XYZ)=>(view==='front'?1:-1)*(p[2]-middle)]){
  const output:XYZ[]=[];for(let i=0;i<r.length;i++){const a=r[i],b=r[(i+1)%r.length],da=distance(a),db=distance(b);if(da>=0)output.push(a);if((da<0&&db>0)||(da>0&&db<0)){const t=da/(da-db);output.push(a.map((n,k)=>n+t*(b[k]-n)) as XYZ);}}r=output;
 }return r;
}
function worldRings(p:Project,m:Pick<Marking,'fragments'>){
 const vertices=new Map(p.surface!.vertices.map(v=>[v.id,[v.xMm,v.yMm,v.zMm] as XYZ])),faces=new Map(p.surface!.faces.map(f=>[f.id,f]));
 return new Map(m.fragments.map(fragment=>[fragment.faceId,fragment.rings.map(r=>r.map(w=>[0,1,2].map(k=>w.reduce((s,n,i)=>s+n*vertices.get(faces.get(fragment.faceId)!.vertices[i])![k],0)) as XYZ))]));
}
function crossingProject(options:{reverseDiagonal?:boolean;subdivisions?:number}={}){
 const p=projectFixture(false);p.surface=importedGarment('PatternBody',options);
 // A shear, applied to both cloth banks, keeps each quad exactly planar.
 // Flipping its diagonal or subdividing changes only tessellation, not shape.
 for(const v of p.surface.vertices)v.zMm+=v.xMm+37;
 const back=structuredClone(p.patternLibrary![0]);back.piece.id=randomUUID();back.piece.nodes.forEach(n=>n.id=randomUUID());back.view='back';back.piece.color='#eeaa22';p.patternLibrary![0].piece.color='#2277ee';p.patternLibrary!.push(back);return p;
}
it('front and back pigments split cross-middle triangles at the physical plane with identical domains after retriangulation',async()=>{
 const totals:number[][]=[];
 for(const options of [{},{reverseDiagonal:true},{subdivisions:2},{reverseDiagonal:true,subdivisions:2}]){
  const p=crossingProject(options),before=structuredClone(p),result=await automaticPlacement(worker,p,p.patternLibrary!.map(r=>r.piece.id));expect(result.skipped).toEqual([]);expect(result.markings).toHaveLength(2);expect(garmentAnatomy(p.surface!)!.neck[2]).toBeCloseTo(37,8);
  const vertices=new Map(p.surface!.vertices.map(v=>[v.id,[v.xMm,v.yMm,v.zMm] as XYZ])),measurements:number[]=[],painted=new Map<string,number>();let crossPlaneFaces=0;
  for(const m of result.markings){expect(m.placement!.reviewed).toBe(false);expect(placementMatchesModel({...p,markings:result.markings},m)).toBe(true);const rings=worldRings(p,m);let total=0;
   for(const face of p.surface!.faces){const triangle=face.vertices.map(id=>vertices.get(id)!),projected=triangle.map(v=>[v[0],v[1]] as XY),expected=Math.abs(area(projected))>1e-6?physicalArea(physicalClip(triangle,m.view,37)):0,actual=(rings.get(face.id)??[]).reduce((s,r)=>s+physicalArea(r),0);
    expect(actual,m.view+' physical half of source triangle').toBeCloseTo(expected,6);for(const point of (rings.get(face.id)??[]).flat())expect((m.view==='front'?1:-1)*(point[2]-37)).toBeGreaterThanOrEqual(-1e-6);
    if(expected>1e-6){painted.set(face.id,(painted.get(face.id)??0)+1);total+=actual;}
   }measurements.push(total);
  }
  crossPlaneFaces=[...painted.values()].filter(n=>n===2).length;expect(crossPlaneFaces).toBeGreaterThan(0);expect(p).toEqual(before);totals.push(measurements);
 }for(const values of totals)values.forEach((value,i)=>expect(value).toBeCloseTo(totals[0][i],6));
},60000);

it('real near-middle front/back fragments conserve physical area within the derived projection roundoff budget',async()=>{
 const p=projectFixture(false),corners=[[120,1150],[250,1150],[250,1350],[120,1350]],captured:XYZ[]=[[193.05039942264557,1279.0639400482178,8.769124746322632],[193.45928728580475,1279.1529893875122,3.513777395710349],[199.712872505188,1283.3826541900635,-.0005376687113312073],[199.40410554409027,1283.2615375518799,5.580352619290352]],ids:string[]=[];
 corners.forEach(([x,y],i)=>{const v=p.surface!.vertices.find(v=>v.xMm===x&&v.yMm===y&&v.zMm===100)!;ids.push(v.id);[v.xMm,v.yMm,v.zMm]=captured[i];});
 const selected=p.surface!.faces.filter(f=>f.vertices.every(id=>ids.includes(id)));expect(selected).toHaveLength(2);p.patternLibrary![0].piece.color='#2277ee';const back=structuredClone(p.patternLibrary![0]);back.piece.id=randomUUID();back.piece.nodes.forEach(n=>n.id=randomUUID());back.view='back';back.piece.color='#eeaa22';p.patternLibrary!.push(back);const before=structuredClone(p),result=await automaticPlacement(worker,p,p.patternLibrary!.map(r=>r.piece.id));expect(result.skipped).toEqual([]);expect(result.markings).toHaveLength(2);
 const byVertex=new Map(p.surface!.vertices.map(v=>[v.id,[v.xMm,v.yMm,v.zMm] as XYZ])),frontMarking=result.markings.find(m=>m.view==='front')!,backMarking=result.markings.find(m=>m.view==='back')!,front=worldRings(p,frontMarking),rear=worldRings(p,backMarking);
 const diagnostics=selected.map(face=>{const expected=physicalArea(face.vertices.map(id=>byVertex.get(id)!)),frontArea=(front.get(face.id)??[]).reduce((s,r)=>s+physicalArea(r),0),backArea=(rear.get(face.id)??[]).reduce((s,r)=>s+physicalArea(r),0),barycentricAreaRatio=[frontMarking,backMarking].reduce((s,m)=>s+Math.abs((m.fragments.find(f=>f.faceId===face.id)?.rings??[]).reduce((n,r)=>n+2*area(r.map(w=>[w[1],w[2]])),0)),0);return {expectedAreaMm2:expected,worldAreaErrorMm2:Math.abs(frontArea+backArea-expected),barycentricAreaRatio,barycentricAreaErrorMm2:Math.abs(barycentricAreaRatio-1)*expected,front:frontMarking.fragments.find(f=>f.faceId===face.id),back:backMarking.fragments.find(f=>f.faceId===face.id)};});mkdirSync('test-results/2026-10-28-imported-cut',{recursive:true});writeFileSync('test-results/2026-10-28-imported-cut/near-middle-complement-diagnostics.json',JSON.stringify(diagnostics,null,2));
 for(const [i,face] of selected.entries()){const triangle=face.vertices.map(id=>byVertex.get(id)!),expected=physicalArea(triangle),frontArea=(front.get(face.id)??[]).reduce((s,r)=>s+physicalArea(r),0),backArea=(rear.get(face.id)??[]).reduce((s,r)=>s+physicalArea(r),0),stationCount=[...(front.get(face.id)??[]),...(rear.get(face.id)??[])].reduce((sum,r)=>sum+r.length,0),budget=projectionAreaRoundoffBudget(triangle,stationCount);
  Object.assign(diagnostics[i],{roundoffBudget:budget,originalAbsoluteGateMm2:1e-10});expect(budget.totalAreaBudgetMm2).toBeLessThan(1e-6);expect(Math.abs(frontArea+backArea-expected),'physical area must obey the independently derived quantization/inverse-map bound').toBeLessThanOrEqual(budget.totalAreaBudgetMm2);
 }
 writeFileSync('test-results/2026-10-28-imported-cut/near-middle-complement-diagnostics-with-bound.json',JSON.stringify(diagnostics,null,2));
 expect(p).toEqual(before);
});

it('a real pigment exceeding 1e-6 square millimetres remains distinct at the physical shoulder boundary',async()=>{
 const p=projectFixture(false),piece=rectangle(.001,.02);piece.allowanceMm=0;piece.nodes.forEach(n=>{n.xMm+=259.999;n.yMm+=1049.99;});p.patternLibrary=[{piece,referenceId:randomUUID(),view:'front',category:'body',anatomy:{part:'body',side:'center',confidence:1,method:'manual'}}];
 const placement:NonNullable<Marking['placement']>={algorithm:'anatomy-3',part:'body',side:'center',modelSide:'center',regions:['garment:body'],sourceGroupHash:'0'.repeat(64),sourceCenter:{xMm:0,yMm:0},targetCenter:{xMm:0,yMm:0},scaleX:1,scaleY:1,rotationRad:0,reviewed:false},before=structuredClone(p),result=await projectReferenceGeometry(worker,p,piece.id,'front',0,0,placement),rings=[...worldRings(p,result).values()].flat();
 const area=rings.reduce((s,r)=>s+physicalArea(r),0);expect(area).toBeGreaterThan(1e-6);expect(area).toBeCloseTo(.00002,10);for(const point of rings.flat()){expect(point[0]).toBeGreaterThanOrEqual(259.999-1e-8);expect(point[0]).toBeLessThanOrEqual(260+1e-8);}expect(p).toEqual(before);
});

it('actual material partitioning of the near-middle cloth has full source coverage and no extra base-colour component',async()=>{
 const results:{localComponents:number;smallComponents:number}[]=[];
 for(const captured of [false,true]){
  const p=projectFixture(false),corners=[[120,1150],[250,1150],[250,1350],[120,1350]],coordinates:XYZ[]=[[193.05039942264557,1279.0639400482178,8.769124746322632],[193.45928728580475,1279.1529893875122,3.513777395710349],[199.712872505188,1283.3826541900635,-.0005376687113312073],[199.40410554409027,1283.2615375518799,5.580352619290352]],ids:string[]=[];
  corners.forEach(([x,y],i)=>{const v=p.surface!.vertices.find(v=>v.xMm===x&&v.yMm===y&&v.zMm===100)!;ids.push(v.id);if(captured)[v.xMm,v.yMm,v.zMm]=coordinates[i];});
  const selected=new Set(p.surface!.faces.filter(f=>f.vertices.every(id=>ids.includes(id))).map(f=>f.id));p.patternLibrary![0].piece.color='#2277ee';const back=structuredClone(p.patternLibrary![0]);back.piece.id=randomUUID();back.piece.nodes.forEach(n=>n.id=randomUUID());back.view='back';p.patternLibrary!.push(back);
  p.markings=(await automaticPlacement(worker,p,p.patternLibrary!.map(r=>r.piece.id))).markings;const before=structuredClone(p),working=await prepareDesignSurface(worker,p,true,true),vertices=new Map(working.surface.vertices.map(v=>[v.id,[v.xMm,v.yMm,v.zMm] as XYZ])),coverage=new Map<string,number>();
  for(const row of working.provenance.values()){
   const ratio=2*Math.abs(area(row.barycentric.map(w=>[w[1],w[2]])));coverage.set(row.faceId,(coverage.get(row.faceId)??0)+ratio);
   if(selected.has(row.faceId))expect(row.color,'no unpainted base complement on either captured source triangle').toBe('#2277ee');
  }
  expect(coverage.size).toBe(p.surface!.faces.length);for(const ratio of coverage.values())expect(Math.abs(ratio-1)).toBeLessThan(1e-12);
  const groups=designComponents(working.surface.faces).map(faces=>({color:faces[0].region,area:faces.reduce((sum,f)=>sum+physicalArea(f.vertices.map(id=>vertices.get(id)!)),0)}));
  const localComponents=designComponents(working.surface.faces.filter(f=>selected.has(working.provenance.get(f.id)!.faceId))).length,smallComponents=groups.filter(g=>g.area<1e-6).length;expect(localComponents).toBe(1);expect(smallComponents).toBe(0);results.push({localComponents,smallComponents});
  mkdirSync('test-results/2026-10-28-imported-cut',{recursive:true});writeFileSync('test-results/2026-10-28-imported-cut/near-middle-material-'+(captured?'captured':'control')+'.json',JSON.stringify({groups,localSelectedPatchComponents:localComponents,sourceFaces:coverage.size,maxCoverageRatioError:Math.max(...[...coverage.values()].map(n=>Math.abs(n-1))),originalInputUnchanged:JSON.stringify(p)===JSON.stringify(before)},null,2));expect(p).toEqual(before);
 }
 expect(results[1]).toEqual(results[0]);
},60000);

it('review refuses a front placement carrying a real fragment wholly behind the garment middle plane',async()=>{
 const p=crossingProject(),result=await automaticPlacement(worker,p,p.patternLibrary!.map(r=>r.piece.id)),front=result.markings.find(m=>m.view==='front')!,back=result.markings.find(m=>m.view==='back')!,decoded=worldRings(p,back),wrong=back.fragments.find(f=>(decoded.get(f.faceId)??[]).flat().every(point=>point[2]<36));expect(wrong).toBeDefined();
 const forged=structuredClone(front);forged.fragments=[structuredClone(wrong!)];expect(placementMatchesModel({...p,markings:[forged]},forged)).toBe(false);
});

it.each([['anatomy-1','garment:body'],['anatomy-2','garment:body'],['anatomy-1','PatternBody'],['anatomy-2','PatternBody']] as const)('preserves reviewed %s with saved group %s through archive, rename, history and locking',async(algorithm,savedRegion)=>{
 const p=parseProject(crossingProject()),fresh=(await automaticPlacement(worker,p,[p.patternLibrary![0].piece.id])).markings[0];expect(fresh.placement!.algorithm).toBe('anatomy-3');
 const placement={...fresh.placement!,algorithm,regions:[savedRegion],reviewed:true},oldProjection=await projectReferenceGeometry(worker,p,fresh.sourcePieceId!,'front',0,0,placement),legacy:Marking={...fresh,placement,fragments:oldProjection.fragments,paths:oldProjection.paths};
 const manual=await projectMarking(worker,p,fresh.sourcePieceId!,'front',0,0),legacyAreas=fragmentAreas(p,legacy),manualAreas=fragmentAreas(p,manual);for(const [id,value] of legacyAreas)expect(value).toBeCloseTo(manualAreas.get(id)??0,6);
 // Historical front registration could include front-facing cloth behind the
 // later middle-plane rule. Reading it must not reinterpret that old geometry.
 expect([...worldRings(p,legacy).values()].flat(2).some(point=>point[2]<36)).toBe(true);expect(placementMatchesModel({...p,markings:[legacy]},legacy)).toBe(true);
 const reinterpretation=structuredClone(legacy);reinterpretation.placement!.algorithm='anatomy-3';expect(placementMatchesModel({...p,markings:[reinterpretation]},reinterpretation)).toBe(false);
 p.markings=[legacy];const original=structuredClone(p),restored=unpack(pack(p).bytes);expect(restored.markings).toEqual(p.markings);expect(staleMarkingIds(restored).size).toBe(0);
 const repo=new Repository(':memory:');try{
  repo.open(restored,null);repo.commit({type:'project.rename',name:'Historical reviewed registration'},randomUUID(),'rename without remapping');expect(repo.snapshot()!.markings).toEqual(original.markings);repo.historyMove(false);expect(repo.snapshot()!.markings).toEqual(original.markings);repo.historyMove(true);expect(repo.snapshot()!.markings).toEqual(original.markings);
  repo.commit({type:'marking.placement.review',markingIds:[legacy.id],reviewed:false},randomUUID(),'withdraw historical review');expect(repo.snapshot()!.markings![0].placement!.algorithm).toBe(algorithm);repo.commit({type:'marking.placement.review',markingIds:[legacy.id],reviewed:true},randomUUID(),'renew historical review');expect(repo.snapshot()!.markings).toEqual(original.markings);
  repo.commit({type:'markings.lockAll',locked:true},randomUUID(),'lock historical placement');const lockedArchive=unpack(pack(repo.snapshot()!).bytes),lockedMarking=lockedArchive.markings![0];expect(lockedMarking.locked).toBe(true);expect(lockedMarking.placement).toEqual(placement);expect(lockedMarking.fragments).toEqual(legacy.fragments);repo.open(lockedArchive,null);expect(repo.snapshot()!.markings).toEqual(lockedArchive.markings);
 }finally{repo.close();}
 const locked=structuredClone(p);locked.markings![0].locked=true;const beforeLock=structuredClone(locked),lockedResult=await automaticPlacement(worker,locked,[fresh.sourcePieceId!]);expect(lockedResult.markings).toEqual([]);expect(lockedResult.skipped).toEqual([{pieceId:fresh.sourcePieceId!,name:p.patternLibrary![0].piece.name,reason:'MARKING_LOCKED'}]);expect(locked).toEqual(beforeLock);
 const renewed=await automaticPlacement(worker,p,[fresh.sourcePieceId!]);expect(renewed.markings[0].placement).toMatchObject({algorithm:'anatomy-3',reviewed:false});expect(p).toEqual(original);
},60000);

it('unrecognized general-model automatic registration still refuses an occluded target',async()=>{
 const p=project();p.pieces=[];p.surface=parseObj('v 0 0 0\nv 100 0 0\nv 100 100 0\nv 0 100 0\nv 0 0 20\nv 100 0 20\nv 100 100 20\nv 0 100 20\ng torso\nf 1 2 3\nf 1 3 4\ng arm-left\nf 5 6 7\nf 5 7 8');
 const piece=rectangle(100,100);piece.allowanceMm=0;p.patternLibrary=[{piece,referenceId:randomUUID(),view:'front',category:'body',anatomy:{part:'body',side:'center',confidence:1,method:'manual'}}];const before=structuredClone(p);
 expect(garmentAnatomy(p.surface)).toBeUndefined();const result=await automaticPlacement(worker,p,[piece.id]);expect(result.markings).toEqual([]);expect(result.skipped).toEqual([{pieceId:piece.id,name:piece.name,reason:'NO_VISIBLE_PROJECTION'}]);expect(p).toEqual(before);
});

function addClosedBadge(surface:Surface){
 const vs=[[-30,1080,350],[30,1080,350],[30,1120,350],[-30,1120,350],[-30,1080,400],[30,1080,400],[30,1120,400],[-30,1120,400]].map(([xMm,yMm,zMm])=>({id:randomUUID(),xMm,yMm,zMm}));surface.vertices.push(...vs);const ids=new Set<string>();
 for(const quad of [[4,5,6,7],[3,2,1,0],[0,1,5,4],[1,2,6,5],[2,3,7,6],[3,0,4,7]])for(const t of [[0,1,2],[0,2,3]]){const f={id:randomUUID(),region:'PatternBody',vertices:t.map(i=>vs[quad[i]].id) as [string,string,string]};surface.faces.push(f);ids.add(f.id);}return {ids,front:surface.faces[surface.faces.length-12]};
}
it('an actual manually dragged decal stays on its visible closed foreground object instead of penetrating the garment',async()=>{
 const p=projectFixture(false),badge=addClosedBadge(p.surface!),source=rectangle(20,20),position={xMm:10,yMm:1090,zMm:400},frame={origin:[0,0,0] as [number,number,number],axes:[[1,0,0],[0,1,0],[0,0,1]] as [[number,number,number],[number,number,number],[number,number,number]]};
 const original=sourceSurfaceShape(source,position,frame),shape=surfaceDragShape(original,{xMm:0,yMm:0},position,[0,0,1],undefined,badge.front.id),before=structuredClone(p),m=await surfaceMarking(worker,p,shape,source.color,'Actual drag on foreground badge');
 expect(m.placement).toBeUndefined();expect(m.fragments.length).toBeGreaterThan(0);expect(m.fragments.every(f=>badge.ids.has(f.faceId))).toBe(true);expect(p).toEqual(before);
});

it('a disconnected closed accessory cannot make registration paint through it onto the garment',async()=>{
 const p=projectFixture(false),badge=addClosedBadge(p.surface!),before=structuredClone(p),result=await automaticPlacement(worker,p,[p.patternLibrary![0].piece.id]);
 expect(result.markings).toHaveLength(1);const vertices=new Map(p.surface!.vertices.map(v=>[v.id,v])),faces=new Map(p.surface!.faces.map(f=>[f.id,f]));let hiddenGarmentArea=0;
 for(const fragment of result.markings[0].fragments){if(badge.ids.has(fragment.faceId))continue;const triangle=faces.get(fragment.faceId)!.vertices.map(id=>vertices.get(id)!);
  for(const ring of fragment.rings){const xy=ring.map(w=>[w.reduce((s,n,i)=>s+n*triangle[i].xMm,0),w.reduce((s,n,i)=>s+n*triangle[i].yMm,0)] as XY);hiddenGarmentArea+=area(clipRectangle(xy,[-30,30,1080,1120]));}
 }
 expect(hiddenGarmentArea).toBeLessThan(1e-6);expect(p).toEqual(before);
});
