import {it,expect} from 'vitest';
import {randomUUID} from 'node:crypto';
import {resolve} from 'node:path';
import {PDFDocument} from 'pdf-lib';
import {analyze,booleanPieces} from '../../apps/desktop/main/worker';
import {svgExport,dxfExport,pdfExport,gate} from '../../apps/desktop/main/export';
import {pack,unpack} from '../../apps/desktop/main/archive';
import {Repository} from '../../apps/desktop/main/repository';
import {mapPiece,moveNode,duplicatePiece,splitEdge,edgeArcPoints} from '../../packages/pattern/edit';
import {project,rectangle} from '../fixtures';
import type {Point} from '../../packages/schema/index';
const worker=resolve('target/release/fpcad-worker.exe'),points=(coords:number[][]):Point[]=>coords.map(([xMm,yMm])=>({id:randomUUID(),xMm,yMm}));
it('hole area and boundary lengths, inward allowance and retained archive',async()=>{
 const p=project();p.pieces[0].holes=[points([[30,30],[70,30],[70,70],[30,70]])];const g=await analyze(worker,p);
 expect(g[0].issues).toEqual([]);expect(g[0].areaMm2).toBe(18400);expect(g[0].perimeterMm).toBe(760);expect(g[0].cutHoles?.[0].map(n=>n.xMm).sort((a,b)=>a-b)).toEqual([40,40,60,60]);
 expect(unpack(pack(p).bytes)).toEqual(p);expect(svgExport(p,g,[])).toContain('id="Notch"');
 const dxf=dxfExport(p,g,[]),tokens=dxf.split(/\r?\n/);expect(tokens[tokens.indexOf('$INSUNITS')+2]).toBe('4');
 const entities=dxf.split('0\r\nLWPOLYLINE\r\n').slice(1);expect(entities.filter(e=>e.includes('8\r\nCUT\r\n'))).toHaveLength(2);expect(entities.filter(e=>e.includes('8\r\nSEAM\r\n'))).toHaveLength(2);
});
it('outside, overlapping and collapsed holes explicitly block manufacture',async()=>{
 const p=project();p.pieces[0].holes=[points([[90,30],[110,30],[110,70],[90,70]])];expect((await analyze(worker,p))[0].issues[0].messageKey).toBe('holeOutside');
 p.pieces[0].holes=[points([[30,30],[70,30],[70,70],[30,70]]),points([[50,50],[80,50],[80,80],[50,80]])];expect((await analyze(worker,p))[0].issues[0].messageKey).toBe('holeOverlap');
 p.pieces[0].holes=[points([[30,30],[40,30],[40,40],[30,40]])];const g=await analyze(worker,p);expect(g[0].issues[0].messageKey).toBe('holeCollapsed');expect(()=>gate(p,g,[])).toThrow('INVALID_GEOMETRY');
});
it('boolean oracle: rectangle subtraction yields a hole, union and xor yield all islands; undo is atomic',async()=>{
 const a=rectangle(100,100),b=mapPiece(rectangle(40,40),n=>({xMm:n.xMm+30,yMm:n.yMm+30}));a.allowanceMm=0;
 const difference=await booleanPieces(worker,a,b,'difference');expect(difference).toHaveLength(1);expect(difference[0].holes).toHaveLength(1);
 const p=project();p.pieces=difference;expect((await analyze(worker,p))[0].areaMm2).toBe(8400);
 const c=mapPiece(rectangle(100,100),n=>({xMm:n.xMm+200,yMm:n.yMm}));expect(await booleanPieces(worker,a,c,'union')).toHaveLength(2);await expect(booleanPieces(worker,a,c,'intersection')).rejects.toThrow('emptyResult');
 const repo=new Repository(':memory:');repo.create('boolean');repo.commit({type:'pieces.replace',removeIds:[],pieces:[a,b]},randomUUID(),'seed');repo.commit({type:'pieces.replace',removeIds:[a.id,b.id],pieces:difference},randomUUID(),'boolean');expect(repo.snapshot()?.pieces).toHaveLength(1);repo.historyMove(false);expect(repo.snapshot()?.pieces).toEqual([a,b]);repo.historyMove(true);expect(repo.snapshot()?.pieces).toEqual(difference);repo.close();
});
it('cubic uses <= 0.01mm sampling and analytic area, round/bevel have distinct real geometry',async()=>{
 const p=project(),a=p.pieces[0].nodes[0],b=p.pieces[0].nodes[1];p.pieces[0].curves=[{id:randomUUID(),startNodeId:a.id,endNodeId:b.id,c1:{...a,id:randomUUID(),yMm:-40},c2:{...b,id:randomUUID(),yMm:-40}}];
 const g=await analyze(worker,p);expect(g[0].issues).toEqual([]);expect(g[0].seam!.length).toBeGreaterThan(50);expect(g[0].areaMm2).toBeCloseTo(22400,0);expect(Math.min(...g[0].seam!.map(n=>n.yMm))).toBe(-30);
 p.pieces=[rectangle()];p.pieces[0].join='round';const round=await analyze(worker,p);expect(round[0].issues).toEqual([]);const area=(r:Point[])=>Math.abs(r.reduce((s,a,i)=>{const b=r[(i+1)%r.length];return s+a.xMm*b.yMm-b.xMm*a.yMm;},0)/2);expect(area(round[0].cut)).toBeCloseTo(26000+Math.PI*100,0);
 p.pieces[0].join='bevel';expect(area((await analyze(worker,p))[0].cut)).toBe(26200);
});
it('holes, control handles, labels and node bindings survive all transformations and duplication',()=>{
 const p=rectangle(),[a,b]=p.nodes;p.curves=[{id:randomUUID(),startNodeId:a.id,endNodeId:b.id,c1:{...a,id:randomUUID(),yMm:-30},c2:{...b,id:randomUUID(),yMm:-30}}];p.holes=[points([[10,10],[20,10],[20,20],[10,20]])];p.notches=[{id:randomUUID(),nodeId:p.nodes[2].id,position:.5,depthMm:3,label:'A'}];p.labels=[{id:randomUUID(),xMm:50,yMm:50,text:'标注'}];
 const moved=mapPiece(p,n=>({xMm:n.xMm+10,yMm:n.yMm+20}));expect(moved.holes?.[0][0].xMm).toBe(20);expect(moved.curves?.[0].c1.yMm).toBe(-10);expect(moved.labels?.[0].xMm).toBe(60);
 const edited=moveNode(p,a.id,10,20);expect(edited.curves?.[0].c1.xMm).toBe(10);expect(edited.curves?.[0].c2).toEqual(p.curves[0].c2);
 const copy=duplicatePiece(p);expect(copy.id).not.toBe(p.id);expect(copy.curves?.[0].startNodeId).toBe(copy.nodes[0].id);expect(copy.notches?.[0].nodeId).toBe(copy.nodes[2].id);
});
it('notches and Unicode annotations export; invalid notch and wrong geometry order reject',async()=>{
 const p=project();p.pieces[0].notches=[{id:randomUUID(),nodeId:p.pieces[0].nodes[0].id,position:.5,depthMm:3,label:'A'}];p.pieces[0].labels=[{id:randomUUID(),xMm:50,yMm:50,text:'耳片'}];const g=await analyze(worker,p);expect(g[0].issues).toEqual([]);expect(svgExport(p,g,[])).toContain('耳片');expect(dxfExport(p,g,[])).toContain('8\r\nNOTCH\r\n');
 p.pieces[0].notches[0].depthMm=10;expect((await analyze(worker,p))[0].issues[0].messageKey).toBe('invalidNotch');
 expect(()=>gate(p,[{...g[0],id:randomUUID()}],[])).toThrow('INVALID_GEOMETRY');
});
it('custom and A3 PDF retain true millimetres and reject impossible tile overlap',async()=>{
 const p=project(),g=await analyze(worker,p),paper={widthMm:297,heightMm:420,marginMm:10,overlapMm:10};const pdf=await PDFDocument.load(await pdfExport(p,g,[],paper));expect(pdf.getPageCount()).toBe(1);expect(pdf.getPage(0).getWidth()*25.4/72).toBeCloseTo(297,10);
 await expect(pdfExport(p,g,[],{widthMm:100,heightMm:100,marginMm:10,overlapMm:90})).rejects.toThrow();
});

it('De Casteljau splitting preserves a cubic, area and perimeter to sampling tolerance',async()=>{
 const p=project(),[a,b]=p.pieces[0].nodes;p.pieces[0].curves=[{id:randomUUID(),startNodeId:a.id,endNodeId:b.id,c1:{...a,id:randomUUID(),yMm:-40},c2:{...b,id:randomUUID(),yMm:-40}}];const before=await analyze(worker,p);p.pieces[0]=splitEdge(p.pieces[0],a.id);expect(p.pieces[0].nodes[1].xMm).toBe(50);expect(p.pieces[0].nodes[1].yMm).toBe(-30);expect(p.pieces[0].curves).toHaveLength(2);const after=await analyze(worker,p);expect(after[0].issues).toEqual([]);expect(after[0].areaMm2).toBeCloseTo(before[0].areaMm2,6);expect(after[0].perimeterMm).toBeCloseTo(before[0].perimeterMm,6);
});

it('asymmetric cubic splitting preserves arc stations and variable allowance; copies remap hole edges',async()=>{
 const p=project(),piece=p.pieces[0],[a,b]=piece.nodes;piece.join='bevel';piece.curves=[{id:randomUUID(),startNodeId:a.id,endNodeId:b.id,c1:{...a,id:randomUUID(),yMm:-100},c2:{...b,id:randomUUID(),yMm:-20}}];piece.edgeAllowances=[{nodeId:a.id,endNodeId:b.id,samples:[{s:0,widthMm:6},{s:.4,widthMm:8},{s:1,widthMm:12}]}];piece.notches=[{id:randomUUID(),nodeId:a.id,position:.7,depthMm:3,label:'arc'}];const before=await analyze(worker,p);const split=splitEdge(piece,a.id,.3),length=(path:{xMm:number;yMm:number}[])=>path.slice(1).reduce((v,n,i)=>v+Math.hypot(n.xMm-path[i].xMm,n.yMm-path[i].yMm),0),left=length(edgeArcPoints(split,a.id)),right=length(edgeArcPoints(split,split.nodes[1].id)),fraction=left/(left+right);expect(Math.abs(fraction-.3)).toBeGreaterThan(.05);expect(split.notches![0].position).toBeCloseTo((.7-fraction)/(1-fraction),10);expect(split.edgeAllowances![0].samples.at(-1)!.widthMm).toBeCloseTo(split.edgeAllowances![1].samples[0].widthMm,10);p.pieces=[split];const after=await analyze(worker,p);expect(after[0].issues).toEqual([]);expect(Math.hypot(before[0].notchSegments![0].start.xMm-after[0].notchSegments![0].start.xMm,before[0].notchSegments![0].start.yMm-after[0].notchSegments![0].start.yMm)).toBeLessThan(.05);
 piece.holes=[points([[20,40],[70,40],[70,90],[20,90]])];piece.edgeAllowances!.push({nodeId:piece.holes[0][0].id,endNodeId:piece.holes[0][1].id,samples:[{s:0,widthMm:5},{s:1,widthMm:5}]});const copy=duplicatePiece(piece);expect(copy.edgeAllowances!.at(-1)!.nodeId).toBe(copy.holes![0][0].id);expect(copy.edgeAllowances!.at(-1)!.endNodeId).toBe(copy.holes![0][1].id);p.pieces=[copy];expect((await analyze(worker,p))[0].issues).toEqual([]);
});
