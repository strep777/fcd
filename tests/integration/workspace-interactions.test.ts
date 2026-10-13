import {it,expect} from 'vitest';
import {randomUUID} from 'node:crypto';
import {Repository} from '../../apps/desktop/main/repository';
import {rectangle} from '../fixtures';
import {commandSchema} from '../../packages/schema/index';
import {referenceScene} from '../../apps/desktop/src/modules/reference-scene';

it('deletes a selection as one undoable operation and rejects stale batches atomically',()=>{
 const repo=new Repository(':memory:');repo.create('bulk');const a=rectangle(),b=rectangle();
 repo.commit({type:'library.regions',regions:[a,b].map(piece=>({piece,referenceId:randomUUID(),view:'front',category:'test'})),replaceViews:[]},randomUUID(),'setup');
 repo.commit({type:'reference.candidate',run:{referenceId:randomUUID(),sourceHash:'a'.repeat(64),piece:a,pixelCount:100,proxyWidth:10,proxyHeight:10,accepted:true}},randomUUID(),'accepted preview');
 const before=repo.snapshot();expect(()=>repo.commit({type:'library.regions.delete',pieceIds:[a.id,randomUUID()]},randomUUID(),'bad')).toThrow('ENTITY_MISSING');expect(repo.snapshot()).toEqual(before);
 expect(commandSchema.safeParse({type:'library.regions.delete',pieceIds:[]}).success).toBe(false);expect(commandSchema.safeParse({type:'library.regions.delete',pieceIds:[a.id,a.id]}).success).toBe(false);
 repo.commit({type:'library.regions.delete',pieceIds:[a.id,b.id]},randomUUID(),'delete');expect(repo.snapshot()!.patternLibrary).toEqual([]);expect(repo.snapshot()!.referenceRun).toBeUndefined();expect(repo.snapshot()!.revision).toBe(before!.revision+1);
 repo.historyMove(false);expect(repo.snapshot()!.patternLibrary?.map(r=>r.piece.id)).toEqual([a.id,b.id]);repo.close();
});
it('uses the combined original dimensions and exact crop offsets',()=>{
 const sheet={id:randomUUID(),width:1275,height:750,png:'data:image/png;base64,AAAA'},base={id:randomUUID(),name:'source',width:600,height:750,png:'data:image/png;base64,AAAA',view:'front' as const};
 const scene=referenceScene([{...base,sheet:{...sheet,x:675,y:0}},{...base,id:randomUUID(),view:'back',sheet:{...sheet,x:0,y:0}}]);expect(scene.width).toBe(1275);expect(scene.height).toBe(750);expect(scene.png).toBe(sheet.png);expect(scene.frames.map(f=>f.x)).toEqual([675,0]);
});

it('preserves fine color regions at original resolution beyond the proxy limit',async()=>{
 const {segmentPixels}=await import('../../apps/desktop/main/reference-segmentation');
 const width=1200,height=700,rgba=new Uint8Array(width*height*4).fill(255);
 for(let y=301;y<305;y++)for(let x=800;x<830;x++)rgba.set([20,100,180,255],(y*width+x)*4);
 const c={a:{x:0,y:700},b:{x:0,y:0},distanceMm:700};
 const result=segmentPixels(width,height,rgba,{x:815,y:302},0,c,width,height,false,true);
 expect(result.pixelCount).toBe(120);expect(result.mask.width).toBe(width);expect(result.mask.height).toBe(height);
 expect(()=>segmentPixels(width,height,rgba,{x:width,y:302},0,c,width,height,false,true)).toThrow('INVALID_SEED');
});

it('recalibrates accepted source coordinates without moving their original pixel boundary and undo restores them',()=>{
 const repo=new Repository(':memory:');repo.create('calibrate');const id=randomUUID(),piece=rectangle(20,30),calibration={a:{x:0,y:100},b:{x:0,y:0},distanceMm:100};
 repo.commit({type:'library.regions',regions:[{piece,referenceId:id,view:'front',category:'test'}],references:[{id,name:'original',view:'front',width:100,height:100,png:'data:image/png;base64,AAAA',calibration}],replaceViews:[]},randomUUID(),'setup');
 const before=repo.snapshot();repo.commit({type:'reference.calibrate',referenceId:id,calibration:{a:{x:10,y:90},b:{x:60,y:90},distanceMm:100}},randomUUID(),'calibrate');
 const updated=repo.snapshot()!.patternLibrary![0].piece;
 updated.nodes.forEach((n,i)=>{expect(n.xMm).toBeCloseTo(20-2*piece.nodes[i].yMm);expect(n.yMm).toBeCloseTo(2*piece.nodes[i].xMm-20);});
 repo.historyMove(false);expect(repo.snapshot()!.patternLibrary).toEqual(before!.patternLibrary);repo.close();
});

it('rejects bulk deletion and recalibration atomically when any dependent placement is locked',()=>{
 const repo=new Repository(':memory:');repo.create('locked');const id=randomUUID(),a=rectangle(),b=rectangle(),calibration={a:{x:0,y:100},b:{x:0,y:0},distanceMm:100};
 repo.commit({type:'library.regions',regions:[a,b].map(piece=>({piece,referenceId:id,view:'front',category:'test'})),references:[{id,name:'original',view:'front',width:100,height:100,png:'data:image/png;base64,AAAA',calibration}],replaceViews:[]},randomUUID(),'setup');
 const p=repo.snapshot()!;p.markings=[{id:randomUUID(),name:'locked source',color:'#000000',source:'reference',sourcePieceId:b.id,sourceHash:'test',surfaceId:randomUUID(),surfaceHash:'test',topologyVersion:1,view:'front',offsetXmm:0,offsetYmm:0,locked:true,fragments:[],paths:[]}];repo.open(p,null);
 const before=repo.snapshot(),status=repo.status();
 expect(()=>repo.commit({type:'library.regions.delete',pieceIds:[a.id,b.id]},randomUUID(),'delete')).toThrow('MARKING_LOCKED');
 expect(()=>repo.commit({type:'reference.calibrate',referenceId:id,calibration:{...calibration,distanceMm:200}},randomUUID(),'calibrate')).toThrow('MARKING_LOCKED');
 expect(repo.snapshot()).toEqual(before);expect(repo.status()).toEqual(status);repo.close();
});
