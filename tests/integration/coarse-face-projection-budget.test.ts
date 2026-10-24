import {it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {randomUUID} from 'node:crypto';
import {project} from '../fixtures';
import {pieceSchema,surfaceSchema,anatomicalPlacementSchema,markingSchema} from '../../packages/schema/index';
import {projectReferenceGeometry,clip,area,triangleClip,clippedWeights,type XY} from '../../apps/desktop/main/markings';
import {analyze} from '../../apps/desktop/main/worker';
import {placedPoint} from '../../packages/reference/placement-transform';

it('preserves a dense curved marking on coarse head faces within stored fragment budgets',async()=>{
 const fixture=JSON.parse(readFileSync(resolve('tests/fixtures/coarse-head-curved-projection.json'),'utf8'));
 const source=pieceSchema.parse(fixture.source),surface=surfaceSchema.parse(fixture.surface),placement=anatomicalPlacementSchema.parse(fixture.placement);
 const p={...project(),pieces:[source],surface},before=structuredClone(p),worker=resolve('target/release/fpcad-worker.exe');
 const geometry=(await analyze(worker,p))[0],subject=[geometry.seam!,...geometry.seamHoles??[]].map(r=>r.map(v=>{const q=placedPoint(v,placement);return [q.xMm,q.yMm] as XY;}));
 const vertices=new Map(surface.vertices.map(v=>[v.id,v]));
 const faces=surface.faces.map(f=>({f,ring:f.vertices.map(id=>{const v=vertices.get(id)!;return [-v.xMm,v.yMm] as XY;})})).filter(f=>area(f.ring)>0);
 const raw=await clip(worker,faces.map(f=>({subjects:subject,clips:[f.ring]})),12);
 expect(raw.flat().some(r=>r.length>2000),'fixture must exercise the former schema failure').toBe(true);
 const result=await projectReferenceGeometry(worker,p,source.id,'back',0,0,placement);
 expect(p).toEqual(before);expect(result.fragments.length).toBeGreaterThan(0);
 const decoded=result.fragments.flatMap(fragment=>{const face=surface.faces.find(f=>f.id===fragment.faceId)!;return fragment.rings.map(r=>r.map(w=>w.reduce((q,n,i)=>{const v=vertices.get(face.vertices[i])!;return [q[0]-n*v.xMm,q[1]+n*v.yMm] as XY;},[0,0] as XY)));});
 const expected=raw.flat().reduce((s,r)=>s+area(r),0),actual=decoded.reduce((s,r)=>s+area(r),0);
 expect(Math.abs(actual-expected)).toBeLessThan(Math.abs(expected)*.0001);
 // Compare topology after the same barycentric round trip on both sides:
 // sub-picometre reconstruction differences can separate adjacent face edges
 // on a 12-digit boolean grid even before any node compaction.
 const baseline=raw.flatMap((rings,i)=>rings.map(r=>triangleClip(r,faces[i].ring).map(p=>clippedWeights(p,faces[i].ring).reduce((q,w,j)=>[q[0]+w*faces[i].ring[j][0],q[1]+w*faces[i].ring[j][1]] as XY,[0,0] as XY))));
 const union=(await clip(worker,[{subjects:baseline,union:true},{subjects:decoded,union:true}],12));
 expect(union[1].filter(r=>area(r)>0).length).toBe(union[0].filter(r=>area(r)>0).length);
 expect(union[1].filter(r=>area(r)<0).length).toBe(union[0].filter(r=>area(r)<0).length);
 expect(()=>markingSchema.parse({id:randomUUID(),name:source.name,color:source.color,source:'reference',sourceHash:'fixture',surfaceId:surface.id,topologyVersion:surface.topologyVersion,surfaceHash:'fixture',view:'back',offsetXmm:0,offsetYmm:0,fragments:result.fragments,paths:[]})).not.toThrow();
},30000);
