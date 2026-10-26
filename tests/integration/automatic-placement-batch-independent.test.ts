import {expect,it} from 'vitest';
import {randomUUID} from 'node:crypto';
import {resolve} from 'node:path';
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

const worker=resolve('target/release/fpcad-worker.exe');
function fixture():Project{
 const p=project(),referenceId=randomUUID();p.pieces=[];p.markings=[];
 p.surface=parseObj('v 0 0 0\nv 100 0 0\nv 100 100 0\nv 0 100 0\ng torso\nf 1 2 3\nf 1 3 4');
 p.references=[{id:referenceId,name:'Single full sheet',view:'sheet',width:100,height:100,png:'data:image/png;base64,AA==',calibration:{a:{x:0,y:100},b:{x:0,y:0},distanceMm:100},illustration:{algorithm:'illustration-2',subject:'character',bounds:{minX:0,minY:0,maxX:100,maxY:100},partBounds:[{part:'body',side:'center',bounds:{minX:0,minY:0,maxX:100,maxY:100}}],foregroundPixels:10000,discardedPixels:0,palette:['#2786b6','#ee964b'],smoothingPx:0}}];
 p.patternLibrary=[20,60].map((x,i)=>{const piece=rectangle(20,20);piece.name='Independent sheet pigment '+i;piece.color=i?'#ee964b':'#2786b6';piece.allowanceMm=0;piece.nodes.forEach(n=>{n.xMm+=x;n.yMm+=40;});return {piece,referenceId,view:'sheet',category:'body',anatomy:{part:'body',side:'center',confidence:1,method:'silhouette-1'}};});return p;
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
 const repo=new Repository(':memory:');try{repo.open(p,null);const before=repo.snapshot()!,history=repo.status();await expect((async()=>{const result=await automaticPlacement(worker,before,before.patternLibrary!.map(r=>r.piece.id));repo.commit({type:'markings.batch',markings:result.markings},randomUUID(),'must not commit partial result');})()).rejects.toThrow('PROJECTION_LIMIT');expect(repo.snapshot()).toEqual(before);expect(repo.status()).toEqual(history);}finally{repo.close();}
},60000);

it('direct surface detail retains its native projected area and archive role while creating no fabric material subdivision',async()=>{
 const p=fixture();p.references=[];p.patternLibrary=[];const before=structuredClone(p),shape:NonNullable<Marking['surfaceShape']>={nodes:[{xMm:30,yMm:30},{xMm:70,yMm:30},{xMm:70,yMm:70},{xMm:30,yMm:70}],origin:[0,0,0],axes:[[1,0,0],[0,1,0],[0,0,1]]};
 const detail=await surfaceMarking(worker,p,shape,'#080608','Direct surface eye detail','detail');expect(detail.fabrication).toBe('detail');expect(sourceFragmentArea(p,detail)).toBeCloseTo(1600,6);expect(p).toEqual(before);
 const withDetail={...p,markings:[detail]};expect(unpack(pack(withDetail).bytes).markings![0].fabrication).toBe('detail');expect(await visibleDesignMarkings(worker,withDetail)).toEqual([]);const detailMesh=await prepareDesignSurface(worker,withDetail,true);expect(detailMesh.materialDomains).toBe(1);expect(new Set([...detailMesh.provenance.values()].map(row=>row.color))).toEqual(new Set(['#eceae5']));
 const sewn={...withDetail,markings:[{...detail,fabrication:'sewn' as const}]};expect((await visibleDesignMarkings(worker,sewn)).map(m=>m.color)).toEqual(['#080608']);const sewnMesh=await prepareDesignSurface(worker,sewn,true);expect(sewnMesh.materialDomains).toBe(2);expect(new Set([...sewnMesh.provenance.values()].map(row=>row.color))).toEqual(new Set(['#eceae5','#080608']));
},60000);
