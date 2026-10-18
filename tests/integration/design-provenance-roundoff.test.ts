import {expect,it} from 'vitest';
import {composeMaterialStation,type MaterialFace} from '../../packages/surface/design-cuts';
const identity:MaterialFace['barycentric']=[[1,0,0],[0,1,0],[0,0,1]];
it('keeps section edge stations within the persisted barycentric contract after floating-point overshoot',()=>{
 const point:[number,number]=[413.15546218487395,586.8445378151262];
 expect(1-(point[0]+point[1])/1000).toBeLessThan(0);
 const actual=composeMaterialStation(point,identity);
 expect(actual[0]).toBe(0);expect(actual.every(n=>n>=0&&n<=1)).toBe(true);
 expect(actual.reduce((s,n)=>s+n,0)).toBeCloseTo(1,15);
 expect(Math.abs(actual[1]-point[0]/1000)).toBeLessThan(1e-14);
 const nested=composeMaterialStation([300,700.0000000000002],[[.2,.3,.5],[0,.6,.4],actual]);
 expect(nested.every(n=>n>=0&&n<=1)).toBe(true);expect(nested.reduce((s,n)=>s+n,0)).toBeCloseTo(1,15);
});
it('retains positive small material weights and rejects genuinely outside or nonfinite stations',()=>{
 expect(composeMaterialStation([1e-8,300],identity)[1]).toBeCloseTo(1e-11,24);
 for(const point of [[-1e-6,100],[500,500.001],[NaN,300],[Infinity,0]] as [number,number][])
  expect(()=>composeMaterialStation(point,identity)).toThrow('INVALID_CUT');
 expect(()=>composeMaterialStation([0,0],[[-.001,.5,.501],identity[1],identity[2]])).toThrow('INVALID_CUT');
});
