import {randomUUID} from 'node:crypto';
import {resolve} from 'node:path';
import {expect,it} from 'vitest';
import type {Surface} from '../../packages/schema/index';
import {unwrapSurface} from '../../apps/desktop/main/surface';
import {adjustPattern} from '../../apps/desktop/main/pattern-adjustment';
import {mapFromSurface,mapToSurface} from '../../packages/surface/mapping';
import {project} from '../fixtures';

const worker=resolve('target/release/fpcad-worker.exe');
async function ready(){
 const coordinates=[[[0,0],[50,0],[100,0],[100,50],[100,100],[50,100],[0,100],[0,50]],[[30,30],[50,30],[70,30],[70,50],[70,70],[50,70],[30,70],[30,50]]];
 const rings=coordinates.map(r=>r.map(([xMm,yMm])=>({id:randomUUID(),xMm,yMm,zMm:0}))),faces:Surface['faces']=[];
 const face=(vertices:string[])=>faces.push({id:randomUUID(),region:'cloth',vertices:vertices as [string,string,string]});
 for(let i=0;i<8;i++){const j=(i+1)%8;face([rings[0][i].id,rings[0][j].id,rings[1][j].id]);}
 // Start each raw boundary at an actual corner, so the simplifier's retained
 // cyclic start does not itself add an otherwise redundant fifth station.
 for(const i of [7,0,1,2,3,4,5,6]){const j=(i+1)%8;face([rings[0][i].id,rings[1][j].id,rings[1][i].id]);}
 const p=project();p.pieces=[];p.defaultAllowanceMm=0;p.surface={id:randomUUID(),topologyVersion:1,source:'obj',vertices:rings.flat(),faces};
 const run=await unwrapSurface(worker,p.surface,p,{partitionStrategy:'mesh',automaticCuts:false,colorBoundaryCuts:false,method:'lscm'});
 expect(run.pieces).toHaveLength(1);expect(run.bindings[0].trim).toBeUndefined();
 expect(run.bindings[0].report.boundary).toHaveLength(4);expect(run.bindings[0].report.holes).toHaveLength(1);expect(run.bindings[0].report.holes![0]).toHaveLength(4);
 p.pieces=run.pieces;p.bindings=run.bindings;
 return {p,outer:rings[0],hole:rings[1]};
}

it('outer editing retains every unchanged hole-boundary station after an eight-point hole is simplified to four corners',async()=>{
 const {p,hole}=await ready(),before=structuredClone(p),binding=p.bindings![0],oldUv=new Map(binding.report.uv.map(v=>[v.vertexId,v])),piece=structuredClone(p.pieces[0]);
 piece.nodes[0].xMm+=.2;
 const result=await adjustPattern(worker,p,piece);expect(result).not.toBeNull();expect(p).toEqual(before);
 const updated=result!.bindings[0],uv=new Map(updated.report.uv.map(v=>[v.vertexId,v]));
 expect(updated.trim).toBeUndefined();expect(result!.piece.holes).toEqual(p.pieces[0].holes);
 // This checks all eight true source stations, including the four stations
 // omitted from the editable paper-hole ring by boundary simplification.
 for(const v of hole)expect(uv.get(v.id)).toEqual(oldUv.get(v.id));
 for(const face of p.surface!.faces){
  const weights:[number,number,number]=[.2,.3,.5],flat=mapFromSurface(updated,face.id,weights,p.surface!);expect(flat).not.toBeNull();
  const hit=mapToSurface(p.surface!,updated,flat!);expect(hit).not.toBeNull();expect(hit!.faceId).toBe(face.id);
  hit!.barycentric.forEach((w,i)=>expect(w).toBeCloseTo(weights[i],12));
 }
});

it('a simplified outer edge midpoint follows the interpolated displacement of that physical edge',async()=>{
 const {p,outer}=await ready(),binding=p.bindings![0],uv=new Map(binding.report.uv.map(v=>[v.vertexId,v])),a=uv.get(binding.report.boundary[0])!,b=uv.get(binding.report.boundary[1])!,dx=b.xMm-a.xMm,dy=b.yMm-a.yMm,length2=dx*dx+dy*dy;
 const middle=outer.map(v=>uv.get(v.id)!).find(v=>!binding.report.boundary.includes(v.vertexId)&&Math.abs((v.xMm-a.xMm)*dy-(v.yMm-a.yMm)*dx)<1e-9&&((v.xMm-a.xMm)*dx+(v.yMm-a.yMm)*dy)/length2>.1&&((v.xMm-a.xMm)*dx+(v.yMm-a.yMm)*dy)/length2<.9);
 expect(middle).toBeDefined();const t=((middle!.xMm-a.xMm)*dx+(middle!.yMm-a.yMm)*dy)/length2,piece=structuredClone(p.pieces[0]);piece.nodes[0].xMm+=.2;
 const result=await adjustPattern(worker,p,piece);expect(result).not.toBeNull();const moved=result!.bindings[0].report.uv.find(v=>v.vertexId===middle!.vertexId)!;
 expect(moved.xMm).toBeCloseTo(middle!.xMm+.2*(1-t),12);expect(moved.yMm).toBe(middle!.yMm);
});
