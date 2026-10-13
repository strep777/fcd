import {it,expect} from 'vitest';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import type Module from 'manifold-3d';
import {surfaceReportSchema,type Surface} from '../packages/schema/index';
import type {Bary} from '../packages/surface/refine';
import {triangulateMaterialTiles} from '../packages/surface/material-tiles';
import {validateSurface} from '../apps/desktop/main/surface';
import {request} from '../apps/desktop/main/worker';
const surface:Surface={id:'a0000000-0000-4000-8000-000000000000',source:'obj',topologyVersion:1,vertices:[{id:'a0000000-0000-4000-8000-000000000001',xMm:0,yMm:0,zMm:0},{id:'a0000000-0000-4000-8000-000000000002',xMm:20,yMm:0,zMm:0},{id:'a0000000-0000-4000-8000-000000000003',xMm:0,yMm:20,zMm:0}],faces:[{id:'a0000000-0000-4000-8000-000000000004',vertices:['a0000000-0000-4000-8000-000000000001','a0000000-0000-4000-8000-000000000002','a0000000-0000-4000-8000-000000000003'],region:'panel'}]};
const bary=([x,y]:number[]):Bary=>[1-(x+y)/20,x/20,y/20],island=[[4,4],[4.00006,4],[4,4.00012]].map(bary),outer=[[0,0],[20,0],[0,20]].map(bary),signed=(r:Bary[])=>r.reduce((s,a,i)=>{const b=r[(i+1)%r.length];return s+a[1]*b[2]-a[2]*b[1];},0)*200;
it('keeps a real island below the native area floor and a conforming base complement',async()=>{
 const load=(await import(pathToFileURL(resolve('dist/assets/manifold.mjs')).href)).default as typeof Module,wasm=await load({locateFile:()=>resolve('dist/assets/manifold.wasm')});wasm.setup();const tiles=[{faceId:surface.faces[0].id,color:'#ee1122',rings:[island]},{faceId:surface.faces[0].id,color:'#eceae5',rings:[outer,[...island].reverse()]}],before=structuredClone(tiles),w=triangulateMaterialTiles(surface,tiles,r=>wasm.triangulate(r,1e-9,false)),colored=[...w.provenance.values()].filter(m=>m.color==='#ee1122'),edges=new Map<string,number>();
 for(const f of w.surface.faces)f.vertices.forEach((a,i)=>{const key=[a,f.vertices[(i+1)%3]].sort().join('|');edges.set(key,(edges.get(key)??0)+1);});expect(tiles).toEqual(before);expect(colored).toHaveLength(1);expect(Math.abs(signed(colored[0].barycentric))).toBeCloseTo(3.6e-9,14);expect([...edges.values()].filter(n=>n===1)).toHaveLength(3);expect([...w.provenance.values()].reduce((s,m)=>s+Math.abs(signed(m.barycentric)),0)).toBeCloseTo(200,10);
});
it('solves a well-conditioned tiny material in physical units without changing its geometry',async()=>{
 const mesh:Surface={...surface,vertices:island.map((w,i)=>({id:surface.vertices[i].id,xMm:w[1]*20,yMm:w[2]*20,zMm:0})),faces:surface.faces.map(f=>({...f,region:'#ee1122'}))},before=structuredClone(mesh);
 expect(()=>validateSurface(mesh)).not.toThrow();const result=await request(resolve('target/release/fpcad-worker.exe'),{protocolVersion:1,operation:'surface.unwrap',mesh:{...mesh,method:'arap',iterations:30,repair_cuts:false}}) as {patches:unknown[]},reports=result.patches.map(r=>surfaceReportSchema.parse(r));
 expect(mesh).toEqual(before);expect(reports).toHaveLength(1);expect(reports[0].faceIds).toEqual([surface.faces[0].id]);expect(reports[0].areaErrorMax).toBeLessThan(1e-6);expect(reports[0].edgeErrorMax).toBeLessThan(1e-6);const uv=new Map(reports[0].uv.map(v=>[v.vertexId,v])),[a,b,c]=surface.faces[0].vertices.map(id=>uv.get(id)!);expect(Math.abs((b.xMm-a.xMm)*(c.yMm-a.yMm)-(b.yMm-a.yMm)*(c.xMm-a.xMm))/2).toBeCloseTo(3.6e-9,14);
});
