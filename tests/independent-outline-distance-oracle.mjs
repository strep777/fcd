// Analytic regression checks for finite-polyline outline correspondence.
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {prepareDistance,distanceBounds,uncoveredLength} from './fixtures/polyline-correspondence-oracle.mjs';
const mappingMm=1e-4,line=(a,b)=>({a,b}),results=[];
function audit(name,source,target,expectedDistance,expectedPass,maxRadius=.001){
 const forward=prepareDistance(source,target,maxRadius),backward=prepareDistance(target,source,maxRadius),a=distanceBounds(forward,maxRadius),b=distanceBounds(backward,maxRadius),passed=uncoveredLength(forward,mappingMm)<=1e-10&&uncoveredLength(backward,mappingMm)<=1e-10;
 assert(a.certified&&b.certified,name+': distance must be certified');const lo=Math.max(a.lowerMm,b.lowerMm),hi=Math.max(a.upperMm,b.upperMm);assert(expectedDistance>=lo-1e-9&&expectedDistance<=hi+1e-9,name+': analytic Hausdorff distance');assert.equal(passed,expectedPass,name+': unchanged 0.0001 mm distance gate');results.push({name,expectedDistanceMm:expectedDistance,bounds:{lowerMm:lo,upperMm:hi},passedGate:passed,expectedPass});
}
const long=[line([0,0],[1000,0])];
audit('1000 mm boundary with 0.00009 mm simplification',long,[line([0,0],[500,.00009]),line([500,.00009],[1000,0])],.00009,true);
audit('1000 mm boundary with 0.00011 mm error',long,[line([0,0],[500,.00011]),line([500,.00011],[1000,0])],.00011,false);
audit('reversed finite segments preserve distance',long,[line([1000,0],[500,.00009]),line([500,.00009],[0,0])],.00009,true);
// The old infinite-line predicate extrapolated this 0.001 mm edge's tiny tilt
// to 0.09 mm over the long edge, despite a true distance of only 0.00000009 mm.
audit('short tilted edge must not be extrapolated',long,[line([0,0],[.001,.00000009]),line([.001,.00000009],[1000,0])],.00000009,true);
audit('finite collinear segments cannot hide an interior gap',long,[line([0,0],[499,0]),line([501,0],[1000,0])],1,false,2);
audit('reverse direction detects missing endpoints',[line([0,0],[10,0])],long,990,false,1000);
await mkdir('test-results/current-repair',{recursive:true});await writeFile('test-results/current-repair/independent-outline-distance-oracle.json',JSON.stringify({passed:true,mappingMm,results},null,2));console.log(JSON.stringify({passed:true,cases:results.length}));
