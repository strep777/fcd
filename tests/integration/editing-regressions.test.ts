import {it,expect} from 'vitest';
import {randomUUID} from 'node:crypto';
import {moveNode} from '../../packages/pattern/edit';
import {rectangle} from '../fixtures';
it('moves a hole node without moving the outer contour, sibling holes or metadata',()=>{
 const piece=rectangle();
 piece.holes=[[[20,30],[70,30],[70,90],[20,90]],[[20,120],[70,120],[70,160],[20,160]]].map(r=>r.map(([xMm,yMm])=>({id:randomUUID(),xMm,yMm})));
 const original=structuredClone(piece),node=piece.holes[0][1],moved=moveNode(piece,node.id,75,35);
 expect(moved.holes?.[0][1]).toEqual({...node,xMm:75,yMm:35});
 expect(moved.nodes).toEqual(original.nodes);expect(moved.holes?.[1]).toEqual(original.holes![1]);expect(piece).toEqual(original);
});

it('bounds dense project contours without passing every point as a function argument',async()=>{
 const {pointBounds}=await import('../../packages/pattern/edit');
 function* points(){for(let i=0;i<1000000;i++)yield {xMm:i,yMm:1-i};}
 expect(pointBounds(points())).toEqual({minX:0,maxX:999999,minY:-999998,maxY:1});
});

