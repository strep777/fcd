import {expect,it} from 'vitest';
import {resolve} from 'node:path';
import mesh from '../fixtures/near-coincident-cloth-panel.json';
import {createWorkerSession} from '../../apps/desktop/main/worker';
import {nativeSurfaceResponseSchema} from '../../packages/surface/native-report';

it.each(['lscm','arap-seamed'])('keeps the complete near-coincident cloth panel together using %s',async method=>{
 const session=createWorkerSession(resolve('target/release/fpcad-worker.exe')),before=JSON.stringify(mesh);
 try{
  const result=nativeSurfaceResponseSchema.parse(await session.request({protocolVersion:1,operation:'surface.unwrap',mesh:{...mesh,method,iterations:100,repair_cuts:false}}));
  expect(result.patches).toHaveLength(1);const panel=result.patches[0];
  expect(new Set(panel.faceIds)).toEqual(new Set(mesh.faces.map(f=>f.id)));expect(panel.uv).toHaveLength(mesh.vertices.length);
  expect(panel.edgeErrorMax).toBeLessThan(.1);expect(panel.areaErrorMax).toBeLessThan(.15);
  expect(JSON.stringify(mesh)).toBe(before);
 }finally{await session.dispose();}
},30000);
