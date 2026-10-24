import {expect,it} from 'vitest';
import {resolve} from 'node:path';
import {randomUUID} from 'node:crypto';
import {project} from '../fixtures';
import {parseObj} from '../../apps/desktop/main/surface';
import {surfaceMarking} from '../../apps/desktop/main/markings';
import {fragmentPatternRings} from '../../apps/desktop/main/fragment-mapping';
import {editSurfaceCuts,cutComponents} from '../../apps/desktop/main/cut-tools';
import {mirrorPaintShape,mirrorSurfacePoint} from '../../packages/surface/symmetry';
import {surfaceCurveSegments} from '../../packages/surface/surface-curve';
import {candidateSeamPreview} from '../../packages/surface/candidate-seams';
import type {Binding,CutProjection,SurfaceRun} from '../../packages/schema/index';
const worker=resolve('target/release/fpcad-worker.exe'),frame:CutProjection={origin:[0,0,0],axes:[[1,0,0],[0,1,0],[0,0,1]]};
it('a source decal crosses adjacent part labels while staying on its anchored surface',async()=>{
 const p=project();p.pieces=[];p.surface=parseObj('v -100 0 0\nv 0 0 0\nv 100 0 0\nv -100 100 0\nv 0 100 0\nv 100 100 0\ng left\nf 1 2 5\nf 1 5 4\ng right\nf 2 3 6\nf 2 6 5');
 const marking=await surfaceMarking(worker,p,{...frame,anchorFaceId:p.surface.faces[0].id,nodes:[{xMm:-40,yMm:20},{xMm:40,yMm:20},{xMm:40,yMm:80},{xMm:-40,yMm:80}]},'#ff8800','Cross seam');
 expect(new Set(marking.fragments.map(f=>p.surface!.faces.find(face=>face.id===f.faceId)!.region))).toEqual(new Set(['left','right']));
 const mirrored=await surfaceMarking(worker,p,mirrorPaintShape(p.surface,marking.surfaceShape!),marking.color,'Mirror');
 expect(mirrored.fragments.length).toBe(marking.fragments.length);
});
it('trimmed UV mapping preserves two independent fragments on the same model triangle',async()=>{
 const mesh=parseObj('v 0 0 0\nv 100 0 0\nv 0 100 0\nf 1 2 3'),faceId=mesh.faces[0].id,ids=mesh.vertices.map(v=>v.id),report={faceIds:[faceId],uv:mesh.vertices.map(v=>({vertexId:v.id,xMm:v.xMm,yMm:v.yMm})),boundary:ids,areaErrorMax:0,edgeErrorMax:0,distortionMean:0,distortionP95:0,distortionMax:0,status:'acceptable' as const};
 const binding:Binding={pieceId:randomUUID(),surfaceId:mesh.id,topologyVersion:1,geometryHash:'0'.repeat(64),surfaceHash:'0'.repeat(64),report,trim:{vertices:mesh.vertices.map(v=>({id:v.id,xMm:v.xMm,yMm:v.yMm})),triangles:[{faceId,vertices:ids as [string,string,string],barycentric:[[1,0,0],[0,1,0],[0,0,1]]}],boundary:ids,holes:[]}};
 const result=await fragmentPatternRings(worker,mesh,binding,[{faceId,rings:[[[.8,.1,.1],[.7,.2,.1],[.7,.1,.2]]]},{faceId,rings:[[[.4,.5,.1],[.3,.6,.1],[.3,.5,.2]]]}]);
 expect(result).toHaveLength(2);
 const area=result.reduce((s,r)=>s+Math.abs(r.reduce((a,p,i)=>a+p[0]*r[(i+1)%r.length][1]-r[(i+1)%r.length][0]*p[1],0)/2),0);expect(area).toBeCloseTo(100,5);
 const run={bindings:[binding]} as SurfaceRun;expect(candidateSeamPreview(mesh,run)).toHaveLength(3);
});
it('world-anchored cuts persist as continuous real seams, with mirrored cuts in the other region',async()=>{
 const p=project();p.pieces=[];p.surface=parseObj('v -100 0 0\nv 0 0 0\nv 100 0 0\nv -100 100 0\nv 0 100 0\nv 100 100 0\ng left\nf 1 2 5\nf 1 5 4\ng right\nf 2 3 6\nf 2 6 5');
 const before=structuredClone(p),result=await editSurfaceCuts(worker,p,{type:'surface.curve',name:'Closed surface path',kind:'pen',surfaceAnchored:true,controlPoints:[[40,20],[60,50],[40,80]].map(([xMm,yMm])=>({id:randomUUID(),xMm,yMm,zMm:0})),projection:frame,tension:1,closed:true,symmetric:true,regions:['left','right']});
 expect(p).toEqual(before);expect(result.surface.cutLines).toHaveLength(2);for(const line of result.surface.cutLines!){expect(line.surfaceAnchored).toBe(true);expect(line.closed).toBe(true);expect(cutComponents(line.edges)).toHaveLength(1);}
});

it.each([false,true])('a mirrored anchored cut outside selected regions fails exactly as its preview and preserves the saved project (editing: %s)',async editing=>{
 let p=project();p.pieces=[];p.surface=parseObj('v -100 0 0\nv 0 0 0\nv 100 0 0\nv -100 100 0\nv 0 100 0\nv 100 100 0\ng left\nf 1 2 5\nf 1 5 4\ng right\nf 2 3 6\nf 2 6 5');
 const controlPoints=[[40,20],[60,50],[40,80]].map(([xMm,yMm])=>({id:randomUUID(),xMm,yMm,zMm:0})),base={type:'surface.curve' as const,name:'Restricted anchored pen',kind:'pen' as const,surfaceAnchored:true,controlPoints,projection:frame,tension:.5,closed:true,symmetric:false,regions:['right']};
 if(editing)p={...p,...await editSurfaceCuts(worker,p,base)};
 const before=structuredClone(p),mirrorPoints=controlPoints.map(point=>mirrorSurfacePoint(p.surface!,point));
 expect(surfaceCurveSegments(p.surface!,controlPoints,true,'preview',base.regions).length).toBeGreaterThan(0);
 expect(()=>surfaceCurveSegments(p.surface!,mirrorPoints,true,'mirror-preview',base.regions)).toThrow('CUT_OUTSIDE_SURFACE');
 // The opposite side is real geometry; only the selected region excludes it.
 expect(surfaceCurveSegments(p.surface!,mirrorPoints,true,'unrestricted-mirror-preview',['left','right']).length).toBeGreaterThan(0);
 await expect(editSurfaceCuts(worker,p,{...base,...(editing?{id:p.surface!.cutLines![0].id}:{}),symmetric:true})).rejects.toThrow('CUT_OUTSIDE_SURFACE');
 expect(p).toEqual(before);
});
