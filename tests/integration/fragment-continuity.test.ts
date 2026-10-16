import {expect,it} from 'vitest';
import {resolve} from 'node:path';
import {parseObj} from '../../apps/desktop/main/surface';
import {continuousFragments} from '../../apps/desktop/main/fragment-continuity';
import {clip} from '../../apps/desktop/main/markings';
import type {Marking} from '../../packages/schema/index';
const surface=parseObj('v 0 0 0\nv 100 0 0\nv 100 100 0\nv 0 100 0\nf 1 2 3\nf 1 3 4');
const full=[[.9999998,.0000001,.0000001],[.0000001,.9999998,.0000001],[.0000001,.0000001,.9999998]] as [number,number,number][];
const marking={view:'front',fragments:[{faceId:surface.faces[0].id,rings:[full]},{faceId:surface.faces[1].id,rings:[[full[0],[.5,.5,0],full[1],full[2]]]}]} as Marking;
const mapped=(m:Marking['fragments'])=>m.flatMap(f=>f.rings.map(r=>r.map(w=>[w.reduce((s,n,i)=>s+n*surface.vertices.find(v=>v.id===surface.faces.find(x=>x.id===f.faceId)!.vertices[i])!.xMm,0),w.reduce((s,n,i)=>s+n*surface.vertices.find(v=>v.id===surface.faces.find(x=>x.id===f.faceId)!.vertices[i])!.yMm,0)] as [number,number])));
it('joins legacy independently rounded face fragments without introducing a diagonal sewing seam',async()=>{
 const worker=resolve('target/release/fpcad-worker.exe'),before=structuredClone(marking),raw=(await clip(worker,[{subjects:mapped(marking.fragments),union:true}],12))[0];
 expect(raw.length).toBeGreaterThan(1);
 const fragments=continuousFragments(surface,marking),rings=(await clip(worker,[{subjects:mapped(fragments),union:true}],12))[0];expect(rings).toHaveLength(1);
 expect(Math.abs(rings[0].reduce((s,p,i,r)=>s+p[0]*r[(i+1)%r.length][1]-r[(i+1)%r.length][0]*p[1],0)/2)).toBeCloseTo(10000,7);
 expect(marking).toEqual(before);expect(fragments[0].rings[0]).toContainEqual([.5,0,.5]);
});
it('retains deliberate fine boundaries outside the original clipping error budget',()=>{
 const m={view:'front',fragments:[{faceId:surface.faces[0].id,rings:[[[.99998,.00001,.00001],[.1,.8,.1],[.1,.1,.8]]]}]} as Marking;
 expect(continuousFragments(surface,m)).toEqual(m.fragments);
});
it('retains a positive-area narrow color island next to a mesh edge',()=>{
 const bary=([x,y]:[number,number]):[number,number,number]=>[1-x/100,x/100-y/100,y/100],ring=[[20,.00005],[50,.00005],[50,.00015],[20,.00015]].map(p=>bary(p as [number,number]));
 const m={view:'front',fragments:[{faceId:surface.faces[0].id,rings:[ring]}]} as Marking,output=continuousFragments(surface,m);
 const before=mapped(m.fragments)[0],after=mapped(output)[0],area=(r:[number,number][])=>Math.abs(r.reduce((s,p,i)=>{const q=r[(i+1)%r.length];return s+p[0]*q[1]-q[0]*p[1];},0)/2);
 expect(area(before)).toBeCloseTo(.003,10);expect(area(after)).toBeCloseTo(area(before),10);expect(output).toEqual(m.fragments);
});
it('retains a narrow positive-area hole next to a mesh edge',()=>{
 const bary=([x,y]:[number,number]):[number,number,number]=>[1-x/100,x/100-y/100,y/100],hole=[[20,.00005],[20,.00015],[50,.00015],[50,.00005]].map(p=>bary(p as [number,number]));
 const m={view:'front',fragments:[{faceId:surface.faces[0].id,rings:[[[1,0,0],[0,1,0],[0,0,1]],hole]}]} as Marking,output=continuousFragments(surface,m);
 expect(output[0].rings).toHaveLength(2);expect(output[0].rings[1]).toEqual(hole);
});
