import {expect,it,vi} from 'vitest';
import {randomUUID} from 'node:crypto';
import {resolve} from 'node:path';
import {spawn} from 'node:child_process';
import {automaticPlacement} from '../../apps/desktop/main/automatic-placement';
import {surfaceMarking,projectMarking,staleMarkingIds,markingIssues} from '../../apps/desktop/main/markings';
import {parseObj,unwrapSurface} from '../../apps/desktop/main/surface';
import {placementMatchesModel} from '../../packages/reference/placement-review';
import {prepareDesignSurface,visibleDesignMarkings} from '../../apps/desktop/main/design-cuts';
import {Repository} from '../../apps/desktop/main/repository';
import {pack,unpack} from '../../apps/desktop/main/archive';
import {markingSchema,type Marking,type Project} from '../../packages/schema/index';
import {project,rectangle} from '../fixtures';
import {sourceFragmentArea} from '../fixtures/detail-fabrication';

// Observe real solver processes without replacing native geometry with a mock.
vi.mock('node:child_process',async original=>{
 const native=await original<typeof import('node:child_process')>();
 return {...native,spawn:vi.fn(native.spawn)};
});

const worker=resolve('target/release/fpcad-worker.exe');
const solverStarts=()=>vi.mocked(spawn).mock.calls.length;
function expectOneClosedSolver(since:number){
 const calls=vi.mocked(spawn).mock.calls.slice(since),results=vi.mocked(spawn).mock.results.slice(since);
 expect(calls).toHaveLength(1);expect(calls[0][0]).toBe(worker);expect(calls[0][1]).toEqual(['--stream']);
 const child=results[0].value;expect(child.pid).toBeGreaterThan(0);expect(child.exitCode!==null||child.signalCode!==null).toBe(true);
}
function fixture():Project{
 const p=project(),referenceId=randomUUID();p.pieces=[];p.markings=[];
 p.surface=parseObj('v 0 0 0\nv 100 0 0\nv 100 100 0\nv 0 100 0\ng torso\nf 1 2 3\nf 1 3 4');
 p.references=[{id:referenceId,name:'Single full sheet',view:'sheet',width:100,height:100,png:'data:image/png;base64,AA==',calibration:{a:{x:0,y:100},b:{x:0,y:0},distanceMm:100},illustration:{algorithm:'illustration-2',subject:'character',bounds:{minX:0,minY:0,maxX:100,maxY:100},partBounds:[{part:'body',side:'center',bounds:{minX:0,minY:0,maxX:100,maxY:100}}],foregroundPixels:10000,discardedPixels:0,palette:['#2786b6','#ee964b'],smoothingPx:0}}];
 p.patternLibrary=[20,60].map((x,i)=>{const piece=rectangle(20,20);piece.name='Independent sheet pigment '+i;piece.color=i?'#ee964b':'#2786b6';piece.allowanceMm=0;piece.nodes.forEach(n=>{n.xMm+=x;n.yMm+=40;});return {piece,referenceId,view:'sheet',category:'body',anatomy:{part:'body',side:'center',confidence:1,method:'silhouette-1'}};});return p;
}

function projectedBounds(p:Project,m:Marking){
 const vertices=new Map(p.surface!.vertices.map(v=>[v.id,v])),faces=new Map(p.surface!.faces.map(f=>[f.id,f]));
 const points=m.fragments.flatMap(fragment=>{const triangle=faces.get(fragment.faceId)!.vertices.map(id=>vertices.get(id)!);return fragment.rings.flatMap(ring=>ring.map(w=>({x:w.reduce((sum,n,i)=>sum+n*triangle[i].xMm,0),y:w.reduce((sum,n,i)=>sum+n*triangle[i].yMm,0)})));});
 return {minX:Math.min(...points.map(p=>p.x)),maxX:Math.max(...points.map(p=>p.x)),minY:Math.min(...points.map(p=>p.y)),maxY:Math.max(...points.map(p=>p.y))};
}

it('a whole-sheet batch returns every requested pigment unreviewed and commits as one undoable operation',async()=>{
 const p=fixture(),before=structuredClone(p),ids=p.patternLibrary!.map(r=>r.piece.id),result=await automaticPlacement(worker,p,ids);
 expect(result.skipped).toEqual([]);expect(result.markings).toHaveLength(2);expect(new Set(result.markings.map(m=>m.sourcePieceId))).toEqual(new Set(ids));
 for(const m of result.markings){expect(markingSchema.parse(m)).toEqual(m);expect(m.placement).toMatchObject({part:'body',side:'center',reviewed:false,scaleX:1,scaleY:1});expect(sourceFragmentArea(p,m)).toBeCloseTo(400,6);expect(m.fragments.every(f=>p.surface!.faces.some(face=>face.id===f.faceId&&face.region==='torso'))).toBe(true);}
 expect(p).toEqual(before);const repo=new Repository(':memory:');try{repo.open(p,null);repo.commit({type:'markings.batch',markings:result.markings},randomUUID(),'whole batch');const committed=repo.snapshot()!;expect(committed.markings).toEqual(result.markings);repo.historyMove(false);expect(repo.snapshot()!.markings).toEqual([]);repo.historyMove(true);expect(repo.snapshot()!.markings).toEqual(result.markings);}finally{repo.close();}
},60000);

it('actual sheet automatic placement has current source fingerprints, requires review, and becomes stale after source reclassification',async()=>{
 const p=fixture(),run=await unwrapSurface(worker,p.surface!,p,{partitionStrategy:'design',automaticCuts:false,colorBoundaryCuts:false,method:'arap'});p.pieces=run.pieces;p.bindings=run.bindings;
 const before=structuredClone(p),result=await automaticPlacement(worker,p,p.patternLibrary!.map(r=>r.piece.id)),placed={...p,markings:result.markings};expect(result.skipped).toEqual([]);expect(result.markings.every(m=>m.paths.length>0&&placementMatchesModel(placed,m))).toBe(true);expect([...staleMarkingIds(placed)]).toEqual([]);const issues=markingIssues(placed);expect(issues.length).toBeGreaterThan(0);expect(issues.every(issue=>issue.messageKey==='AUTOMATIC_PLACEMENT_REVIEW')).toBe(true);expect(p).toEqual(before);
 const repo=new Repository(':memory:');try{repo.open(placed,null);repo.commit({type:'marking.placement.review',markingIds:result.markings.map(m=>m.id),reviewed:true},randomUUID(),'Review valid sheet placement');expect(markingIssues(repo.snapshot()!)).toEqual([]);}finally{repo.close();}
 const changed=structuredClone(placed);changed.patternLibrary![0].anatomy!.part='tail';expect(placementMatchesModel(changed,changed.markings![0])).toBe(false);expect(staleMarkingIds(changed).has(changed.markings![0].id)).toBe(true);expect(markingIssues(changed).some(issue=>issue.messageKey==='STALE_MARKING')).toBe(true);
},60000);

it('known pigments still place while unknown and unavailable anatomical parts return actionable per-source reasons',async()=>{
 const p=fixture(),unknown={...structuredClone(p.patternLibrary![0]),piece:{...rectangle(5,5),name:'Unknown source'},anatomy:undefined},missing={...structuredClone(p.patternLibrary![0]),piece:{...rectangle(5,5),name:'Missing tail'},anatomy:{part:'tail' as const,side:'center' as const,confidence:1,method:'silhouette-1' as const}};p.patternLibrary!.push(unknown,missing);
 const before=structuredClone(p),result=await automaticPlacement(worker,p,p.patternLibrary!.map(r=>r.piece.id));
 expect(result.markings).toHaveLength(2);expect(result.skipped).toEqual([{pieceId:unknown.piece.id,name:'Unknown source',reason:'ANATOMY_REQUIRED'},{pieceId:missing.piece.id,name:'Missing tail',reason:'MODEL_PART_MISSING'}]);expect(p).toEqual(before);
},60000);

it('filtering the batch to absent parts reports each unplaced source and never modifies the source project',async()=>{
 const p=fixture(),before=structuredClone(p),result=await automaticPlacement(worker,p,p.patternLibrary!.map(r=>r.piece.id),['tail']);expect(result.markings).toEqual([]);expect(result.skipped).toEqual(p.patternLibrary!.map(r=>({pieceId:r.piece.id,name:r.piece.name,reason:'ANATOMY_REQUIRED'})));expect(p).toEqual(before);
});

it.each(['duplicate','missing'] as const)('invalid %s selection fails before any native projection or state mutation',async mode=>{
 const p=fixture(),before=structuredClone(p),id=p.patternLibrary![0].piece.id;await expect(automaticPlacement(resolve('selection-validation-must-not-launch.exe'),p,mode==='duplicate'?[id,id]:[id,randomUUID()])).rejects.toThrow('INVALID_SELECTION');expect(p).toEqual(before);
});

it('a fatal batch limit after a valid first pigment leaves the complete project and repository history unchanged',async()=>{
 const p=fixture(),seed=await projectMarking(worker,p,p.patternLibrary![0].piece.id,'front',0,0);p.markings=Array.from({length:499},()=>({...seed,id:randomUUID(),source:'surface' as const,sourcePieceId:undefined}));
 const repo=new Repository(':memory:');try{repo.open(p,null);const before=repo.snapshot()!,history=repo.status(),started=solverStarts();await expect((async()=>{const result=await automaticPlacement(worker,before,before.patternLibrary!.map(r=>r.piece.id));repo.commit({type:'markings.batch',markings:result.markings},randomUUID(),'must not commit partial result');})()).rejects.toThrow('PROJECTION_LIMIT');expect(repo.snapshot()).toEqual(before);expect(repo.status()).toEqual(history);expectOneClosedSolver(started);}finally{repo.close();}
 const next=fixture(),beforeNext=structuredClone(next),startedNext=solverStarts(),result=await automaticPlacement(worker,next,next.patternLibrary!.map(r=>r.piece.id));
 expect(result.skipped).toEqual([]);expect(result.markings).toHaveLength(2);expect(next).toEqual(beforeNext);expectOneClosedSolver(startedNext);
},60000);

it('one real native solver serves all source analyses and clips in a complete batch and exits before returning',async()=>{
 const p=fixture(),before=structuredClone(p),started=solverStarts(),result=await automaticPlacement(worker,p,p.patternLibrary!.map(r=>r.piece.id));
 expect(result.skipped).toEqual([]);expect(result.markings).toHaveLength(2);for(const marking of result.markings)expect(sourceFragmentArea(p,marking)).toBeCloseTo(400,6);expect(p).toEqual(before);expectOneClosedSolver(started);
},60000);

it('every missing anatomical part is skipped without borrowing the available torso or modifying source contours',async()=>{
 const p=fixture(),template=p.patternLibrary![0],missing=(['head','ear','horn','arm','paw','leg','foot','tail'] as const).map(part=>({...structuredClone(template),piece:{...rectangle(20,20),name:'Unavailable '+part},anatomy:{part,side:'center' as const,confidence:1,method:'silhouette-1' as const}}));p.patternLibrary!.push(...missing);
 const before=structuredClone(p),result=await automaticPlacement(worker,p,p.patternLibrary!.map(r=>r.piece.id));
 expect(result.markings.map(m=>m.sourcePieceId)).toEqual(p.patternLibrary!.slice(0,2).map(r=>r.piece.id));expect(result.skipped).toEqual(missing.map(r=>({pieceId:r.piece.id,name:r.piece.name,reason:'MODEL_PART_MISSING'})));
 expect(result.markings.every(m=>m.fragments.every(f=>p.surface!.faces.find(face=>face.id===f.faceId)!.region==='torso'))).toBe(true);expect(p).toEqual(before);
},60000);

it.each(['right','unknown'] as const)('an unavailable %s arm does not attach to the only left arm',async side=>{
 const p=fixture();p.surface=parseObj('v 0 0 0\nv 100 0 0\nv 100 100 0\nv 0 100 0\nv 200 0 0\nv 250 0 0\nv 250 100 0\nv 200 100 0\ng torso\nf 1 2 3\nf 1 3 4\ng arm-left\nf 5 6 7\nf 5 7 8');
 const source={...structuredClone(p.patternLibrary![0]),piece:{...rectangle(20,20),name:'Unmatched arm'},anatomy:{part:'arm' as const,side,confidence:1,method:'silhouette-1' as const}};p.patternLibrary!.push(source);
 const before=structuredClone(p),result=await automaticPlacement(worker,p,p.patternLibrary!.map(r=>r.piece.id));
 expect(result.markings).toHaveLength(2);expect(result.skipped).toEqual([{pieceId:source.piece.id,name:source.piece.name,reason:side==='unknown'?'ANATOMY_SIDE_REQUIRED':'MODEL_PART_MISSING'}]);expect(result.markings.every(m=>m.placement!.part==='body')).toBe(true);expect(p).toEqual(before);
},60000);

it('a nearby source outside its measured body frame is skipped instead of translating one pigment away from its group',async()=>{
 const p=fixture(),piece=rectangle(6,8);piece.allowanceMm=0;piece.name='Outside measured body';piece.nodes.forEach(n=>{n.xMm+=108;n.yMm+=46;});const source={...structuredClone(p.patternLibrary![0]),piece};p.patternLibrary!.push(source);
 const before=structuredClone(p),result=await automaticPlacement(worker,p,p.patternLibrary!.map(r=>r.piece.id));
 expect(result.markings).toHaveLength(2);expect(result.skipped).toEqual([{pieceId:piece.id,name:piece.name,reason:'NO_VISIBLE_PROJECTION'}]);expect(result.markings.every(m=>m.offsetXmm===0&&m.offsetYmm===0)).toBe(true);expect(p).toEqual(before);
},60000);

it('different-sized figures on one original sheet keep independent part scales and preserve relative pigment sizes and positions',async()=>{
 const p=fixture(),reference=p.references![0];reference.width=500;reference.height=500;reference.calibration={a:{x:0,y:500},b:{x:0,y:0},distanceMm:500};
 reference.illustration={algorithm:'illustration-2',subject:'character',bounds:{minX:0,minY:0,maxX:400,maxY:200},figures:[{sourceGroup:0,bounds:{minX:0,minY:0,maxX:100,maxY:100},normalZ:1},{sourceGroup:1,bounds:{minX:200,minY:0,maxX:400,maxY:200},normalZ:1}],partBounds:[{sourceGroup:0,part:'body',side:'center',bounds:{minX:0,minY:0,maxX:100,maxY:100}},{sourceGroup:1,part:'body',side:'center',bounds:{minX:200,minY:0,maxX:400,maxY:200}}],foregroundPixels:50000,discardedPixels:0,palette:['#2786b6','#ee964b'],smoothingPx:0};
 p.patternLibrary=[0,1].flatMap(sourceGroup=>[0,1].map(index=>{
  const factor=sourceGroup+1,size=(index?10:20)*factor,x=(sourceGroup?200:0)+(index?70:20)*factor,y=500-(index?30:60)*factor,piece=rectangle(size,size);piece.allowanceMm=0;piece.name='Figure '+sourceGroup+' pigment '+index;piece.color=index?'#ee964b':'#2786b6';piece.nodes.forEach(n=>{n.xMm+=x;n.yMm+=y;});
  return {piece,referenceId:reference.id,sourceGroup,view:'sheet' as const,category:'body',anatomy:{part:'body' as const,side:'center' as const,confidence:1,method:'silhouette-1' as const}};
 }));
 const before=structuredClone(p),result=await automaticPlacement(worker,p,p.patternLibrary.map(r=>r.piece.id));expect(result.skipped).toEqual([]);expect(result.markings).toHaveLength(4);
 for(let index=0;index<result.markings.length;index++){
  const marking=result.markings[index],group=Math.floor(index/2),small=index%2===1;expect(marking.placement).toMatchObject({part:'body',side:'center',scaleX:group?0.5:1,scaleY:group?0.5:1,sourceCenter:group?{xMm:300,yMm:400}:{xMm:50,yMm:450},targetCenter:{xMm:50,yMm:50},reviewed:false});
  expect(sourceFragmentArea(p,marking)).toBeCloseTo(small?100:400,6);const box=projectedBounds(p,marking);expect(box.minX).toBeCloseTo(small?70:20,6);expect(box.maxX).toBeCloseTo(small?80:40,6);expect(box.minY).toBeCloseTo(small?70:40,6);expect(box.maxY).toBeCloseTo(small?80:60,6);expect(marking.offsetXmm).toBe(0);expect(marking.offsetYmm).toBe(0);
 }
 expect(result.markings[0].placement!.sourceGroupHash).not.toBe(result.markings[2].placement!.sourceGroupHash);expect(p).toEqual(before);
},60000);

it('invalid source geometry is isolated while the next valid source still completes with the real shared solver',async()=>{
 const p=fixture(),bad=p.patternLibrary![0].piece;bad.nodes=[[20,40],[40,60],[20,60],[40,40]].map(([xMm,yMm])=>({id:randomUUID(),xMm,yMm}));
 const before=structuredClone(p),started=solverStarts(),result=await automaticPlacement(worker,p,p.patternLibrary!.map(r=>r.piece.id));
 expect(result.skipped).toEqual([{pieceId:bad.id,name:bad.name,reason:'INVALID_GEOMETRY'}]);expect(result.markings).toHaveLength(1);expect(result.markings[0].sourcePieceId).toBe(p.patternLibrary![1].piece.id);expect(sourceFragmentArea(p,result.markings[0])).toBeCloseTo(400,6);expect(p).toEqual(before);expectOneClosedSolver(started);
},60000);

it('direct surface detail retains its native projected area and archive role while creating no fabric material subdivision',async()=>{
 const p=fixture();p.references=[];p.patternLibrary=[];const before=structuredClone(p),shape:NonNullable<Marking['surfaceShape']>={nodes:[{xMm:30,yMm:30},{xMm:70,yMm:30},{xMm:70,yMm:70},{xMm:30,yMm:70}],origin:[0,0,0],axes:[[1,0,0],[0,1,0],[0,0,1]]};
 const detail=await surfaceMarking(worker,p,shape,'#080608','Direct surface eye detail','detail');expect(detail.fabrication).toBe('detail');expect(sourceFragmentArea(p,detail)).toBeCloseTo(1600,6);expect(p).toEqual(before);
 const withDetail={...p,markings:[detail]};expect(unpack(pack(withDetail).bytes).markings![0].fabrication).toBe('detail');expect(await visibleDesignMarkings(worker,withDetail)).toEqual([]);const detailMesh=await prepareDesignSurface(worker,withDetail,true);expect(detailMesh.materialDomains).toBe(1);expect(new Set([...detailMesh.provenance.values()].map(row=>row.color))).toEqual(new Set(['#eceae5']));
 const sewn={...withDetail,markings:[{...detail,fabrication:'sewn' as const}]};expect((await visibleDesignMarkings(worker,sewn)).map(m=>m.color)).toEqual(['#080608']);const sewnMesh=await prepareDesignSurface(worker,sewn,true);expect(sewnMesh.materialDomains).toBe(2);expect(new Set([...sewnMesh.provenance.values()].map(row=>row.color))).toEqual(new Set(['#eceae5','#080608']));
},60000);
