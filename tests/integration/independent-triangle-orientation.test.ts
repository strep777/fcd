import {expect,it} from 'vitest';
// @ts-expect-error Standalone audit oracle has no production TypeScript dependency.
import {triangleOrientation} from '../fixtures/independent-triangle-orientation.mjs';

it('retains a positive material cell regardless of its fraction of a larger parent',()=>{
 const actual=[[5.616918756674079e-8,0],[0,6.7307068251603e-8],[0,0]];
 expect(triangleOrientation(actual)).toBe(1);
 expect(triangleOrientation([actual[1],actual[0],actual[2]])).toBe(-1);
});
it('resolves stored zero-area, reflected, tiny and translated triangles independently',()=>{
 expect(triangleOrientation([[0,0],[1,1],[2,2]])).toBe(0);
 expect(triangleOrientation([[0,0],[1e-200,0],[0,1e-200]])).toBe(1);
 expect(triangleOrientation([[0,0],[0,1e-200],[1e-200,0]])).toBe(-1);
 expect(triangleOrientation([[1.1693772051297892e-155,-1.689489986741539e-156],[-2.7850591472745583e-155,3.320628735518005e-155],[-2.668462430987789e-155,3.217738394449082e-155]])).toBe(-1);
 const base=2**40;
 expect(triangleOrientation([[base,base],[base+2,base],[base,base+.001]])).toBe(1);
 expect(()=>triangleOrientation([[Infinity,0],[0,0],[0,1]])).toThrow('Nonfinite');
});
