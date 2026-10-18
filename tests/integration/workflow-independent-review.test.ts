import {expect,it} from 'vitest';
import {randomUUID} from 'node:crypto';
import {resolve} from 'node:path';
import {project,rectangle} from '../fixtures';
import {parseObj,pieceGeometryHash} from '../../apps/desktop/main/surface';
import {hash,Repository} from '../../apps/desktop/main/repository';
import {surfaceMarking,staleMarkingIds} from '../../apps/desktop/main/markings';
import {brushSurfaceMarking} from '../../apps/desktop/main/surface-marking-edit';
import {editTrimmedMarking} from '../../apps/desktop/main/trim-marking';
import {candidateSeamPreview} from '../../packages/surface/candidate-seams';
import {mirrorPaintShape} from '../../packages/surface/symmetry';
import {surfaceCurveSegments} from '../../packages/surface/surface-curve';
import {speciesParamsSchema,type Binding,type Surface,type SurfaceRun} from '../../packages/schema/index';
import {speciesDefaults} from '../../packages/body/defaults';
import {speciesRanges,validSpeciesParameters} from '../../packages/body/parameter-validation';
import type {Bary} from '../../packages/surface/triangles';

const worker=resolve('target/release/fpcad-worker.exe');
const xy=(xMm:number,yMm:number)=>({xMm,yMm});
const bary=(x:number,y:number):Bary=>[1-(x+y)/100,x/100,y/100];
const ring=(points:number[][])=>points.map(([x,y])=>bary(x,y));
function singleFace(){return parseObj('v 0 0 0\nv 100 0 0\nv 0 100 0\nf 1 2 3');}
function binding(surface:Surface,points:number[][],triangles:number[][]):Binding {
 const piece=rectangle(30,30),vertices=points.map(([xMm,yMm])=>({id:randomUUID(),xMm,yMm}));
 return {pieceId:piece.id,surfaceId:surface.id,topologyVersion:surface.topologyVersion,geometryHash:pieceGeometryHash(piece),surfaceHash:hash(JSON.stringify(surface)),report:{faceIds:surface.faces.map(f=>f.id),uv:surface.vertices.map(v=>({vertexId:v.id,xMm:v.xMm,yMm:v.yMm})),boundary:surface.vertices.map(v=>v.id),areaErrorMax:0,edgeErrorMax:0,distortionMean:0,distortionP95:0,distortionMax:0,status:'acceptable'},trim:{vertices,triangles:triangles.map(t=>({faceId:surface.faces[0].id,vertices:t.map(i=>vertices[i].id) as [string,string,string],barycentric:t.map(i=>bary(points[i][0],points[i][1])) as [Bary,Bary,Bary]})),boundary:vertices.map(v=>v.id),holes:[]}};
}

it('candidate UV preview removes internal trim triangulation within one original model face',()=>{
 const surface=singleFace(),trim=binding(surface,[[10,10],[30,10],[30,30],[10,30]],[[0,1,2],[0,2,3]]),before=structuredClone(trim);
 const lines=candidateSeamPreview(surface,{bindings:[trim]} as SurfaceRun);
 expect(lines).toHaveLength(4);
 expect(lines.every(({a,b})=>Math.abs(a.xMm-b.xMm)<1e-7||Math.abs(a.yMm-b.yMm)<1e-7)).toBe(true);
 expect(lines.reduce((sum,{a,b})=>sum+Math.hypot(a.xMm-b.xMm,a.yMm-b.yMm,a.zMm-b.zMm),0)).toBeCloseTo(80,7);
 expect(trim).toEqual(before);
});

it('neighboring UV islands draw a shared seam once even when one side subdivides it',()=>{
 const surface=singleFace(),left=binding(surface,[[10,10],[30,10],[30,30],[10,30]],[[0,1,2],[0,2,3]]),right=binding(surface,[[30,10],[50,10],[50,30],[30,30],[30,20]],[[0,1,2],[0,2,4],[2,3,4]]);
 const lines=candidateSeamPreview(surface,{bindings:[left,right]} as SurfaceRun);
 const shared=lines.filter(({a,b})=>Math.abs(a.xMm-30)<1e-7&&Math.abs(b.xMm-30)<1e-7);
 for(const y of [15,25])expect(shared.filter(({a,b})=>y>Math.min(a.yMm,b.yMm)&&y<Math.max(a.yMm,b.yMm))).toHaveLength(1);
 expect(lines.reduce((sum,{a,b})=>sum+Math.hypot(a.xMm-b.xMm,a.yMm-b.yMm,a.zMm-b.zMm),0)).toBeCloseTo(140,7);
});

it('a 500-island preview retains only the unique mesh seams and valid owning faces',()=>{
 const columns=100,rows=5,source=singleFace(),vertices=Array.from({length:(columns+1)*(rows+1)},(_,i)=>({id:randomUUID(),xMm:i%(columns+1)*10,yMm:Math.floor(i/(columns+1))*10,zMm:0}));
 const surface:Surface={...source,vertices,faces:[]},bindings:Binding[]=[],template=binding(source,[[0,0],[10,0],[0,10]],[[0,1,2]]);
 for(let y=0;y<rows;y++)for(let x=0;x<columns;x++){
  const a=y*(columns+1)+x,b=a+1,c=a+columns+2,d=c-1,faces=[[a,b,c],[a,c,d]].map(indices=>({id:randomUUID(),vertices:indices.map(i=>vertices[i].id) as [string,string,string],region:'shell'}));
  surface.faces.push(...faces);bindings.push({...template,pieceId:randomUUID(),trim:undefined,report:{...template.report,faceIds:faces.map(f=>f.id)}});
 }
 const lines=candidateSeamPreview(surface,{bindings} as SurfaceRun),faces=new Map(surface.faces.map(f=>[f.id,f])),points=new Map<string,Surface['vertices'][number]>(vertices.map(v=>[v.id,v]));
 expect(lines).toHaveLength((rows+1)*columns+(columns+1)*rows);
 expect(lines.reduce((sum,{a,b})=>sum+Math.hypot(a.xMm-b.xMm,a.yMm-b.yMm,a.zMm-b.zMm),0)).toBeCloseTo(11050,6);
 for(const line of lines){const face=faces.get(line.faceId)!;expect(face).toBeDefined();const corners=face.vertices.map(id=>points.get(id)!);for(const point of [line.a,line.b]){expect(point.xMm).toBeGreaterThanOrEqual(Math.min(...corners.map(v=>v.xMm))-1e-7);expect(point.xMm).toBeLessThanOrEqual(Math.max(...corners.map(v=>v.xMm))+1e-7);expect(point.yMm).toBeGreaterThanOrEqual(Math.min(...corners.map(v=>v.yMm))-1e-7);expect(point.yMm).toBeLessThanOrEqual(Math.max(...corners.map(v=>v.yMm))+1e-7);}}
});

it('editing a partial UV patch retains every separate paint fragment elsewhere on that same model face',async()=>{
 const p=project(),surface=singleFace(),piece=rectangle(30,30),trim=binding(surface,[[0,0],[30,0],[0,30]],[[0,1,2]]);
 piece.nodes=[xy(0,0),xy(30,0),xy(0,30)].map(point=>({...point,id:randomUUID()}));piece.allowanceMm=0;
 trim.pieceId=piece.id;trim.geometryHash=pieceGeometryHash(piece);p.surface=surface;p.pieces=[piece];p.bindings=[trim];
 const old=await surfaceMarking(worker,p,{origin:[0,0,0],axes:[[1,0,0],[0,1,0],[0,0,1]],nodes:[xy(5,5),xy(10,5),xy(5,10)]},'#ff8800','Partial patch');
 old.fragments=[{faceId:surface.faces[0].id,rings:[ring([[5,5],[10,5],[5,10]])]},{faceId:surface.faces[0].id,rings:[ring([[45,5],[55,5],[45,15]])]},{faceId:surface.faces[0].id,rings:[ring([[5,45],[15,45],[5,55]])]}];
 p.markings=[old];const before=structuredClone(p);
 const next=await editTrimmedMarking(worker,p,old,piece,trim,[[xy(10,10),xy(15,10),xy(10,15)]]);
 const all=next.fragments.flatMap(f=>f.rings),area=all.reduce((sum,r)=>sum+r.reduce((s,a,i)=>{const b=r[(i+1)%r.length];return s+a[1]*b[2]-b[1]*a[2];},0)*5000,0);
 expect(all).toHaveLength(3);expect(area).toBeCloseTo(112.5,5);
 expect(all.some(r=>r.every(w=>w[1]>=.45-1e-7))).toBe(true);
 expect(all.some(r=>r.every(w=>w[2]>=.45-1e-7))).toBe(true);
 expect(next.paths).toHaveLength(1);expect(next.paths[0].rings).toHaveLength(1);
 expect(next.paths[0].rings[0].every(point=>point.xMm>=10-1e-5&&point.yMm>=10-1e-5)).toBe(true);
 expect(next.editMode).toBe('uv-manual');expect(p).toEqual(before);
});

it('model form and authoritative schema agree at every species parameter range boundary',()=>{
 for(const species of ['canine','feline','rabbit','bear','deer','dragon'] as const){
  const defaults=speciesDefaults(species);
  for(const [key,[min,max]] of Object.entries(speciesRanges))for(const value of [min-1e-5,min,min+1e-5,max-1e-5,max,max+1e-5,NaN,Infinity]){
   const parameters={...defaults,[key]:value};
   expect(validSpeciesParameters(parameters),`${species}.${key}=${value}`).toBe(speciesParamsSchema.safeParse(parameters).success);
  }
 }
});

it('a real symmetric brush pair persists in one revision and undo removes both markings',async()=>{
 const p=project();p.pieces=[];p.surface=parseObj('v -100 0 0\nv 100 0 0\nv 100 100 0\nv -100 100 0\nf 1 2 3\nf 1 3 4');
 const left=await brushSurfaceMarking(worker,p,undefined,{mode:'add',points:[xy(20,40),xy(45,60)],radiusMm:5,paint:{frame:{origin:[0,0,0],axes:[[1,0,0],[0,1,0],[0,0,1]]},color:'#ff8800',name:'Paired brush'}}),right=await surfaceMarking(worker,p,mirrorPaintShape(p.surface,left.surfaceShape!),left.color,'Mirrored brush');
 expect(left.id).not.toBe(right.id);expect(left.fragments.length).toBeGreaterThan(0);expect(right.fragments.length).toBeGreaterThan(0);
 const persisted=JSON.parse(JSON.stringify([left,right]));
 const repository=new Repository(':memory:');try{
  repository.open(p,null);const revision=repository.snapshot()!.revision;
  repository.commit({type:'markings.batch',markings:[left,right]},randomUUID(),'paired-brush');
  const saved=repository.snapshot()!;expect(saved.revision).toBe(revision+1);expect(saved.markings).toEqual(persisted);expect(staleMarkingIds(saved).size).toBe(0);
  repository.historyMove(false);expect(repository.snapshot()!.markings??[]).toEqual([]);
  repository.historyMove(true);expect(repository.snapshot()!.markings).toEqual(persisted);expect(staleMarkingIds(repository.snapshot()!).size).toBe(0);
 }finally{repository.close();}
});

it('surface paths across a coplanar patch use its interior when anchors lie on neighboring face edges',()=>{
 const surface=parseObj('v -50 -50 -50\nv 50 -50 -50\nv 50 50 -50\nv -50 50 -50\nv -50 -50 50\nv 50 -50 50\nv 50 50 50\nv -50 50 50\nf 5 6 7\nf 5 7 8\nf 1 4 3\nf 1 3 2\nf 2 3 7\nf 2 7 6\nf 4 8 7\nf 4 7 3\nf 1 5 8\nf 1 8 4\nf 1 2 6\nf 1 6 5');
 const points=[{xMm:0,yMm:50,zMm:50},{xMm:50,yMm:50,zMm:0}],cuts=surfaceCurveSegments(surface,points,false,'coplanar'),faces=new Map(surface.faces.map(f=>[f.id,f])),vertices=new Map(surface.vertices.map(v=>[v.id,v]));
 const positions=cuts.map(c=>{const face=faces.get(c.faceId)!;return [c.a,c.b].map(weights=>[0,1,2].map(axis=>weights.reduce((s,w,i)=>s+w*[vertices.get(face.vertices[i])!.xMm,vertices.get(face.vertices[i])!.yMm,vertices.get(face.vertices[i])!.zMm][axis],0)));});
 const length=positions.reduce((sum,[a,b])=>sum+Math.hypot(...a.map((v,i)=>v-b[i])),0);
 expect(length).toBeCloseTo(Math.sqrt(5000),6);
 expect(cuts.every(c=>[6,7].includes(surface.faces.findIndex(f=>f.id===c.faceId)))).toBe(true);
});
