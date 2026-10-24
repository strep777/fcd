import {expect,it} from 'vitest';
import type {CutProjection} from '../../packages/schema/index';
import {surfaceDragDelta} from '../../packages/surface/drag-plane';

const front:CutProjection={origin:[0,0,0],axes:[[1,0,0],[0,1,0],[0,0,1]]};
const point=(xMm:number,yMm:number)=>({xMm,yMm});
it.each([false,true])('keeps a grabbed contour stationary and matches physical screen movement (perspective=%s)',perspective=>{
 const start=point(30,40),anchor={xMm:15,yMm:20,zMm:500};
 expect(surfaceDragDelta(front,front,start,start,anchor,perspective,1000)).toEqual(point(0,0));
 const delta=surfaceDragDelta(front,front,start,point(34,46),anchor,perspective,1000)!;
 expect(delta.xMm).toBeCloseTo(perspective?2:4,10);
 expect(delta.yMm).toBeCloseTo(perspective?3:6,10);
});
it('preserves the visible edit direction in a side view without inventing hidden-axis movement',()=>{
 const side:CutProjection={origin:[0,0,0],axes:[[0,0,-1],[0,1,0],[1,0,0]]};
 const delta=surfaceDragDelta(front,side,point(0,0),point(20,7),{xMm:0,yMm:0,zMm:0})!;
 expect(delta.xMm).toBeCloseTo(0,10);expect(delta.yMm).toBeCloseTo(7,10);
});
it('does not amplify small pointer movement along a nearly invisible direction',()=>{
 const yaw=Math.PI/2-.001,view:CutProjection={origin:[0,0,0],axes:[[Math.cos(yaw),0,-Math.sin(yaw)],[0,1,0],[Math.sin(yaw),0,Math.cos(yaw)]]};
 const delta=surfaceDragDelta(front,view,point(0,0),point(2,3),{xMm:0,yMm:0,zMm:0})!;
 expect(Math.abs(delta.xMm)).toBeLessThan(.001);expect(delta.yMm).toBeCloseTo(3,10);
});
it('matches the actual projected handle depth with a tilted persistent frame',()=>{
 const angle=.6,c=Math.cos(angle),s=Math.sin(angle),frame:CutProjection={origin:[0,0,0],axes:[[c,0,-s],[0,1,0],[s,0,c]]};
 const anchor={xMm:40,yMm:20,zMm:300},distance=1000;
 const project=(p:typeof anchor)=>point(distance*p.xMm/(distance-p.zMm),distance*p.yMm/(distance-p.zMm));
 const end={xMm:anchor.xMm+c*12,yMm:anchor.yMm-8,zMm:anchor.zMm-s*12};
 const delta=surfaceDragDelta(frame,front,project(anchor),project(end),anchor,true,distance)!;
 expect(delta.xMm).toBeCloseTo(12,9);expect(delta.yMm).toBeCloseTo(-8,9);
});
it('rejects points behind the camera and nonfinite input',()=>{
 expect(surfaceDragDelta(front,front,point(0,0),point(1,1),{xMm:0,yMm:0,zMm:1100},true,1000)).toBeUndefined();
 expect(surfaceDragDelta(front,front,point(0,0),point(NaN,1),{xMm:0,yMm:0,zMm:0})).toBeUndefined();
});
