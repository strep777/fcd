import {it,expect} from 'vitest';
import {randomUUID} from 'node:crypto';
import {project} from '../fixtures';
import {parseObj} from '../../apps/desktop/main/surface';
import {Repository,hash} from '../../apps/desktop/main/repository';
import {resizeProject,resizeShape} from '../../apps/desktop/main/resize-project';
import {resizeSurface} from '../../packages/surface/resize';
import {staleMarkingIds} from '../../apps/desktop/main/markings';
import {markingSchema,type Marking} from '../../packages/schema/index';
const mesh=()=>parseObj('v 0 0 0\nv 100 0 0\nv 100 100 100\nv 0 100 100\nf 1 2 3\nf 1 3 4');
const shape:NonNullable<Marking['surfaceShape']>={origin:[30,40,40],axes:[[1,0,0],[0,Math.SQRT1_2,Math.SQRT1_2],[0,-Math.SQRT1_2,Math.SQRT1_2]],nodes:[{xMm:0,yMm:0},{xMm:10,yMm:0},{xMm:0,yMm:10}],holes:[]};
it('nonuniform resize transforms oblique paint plane exactly and keeps orthonormal editing axes',()=>{
 const old=mesh(),next=resizeSurface(old,{dimensionsMm:{width:200,height:300,depth:400}}),s=resizeShape(shape,old,next);
 for(let i=0;i<shape.nodes.length;i++){
  const p=shape.nodes[i],q=s.nodes[i];
  for(let axis=0;axis<3;axis++)expect(s.origin[axis]+s.axes[0][axis]*q.xMm+s.axes[1][axis]*q.yMm).toBeCloseTo(50+([2,3,4][axis])*(shape.origin[axis]+shape.axes[0][axis]*p.xMm+shape.axes[1][axis]*p.yMm-50),8);
 }
 expect(Math.hypot(...s.axes[0])).toBeCloseTo(1);expect(Math.hypot(...s.axes[1])).toBeCloseTo(1);expect(s.axes[0].reduce((v,x,i)=>v+x*s.axes[1][i],0)).toBeCloseTo(0);
});
it('resize retains paint fragments without stale provenance and is atomic on lock or degeneracy',()=>{
 const p=project();p.pieces=[];p.surface=mesh();p.markings=[{id:randomUUID(),name:'surface paint',color:'#e63344',source:'surface',surfaceShape:shape,sourceHash:hash(JSON.stringify(shape)),surfaceId:p.surface.id,surfaceHash:hash(JSON.stringify(p.surface)),topologyVersion:p.surface.topologyVersion,view:'front',offsetXmm:0,offsetYmm:0,fragments:[{faceId:p.surface.faces[0].id,rings:[[[1,0,0],[0,1,0],[0,0,1]]]}],paths:[]}];
 p.markings=p.markings.map(m=>markingSchema.parse(m));p.markings[0].sourceHash=hash(JSON.stringify(p.markings[0].surfaceShape));const repo=new Repository(':memory:');repo.open(p,null);repo.commit({type:'surface.resize',dimensionsMm:{width:200,height:300,depth:400}},randomUUID(),'resize');const resized=repo.snapshot()!;
 expect(resized.markings![0].fragments).toEqual(p.markings[0].fragments);expect(staleMarkingIds(resized).size).toBe(0);repo.historyMove(false);expect(repo.snapshot()!.surface).toEqual(p.surface);
 repo.commit({type:'marking.lock',markingId:p.markings[0].id,locked:true},randomUUID(),'lock');const locked=repo.snapshot();expect(()=>repo.commit({type:'surface.resize',scale:2},randomUUID(),'blocked')).toThrow('MARKING_LOCKED');expect(repo.snapshot()).toEqual(locked);
 repo.historyMove(false);const before=repo.snapshot();expect(()=>repo.commit({type:'surface.resize',scale:1e-12},randomUUID(),'invalid')).toThrow('MODEL_SIZE_INVALID');expect(repo.snapshot()).toEqual(before);repo.close();
});
