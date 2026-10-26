import {expect,it} from 'vitest';
import {readFileSync,mkdirSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {project} from '../fixtures';
import {surfaceSchema} from '../../packages/schema/index';
import {cutPreview} from '../../apps/desktop/main/cut-preview';

type Point2=[number,number];
const twiceArea=(ring:Point2[])=>ring.reduce((sum,a,i)=>{const b=ring[(i+1)%ring.length];return sum+a[0]*b[1]-a[1]*b[0];},0);
// Independent convex clipping in the source triangle's barycentric plane.
// Equal summed areas alone cannot distinguish full coverage from overlap+gap.
function intersection(first:Point2[],second:Point2[]){
 let ring=first;
 for(let i=0;i<second.length&&ring.length;i++){
  const a=second[i],b=second[(i+1)%second.length],side=(p:Point2)=>(b[0]-a[0])*(p[1]-a[1])-(b[1]-a[1])*(p[0]-a[0]),output:Point2[]=[];
  let previous=ring.at(-1)!,before=side(previous);
  for(const point of ring){const after=side(point);if((before>=0)!==(after>=0)){const t=before/(before-after);output.push([previous[0]+t*(point[0]-previous[0]),previous[1]+t*(point[1]-previous[1])]);}if(after>=0)output.push(point);previous=point;before=after;}
  ring=output;
 }
 return ring;
}
const triangleArea=(points:number[][])=>{const [a,b,c]=points,u=b.map((n,i)=>n-a[i]),v=c.map((n,i)=>n-a[i]);return Math.hypot(u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0])/2;};
const distance=(a:number[],b:number[])=>Math.hypot(...a.map((n,i)=>n-b[i]));

it('opens the captured concave material patch without recursive failure, lost coverage or triangle-sized panel proliferation',async()=>{
 // Captured from real-rejected-3.json: this 26-face material patch failed
 // UNWRAP_DISTORTION and caused repeated central subdivision in the real
 // whole-model workflow. Success means useful, fully mapped paper panels;
 // neither a particular solver strategy nor an exact piece count is expected.
 const surface=surfaceSchema.parse(JSON.parse(readFileSync(new URL('../fixtures/concave-material-opening.json',import.meta.url),'utf8')));
 const p=project();p.pieces=[];p.defaultAllowanceMm=0;p.surface=surface;
 const before=structuredClone(p),output=resolve('test-results/2026-10-27-sewing-lines');mkdirSync(output,{recursive:true});
 writeFileSync(resolve(output,'concave-material-opening-input.json'),JSON.stringify(p));
 let candidate:Awaited<ReturnType<typeof cutPreview>>;
 try{candidate=await cutPreview(resolve('target/release/fpcad-worker.exe'),surface,p,{method:'arap',partitionStrategy:'design',automaticCuts:true},resolve('dist/assets'));}
 finally{expect(p).toEqual(before);}
 writeFileSync(resolve(output,'concave-material-opening-candidate.json'),JSON.stringify(candidate));
 const run=candidate.run;
 expect(run.pieces.length).toBeGreaterThan(0);
 // A generous fabrication ceiling for one small local material patch, not
 // the expected answer. In particular, 26 separate source triangles fail.
 expect(run.pieces.length).toBeLessThanOrEqual(8);
 expect(run.bindings).toHaveLength(run.pieces.length);
 const originals=new Map(surface.faces.map(face=>[face.id,face])),vertices=new Map(surface.vertices.map(vertex=>[vertex.id,[vertex.xMm,vertex.yMm,vertex.zMm]])),covered=new Map<string,Point2[][]>();
 let measuredAreaErrorMax=0,measuredEdgeErrorMax=0;
 for(const binding of run.bindings){
  const report=binding.report;
  expect(report.areaErrorMax).toBeLessThanOrEqual(.15);
  expect(report.edgeErrorMax).toBeLessThanOrEqual(.1);
  expect(report.distortionMax).toBeLessThanOrEqual(.15);
  expect(report.seamErrorMax??0).toBeLessThanOrEqual(.0005);
  expect(report.seamLengthErrorMm??0).toBeLessThanOrEqual(.25);
  expect(binding.trim).toBeDefined();
  const trim=binding.trim!,uv=new Map(trim.vertices.map(vertex=>[vertex.id,[vertex.xMm,vertex.yMm]]));
  for(const triangle of trim.triangles){
   const source=originals.get(triangle.faceId);expect(source,triangle.faceId).toBeDefined();
   const corners=source!.vertices.map(id=>vertices.get(id)!);
   for(const weights of triangle.barycentric){expect(weights.every(n=>Number.isFinite(n)&&n>=-1e-9&&n<=1+1e-9)).toBe(true);expect(weights.reduce((sum,n)=>sum+n,0)).toBeCloseTo(1,10);}
   const local=triangle.barycentric.map(weights=>[weights[1],weights[2]] as Point2);
   expect(twiceArea(local),triangle.faceId).toBeGreaterThan(0);
   covered.set(triangle.faceId,[...(covered.get(triangle.faceId)??[]),local]);
   const physical=triangle.barycentric.map(weights=>[0,1,2].map(axis=>weights.reduce((sum,n,i)=>sum+n*corners[i][axis],0))),flat=triangle.vertices.map(id=>uv.get(id)!);
   expect(flat.every(Boolean)).toBe(true);expect(twiceArea(flat as Point2[])).toBeGreaterThan(0);
   const physicalArea=triangleArea(physical),flatArea=triangleArea(flat.map(point=>[...point,0]));
   expect(physicalArea).toBeGreaterThan(0);
   measuredAreaErrorMax=Math.max(measuredAreaErrorMax,Math.abs(flatArea/physicalArea-1));
   for(let i=0;i<3;i++){const next=(i+1)%3;measuredEdgeErrorMax=Math.max(measuredEdgeErrorMax,Math.abs(distance(flat[i],flat[next])/distance(physical[i],physical[next])-1));}
  }
 }
 expect(measuredAreaErrorMax).toBeLessThanOrEqual(.15);expect(measuredEdgeErrorMax).toBeLessThanOrEqual(.1);
 expect(new Set(covered.keys())).toEqual(new Set(originals.keys()));
 for(const face of surface.faces){
  const triangles=covered.get(face.id)!;
  expect(triangles.reduce((sum,triangle)=>sum+twiceArea(triangle),0),face.id).toBeCloseTo(1,8);
  for(let i=0;i<triangles.length;i++)for(let j=i+1;j<triangles.length;j++)expect(Math.abs(twiceArea(intersection(triangles[i],triangles[j]))),face.id).toBeLessThanOrEqual(1e-8);
 }
 writeFileSync(resolve(output,'concave-material-opening-metrics.json'),JSON.stringify({pieces:run.pieces.length,originalFaces:surface.faces.length,coveredFaces:covered.size,measuredAreaErrorMax,measuredEdgeErrorMax},null,2));
 expect(p).toEqual(before);
},120000);
