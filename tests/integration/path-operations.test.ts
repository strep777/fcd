import {it,expect} from 'vitest';
import {randomUUID} from 'node:crypto';
import {project,rectangle} from '../fixtures';
import {Repository,hash} from '../../apps/desktop/main/repository';
import {splitProjectEdge} from '../../apps/desktop/main/topology-edit';
import {trimPath,joinPaths,reversePath} from '../../packages/pattern/path-operations';
import {piecePath} from '../../packages/pattern/edit';
import {seamReports} from '../../apps/desktop/main/seams';
import {analyze} from '../../apps/desktop/main/worker';
import {resolve} from 'node:path';
import {referenceWorldMatrix} from '../../packages/reference/alignment';
import {cameraProject,perspectiveWeights} from '../../packages/surface/camera';
const worker=resolve('target/release/fpcad-worker.exe');
it('exact subdivision remaps reversed seam intervals, ease and tolerance atomically and supports undo',async()=>{
 const p=project(),a=p.pieces[0],b=rectangle();p.pieces.push(b);p.seams=[{id:randomUUID(),name:'paired',a:{pieceId:a.id,nodeId:a.nodes[0].id,endNodeId:a.nodes[1].id,start:.1,end:.9,reverse:false},b:{pieceId:b.id,nodeId:b.nodes[0].id,endNodeId:b.nodes[1].id,start:.1,end:.9,reverse:true},expectedEaseMm:0,toleranceMm:1,locked:true}];const r=new Repository(':memory:');r.open(p,null);r.commit({type:'piece.split',pieceId:a.id,nodeId:a.nodes[0].id,t:.3},randomUUID(),'split');const after=r.snapshot()!;expect(after.seams).toHaveLength(2);expect(after.seams![0].b.start).toBeCloseTo(.7,12);expect(after.seams![0].b).toMatchObject({end:.9,reverse:true});expect(seamReports(after,await analyze(worker,after)).every(s=>s.status==='valid')).toBe(true);r.historyMove(false,randomUUID(),'undo');expect(r.snapshot()!.seams).toEqual(p.seams);r.db.close();
});
it('subdivision updates only matching geometry provenance, preserving already stale bindings',()=>{
 const p=project(),a=p.pieces[0],h=hash(JSON.stringify({nodes:a.nodes,holes:[],curves:[]}));p.markings=[{id:randomUUID(),name:'mark',color:'#ffffff',source:'manual',sourcePieceId:a.id,sourceHash:h,surfaceId:randomUUID(),surfaceHash:'x',topologyVersion:1,view:'front',offsetXmm:0,offsetYmm:0,fragments:[],paths:[{pieceId:a.id,geometryHash:h,rings:[]}]}];const after=splitProjectEdge(p,a.id,a.nodes[0].id,.5);expect(after.markings![0].sourceHash).not.toBe(h);expect(after.markings![0].paths[0].geometryHash).toBe(after.markings![0].sourceHash);
});
it('trim leaves an open path, joining reversed paths preserves handles, notch stations and metadata',()=>{
 const a=rectangle(),open=trimPath(a,a.nodes[0].id,a.nodes[2].id);expect(open.closed).toBe(false);expect(piecePath(open)).not.toContain('Z');const b=rectangle();b.closed=false;b.nodes=[{...b.nodes[0],xMm:100,yMm:200},{...b.nodes[1],xMm:100,yMm:300},{...b.nodes[2],xMm:0,yMm:300}];b.notches=[{id:randomUUID(),nodeId:b.nodes[0].id,position:.2,depthMm:3,label:'test'}];const joined=joinPaths(open,b);expect(joined.nodes).toHaveLength(5);expect(joined.notches![0].nodeId).toBe(open.nodes[2].id);expect(reversePath(b).notches![0].position).toBe(.8);expect(()=>joinPaths(open,{...b,material:'other'})).toThrow('PATH_METADATA_MISMATCH');
});
it('trim cannot silently delete a seam dependency',()=>{
 const p=project(),a=p.pieces[0],b=rectangle();p.pieces.push(b);p.seams=[{id:randomUUID(),name:'keep',a:{pieceId:a.id,nodeId:a.nodes[2].id,endNodeId:a.nodes[3].id,start:0,end:1,reverse:false},b:{pieceId:b.id,nodeId:b.nodes[0].id,endNodeId:b.nodes[1].id,start:0,end:1,reverse:false},expectedEaseMm:0,toleranceMm:1,locked:false}];const r=new Repository(':memory:');r.open(p,null);expect(()=>r.commit({type:'piece.trim',pieceId:a.id,startId:a.nodes[0].id,endId:a.nodes[2].id},randomUUID(),'trim')).toThrow('SEAM_DEPENDENCY');expect(r.snapshot()).toEqual(p);r.db.close();
});
it('perspective barycentric picking recovers the actual triangle position, and calibrated dual views share origin',()=>{
 const pts=[[0,0,0],[100,0,200],[0,100,-100]],camera=pts.map(([x,y,z])=>cameraProject(x,y,z,1,true,1000)),actual=[.2,.3,.5] as [number,number,number],screen=actual.map((w,i)=>w/camera[i].inverseDepth),sum=screen.reduce((s,v)=>s+v,0),recovered=perspectiveWeights(screen.map(v=>v/sum) as [number,number,number],camera.map(p=>p.inverseDepth));expect(recovered[1]).toBeCloseTo(.3,12);
 const ref={id:randomUUID(),name:'test',view:'front' as const,width:100,height:200,png:'data:image/png;base64,YQ==',calibration:{a:{x:50,y:200},b:{x:50,y:0},distanceMm:1800}},m=referenceWorldMatrix(ref);expect(m[0]*50+m[2]*200+m[4]).toBe(0);expect(m[1]*50+m[3]*200+m[5]).toBe(0);expect(m[1]*50+m[5]).toBe(-1800);expect(referenceWorldMatrix({...ref,view:'back'})[0]).toBe(-m[0]);
});

it('paired seam notches follow reverse arc intervals and regenerate without deleting manual notches',async()=>{const {pairedNotches}=await import('../../apps/desktop/main/seam-notches'),p=project(),a=p.pieces[0],b=rectangle();p.pieces.push(b);const seam={id:randomUUID(),name:'Pair',a:{pieceId:a.id,nodeId:a.nodes[0].id,endNodeId:a.nodes[1].id,start:0,end:1,reverse:false},b:{pieceId:b.id,nodeId:b.nodes[0].id,endNodeId:b.nodes[1].id,start:0,end:1,reverse:true},expectedEaseMm:0,toleranceMm:1,locked:false};p.seams=[seam];a.notches=[{id:randomUUID(),nodeId:a.nodes[0].id,position:.1,depthMm:3,label:'manual'}];const pieces=pairedNotches(p,seam.id,3,3);expect(pieces[0].notches!.map(n=>n.position)).toEqual([.1,.25,.5,.75]);expect(pieces[1].notches!.map(n=>n.position)).toEqual([.75,.5,.25]);p.pieces=pieces;expect(pairedNotches(p,seam.id,2,3)[0].notches).toHaveLength(3);const split=splitProjectEdge(p,a.id,a.nodes[0].id,.4);expect(split.pieces[0].notches!.filter(n=>n.sourceSeamId===split.seams![1].id)).toHaveLength(2);const geometry=await analyze(worker,{...p,pieces});expect(geometry[0].notchSegments).toHaveLength(4);});
