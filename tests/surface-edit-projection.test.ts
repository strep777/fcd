import {it,expect} from 'vitest';
import {randomUUID} from 'node:crypto';
import {surfaceFramePoint} from '../packages/surface/edit-surface-point';
import type {Surface,CutProjection} from '../packages/schema/index';
const frame:CutProjection={origin:[0,0,0],axes:[[1,0,0],[0,1,0],[0,0,1]]};
const vertex=(xMm:number,yMm:number,zMm:number)=>({id:randomUUID(),xMm,yMm,zMm});
it('editable knots resolve on a folded model, with frontmost depth and target regions respected',()=>{
 const vertices=[vertex(0,0,10),vertex(100,0,60),vertex(0,100,10),vertex(100,100,60),vertex(0,0,-50),vertex(100,0,-50),vertex(0,100,-50)];
 const faces=[[0,1,2],[1,3,2],[4,5,6]].map((ids,i)=>({id:randomUUID(),vertices:ids.map(j=>vertices[j].id) as [string,string,string],region:i<2?'front':'back'}));
 const surface:Surface={id:randomUUID(),topologyVersion:1,source:'obj',vertices,faces};
 const resolve=surfaceFramePoint(surface,frame);
 for(const x of [5,20,45,80]){const p=resolve({xMm:x,yMm:15})!;expect(p.xMm).toBeCloseTo(x,9);expect(p.yMm).toBeCloseTo(15,9);expect(p.zMm).toBeCloseTo(10+.5*x,9);}
 expect(surfaceFramePoint(surface,frame,['back'])({xMm:20,yMm:15})?.zMm).toBe(-50);
 expect(resolve({xMm:-10,yMm:15})).toBeUndefined();
 const clipped=resolve({xMm:-10,yMm:15},[{faceId:faces[0].id,a:vertices[0],b:vertices[2]}])!;
 expect(clipped).toEqual({xMm:0,yMm:15,zMm:10});
});
