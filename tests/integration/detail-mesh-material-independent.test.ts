import {expect,it} from 'vitest';
import {randomUUID} from 'node:crypto';
import {resolve} from 'node:path';
import {project,rectangle} from '../fixtures';
import {parseObj,unwrapSurface,bindingIssues} from '../../apps/desktop/main/surface';
import {projectMarking,markingIssues} from '../../apps/desktop/main/markings';
import {unwrapMarkings} from '../../apps/desktop/main/unwrap-markings';
import {cutPreview} from '../../apps/desktop/main/cut-preview';
import {analyze} from '../../apps/desktop/main/worker';
import {svgExport,dxfExport} from '../../apps/desktop/main/export';
import {materialIssues} from '../../packages/manufacturing/material';
import type {Project} from '../../packages/schema/index';

const worker=resolve('target/release/fpcad-worker.exe');
const options={partitionStrategy:'mesh' as const,automaticCuts:true,colorBoundaryCuts:true,method:'arap' as const};
const area=(ring:{xMm:number;yMm:number}[])=>Math.abs(ring.reduce((sum,a,i)=>{const b=ring[(i+1)%ring.length];return sum+a.xMm*b.yMm-b.xMm*a.yMm;},0)/2);
async function fixture(inkWidth:number,sewn=false){
 const p=project();p.pieces=[];p.defaultAllowanceMm=0;p.surface=parseObj('v 0 0 0\nv 100 0 0\nv 100 100 0\nv 0 100 0\ng torso\nf 1 2 3\nf 1 3 4');
 const source=(name:string,color:string,width:number,fabrication:'detail'|'sewn')=>{const piece=rectangle(width,width);piece.name=name;piece.color=color;piece.allowanceMm=0;return{piece,referenceId:randomUUID(),view:'front' as const,category:'body',fabrication};};
 p.patternLibrary=[...(sewn?[source('Sewn blue cloth','#2786b6',20,'sewn')]:[]),source('Printed black detail','#080608',inkWidth,'detail')];p.markings=[];
 for(const r of p.patternLibrary)p.markings.push(await projectMarking(worker,p,r.piece.id,'front',0,0));return p;
}
async function cut(p:Project){
 const before=structuredClone(p),c=await cutPreview(worker,p.surface!,p,options,resolve('dist/assets')),ready={...p,pieces:c.run.pieces,bindings:c.run.bindings,markings:c.markings},geometry=await analyze(worker,ready);
 expect(p).toEqual(before);expect(geometry.flatMap(g=>g.issues.filter(i=>i.severity==='error'))).toEqual([]);expect(bindingIssues(ready).filter(i=>i.severity==='error')).toEqual([]);expect(markingIssues(ready)).toEqual([]);expect(geometry.reduce((sum,g)=>sum+g.areaMm2,0)).toBeCloseTo(10000,7);return{c,ready,geometry};
}
function exportedDetail(r:Awaited<ReturnType<typeof cut>>,expectedArea:number){
 const ink=r.ready.markings!.find(m=>m.fabrication==='detail')!;expect(ink).toBeDefined();expect(ink.paths.reduce((sum,p)=>sum+p.rings.reduce((n,ring)=>n+area(ring),0),0)).toBeCloseTo(expectedArea,7);
 const ack=[...r.geometry.flatMap(g=>g.issues),...bindingIssues(r.ready),...materialIssues(r.ready)].map(i=>i.ruleId),svg=svgExport(r.ready,r.geometry,ack),dxf=dxfExport(r.ready,r.geometry,ack);
 expect(svg).toContain('<title>Printed black detail</title>');expect(svg).toContain('fill="#080608"');expect(svg).toContain('calibration-100mm');expect(dxf).toMatch(/\r?\nMARKING\r?\n/);
}

it.each([20,100])('mesh compatibility with only a %s mm detail keeps the unpainted baseline cloth colour/count and real export paths',async width=>{
 const p=await fixture(width),plain=await cut({...p,markings:[]}),printed=await cut(p);
 expect(plain.c.run.pieces).toHaveLength(1);expect(printed.c.run.pieces).toHaveLength(1);expect(printed.c.run.bindings[0].trim).toBeUndefined();expect(printed.c.run.pieces.map(p=>p.color)).toEqual(plain.c.run.pieces.map(p=>p.color));expect(printed.c.run.pieces[0].color).not.toBe('#080608');expect(printed.c.run.bindings[0].report.faceIds.slice().sort()).toEqual(p.surface!.faces.map(f=>f.id).sort());exportedDetail(printed,width*width);
},60000);

it('a larger printed layer cannot replace sewn cloth colour in the real nontrim mapping stage or final mesh cut',async()=>{
 const p=await fixture(100,true),before=structuredClone(p),run=await unwrapSurface(worker,p.surface!,p,options),mapped=await unwrapMarkings(worker,p,run,9,1e-9);
 expect(run.pieces).toHaveLength(1);expect(run.bindings[0].trim).toBeUndefined();expect(run.pieces[0].color).toBe('#2786b6');const ink=mapped.find(m=>m.fabrication==='detail')!,cloth=mapped.find(m=>m.fabrication==='sewn')!;expect(ink.paths.reduce((sum,p)=>sum+area(p.rings[0]),0)).toBeCloseTo(10000,7);expect(cloth.paths.reduce((sum,p)=>sum+area(p.rings[0]),0)).toBeCloseTo(400,7);expect(p).toEqual(before);
 const result=await cut(p);expect(result.c.run.pieces).toHaveLength(2);expect(new Set(result.c.run.pieces.map(p=>p.color))).toEqual(new Set(['#2786b6','#eceae5']));expect(result.geometry.find(g=>result.ready.pieces.find(p=>p.id===g.id)?.color==='#2786b6')!.areaMm2).toBeCloseTo(400,7);exportedDetail(result,10000);
},60000);
