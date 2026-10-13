import {expect,it} from 'vitest';
import {DraftHistory} from '../../packages/ui/draft-history';
import {transformShape,shapeWorld} from '../../packages/surface/attached-edit';
it('coalesces a continuous gesture, supports redo, and drops redo after an independent edit',()=>{
 const history=new DraftHistory<{nodes:number[];holes:number[][]}>(),baseline={nodes:[0,10,20],holes:[[5,6,7]]};history.begin(baseline);let state=baseline;for(let i=1;i<=50;i++)state={nodes:[i,10,20],holes:[[5+i,6,7]]};history.end(state);const restored=history.move(state)!;expect(restored).toEqual(baseline);expect(history.move(restored)).toBeUndefined();const redone=history.move(restored,true)!;expect(redone).toEqual(state);history.record(redone,{nodes:[100,10,20],holes:[[55,6,7]]});expect(history.move(redone,true)).toBeUndefined();
});
it('rollback and committed-reset clear pending gesture history without an extra undo step',()=>{
 const h=new DraftHistory<number[]>();h.begin([1,2]);expect(h.rollback()).toEqual([1,2]);expect(h.move([2,2])).toBeUndefined();h.record([1],[2]);h.clear();expect(h.move([2])).toBeUndefined();expect(h.move([2],true)).toBeUndefined();
});
it('anisotropic sizing and rotation preserve the world centre, every hole, and the original frame',()=>{
 const frame={origin:[10,20,30] as [number,number,number],axes:[[0,1,0],[0,0,1],[1,0,0]] as [[number,number,number],[number,number,number],[number,number,number]]},shape={...frame,nodes:[{xMm:0,yMm:0},{xMm:10,yMm:0},{xMm:10,yMm:20},{xMm:0,yMm:20}],holes:[[{xMm:2,yMm:3},{xMm:4,yMm:3},{xMm:3,yMm:5}]]};
 const result=transformShape(shape,2,.5,Math.PI/2);expect(result.origin).toEqual(shape.origin);expect(result.axes).toEqual(shape.axes);expect(result.holes).toHaveLength(1);expect(shapeWorld(result,{xMm:5,yMm:10})).toEqual(shapeWorld(shape,{xMm:5,yMm:10}));expect(result.nodes[0].xMm).toBeCloseTo(10);expect(result.nodes[0].yMm).toBeCloseTo(0);expect(result.holes![0][0].xMm).toBeCloseTo(8.5);expect(result.holes![0][0].yMm).toBeCloseTo(4);expect(shape.nodes[0]).toEqual({xMm:0,yMm:0});expect(()=>transformShape(shape,0)).toThrow('INVALID_GEOMETRY');expect(()=>transformShape(shape,1,NaN)).toThrow('INVALID_GEOMETRY');
});
