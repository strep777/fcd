import {it,expect} from 'vitest';
import {resolve} from 'node:path';
import {project} from '../fixtures';
import {parseObj,generateTorso,unwrapSurface,validateSurface,bindingIssues} from '../../apps/desktop/main/surface';
import {analyze} from '../../apps/desktop/main/worker';
import {Repository} from '../../apps/desktop/main/repository';
import {pack,unpack} from '../../apps/desktop/main/archive';
import {randomUUID} from 'node:crypto';
const worker=resolve('target/release/fpcad-worker.exe');
const rectangleObj='v 0 0 0\nv 100 0 0\nv 100 200 0\nv 0 200 0\nf 1 2 3\nf 1 3 4\n';
it('planar LSCM is isometric in mm, candidate leaves pieces untouched, acceptance and undo preserve binding',async()=>{
 const p=project();p.pieces=[];p.surface=parseObj(rectangleObj);const before=structuredClone(p),run=await unwrapSurface(worker,p.surface,p);expect(p).toEqual(before);expect(run.pieces).toHaveLength(1);const r=run.bindings[0].report;expect(r.status).toBe('acceptable');expect(r.edgeErrorMax).toBeLessThan(1e-8);expect(r.distortionMax).toBeLessThan(1e-8);const g=await analyze(worker,{...p,pieces:run.pieces});expect(g[0].areaMm2).toBeCloseTo(20000,5);expect(g[0].perimeterMm).toBeCloseTo(600,5);
 const repo=new Repository(':memory:');repo.open(p,null);repo.commit({type:'unwrap.candidate',run},randomUUID(),'candidate');expect(repo.snapshot()?.pieces).toHaveLength(0);repo.commit({type:'unwrap.accept'},randomUUID(),'accept');expect(repo.snapshot()?.pieces).toHaveLength(1);expect(bindingIssues(repo.snapshot()!)).toEqual([]);expect(unpack(pack(repo.snapshot()!).bytes)).toEqual(repo.snapshot());repo.historyMove(false);expect(repo.snapshot()?.pieces).toHaveLength(0);repo.historyMove(true);expect(repo.snapshot()?.bindings).toHaveLength(1);const changed=repo.snapshot()!;changed.pieces[0].nodes[0].xMm++;expect(bindingIssues(changed)[0].messageKey).toBe('STALE_BINDING');repo.close();
});
it('OBJ handles explicit scale and negative indices, rejects nontriangular and invalid faces',()=>{
 expect(parseObj(rectangleObj,10).vertices[1].xMm).toBe(1000);expect(parseObj('v 0 0 0\nv 1 0 0\nv 0 1 0\nf -3 -2 -1').faces).toHaveLength(1);expect(()=>parseObj(rectangleObj.replace('f 1 2 3','f 1 2 3 4'))).toThrow('OBJ_TRIANGLES_REQUIRED');expect(()=>parseObj(rectangleObj.replace('f 1 2 3','f 0 2 3'))).toThrow('INVALID_MESH');expect(()=>parseObj(rectangleObj.replace('v 100 200 0','v 100 0 0'))).toThrow('DEGENERATE_MESH');
});
it('closed patches require explicit cuts; reversed adjacent winding is rejected',async()=>{
 const closed=parseObj('v 0 0 0\nv 100 0 0\nv 0 100 0\nv 0 0 100\nf 1 3 2\nf 1 2 4\nf 1 4 3\nf 2 3 4');await expect(unwrapSurface(worker,closed,project())).rejects.toThrow('PATCH_NEEDS_CUTS');expect(()=>parseObj(rectangleObj.replace('f 1 3 4','f 1 4 3'))).toThrow('MESH_ORIENTATION');
});
it('procedural torso has exact baseline ring girths and stable IDs; four groups produce real unwrap reports',async()=>{
 const params={heightMm:600,neckGirthMm:500,chestGirthMm:1100,waistGirthMm:900,hipGirthMm:1000,depthRatio:.7,chestPaddingMm:0,waistPaddingMm:0,hipPaddingMm:0,layerMm:0},body=generateTorso(params);validateSurface(body);expect(body.vertices).toHaveLength(192);expect(body.faces).toHaveLength(288);
 const ring=body.vertices.slice(96,144),girth=ring.reduce((s,a,i)=>{const b=ring[(i+1)%ring.length];return s+Math.hypot(a.xMm-b.xMm,a.zMm-b.zMm);},0);expect(girth).toBeCloseTo(1100,8);expect(Math.max(...body.vertices.map(v=>v.yMm))).toBe(600);
 const changed=generateTorso({...params,chestGirthMm:1200},body);expect(changed.vertices.map(v=>v.id)).toEqual(body.vertices.map(v=>v.id));expect(changed.topologyVersion).toBe(2);const run=await unwrapSurface(worker,body,{...project(),pieces:[]});expect(run.pieces).toHaveLength(4);expect(run.bindings.every(b=>Number.isFinite(b.report.distortionMean))).toBe(true);
});
it('ARAP preserves flat isometry and decreases curved triangle energy without losing faces',async()=>{
 const p={...project(),pieces:[]};const flat=await unwrapSurface(worker,parseObj(rectangleObj),p,{method:'arap'});expect(flat.bindings[0].report.edgeErrorMax).toBeLessThan(1e-8);expect(flat.bindings[0].report.arap?.energyAfter).toBeLessThan(1e-12);
 const curved=parseObj('v 0 0 0\nv 100 0 0\nv 100 100 60\nv 0 100 0\nv 50 50 35\nf 1 2 5\nf 2 3 5\nf 3 4 5\nf 4 1 5');const run=await unwrapSurface(worker,curved,p,{method:'arap',iterations:50});const r=run.bindings[0].report;expect(r.arap).toBeDefined();expect(r.arap!.energyAfter).toBeLessThan(r.arap!.energyBefore);expect(r.faceDistortion?.map(d=>d.faceId).sort()).toEqual(curved.faces.map(f=>f.id).sort());expect(r.arap!.iterations).toBeGreaterThan(0);
});
it('automatic seams open a closed manifold into disk patches, preserving every original face',async()=>{
 const mesh=parseObj('v 0 0 0\nv 100 0 0\nv 0 100 0\nv 0 0 100\nf 1 3 2\nf 1 2 4\nf 1 4 3\nf 2 3 4');const run=await unwrapSurface(worker,mesh,{...project(),pieces:[]},{method:'arap',automaticCuts:true,normalAngleDeg:180});expect(run.pieces.length).toBeGreaterThan(1);expect(run.cutEdges?.length).toBeGreaterThan(0);expect(run.bindings.flatMap(b=>b.report.faceIds).sort()).toEqual(mesh.faces.map(f=>f.id).sort());expect(new Set(run.bindings.flatMap(b=>b.report.faceIds)).size).toBe(mesh.faces.length);expect(run.bindings.every(b=>b.report.arap!.energyAfter<=b.report.arap!.energyBefore+1e-12)).toBe(true);
});
it('trial cuts preserve region hard boundaries and never replace a lower-cost legal candidate',async()=>{
 const mesh=generateTorso({heightMm:600,neckGirthMm:500,chestGirthMm:1100,waistGirthMm:900,hipGirthMm:1000,depthRatio:.7,chestPaddingMm:0,waistPaddingMm:0,hipPaddingMm:0,layerMm:0}),before=structuredClone(mesh);const run=await unwrapSurface(worker,mesh,{...project(),pieces:[]},{method:'arap',automaticCuts:true,optimizeCuts:true,searchPasses:3,iterations:15,maxPieces:50});expect(run.optimization!.finalCost).toBeLessThanOrEqual(run.optimization!.initialCost+1e-12);expect(run.optimization!.trials).toBeLessThanOrEqual(3);for(const b of run.bindings){const regions=new Set(mesh.faces.filter(f=>b.report.faceIds.includes(f.id)).map(f=>f.region));expect(regions.size).toBe(1);}expect(mesh).toEqual(before);await expect(unwrapSurface(worker,mesh,{...project(),pieces:[]},{automaticCuts:true,maxPieces:2})).rejects.toThrow('PATCH_LIMIT');
});
it('locked mesh edges remain cut under normal growth and trial-cut optimization',async()=>{
 const mesh=parseObj(rectangleObj);mesh.cutConstraints=[{a:mesh.vertices[0].id,b:mesh.vertices[2].id,locked:true}];const run=await unwrapSurface(worker,mesh,{...project(),pieces:[]},{method:'arap',automaticCuts:true,optimizeCuts:true,normalAngleDeg:180});expect(run.pieces).toHaveLength(2);expect(run.cutEdges?.map(e=>[...e].sort().join(':'))).toContain([mesh.vertices[0].id,mesh.vertices[2].id].sort().join(':'));expect(run.bindings.every(b=>b.report.faceIds.length===1)).toBe(true);expect(()=>validateSurface({...mesh,cutConstraints:[{a:mesh.vertices[0].id,b:mesh.vertices[3].id,locked:true}]})).not.toThrow();expect(()=>validateSurface({...mesh,cutConstraints:[{a:mesh.vertices[1].id,b:mesh.vertices[3].id,locked:true}]})).toThrow('INVALID_MESH');
});

it('many unfolded panels form a usable two-dimensional overview with unchanged binding geometry',async()=>{
 let obj='';for(let i=0;i<30;i++){const offset=i*4;obj+='v '+i*110+' 0 0\nv '+(i*110+100)+' 0 0\nv '+(i*110+100)+' 100 0\nv '+i*110+' 100 0\ng panel-'+i+'\nf '+(offset+1)+' '+(offset+2)+' '+(offset+3)+'\nf '+(offset+1)+' '+(offset+3)+' '+(offset+4)+'\n';}
 const p=project();p.pieces=[];p.surface=parseObj(obj);const r=await unwrapSurface(worker,p.surface,p);const nodes=r.pieces.flatMap(p=>p.nodes),w=Math.max(...nodes.map(n=>n.xMm))-Math.min(...nodes.map(n=>n.xMm)),h=Math.max(...nodes.map(n=>n.yMm))-Math.min(...nodes.map(n=>n.yMm));expect(w/h).toBeLessThan(4);p.pieces=r.pieces;p.bindings=r.bindings;expect(bindingIssues(p)).toEqual([]);const g=await analyze(worker,p);expect(g.every(g=>Math.abs(g.areaMm2-10000)<1e-6)).toBe(true);
});
