import type {XY} from './markings';
import {simplifyColorBoundary} from './contour-simplification';
import {safeColorOutline} from './color-outline';
import {DomainError} from './repository';

const area=(ring:XY[])=>ring.reduce((sum,p,i)=>{const q=ring[(i+1)%ring.length],o=ring[0];return sum+(p[0]-o[0])*(q[1]-o[1])-(q[0]-o[0])*(p[1]-o[1]);},0)/2;
const inside=(p:XY,ring:XY[])=>{let yes=false;for(let i=0,j=ring.length-1;i<ring.length;j=i++){const a=ring[i],b=ring[j];if((a[1]>p[1])!==(b[1]>p[1])&&p[0]<(b[0]-a[0])*(p[1]-a[1])/(b[1]-a[1])+a[0])yes=!yes;}return yes;};
const bounds=(ring:XY[])=>[Math.min(...ring.map(p=>p[0])),Math.min(...ring.map(p=>p[1])),Math.max(...ring.map(p=>p[0])),Math.max(...ring.map(p=>p[1]))];
const overlaps=(a:number[],b:number[])=>a[0]<=b[2]&&b[0]<=a[2]&&a[1]<=b[3]&&b[1]<=a[3];
/** Affine mapping can emit the same clipping station with sub-nanometre
 * roundoff. Remove only consecutive numerical duplicates, never real detail. */
export function distinctMarkingStations(ring:XY[]):XY[]{
 const result:XY[]=[];for(const point of ring){const prior=result.at(-1);if(!prior||Math.hypot(point[0]-prior[0],point[1]-prior[1])>1e-9)result.push(point);}
 if(result.length>1&&Math.hypot(result[0][0]-result.at(-1)![0],result[0][1]-result.at(-1)![1])<=1e-9)result.pop();
 return result.length>=3&&result.length!==ring.length?result:ring;
}
function polygons(rings:XY[][]){
 const result=rings.filter(r=>area(r)>0).map(outer=>({outer,holes:[] as XY[][]}));
 for(const hole of rings.filter(r=>area(r)<0)){const owner=result.filter(p=>inside(hole[0],p.outer)).sort((a,b)=>area(a.outer)-area(b.outer))[0];if(!owner)throw new DomainError('REGION_COMPLEXITY');owner.holes.push(hole);}
 return result;
}

/** UV paths are derived samples, not new source contours. Compact only paths
 * over the editable node budget, preserving holes and a 0.001 mm distance
 * bound. Truly complex material is partitioned into adjacent same-color rings;
 * this does not introduce a sewing line or discard any material. */
export async function boundedMarkingRings(rings:XY[][],precisionDigits:number,intersect:(jobs:{subjects:XY[][];clips:XY[][]}[])=>Promise<XY[][][]>):Promise<XY[][]>{
 const distinct=rings.map(distinctMarkingStations);if(distinct.some((ring,i)=>ring!==rings[i]))rings=distinct;
 if(rings.length<=1000&&rings.every(r=>r.length<=2000))return rings;
 const pending=polygons(rings).map(p=>({...p,depth:0})),result:XY[][]=[],finishedBounds:number[][]=[];
 while(pending.length){
  const polygon=pending.pop()!;
  const box=bounds(polygon.outer);
  // Independent islands may occupy a shallow concavity or a narrow hole.
  // Local outer/hole validation cannot detect their being swallowed by RDP.
  // Keep exact contours wherever another island's box overlaps; subdivision
  // still satisfies the node budget without altering their relative topology.
  const neighbours=pending.some(p=>overlaps(box,bounds(p.outer)))||finishedBounds.some(b=>overlaps(box,b));
  const compact=neighbours?polygon:safeColorOutline(polygon,{outer:polygon.outer.length>2000?simplifyColorBoundary(polygon.outer):polygon.outer,holes:polygon.holes.map(r=>r.length>2000?simplifyColorBoundary(r):r)});
  if(compact.outer.length<=2000&&compact.holes.every(r=>r.length<=2000)){result.push(compact.outer,...compact.holes);finishedBounds.push(bounds(compact.outer));if(result.length>1000)throw new DomainError('REGION_COMPLEXITY');continue;}
  if(polygon.depth>=12)throw new DomainError('REGION_COMPLEXITY');
  const x=polygon.outer.map(p=>p[0]),y=polygon.outer.map(p=>p[1]),minX=Math.min(...x),maxX=Math.max(...x),minY=Math.min(...y),maxY=Math.max(...y),vertical=maxX-minX>=maxY-minY,middle=vertical?(minX+maxX)/2:(minY+maxY)/2;
  const boxes=vertical?[[minX-1,minY-1,middle,maxY+1],[middle,minY-1,maxX+1,maxY+1]]:[[minX-1,minY-1,maxX+1,middle],[minX-1,middle,maxX+1,maxY+1]];
  const parts=await intersect(boxes.map(([x0,y0,x1,y1])=>({subjects:[polygon.outer,...polygon.holes],clips:[[[x0,y0],[x1,y0],[x1,y1],[x0,y1]] as XY[]]})));
  const before=area(polygon.outer)+polygon.holes.reduce((sum,r)=>sum+area(r),0),after=parts.flat().reduce((sum,r)=>sum+area(r),0),perimeter=[polygon.outer,...polygon.holes].reduce((sum,r)=>sum+r.reduce((s,p,i)=>s+Math.hypot(p[0]-r[(i+1)%r.length][0],p[1]-r[(i+1)%r.length][1]),0),0);
  if(Math.abs(before-after)>Math.max(1e-8,Math.abs(before)*1e-10,perimeter*10**-precisionDigits*4))throw new DomainError('REGION_COMPLEXITY');
  pending.push(...parts.flatMap(polygons).map(p=>({...p,depth:polygon.depth+1})));
 }
 return result;
}
