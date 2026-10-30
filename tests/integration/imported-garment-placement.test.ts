import {expect,it} from 'vitest';
import {randomUUID} from 'node:crypto';
import {resolve} from 'node:path';
import {project,rectangle} from '../fixtures';
import {importedGarment} from '../fixtures/imported-garment';
import {automaticPlacement} from '../../apps/desktop/main/automatic-placement';
import {surfaceMarking,markingIssues,projectReferenceGeometry} from '../../apps/desktop/main/markings';
import {withWorkerSession} from '../../apps/desktop/main/worker';
import {modelParts} from '../../apps/desktop/main/anatomical-placement';
import {Repository} from '../../apps/desktop/main/repository';
import {placementMatchesModel} from '../../packages/reference/placement-review';
import {placementRegion,garmentAnatomy} from '../../packages/surface/garment-anatomy';
import {markingSchema,type Project,type Marking} from '../../packages/schema/index';

const worker=resolve('target/release/fpcad-worker.exe');
const hipY=815.25,shoulderX=260;
function decodedFragments(p:Project,m:Pick<Marking,'fragments'>){
 const faces=new Map(p.surface!.faces.map(f=>[f.id,f])),vertices=new Map(p.surface!.vertices.map(v=>[v.id,v]));
 return m.fragments.map(fragment=>({face:faces.get(fragment.faceId)!,rings:fragment.rings.map(r=>r.map(w=>({x:w.reduce((s,n,i)=>s+n*vertices.get(faces.get(fragment.faceId)!.vertices[i])!.xMm,0),y:w.reduce((s,n,i)=>s+n*vertices.get(faces.get(fragment.faceId)!.vertices[i])!.yMm,0)})))}));
}
function assertPhysicalPart(points:{x:number;y:number}[],part:string,side:string){
 for(const p of points){
  if(part==='leg')expect(p.y).toBeLessThanOrEqual(hipY+1e-6);else expect(p.y).toBeGreaterThanOrEqual(hipY-1e-6);
  if(part==='body')expect(Math.abs(p.x)).toBeLessThanOrEqual(shoulderX+1e-6);
  if(part==='arm'&&side==='left')expect(p.x).toBeGreaterThanOrEqual(shoulderX-1e-6);
  if(part==='arm'&&side==='right')expect(p.x).toBeLessThanOrEqual(-shoulderX+1e-6);
  if(part==='leg'&&side==='left')expect(p.x).toBeGreaterThanOrEqual(-1e-6);
  if(part==='leg'&&side==='right')expect(p.x).toBeLessThanOrEqual(1e-6);
 }
}
function fixture():Project{
 const p=project();p.pieces=[];p.markings=[];p.surface=importedGarment();
 p.patternLibrary=([['body','center',0,1150,120,220],['arm','left',450,1050,140,90],['arm','right',-450,1050,140,90],['leg','left',180,400,90,180],['leg','right',-180,400,90,180],['head','center',0,1700,100,100],['tail','center',0,300,100,150]] as const).map(([part,side,x,y,width,height])=>{
  const piece=rectangle(width,height);piece.allowanceMm=0;piece.name=part+' '+side;piece.nodes.forEach(n=>{n.xMm+=x-width/2;n.yMm+=y-height/2;});
  return {piece,referenceId:randomUUID(),view:'front',category:part,anatomy:{part,side,confidence:1,method:'manual'}};
 });return p;
}

it('recognizes five physical openings without changing imported geometry or adding cut constraints',()=>{
 const p=fixture(),before=structuredClone(p),parts=modelParts(p);
 expect(parts.map(p=>p.part+':'+p.side).sort()).toEqual(['arm:left','arm:right','body:center','leg:left','leg:right']);
 expect(garmentAnatomy(p.surface!)).toBeDefined();expect(p).toEqual(before);
 expect(new Set(p.surface!.faces.map(f=>f.region))).toEqual(new Set(['PatternBody']));expect(p.surface!.cutConstraints).toBeUndefined();
 const ambiguous=structuredClone(p.surface!);ambiguous.partAssignments=[{region:'PatternBody',part:'unknown',side:'unknown'}];
 expect(garmentAnatomy(ambiguous)).toBeUndefined();
});

it('places each available limb on its own character side and reports missing head and tail without mutation',async()=>{
 const p=fixture(),before=structuredClone(p),result=await automaticPlacement(worker,p,p.patternLibrary!.map(r=>r.piece.id));
 expect(result.markings).toHaveLength(5);expect(result.skipped).toEqual(p.patternLibrary!.slice(5).map(r=>({pieceId:r.piece.id,name:r.piece.name,reason:'MODEL_PART_MISSING'})));
 const faces=new Map(p.surface!.faces.map(f=>[f.id,f])),vertices=new Map(p.surface!.vertices.map(v=>[v.id,v]));
 for(const m of result.markings){
  expect(markingSchema.parse(m)).toEqual(m);expect(m.fragments.length).toBeGreaterThan(0);expect(m.placement!.reviewed).toBe(false);expect(placementMatchesModel({...p,markings:result.markings},m)).toBe(true);
  assertPhysicalPart(decodedFragments(p,m).flatMap(f=>f.rings.flat()),m.placement!.part,m.placement!.side);
  if(m.placement!.side!=='center'){
   const xs=m.fragments.flatMap(fragment=>fragment.rings.flatMap(r=>r.map(w=>w.reduce((sum,n,i)=>sum+n*vertices.get(faces.get(fragment.faceId)!.vertices[i])!.xMm,0))));
   if(m.placement!.side==='left')expect(Math.min(...xs)).toBeGreaterThan(0);else expect(Math.max(...xs)).toBeLessThan(0);
  }
 }
 expect(p).toEqual(before);
 const repo=new Repository(':memory:');try{
  repo.open(p,null);repo.commit({type:'markings.batch',markings:result.markings},randomUUID(),'imported garment placement');
  expect(markingIssues(repo.snapshot()!).every(i=>i.messageKey==='AUTOMATIC_PLACEMENT_REVIEW')).toBe(true);
  repo.commit({type:'marking.placement.review',markingIds:result.markings.map(m=>m.id),reviewed:true},randomUUID(),'review imported garment');
  expect(markingIssues(repo.snapshot()!)).toEqual([]);repo.historyMove(false);expect(repo.snapshot()!.markings!.every(m=>!m.placement!.reviewed)).toBe(true);repo.historyMove(true);expect(markingIssues(repo.snapshot()!)).toEqual([]);
 }finally{repo.close();}
},60000);

it('physical shoulder and hip boundaries retain area and location after diagonal flips and subdivision',async()=>{
 const regions=[{part:'body',side:'center',area:371375,bounds:[-260,260,815.25,1550]},{part:'arm',side:'left',area:88000,bounds:[260,700,950,1150]},{part:'arm',side:'right',area:88000,bounds:[-700,-260,950,1150]},{part:'leg',side:'left',area:100812.5,bounds:[0,250,100,815.25]},{part:'leg',side:'right',area:100812.5,bounds:[-250,0,100,815.25]}] as const;
 const outputs:number[][]=[];
 await withWorkerSession(worker,async()=>{
  for(const options of [{},{reverseDiagonal:true},{subdivisions:2},{reverseDiagonal:true,subdivisions:2}]){
   const p=fixture();p.surface=importedGarment('PatternBody',options);const source=rectangle(2000,2000);source.allowanceMm=0;source.nodes.forEach(n=>n.xMm-=1000);p.patternLibrary=[{piece:source,referenceId:randomUUID(),view:'front',category:'independent physical footprint'}];const before=structuredClone(p),areas:number[]=[],faceDomains=new Map<string,Set<string>>();
   for(const domain of regions){
    const region='garment:'+domain.part+(domain.side==='center'?'':'-'+domain.side),placement:NonNullable<Marking['placement']>={algorithm:'anatomy-2',rotationRad:0,sourceGroupHash:'0'.repeat(64),part:domain.part,side:domain.side,modelSide:domain.side,regions:[region],scaleX:1,scaleY:1,sourceCenter:{xMm:0,yMm:0},targetCenter:{xMm:0,yMm:0},reviewed:false};
    const result=await projectReferenceGeometry(worker,p,source.id,'front',0,0,placement),decoded=decodedFragments(p,result),points=decoded.flatMap(f=>f.rings.flat());assertPhysicalPart(points,domain.part,domain.side);
    const area=decoded.reduce((s,f)=>s+f.rings.reduce((n,r)=>n+r.reduce((a,p,i)=>{const q=r[(i+1)%r.length];return a+(p.x-r[0].x)*(q.y-r[0].y)-(q.x-r[0].x)*(p.y-r[0].y);},0)/2,0),0);
    expect(area).toBeCloseTo(domain.area,5);areas.push(area);const actual=[Math.min(...points.map(p=>p.x)),Math.max(...points.map(p=>p.x)),Math.min(...points.map(p=>p.y)),Math.max(...points.map(p=>p.y))];actual.forEach((n,i)=>expect(n).toBeCloseTo(domain.bounds[i],6));
    for(const fragment of result.fragments){const labels=faceDomains.get(fragment.faceId)??new Set<string>();labels.add(region);faceDomains.set(fragment.faceId,labels);}
   }
   // The same original triangle genuinely contributes to both sides; selecting
   // it only by centroid would omit one contribution or spill into the other.
   expect([...faceDomains.values()].some(domains=>domains.size>1)).toBe(true);
   expect(p).toEqual(before);outputs.push(areas);
  }
 });for(const areas of outputs)areas.forEach((area,i)=>expect(area).toBeCloseTo(outputs[0][i],6));
},120000);

it('automatic fitting and review retain the same physical pigment after diagonal flips and refinement',async()=>{
 const source=fixture(),variants=[{},{reverseDiagonal:true},{subdivisions:2},{reverseDiagonal:true,subdivisions:2}],runs:Map<string,number[]>[]=[];
 for(const options of variants){
  const p=structuredClone(source);p.surface=importedGarment('PatternBody',options);const before=structuredClone(p),result=await automaticPlacement(worker,p,p.patternLibrary!.map(r=>r.piece.id));
  expect(result.markings).toHaveLength(5);expect(result.skipped.map(s=>s.reason)).toEqual(['MODEL_PART_MISSING','MODEL_PART_MISSING']);
  const measured=new Map<string,number[]>();for(const m of result.markings){const placed=m.placement!,rings=decodedFragments(p,m).flatMap(f=>f.rings),points=rings.flat();assertPhysicalPart(points,placed.part,placed.side);
   expect(placementMatchesModel({...p,markings:result.markings},m)).toBe(true);
   const area=rings.reduce((s,r)=>s+r.reduce((a,p,i)=>{const q=r[(i+1)%r.length];return a+(p.x-r[0].x)*(q.y-r[0].y)-(q.x-r[0].x)*(p.y-r[0].y);},0)/2,0);
   measured.set(placed.part+':'+placed.side,[placed.scaleX,placed.scaleY,placed.rotationRad??0,placed.targetCenter.xMm,placed.targetCenter.yMm,area,Math.min(...points.map(p=>p.x)),Math.max(...points.map(p=>p.x)),Math.min(...points.map(p=>p.y)),Math.max(...points.map(p=>p.y))]);
  }expect(p).toEqual(before);runs.push(measured);
 }
 for(const run of runs)for(const [key,values] of run)values.forEach((value,i)=>expect(value,key+' physical measurement '+i).toBeCloseTo(runs[0].get(key)![i],6));
},120000);

it('reviews valid cross-boundary fragments and rejects a real hip spill despite its body-labelled centroid',async()=>{
 const p=fixture(),piece=rectangle(520,734.75);piece.allowanceMm=0;piece.nodes.forEach(n=>{n.xMm-=260;n.yMm+=815.25;});
 p.patternLibrary=[{piece,referenceId:randomUUID(),view:'front',category:'body',anatomy:{part:'body',side:'center',confidence:1,method:'manual'}}];
 const result=await automaticPlacement(worker,p,[piece.id]);expect(result.skipped).toEqual([]);expect(result.markings).toHaveLength(1);const m=result.markings[0],decoded=decodedFragments(p,m);
 expect(decoded.some(f=>placementRegion(p.surface!,f.face)!=='garment:body')).toBe(true);expect(placementMatchesModel({...p,markings:[m]},m)).toBe(true);
 const byId=new Map(p.surface!.vertices.map(v=>[v.id,v]));const crossing=decoded.find(f=>placementRegion(p.surface!,f.face)==='garment:body'&&f.face.vertices.some(id=>byId.get(id)!.yMm<hipY));expect(crossing).toBeDefined();
 const forged=structuredClone(m);forged.fragments.find(f=>f.faceId===crossing!.face.id)!.rings=[[[1,0,0],[0,1,0],[0,0,1]]];
 expect(placementMatchesModel({...p,markings:[forged]},forged)).toBe(false);
 const repo=new Repository(':memory:');try{
  repo.open({...p,markings:[m]},null);repo.commit({type:'marking.placement.review',markingIds:[m.id],reviewed:true},randomUUID(),'review physical cross-boundary pigment');expect(markingIssues(repo.snapshot()!)).toEqual([]);repo.historyMove(false);expect(repo.snapshot()!.markings![0].placement!.reviewed).toBe(false);repo.historyMove(true);expect(repo.snapshot()!.markings![0].placement!.reviewed).toBe(true);
  repo.open({...p,markings:[forged]},null);const before=repo.snapshot(),history=repo.status();expect(()=>repo.commit({type:'marking.placement.review',markingIds:[m.id],reviewed:true},randomUUID(),'reject body-labelled spill')).toThrow('STALE_PLACEMENT');expect(repo.snapshot()).toEqual(before);expect(repo.status()).toEqual(history);
 }finally{repo.close();}
},60000);

it('manual surface attachment accepts an arbitrary imported region without automatic anatomical requirements',async()=>{
 const p=fixture();p.surface=importedGarment('user_group_42');p.surface.partAssignments=[{region:'user_group_42',part:'unknown',side:'unknown'}];
 const before=structuredClone(p),shape={origin:[0,1200,100] as [number,number,number],axes:[[1,0,0],[0,1,0],[0,0,1]] as [[number,number,number],[number,number,number],[number,number,number]],nodes:[{xMm:-30,yMm:-40},{xMm:30,yMm:-40},{xMm:30,yMm:40},{xMm:-30,yMm:40}]};
 const m=await surfaceMarking(worker,p,shape,'#2786b6','Manual imported decal');expect(m.fragments.length).toBeGreaterThan(0);expect(m.placement).toBeUndefined();expect(m.surfaceShape).toEqual(shape);expect(p).toEqual(before);
},60000);
