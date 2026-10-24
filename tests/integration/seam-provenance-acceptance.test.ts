import {expect,it} from 'vitest';
import {randomUUID} from 'node:crypto';
import type {SurfaceRun} from '../../packages/schema/index';
import {Repository} from '../../apps/desktop/main/repository';
import {pieceGeometryHash} from '../../apps/desktop/main/surface';
import {acceptedCutProject} from '../fixtures/accepted-cut';

// Prepared during the performance freeze. These exercise real acceptance,
// without a worker, a fabricated throwing callback, or a user project database.
function fixture(){
 const source=acceptedCutProject(),surface=source.surface!,run=structuredClone(source.surfaceRun!);
 run.accepted=false;run.algorithm='lscm-arap-seamed-1';
 for(const binding of run.bindings){
  binding.report={...binding.report,seamErrorMax:0,seamLengthErrorMm:0};
  binding.trim={vertices:surface.vertices.map(v=>({id:v.id,xMm:v.xMm,yMm:v.yMm})),triangles:surface.faces.map(f=>({faceId:f.id,vertices:f.vertices,barycentric:[[1,0,0],[0,1,0],[0,0,1]]})),boundary:surface.vertices.map(v=>v.id),holes:[]};
 }
 return {source,surface,run};
}
function rejectsWithoutMutation(source:ReturnType<typeof acceptedCutProject>,run:SurfaceRun){
 const repo=new Repository(':memory:');try{
  repo.open(source,null);repo.commit({type:'unwrap.candidate',run,markings:[]},randomUUID(),'candidate');repo.checkpoint();
  const before=repo.snapshot(),status=repo.status(),counts=()=>['commands','events','requests','recovery','resources'].map(t=>repo.db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get()!.n),rows=counts(),requestId=randomUUID();
  expect(()=>repo.commit({type:'unwrap.accept'},requestId,'accept')).toThrow('UNWRAP_DISTORTION');
  expect(repo.snapshot()).toEqual(before);expect(repo.status()).toEqual(status);expect(counts()).toEqual(rows);expect(repo.replay(requestId,'accept')).toBe(false);
 }finally{repo.close();}
}

it('rejects a matching exported outline whose trim stations are disconnected from every provenance triangle',()=>{
 const {source,run}=fixture(),piece=run.pieces[0],binding=run.bindings[0],trim=binding.trim!;
 const detached=piece.nodes.map(n=>({id:randomUUID(),xMm:n.xMm*1.02,yMm:n.yMm}));
 trim.vertices.push(...detached);trim.boundary=detached.map(p=>p.id);piece.nodes=detached.map(p=>({...p,id:randomUUID()}));binding.geometryHash=pieceGeometryHash(piece);
 expect(trim.triangles.every(t=>t.vertices.every(id=>!trim.boundary.includes(id)))).toBe(true);
 rejectsWithoutMutation(source,run);
});

it('rejects duplicated provenance triangles that cancel every counted boundary and conceal stretched sewing edges',()=>{
 const {source,surface,run}=fixture(),piece=run.pieces[0],binding=run.bindings[0],trim=binding.trim!,triangle=trim.triangles[0];
 trim.triangles=[triangle,structuredClone(triangle)];trim.boundary=[...triangle.vertices];binding.report.faceIds=[surface.faces[0].id];binding.report.boundary=[...trim.boundary];
 for(const v of trim.vertices)v.xMm*=1.02;
 piece.nodes=trim.boundary.map(id=>({...trim.vertices.find(v=>v.id===id)!,id:randomUUID()}));binding.geometryHash=pieceGeometryHash(piece);
 rejectsWithoutMutation(source,run);
});

it('rejects an inverted interior with exact boundary lengths and forged zero area/edge/distortion reports',()=>{
 const {source,surface,run}=fixture(),binding=run.bindings[0],trim=binding.trim!,centre=randomUUID(),[a,b,c,d]=surface.vertices.map(v=>v.id);
 trim.vertices.push({id:centre,xMm:150,yMm:50});
 trim.triangles=[
  {faceId:surface.faces[0].id,vertices:[a,b,centre],barycentric:[[1,0,0],[0,1,0],[.5,0,.5]]},
  {faceId:surface.faces[0].id,vertices:[b,c,centre],barycentric:[[0,1,0],[0,0,1],[.5,0,.5]]},
  {faceId:surface.faces[1].id,vertices:[a,centre,d],barycentric:[[1,0,0],[.5,.5,0],[0,0,1]]},
  {faceId:surface.faces[1].id,vertices:[centre,c,d],barycentric:[[.5,.5,0],[0,1,0],[0,0,1]]},
 ];
 rejectsWithoutMutation(source,run);
});

it.each(['empty pieces','missing binding','duplicate binding'] as const)('rejects a seamed candidate with %s without committing or authorizing replay',failure=>{
 const {source,run}=fixture();
 if(failure==='empty pieces'){run.pieces=[];run.bindings=[];}
 if(failure==='missing binding')run.bindings=[];
 if(failure==='duplicate binding'){
  run.pieces.push({...structuredClone(run.pieces[0]),id:randomUUID()});run.bindings.push(structuredClone(run.bindings[0]));
  expect(run.bindings).toHaveLength(run.pieces.length);expect(new Set(run.pieces.map(p=>p.id)).size).toBe(run.pieces.length);
 }
 rejectsWithoutMutation(source,run);
});

it('rejects non-unit trim barycentrics even when the reconstructed physical point and all reported errors are unchanged',()=>{
 const {source,surface,run}=fixture(),triangle=run.bindings[0].trim!.triangles[0],origin=surface.vertices.find(v=>v.id===surface.faces[0].vertices[0])!;
 expect([origin.xMm,origin.yMm,origin.zMm]).toEqual([0,0,0]);
 // Halving the origin weight leaves its XYZ at the origin, so distance and
 // outline checks cannot stand in for validating normalized correspondence.
 triangle.barycentric[0]=[.5,0,0];
 expect(run.bindings[0].report.seamErrorMax).toBe(0);expect(run.bindings[0].report.seamLengthErrorMm).toBe(0);
 rejectsWithoutMutation(source,run);
});

it.each(['lscm-cg-1','lscm-arap-1'] as const)('retains legitimate historical %s candidates without newly required seam reports or exact trims',algorithm=>{
 const {source}=fixture(),run=structuredClone(source.surfaceRun!);run.algorithm=algorithm;run.accepted=false;
 const repo=new Repository(':memory:');try{repo.open(source,null);repo.commit({type:'unwrap.candidate',run,markings:[]},randomUUID(),'legacy');repo.commit({type:'unwrap.accept'},randomUUID(),'accept');expect(repo.snapshot()!.surfaceRun!.accepted).toBe(true);}finally{repo.close();}
});
