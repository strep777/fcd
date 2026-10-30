import {it,expect} from 'vitest';
import {resolve} from 'node:path';
import {randomUUID} from 'node:crypto';
import {createWorkerSession} from '../../apps/desktop/main/worker';
import {nativeSurfaceResponseSchema} from '../../packages/surface/native-report';
import type {Surface} from '../../packages/schema/index';

it('a dense curved panel calibrates its boundary without inventing seams at the direct-matrix budget',async()=>{
 const nx=110,ny=95,radius=180,facets=10,height=600,angle=Math.PI/facets,chord=2*radius*Math.sin(angle/2);
 const vertices:Surface['vertices']=[],faces:Surface['faces']=[],initial_uv:{vertexId:string;xMm:number;yMm:number}[]=[];
 for(let y=0;y<=ny;y++)for(let x=0;x<=nx;x++){
  // Densify the SAME ten physical facets, not a different smooth cylinder.
  const t=x/nx*facets,k=Math.min(facets-1,Math.floor(t)),f=t-k,a=-Math.PI/2+k*angle,b=a+angle,id=randomUUID();
  vertices.push({id,xMm:radius*((1-f)*Math.sin(a)+f*Math.sin(b)),yMm:y/ny*height,zMm:radius*((1-f)*Math.cos(a)+f*Math.cos(b))});
  initial_uv.push({vertexId:id,xMm:t*chord*.98,yMm:y/ny*height*.98});
 }
 for(let y=0;y<ny;y++)for(let x=0;x<nx;x++){const a=y*(nx+1)+x,b=a+1,c=a+nx+1,d=c+1;for(const ids of [[a,b,d],[a,d,c]])faces.push({id:randomUUID(),vertices:ids.map(i=>vertices[i].id) as [string,string,string],region:'cloth'});}
 expect(vertices.length*2-2).toBeGreaterThan(20000);
 const session=createWorkerSession(resolve('target/release/fpcad-worker.exe'));
 try{
  const result=nativeSurfaceResponseSchema.parse(await session.request({protocolVersion:1,operation:'surface.unwrap',mesh:{vertices,faces,initial_uv,method:'arap-seamed',iterations:100,repair_cuts:false}}));
  expect(result.patches).toHaveLength(1);const panel=result.patches[0];
  expect(new Set(panel.faceIds)).toEqual(new Set(faces.map(f=>f.id)));
  expect(panel.uv).toHaveLength(vertices.length);expect(panel.edgeErrorMax).toBeLessThan(.1);expect(panel.areaErrorMax).toBeLessThan(.15);
  expect(panel.seamErrorMax).toBeLessThanOrEqual(.0005);expect(panel.seamLengthErrorMm).toBeLessThanOrEqual(.25);
  const area=panel.uv.reduce((box,p)=>[Math.min(box[0],p.xMm),Math.max(box[1],p.xMm),Math.min(box[2],p.yMm),Math.max(box[3],p.yMm)],[Infinity,-Infinity,Infinity,-Infinity]);
  expect(area[1]-area[0]).toBeCloseTo(facets*chord,0);expect(area[3]-area[2]).toBeCloseTo(height,0);
 }finally{await session.dispose();}
},120000);
