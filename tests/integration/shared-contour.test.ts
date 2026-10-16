import {it,expect} from 'vitest';import{randomUUID}from'node:crypto';import{resolve}from'node:path';
import{traceMask}from'../../apps/desktop/main/reference-segmentation';import{clip}from'../../apps/desktop/main/markings';import{edgeArcPoints}from'../../packages/pattern/edit';
import{recoverSharedContours}from'../../packages/reference/shared-contour';import{safeContour,contourBoundaryError}from'../../packages/reference/contour-topology';
import type{Piece}from'../../packages/schema/index';
const area=(rings:number[][][])=>Math.abs(rings.reduce((s,r)=>s+r.reduce((n,p,i)=>{const q=r[(i+1)%r.length];return n+p[0]*q[1]-q[0]*p[1];},0)/2,0));
const rings=(p:Piece)=>[p.nodes.flatMap(n=>edgeArcPoints(p,n.id).slice(0,-1)).map(n=>[n.xMm,n.yMm]as[number,number]),...(p.holes??[]).map(r=>r.map(n=>[n.xMm,n.yMm]as[number,number]))];
it.each(['diagonal','open-curve','ellipse','diamond'] as const)('shared %s boundaries remain one exact partition with original holes, straight sides and bounded fidelity',async mode=>{
 const width=200,height=180,masks=[new Uint8Array(width*height),new Uint8Array(width*height)];for(let y=10;y<170;y++)for(let x=10;x<190;x++){const first=mode==='diagonal'?x<30+.62*y:mode==='open-curve'?x<80+30*Math.sin(y/35):mode==='ellipse'?((x-100)/60)**2+((y-90)/50)**2<1:Math.abs(x-100)+Math.abs(y-90)<60;masks[first?0:1][y*width+x]=1;}
 const originals=masks.map(mask=>traceMask(width,height,mask,{a:{x:0,y:height},b:{x:0,y:0},distanceMm:height},width,height,'#123456',true).piece),{pieces,report}=recoverSharedContours(originals,.8,randomUUID);
 expect(report.sharedChains).toBeGreaterThan(0);for(let i=0;i<pieces.length;i++){expect(safeContour(pieces[i],originals[i],.8)).toBe(true);expect(contourBoundaryError(pieces[i],originals[i],.1,1.05)).toBeLessThanOrEqual(1.05);expect(pieces[i].holes?.length??0).toBe(originals[i].holes?.length??0);expect(new Set(pieces[i].nodes.map(p=>p.id)).size).toBe(pieces[i].nodes.length);}
 const a=rings(pieces[0]),b=rings(pieces[1]),rect:[number,number][][]=[[[10,10],[190,10],[190,170],[10,170]]],[union]=await clip(resolve('target/release/fpcad-worker.exe'),[{subjects:[...a,...b],union:true}],9),[gap,overlap]=await clip(resolve('target/release/fpcad-worker.exe'),[{subjects:rect,subtract:union},{subjects:a,clips:b}],9);expect(area(gap)).toBeLessThan(1e-7);expect(area(overlap)).toBeLessThan(1e-7);
 if(mode==='diamond'){expect(pieces[0].curves).toHaveLength(0);expect(pieces[0].nodes.length).toBeLessThanOrEqual(12);}if(mode==='ellipse'){expect(report.closedSharedChains).toBe(1);expect(pieces[0].nodes.length).toBeLessThan(originals[0].nodes.length/2);}
});

it.each([0,.37])('three-owner junctions and a contact loop preserve a single partition at angle %s after large translation',async angle=>{
 const width=180,height=160,masks=Array.from({length:3},()=>new Uint8Array(width*height));
 for(let y=10;y<150;y++)for(let x=10;x<170;x++)masks[x>=80&&x<100&&y>=70&&y<90?0:x>=100&&y>=90?2:1][y*width+x]=1;
 const raw=masks.map(mask=>traceMask(width,height,mask,{a:{x:0,y:height},b:{x:0,y:0},distanceMm:height},width,height,'#123456',true).piece),scale=.03,transform=(p:Piece['nodes'][number])=>({...p,xMm:1e6+scale*(p.xMm*Math.cos(angle)-p.yMm*Math.sin(angle)),yMm:-1e6+scale*(p.xMm*Math.sin(angle)+p.yMm*Math.cos(angle))}),originals=raw.map(p=>({...p,nodes:p.nodes.map(transform),holes:p.holes?.map(r=>r.map(transform))})),{pieces}=recoverSharedContours(originals,.8*scale,randomUUID);
 for(let i=0;i<pieces.length;i++){expect(safeContour(pieces[i],originals[i],.8*scale)).toBe(true);expect(contourBoundaryError(pieces[i],originals[i],scale*.1,scale*1.05)).toBeLessThanOrEqual(scale*1.05);const ids=new Set(pieces[i].nodes.map(n=>n.id));for(const c of pieces[i].curves??[]){expect(ids.has(c.startNodeId)).toBe(true);expect(ids.has(c.endNodeId)).toBe(true);}}
 // Compare to the original network, including its disclosed tiny diagonal
 // contact bevel, rather than filling that genuine topological separation.
 const local=(p:Piece)=>rings(p).map(r=>r.map(([x,y])=>[x-1e6,y+1e6]as[number,number])),worker=resolve('target/release/fpcad-worker.exe'),[before,after]=await clip(worker,[{subjects:originals.flatMap(local),union:true},{subjects:pieces.flatMap(local),union:true}],9),[missing,extra,...overlap]=await clip(worker,[{subjects:before,subtract:after},{subjects:after,subtract:before},...pieces.flatMap((p,i)=>pieces.slice(i+1).map(q=>({subjects:local(p),clips:local(q)})))],9);
 // Rotating a short raster edge after a 1e6 mm translation loses a few
 // representable bits before fitting. Bound that numeric area by coordinate
 // roundoff times the rectangle perimeter; this is not a pixel-gap allowance.
 const numericArea=128*Number.EPSILON*1e6*2*(width+height)*scale;
 expect(area(missing)).toBeLessThan(numericArea);expect(area(extra)).toBeLessThan(numericArea);for(const r of overlap)expect(area(r)).toBeLessThan(numericArea);
});

it.each([.13,1.5,2.7])('shared straight strip at slope %s keeps long digital edges straight across material junctions',async slope=>{
 const height=180,width=Math.ceil(160*slope)+80,masks=Array.from({length:3},()=>new Uint8Array(width*height));
 for(let y=10;y<170;y++)for(let x=10;x<width-10;x++){const border=30+slope*(y-10);masks[x<border?0:x<border+8?1:2][y*width+x]=1;}
 const originals=masks.map(mask=>traceMask(width,height,mask,{a:{x:0,y:height},b:{x:0,y:0},distanceMm:height},width,height,'#123456',true).piece),{pieces}=recoverSharedContours(originals,.8,randomUUID);
 // The central material has two long shared boundaries and two fixed caps.
 // Area/topology and fidelity remain strict; a staircase fallback is visible
 // as hundreds of editable nodes, so compactness is independently required.
 expect(pieces[1].nodes.length).toBeLessThanOrEqual(20);expect(pieces[1].curves).toHaveLength(0);
 for(let i=0;i<3;i++){expect(safeContour(pieces[i],originals[i],.8)).toBe(true);expect(contourBoundaryError(pieces[i],originals[i],.1,1.05)).toBeLessThanOrEqual(1.05);}
 const worker=resolve('target/release/fpcad-worker.exe'),[union]=await clip(worker,[{subjects:pieces.flatMap(rings),union:true}],9),[gap,...overlap]=await clip(worker,[{subjects:[[[10,10],[width-10,10],[width-10,170],[10,170]]],subtract:union},...pieces.flatMap((p,i)=>pieces.slice(i+1).map(q=>({subjects:rings(p),clips:rings(q)})))],9);
 expect(area(gap)).toBeLessThan(1e-7);for(const r of overlap)expect(area(r)).toBeLessThan(1e-7);
});
