import {randomUUID} from 'node:crypto';
import type {Binding,Project,Surface,SurfaceRun} from '../../packages/schema/index';
import {pieceSchema,surfaceSchema} from '../../packages/schema/index';
import {hash} from '../../apps/desktop/main/repository';
import {pieceGeometryHash} from '../../apps/desktop/main/surface';
import {project,rectangle} from '../fixtures';

/** A planar accepted cut for persistence tests that do not need a native solver. */
export function acceptedCutProject():Project {
 const p=project(),piece=pieceSchema.parse({...rectangle(100,100),allowanceMm:0});
 const vertices=piece.nodes.map(n=>({id:randomUUID(),xMm:n.xMm,yMm:n.yMm,zMm:0}));
 const surface:Surface=surfaceSchema.parse({id:randomUUID(),source:'obj',topologyVersion:1,vertices,faces:[
  {id:randomUUID(),vertices:[vertices[0].id,vertices[1].id,vertices[2].id],region:'sheet'},
  {id:randomUUID(),vertices:[vertices[0].id,vertices[2].id,vertices[3].id],region:'sheet'}
 ]});
 const digest=hash(JSON.stringify(surface));
 const binding:Binding={pieceId:piece.id,surfaceId:surface.id,topologyVersion:1,geometryHash:pieceGeometryHash(piece),surfaceHash:digest,report:{
  faceIds:surface.faces.map(f=>f.id),uv:vertices.map(v=>({vertexId:v.id,xMm:v.xMm,yMm:v.yMm})),boundary:vertices.map(v=>v.id),
  areaErrorMax:0,edgeErrorMax:0,distortionMean:0,distortionP95:0,distortionMax:0,status:'acceptable'
 }};
 const run:SurfaceRun={sourceHash:digest,algorithm:'lscm-cg-1',pieces:[piece],bindings:[binding],accepted:true};
 return {...p,pieces:[piece],surface,bindings:[binding],surfaceRun:run,cuttingLibrary:[{
  id:randomUUID(),name:'已确认平面裁切',createdAt:p.createdAt,sourceRevision:0,surface:structuredClone(surface),run:structuredClone(run),markings:[],seams:[]
 }]};
}
