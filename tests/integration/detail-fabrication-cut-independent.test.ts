import {expect,it} from 'vitest';
import {randomUUID} from 'node:crypto';
import {resolve} from 'node:path';
import {mkdirSync,writeFileSync} from 'node:fs';
import {box,detailPlane,detailWorker,ring,sourceFragmentArea,trimPhysicalArea} from '../fixtures/detail-fabrication';
import {detailUnderlaySources} from '../../apps/desktop/main/detail-underlay';
import {prepareCutMarkings} from '../../apps/desktop/main/cut-markings';
import {cutPreview} from '../../apps/desktop/main/cut-preview';
import {analyze} from '../../apps/desktop/main/worker';
import {projectMarking,markingIssues} from '../../apps/desktop/main/markings';
import {bindingIssues} from '../../apps/desktop/main/surface';
import {materialIssues} from '../../packages/manufacturing/material';
import {svgExport,dxfExport} from '../../apps/desktop/main/export';
import type {Project} from '../../packages/schema/index';

const polygonArea=(r:{xMm:number;yMm:number}[])=>Math.abs(r.reduce((s,a,i)=>{const b=r[(i+1)%r.length];return s+a.xMm*b.yMm-b.xMm*a.yMm;},0)/2);
async function remap(p:Project){p.markings=[];for(const r of p.patternLibrary!)p.markings.push(await projectMarking(detailWorker,p,r.piece.id,'front',0,0));}
async function candidate(p:Project){const before=structuredClone(p),c=await cutPreview(detailWorker,p.surface!,p,{partitionStrategy:'design',automaticCuts:true,colorBoundaryCuts:true,method:'arap'},resolve('dist/assets'));expect(p).toEqual(before);const ready={...p,pieces:c.run.pieces,bindings:c.run.bindings,markings:c.markings},g=await analyze(detailWorker,ready);expect(g.flatMap(g=>g.issues).filter(i=>i.severity==='error')).toEqual([]);expect(bindingIssues(ready).filter(i=>i.severity==='error')).toEqual([]);expect(markingIssues(ready)).toEqual([]);return{c,ready,g};}
function fullCoverage(p:Project,ready:Project,total:number){const coverage=new Map<string,number>();for(const b of ready.bindings!)for(const t of b.trim!.triangles){const [a,b,c]=t.barycentric;coverage.set(t.faceId,(coverage.get(t.faceId)??0)+Math.abs((b[1]-a[1])*(c[2]-a[2])-(b[2]-a[2])*(c[1]-a[1])));}expect(new Set(coverage.keys())).toEqual(new Set(p.surface!.faces.map(f=>f.id)));for(const f of p.surface!.faces)expect(coverage.get(f.id)).toBeCloseTo(1,8);expect(ready.bindings!.reduce((s,b)=>s+trimPhysicalArea(p.surface!,b),0)).toBeCloseTo(total,6);}

it('detail artwork preserves print paths and SVG/DXF output without adding a material panel or losing source faces',async()=>{
 const {p,body,detail}=await detailPlane({detailRole:'detail'}),baseline={...p,patternLibrary:p.patternLibrary!.filter(r=>r.piece.id===body.id),markings:p.markings!.filter(m=>m.sourcePieceId===body.id)},plain=await candidate(baseline),printed=await candidate(p);expect(plain.ready.pieces).toHaveLength(1);expect(printed.ready.pieces).toHaveLength(1);expect(printed.ready.pieces[0].color).toBe(body.color);fullCoverage(p,printed.ready,10000);const ink=printed.ready.markings!.find(m=>m.sourcePieceId===detail.id)!;expect(ink.fabrication).toBe('detail');expect(ink.paths).toHaveLength(1);expect(polygonArea(ink.paths[0].rings[0])).toBeCloseTo(400,6);const ack=[...printed.g.flatMap(g=>g.issues),...bindingIssues(printed.ready),...materialIssues(printed.ready)].map(i=>i.ruleId),svg=svgExport(printed.ready,printed.g,ack);expect(svg).toContain('<title>Eye ink</title>');expect(svg).toContain('fill="#080608"');expect(svg.match(/<g id="Cut"[^>]*>(.*?)<\/g>/s)![1].match(/<path/g)).toHaveLength(1);expect(svg).toContain('calibration-100mm');expect(dxfExport(printed.ready,printed.g,ack)).toContain('MARKING');
},60000);
it.each(['complete-square','control-polygon-only'] as const)('a legal sampled curved hole uses its complete contour for %s coverage and preserves unrelated geometry',async mode=>{
 const {p,body,detail}=await detailPlane({sourceHole:true,detailRole:'detail'});
 // Piece.curves currently describes the outer outline only. Store a curved
 // hole as its legal sampled node ring; do not invent unsupported hole curves.
 const knots=[[40,50],[50,60],[60,50],[50,40]],k=4*(Math.sqrt(2)-1)/3*10;
 const controls=[[[40,50+k],[50-k,60]],[[50+k,60],[60,50+k]],[[60,50-k],[50+k,40]],[[50-k,40],[40,50-k]]];
 const circle=ring(knots.flatMap((a,i)=>Array.from({length:16},(_,j)=>{const t=j/16,u=1-t,b=knots[(i+1)%4],[c,d]=controls[i];return[0,1].map(axis=>u*u*u*a[axis]+3*u*u*t*c[axis]+3*u*t*t*d[axis]+t*t*t*b[axis]);})));
 const other=ring([[10,10],[10,20],[20,20],[20,10]]);body.holes=[circle,other];
 const outerCurve={id:randomUUID(),startNodeId:body.nodes[0].id,endNodeId:body.nodes[1].id,c1:{id:randomUUID(),xMm:30,yMm:2},c2:{id:randomUUID(),xMm:70,yMm:2}};
 body.curves=[outerCurve];if(mode==='control-polygon-only')detail.nodes=ring([[40,50],[50,40],[60,50],[50,60]]);
 const [geometry]=await analyze(detailWorker,{...p,pieces:[body]});expect(geometry.issues.filter(i=>i.severity==='error')).toEqual([]);
 expect(polygonArea(geometry.seamHoles![0])).toBeCloseTo(polygonArea(circle),8);expect(polygonArea(circle)).toBeGreaterThan(300);expect(polygonArea(ring(knots))).toBe(200);
 await remap(p);const before=structuredClone(p),underlay=await detailUnderlaySources(detailWorker,p),cloth=p.markings!.find(m=>m.sourcePieceId===body.id)!;
 if(mode==='complete-square'){
  expect(underlay.get(cloth.id)!.holes).toEqual([other]);expect(underlay.get(cloth.id)!.curves).toEqual([outerCurve]);
  const [filled]=await analyze(detailWorker,{...p,pieces:[underlay.get(cloth.id)!]});expect(filled.issues.filter(i=>i.severity==='error')).toEqual([]);expect(filled.seamHoles).toHaveLength(1);
  expect(filled.areaMm2-geometry.areaMm2).toBeCloseTo(polygonArea(circle),6);
 }else expect(underlay.size).toBe(0);
 expect(p).toEqual(before);mkdirSync('test-results/detail-fabrication-independent',{recursive:true});writeFileSync('test-results/detail-fabrication-independent/legal-curved-'+mode+'.json',JSON.stringify({source:body,detail,geometry,derived:[...underlay]},null,2));
},60000);
it('complete detail coverage fills only a derived source colour hole and keeps every original source intact',async()=>{
 const {p,body,detail}=await detailPlane({sourceHole:true,detailRole:'detail'}),before=structuredClone(p),cloth=p.markings!.find(m=>m.sourcePieceId===body.id)!,derived=await detailUnderlaySources(detailWorker,p);expect(derived.get(cloth.id)!.holes).toEqual([]);const prepared=await prepareCutMarkings(detailWorker,p);expect(sourceFragmentArea(prepared,prepared.markings!.find(m=>m.id===cloth.id)!)).toBeCloseTo(10000,6);expect(sourceFragmentArea(prepared,prepared.markings!.find(m=>m.sourcePieceId===detail.id)!)).toBeCloseTo(400,6);const {ready,g}=await candidate(p);expect(ready.pieces).toHaveLength(1);expect(g[0].seamHoles??[]).toHaveLength(0);fullCoverage(p,ready,10000);expect(p).toEqual(before);
},60000);
it.each(['partial','wrong-reference','wrong-frame','uv-manual','inferred'] as const)('%s detail cannot silently fill a saved cloth hole',async mode=>{
 const {p,body,detail}=await detailPlane({sourceHole:true,detailRole:'detail',detailWidth:mode==='partial'?10:20}),ink=p.markings!.find(m=>m.sourcePieceId===detail.id)!;if(mode==='wrong-reference')p.patternLibrary!.find(r=>r.piece.id===detail.id)!.referenceId=randomUUID();if(mode==='wrong-frame')ink.offsetXmm=.1;if(mode==='uv-manual')ink.editMode='uv-manual';if(mode==='inferred')ink.inference={algorithm:'exact-symmetry-x-1',sourceMarkingId:p.markings![0].id,sourceFingerprint:'0'.repeat(64),distanceMm:1,planeXmm:0,reviewed:false};const before=structuredClone(p);expect((await detailUnderlaySources(detailWorker,p)).size).toBe(0);expect(body.holes).toHaveLength(1);expect(p).toEqual(before);
},30000);
it('a different attachment frame rejects underlay even when its shifted larger artwork still physically covers the entire hole',async()=>{
 const {p,detail}=await detailPlane({sourceHole:true,detailRole:'detail'});detail.nodes=ring([[30,30],[70,30],[70,70],[30,70]]);await remap(p);
 expect((await detailUnderlaySources(detailWorker,p)).size).toBe(1);
 const ink=p.markings!.find(m=>m.sourcePieceId===detail.id)!;ink.offsetXmm=.1;
 const shifted=detail.nodes.map(n=>({xMm:n.xMm+ink.offsetXmm,yMm:n.yMm+ink.offsetYmm}));
 // Physical full coverage is independent of the source-frame identity gate.
 expect(Math.min(...shifted.map(p=>p.xMm))).toBeLessThan(40);expect(Math.max(...shifted.map(p=>p.xMm))).toBeGreaterThan(60);expect(Math.min(...shifted.map(p=>p.yMm))).toBeLessThan(40);expect(Math.max(...shifted.map(p=>p.yMm))).toBeGreaterThan(60);
 const before=structuredClone(p);expect((await detailUnderlaySources(detailWorker,p)).size).toBe(0);expect(p).toEqual(before);
},30000);
it('filling a source colour hole cannot fill a real surface opening underneath it',async()=>{
 const {p,body,detail}=await detailPlane({sourceHole:true,physicalHole:true,detailRole:'detail'}),before=structuredClone(p),derived=await detailUnderlaySources(detailWorker,p);expect(derived.get(p.markings!.find(m=>m.sourcePieceId===body.id)!.id)!.holes).toEqual([]);const {ready,g}=await candidate(p);expect(ready.pieces).toHaveLength(1);expect(g[0].seamHoles).toHaveLength(1);expect(g[0].cutHoles).toHaveLength(1);expect(polygonArea(g[0].seamHoles![0])).toBeCloseTo(400,5);fullCoverage(p,ready,9600);expect(sourceFragmentArea(p,p.markings!.find(m=>m.sourcePieceId===detail.id)!)).toBeCloseTo(1200,6);expect(p).toEqual(before);
},60000);
it('independent detail colours jointly cover a cloth hole without their nested holes cancelling each other',async()=>{
 const {p,body,detail,referenceId}=await detailPlane({sourceHole:true,detailRole:'detail'});detail.holes=[ring([[45,45],[45,55],[55,55],[55,45]])];await remap(p);const cloth=p.markings!.find(m=>m.sourcePieceId===body.id)!;expect((await detailUnderlaySources(detailWorker,p)).size).toBe(0);
 const highlight=box(45,45,10,10,'Eye highlight','#ffffff');p.patternLibrary!.push({piece:highlight,referenceId,view:'front',category:'eye',fabrication:'detail'});await remap(p);const before=structuredClone(p),derived=await detailUnderlaySources(detailWorker,p);expect(derived.get(cloth.id)??derived.get(p.markings!.find(m=>m.sourcePieceId===body.id)!.id)).toMatchObject({holes:[]});const {ready}=await candidate(p);expect(ready.pieces).toHaveLength(1);fullCoverage(p,ready,10000);expect(ready.markings!.filter(m=>m.fabrication==='detail')).toHaveLength(2);expect(p).toEqual(before);
},60000);
