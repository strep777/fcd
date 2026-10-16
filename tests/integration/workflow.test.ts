import {interiorAnchor} from '../../packages/pattern/interior';
import {it,expect} from 'vitest';
import {randomUUID} from 'node:crypto';
import {resolve} from 'node:path';
import {project,rectangle} from '../fixtures';
import {splitReferencePixels} from '../../apps/desktop/main/automatic-reference';
import {parseObj,unwrapSurface,bindingIssues} from '../../apps/desktop/main/surface';
import {projectMarking,markingIssues,editMarking} from '../../apps/desktop/main/markings';
import {unwrapMarkings} from '../../apps/desktop/main/unwrap-markings';
import {adjustPattern} from '../../apps/desktop/main/pattern-adjustment';
import {insertCutPoint} from '../../apps/desktop/main/cut-points';
import {area,weights} from '../../apps/desktop/main/markings';
import {refreshSavedModelMarkings} from '../../apps/desktop/main/model-markings';
import {colorCuts} from '../../apps/desktop/main/color-cuts';
import {surfaceCutPath} from '../../packages/surface/cut-path';
import {mapToSurface,mapFromSurface} from '../../packages/surface/mapping';
import {Repository} from '../../apps/desktop/main/repository';
import {pack,unpack} from '../../apps/desktop/main/archive';
import {cutBundle,readCutBundle,workflowBytes,readWorkflow,selectedProject,printHtml} from '../../apps/desktop/main/workflow-exchange';
import {analyze} from '../../apps/desktop/main/worker';
import {svgExport,pdfExport} from '../../apps/desktop/main/export';
import {PDFDocument} from 'pdf-lib';
import type {Reference} from '../../packages/schema/index';
const worker=resolve('target/release/fpcad-worker.exe');
const obj='v 0 0 0\nv 100 0 0\nv 200 0 0\nv 0 100 0\nv 100 100 0\nv 200 100 0\ng left\nf 1 2 5\nf 1 5 4\ng right\nf 2 3 6\nf 2 6 5';

it('automatic splitting retains every color, removes border background and keeps interior white islands',()=>{
 const width=40,height=40,rgba=new Uint8Array(width*height*4).fill(255);
 for(let y=5;y<35;y++)for(let x=5;x<35;x++)rgba.set(x<20?[255,0,0,255]:[0,0,255,255],(y*width+x)*4);
 for(let y=10;y<15;y++)for(let x=10;x<15;x++)rgba.set([255,255,255,255],(y*width+x)*4);
 const reference={id:randomUUID(),name:'test',view:'front',width,height,png:'data:image/png;base64,AAAA',calibration:{a:{x:20,y:40},b:{x:20,y:0},distanceMm:100}} as Reference;
 const regions=splitReferencePixels(reference,width,height,rgba,3,true);
 expect(new Set(regions.map(r=>r.piece.color))).toEqual(new Set(['#ff0000','#0000ff','#ffffff']));
 expect(regions).toHaveLength(3);expect(regions.find(r=>r.piece.color==='#ffffff')!.piece.nodes.every(n=>Math.abs(n.xMm)<50)).toBe(true);
 expect(regions.every(r=>r.referenceId===reference.id&&r.view==='front')).toBe(true);
});

it('markings attach before unwrap, map to every candidate and survive cuts, acceptance, adjustments and exchange',async()=>{
 const p=project();p.pieces=[];p.surface=parseObj(obj);const source=rectangle(100,60);source.allowanceMm=0;source.color='#ff3300';source.nodes.forEach(n=>{n.xMm+=50;n.yMm+=20;});
 p.patternLibrary=[{piece:source,referenceId:randomUUID(),view:'front',category:'orange'}];
 const marking=await projectMarking(worker,p,source.id,'front',0,0);expect(marking.paths).toHaveLength(0);expect(marking.fragments).toHaveLength(4);p.markings=[marking];
 const repo=new Repository(':memory:');repo.open(p,null);
 const constraints={...p.surface,cutConstraints:[{a:p.surface.faces[0].vertices[0],b:p.surface.faces[0].vertices[1],locked:true}]};
 repo.commit({type:'surface.set',surface:constraints},randomUUID(),'cuts');const cutProject=repo.snapshot()!;
 const run=await unwrapSurface(worker,cutProject.surface!,cutProject,{automaticCuts:true});
 const markings=await unwrapMarkings(worker,cutProject,run);expect(markings[0].paths.length).toBeGreaterThanOrEqual(2);expect(run.pieces.every(piece=>piece.color===source.color)).toBe(true);
 repo.commit({type:'unwrap.candidate',run,markings},randomUUID(),'candidate');expect(repo.snapshot()!.pieces).toHaveLength(0);repo.commit({type:'unwrap.accept'},randomUUID(),'accepted');
 const ready=repo.snapshot()!;expect(markingIssues(ready)).toEqual([]);expect(bindingIssues(ready)).toEqual([]);expect(ready.modelLibrary).toHaveLength(1);
 const piece=structuredClone(ready.pieces[0]);piece.nodes[0].xMm+=.1;const adjustment=await adjustPattern(worker,ready,piece);expect(adjustment).not.toBeNull();repo.commit({type:'piece.adjusted',...adjustment!},randomUUID(),'adjust');const adjusted=repo.snapshot()!;
 expect(markingIssues(adjusted)).toEqual([]);expect(bindingIssues(adjusted).every(i=>i.severity==='warning')).toBe(true);
 expect(adjusted.bindings![0].report.faceDistortion!.every(f=>f.angleError!==undefined&&Math.abs(f.distortion-(.4*f.areaError+.4*f.edgeError+.2*f.angleError))<1e-12)).toBe(true);
 const geometry=await analyze(worker,adjusted),ack=[...geometry.flatMap(g=>g.issues.filter(i=>i.severity==='warning').map(i=>i.ruleId)),...bindingIssues(adjusted).map(i=>i.ruleId)];
 const svg=svgExport(adjusted,geometry,ack);expect(svg).toContain('fill="#ff3300"');expect(svg).toContain('id="Color"');
 const subset=selectedProject(adjusted,[piece.id]),pdf=await PDFDocument.load(await pdfExport(subset,geometry.filter(g=>g.id===piece.id),ack,{widthMm:297,heightMm:420,marginMm:10,overlapMm:10}));
 expect(pdf.getPage(0).getWidth()).toBeCloseTo(297*72/25.4);expect(pdf.getPage(0).getHeight()).toBeCloseTo(420*72/25.4);
 expect(unpack(pack(adjusted).bytes)).toEqual(adjusted);expect(readWorkflow(workflowBytes(adjusted))).toEqual(adjusted);expect(readCutBundle(cutBundle(adjusted,geometry))).toEqual(adjusted);
 const html=printHtml(svg,{widthMm:210,heightMm:297,marginMm:10,overlapMm:10});expect(html).toContain('size:210mm 297mm');expect(html).toContain('print-color-adjust:exact');
 repo.historyMove(false);expect(repo.snapshot()!.pieces).toEqual(ready.pieces);repo.close();
});

it('model CRUD restores model-specific markings and pieces and repeated unwrap replaces existing cuts',async()=>{
 const p=project();p.pieces=[];const repo=new Repository(':memory:');repo.open(p,null);const first=parseObj(obj),second=parseObj(obj);
 repo.commit({type:'surface.set',surface:first},randomUUID(),'first');let current=repo.snapshot()!;const run=await unwrapSurface(worker,first,current);repo.commit({type:'unwrap.candidate',run},randomUUID(),'run');repo.commit({type:'unwrap.accept'},randomUUID(),'accept');const firstPieces=repo.snapshot()!.pieces;
 repo.commit({type:'surface.set',surface:second},randomUUID(),'second');expect(repo.snapshot()!.pieces).toHaveLength(0);expect(repo.snapshot()!.modelLibrary).toHaveLength(2);
 repo.commit({type:'model.rename',modelId:first.id,name:'Saved shell'},randomUUID(),'rename');repo.commit({type:'model.activate',modelId:first.id},randomUUID(),'activate');expect(repo.snapshot()!.pieces).toEqual(firstPieces);
 current=repo.snapshot()!;const again=await unwrapSurface(worker,first,{...current,pieces:[]});repo.commit({type:'unwrap.candidate',run:again},randomUUID(),'rerun');repo.commit({type:'unwrap.accept'},randomUUID(),'reaccept');expect(repo.snapshot()!.pieces.length).toBe(firstPieces.length);
 repo.commit({type:'model.delete',modelId:first.id},randomUUID(),'delete');expect(repo.snapshot()!.surface).toBeUndefined();expect(repo.snapshot()!.modelLibrary).toHaveLength(1);repo.historyMove(false);expect(repo.snapshot()!.surface?.id).toBe(first.id);repo.close();
});

it('flow and bundle imports reject unsupported versions and tampered files',async()=>{
 const p=project(),geometry=await analyze(worker,p),bundle=cutBundle(p,geometry),corrupt=Uint8Array.from(bundle);corrupt[100]^=1;
 expect(()=>readCutBundle(corrupt)).toThrow();expect(()=>readWorkflow(new TextEncoder().encode(JSON.stringify({format:'fpcad-workflow',version:999,project:p})))).toThrow();
});

it('inserting a cut point refines shared faces and locked cuts without losing attached color coverage',async()=>{
 const p=project();p.pieces=[];p.surface=parseObj(obj);const source=rectangle(180,80);source.allowanceMm=0;source.color='#aabbcc';source.nodes.forEach(n=>{n.xMm+=10;n.yMm+=10;});p.patternLibrary=[{piece:source,referenceId:randomUUID(),view:'front',category:'test'}];p.markings=[await projectMarking(worker,p,source.id,'front',0,0)];
 const a=p.surface.faces[0].vertices[0],b=p.surface.faces[0].vertices[2];p.surface.cutConstraints=[{a,b,locked:true}];p.markings[0].surfaceHash=(await import('../../apps/desktop/main/repository')).hash(JSON.stringify(p.surface));
 const coverage=(project:typeof p)=>{const vertices=new Map(project.surface!.vertices.map(v=>[v.id,v])),faces=new Map(project.surface!.faces.map(f=>[f.id,f]));return project.markings![0].fragments.reduce((sum,fragment)=>sum+fragment.rings.reduce((s,ring)=>s+area(ring.map(w=>{const triangle=faces.get(fragment.faceId)!.vertices.map(id=>vertices.get(id)!);return [w.reduce((v,n,i)=>v+n*triangle[i].xMm,0),w.reduce((v,n,i)=>v+n*triangle[i].yMm,0)];})),0),0);};
 const refined=await insertCutPoint(worker,p,a,b,.37),next={...p,surface:refined.surface,markings:refined.markings};expect(next.surface.vertices.length).toBe(p.surface.vertices.length+1);expect(next.surface.faces.length).toBe(p.surface.faces.length+2);expect(next.surface.cutConstraints).toHaveLength(2);expect(Math.abs(coverage(next)-coverage(p))).toBeLessThan(.001);expect(next.markings[0].color).toBe(source.color);
 const repo=new Repository(':memory:');repo.open(p,null);repo.commit({type:'surface.refined',surface:refined.surface,markings:refined.markings},randomUUID(),'point');const run=await unwrapSurface(worker,refined.surface,next,{automaticCuts:true});const markings=await unwrapMarkings(worker,next,run);repo.commit({type:'unwrap.candidate',run,markings},randomUUID(),'run');repo.commit({type:'unwrap.accept'},randomUUID(),'accept');expect(bindingIssues(repo.snapshot()!)).toEqual([]);expect(markingIssues(repo.snapshot()!)).toEqual([]);repo.historyMove(false);repo.historyMove(false);repo.historyMove(false);expect(repo.snapshot()!.surface).toEqual(p.surface);expect(repo.snapshot()!.markings).toEqual(p.markings);repo.close();
 await expect(insertCutPoint(worker,p,a,b,0)).rejects.toThrow('INVALID_SELECTION');
});

it('shared library edits and deletion update attachments in inactive saved models atomically',async()=>{
 const p=project();p.pieces=[];p.surface=parseObj(obj);const source=rectangle(180,80);source.allowanceMm=0;source.nodes.forEach(n=>{n.xMm+=10;n.yMm+=10;});const region={piece:source,referenceId:randomUUID(),view:'front' as const,category:'test'};p.patternLibrary=[region];p.markings=[await projectMarking(worker,p,source.id,'front',0,0)];const repo=new Repository(':memory:');repo.open(p,null);repo.commit({type:'workflow.node',node:{key:'references',title:'test',notes:'',completed:false}},randomUUID(),'save');const first=p.surface.id;repo.commit({type:'surface.set',surface:parseObj(obj)},randomUUID(),'other');
 const nextRegion={...region,piece:{...source,color:'#123456'}},proposed={...repo.snapshot()!,patternLibrary:[nextRegion]},models=await refreshSavedModelMarkings(worker,proposed,source.id);repo.commit({type:'library.region.update',region:nextRegion,markings:[],models},randomUUID(),'source');repo.commit({type:'model.activate',modelId:first},randomUUID(),'restore');expect(repo.snapshot()!.markings![0].color).toBe('#123456');expect(markingIssues(repo.snapshot()!)).toEqual([]);
 repo.commit({type:'surface.set',surface:parseObj(obj)},randomUUID(),'another');repo.commit({type:'library.region.delete',pieceId:source.id},randomUUID(),'delete');expect(repo.snapshot()!.modelLibrary!.find(m=>m.id===first)!.markings).toEqual([]);repo.historyMove(false);expect(repo.snapshot()!.modelLibrary!.find(m=>m.id===first)!.markings).toHaveLength(1);repo.close();
});

it('visible color boundaries become disjoint sewing cuts with exact 3D mapping, holes, editable boundaries and exchange',async()=>{
 const p=project();p.pieces=[];p.surface=parseObj(obj);const red=rectangle(120,60),blue=rectangle(30,30);red.allowanceMm=0;blue.allowanceMm=0;red.color='#ff0000';blue.color='#0000ff';red.nodes.forEach(n=>{n.xMm+=40;n.yMm+=20;});blue.nodes.forEach(n=>{n.xMm+=60;n.yMm+=35;});p.patternLibrary=[red,blue].map(piece=>({piece,referenceId:randomUUID(),view:'front' as const,category:piece.color}));p.markings=[await projectMarking(worker,p,red.id,'front',0,0),await projectMarking(worker,p,blue.id,'front',0,0)];
 const raw=await unwrapSurface(worker,p.surface,p),mapped=await unwrapMarkings(worker,p,raw),run=await colorCuts(worker,p,raw,mapped),markings=await unwrapMarkings(worker,p,run),ready={...p,pieces:run.pieces,bindings:run.bindings,markings};
 expect(new Set(ready.pieces.map(p=>p.color))).toEqual(new Set(['#ff0000','#0000ff','#eceae5']));expect(ready.bindings.every(b=>!!b.trim)).toBe(true);expect(ready.pieces.some(p=>p.holes!.length)).toBe(true);for(const piece of ready.pieces){const anchor=interiorAnchor(piece.nodes,piece.holes);expect(anchor.clearanceMm).toBeGreaterThan(0);expect(mapToSurface(ready.surface!,ready.bindings.find(b=>b.pieceId===piece.id)!,anchor)).not.toBeNull();}
 const total=ready.pieces.reduce((s,p)=>s+area(p.nodes.map(n=>[n.xMm,n.yMm]))+(p.holes??[]).reduce((s,h)=>s+area(h.map(n=>[n.xMm,n.yMm])),0),0);const parentArea=raw.pieces.reduce((sum,p)=>sum+area(p.nodes.map(n=>[n.xMm,n.yMm])),0);expect(Math.abs(total-parentArea)/parentArea).toBeLessThan(1e-6);expect(bindingIssues(ready)).toEqual([]);expect(markingIssues(ready)).toEqual([]);
 const piece=ready.pieces.find(p=>p.color==='#0000ff')!,binding=ready.bindings.find(b=>b.pieceId===piece.id)!,point=mapFromSurface(binding,ready.surface!.faces[0].id,weights([75,50],ready.surface!.faces[0].vertices.map(id=>{const v=ready.surface!.vertices.find(v=>v.id===id)!;return [v.xMm,v.yMm];})),ready.surface!)!,mappedPoint=mapToSurface(ready.surface!,binding,point)!;expect(mappedPoint.position.xMm).toBeCloseTo(75,3);expect(mappedPoint.position.yMm).toBeCloseTo(50,3);const roundtrip=mapFromSurface(binding,mappedPoint.faceId,mappedPoint.barycentric,ready.surface!)!;expect(roundtrip.xMm).toBeCloseTo(point.xMm,6);expect(roundtrip.yMm).toBeCloseTo(point.yMm,6);expect(mapToSurface(ready.surface!,binding,{xMm:-10000,yMm:-10000})).toBeNull();
 const changed=structuredClone(piece);changed.nodes[0].xMm+=.1;const adjustment=await adjustPattern(worker,ready,changed);expect(adjustment).not.toBeNull();const adjusted={...ready,pieces:ready.pieces.map(p=>p.id===piece.id?adjustment!.piece:p),bindings:adjustment!.bindings,markings:adjustment!.markings};expect(bindingIssues(adjusted).every(i=>i.severity==='warning')).toBe(true);expect(markingIssues(adjusted)).toEqual([]);const geometry=await analyze(worker,adjusted);expect(geometry.flatMap(g=>g.issues.filter(i=>i.severity==='error'))).toEqual([]);expect(readCutBundle(cutBundle(adjusted,geometry))).toEqual(adjusted);expect(readWorkflow(workflowBytes(adjusted))).toEqual(adjusted);
 const holed=ready.pieces.find(p=>p.holes?.length)!,holeChanged=structuredClone(holed);holeChanged.holes![0][0].xMm+=.05;const holeAdjustment=await adjustPattern(worker,ready,holeChanged);expect(holeAdjustment).not.toBeNull();expect(bindingIssues({...ready,pieces:ready.pieces.map(p=>p.id===holed.id?holeChanged:p),bindings:holeAdjustment!.bindings,markings:holeAdjustment!.markings}).every(i=>i.severity==='warning')).toBe(true);
 const path=ready.markings.find(m=>m.color==='#0000ff')!,rings=path.paths.find(r=>r.pieceId===piece.id)!.rings,shrunken=rings.map(r=>r.map(v=>({xMm:point.xMm+(v.xMm-point.xMm)*.9,yMm:point.yMm+(v.yMm-point.yMm)*.9}))),edited=await editMarking(worker,ready,path.id,piece.id,shrunken);expect(edited.editMode).toBe('uv-manual');expect(edited.fragments.length).toBeGreaterThan(0);expect(markingIssues({...ready,markings:ready.markings.map(m=>m.id===edited.id?edited:m)})).toEqual([]);
 const recolored={...adjusted,markings:adjusted.markings.map(m=>({...m,color:'#abcdef'}))};expect(bindingIssues(recolored).every(i=>i.severity==='error')).toBe(true);
});

it('surface cut drawing connects shortest mesh paths and rejects disconnected endpoints',()=>{
 const surface=parseObj(obj),a=surface.vertices[0].id,b=surface.vertices[5].id,path=surfaceCutPath(surface,a,b);expect(path[0].a).toBe(a);expect(path.at(-1)!.b).toBe(b);expect(path.every(e=>surface.faces.some(f=>f.vertices.includes(e.a)&&f.vertices.includes(e.b)))).toBe(true);for(let i=1;i<path.length;i++)expect(path[i].a).toBe(path[i-1].b);expect(()=>surfaceCutPath(surface,a,a)).toThrow('INVALID_SELECTION');const isolated={id:randomUUID(),xMm:500,yMm:500,zMm:500};expect(()=>surfaceCutPath({...surface,vertices:[...surface.vertices,isolated]},a,isolated.id)).toThrow('CUT_PATH_DISCONNECTED');
});
