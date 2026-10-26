import assert from 'node:assert/strict';
import {planarArea} from './fixtures/independent-planar-area.mjs';

// Binary-rational dimensions and translations are exactly representable. The
// expected area is prescribed before either the polygon or its page offset.
const width=2**-20,height=2**-19,expected=2**-39;
const rectangle=[[0,0],[width,0],[width,height],[0,height]];
const translations=[[0,0],[4096,8192],[-4096,8192],[4096,-8192]];
for(const [x,y] of translations){
  const shifted=rectangle.map(([a,b])=>[a+x,b+y]);
  assert.equal(planarArea(shifted),expected,'A real tiny rectangle retains exact area after page translation');
  assert.equal(planarArea(shifted.toReversed()),expected,'Winding does not change unsigned area');
  assert.equal(planarArea([shifted[0],shifted[1],shifted[2]]),expected/2,'Tiny triangle remains nondegenerate');
  assert.equal(planarArea([shifted[0],shifted[1],shifted[1]]),0,'Actual repeated-vertex degeneracy is still rejected');
}
const outer=[[0,0],[4,0],[4,4],[2,2],[0,4]];
assert.equal(planarArea(outer),12,'Concave area preserves signed cancellation within the local frame');
assert.equal(planarArea(outer.map(([x,y])=>[x+2**30,y-2**30])),12,'Concavity is translation invariant');
const absoluteArea=points=>Math.abs(points.reduce((s,a,i)=>s+a[0]*points[(i+1)%points.length][1]-points[(i+1)%points.length][0]*a[1],0))/2;
assert.equal(absoluteArea(rectangle.map(([x,y])=>[x+4096,y+8192])),0,'The regression really exercises absolute-coordinate cancellation');
console.log(JSON.stringify({passed:true,checks:19,expectedAreaMm2:expected,areaThresholdUnchanged:1e-16}));
