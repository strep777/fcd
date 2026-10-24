import {expect,it} from 'vitest';
import {transportSurfaceShape} from '../packages/surface/transport-decal';
import {dragShapeTransform,setShapeTransform} from '../packages/surface/free-transform';
import {shapeWorld,type Shape} from '../packages/surface/attached-edit';
const shape:Shape={origin:[2,4,15],axes:[[1,0,0],[0,1,0],[0,0,1]],nodes:[{xMm:-20,yMm:-30},{xMm:20,yMm:-30},{xMm:20,yMm:30},{xMm:-20,yMm:30}],holes:[[{xMm:1,yMm:1},{xMm:3,yMm:5},{xMm:5,yMm:1}]],curves:[{startIndex:0,c1:{xMm:-10,yMm:-35},c2:{xMm:10,yMm:-35}}]};
it('a tilted existing decal does not jump or rotate when grabbed at a curved surface',()=>{
 const hit={xMm:10,yMm:20,zMm:25},normal:[number,number,number]=[.6,0,.8];
 expect(transportSurfaceShape(shape,hit,normal,hit,normal)).toEqual(shape);
 const moved=transportSurfaceShape(shape,hit,normal,{xMm:17,yMm:24,zMm:27},normal);
 expect(moved.axes).toEqual(shape.axes);expect(moved.origin).toEqual([9,8,17]);expect(moved.nodes).toEqual(shape.nodes);expect(moved.holes).toEqual(shape.holes);expect(moved.curves).toEqual(shape.curves);
});
it('surface transport rotates the complete pose rigidly without losing resized contours or holes',()=>{
 const resized=setShapeTransform(shape,70,90,.35),start={xMm:10,yMm:20,zMm:25},end={xMm:30,yMm:40,zMm:50};
 const moved=transportSurfaceShape(resized,start,[0,0,1],end,[1,0,0],'leg','new-face');
 const rotate=({xMm:x,yMm:y,zMm:z}:{xMm:number;yMm:number;zMm:number})=>({xMm:end.xMm+z-start.zMm,yMm:end.yMm+y-start.yMm,zMm:end.zMm-x+start.xMm});
 for(const node of resized.nodes){const expected=rotate(shapeWorld(resized,node)),actual=shapeWorld(moved,node);expect(actual.xMm).toBeCloseTo(expected.xMm,10);expect(actual.yMm).toBeCloseTo(expected.yMm,10);expect(actual.zMm).toBeCloseTo(expected.zMm,10);}
 expect(moved.anchorFaceId).toBe('new-face');expect(moved.curves).toEqual(resized.curves);expect(moved.holes).toEqual(resized.holes);
});
it('free transform translation preserves exact size, rotation and all contour controls',()=>{
 const scaled=setShapeTransform(shape,70,90,.35),result=dragShapeTransform(scaled,'move',{xMm:0,yMm:0},{xMm:12,yMm:-7},{angleRad:.35});
 expect(result.width).toBeCloseTo(70);expect(result.height).toBeCloseTo(90);expect(result.angleRad).toBe(.35);
 expect(result.shape.nodes[0].xMm).toBeCloseTo(scaled.nodes[0].xMm+12);expect(result.shape.curves![0].c1.yMm).toBeCloseTo(scaled.curves![0].c1.yMm-7);
});
