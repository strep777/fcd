import {beforeAll,afterAll,expect,it} from 'vitest';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
import sharp from 'sharp';
import {Path2D,createCanvas} from '@napi-rs/canvas';
import {splitReferences} from '../../apps/desktop/main/automatic-reference';
import {referenceFromPng} from '../../apps/desktop/main/references';
import {projectMarking} from '../../apps/desktop/main/markings';
import {automaticPlacement} from '../../apps/desktop/main/automatic-placement';
import {anatomicalPlacement} from '../../apps/desktop/main/anatomical-placement';
import {placementAnatomies} from '../../packages/reference/placement-context';
import {pack,unpack} from '../../apps/desktop/main/archive';
import {pairedJpegColors} from '../fixtures/paired-palette-contract';
import type {Project,Reference} from '../../packages/schema/index';
const output=resolve(process.env.FPCAD_FRESH_PLACEMENT_RESULTS??'test-results/2026-10-27-placement-seams/fresh-jpeg'),worker=resolve('target/release/fpcad-worker.exe');
const auditedSources=['packages/reference/illustration.ts','packages/reference/terminal-paw-support.ts','apps/desktop/main/automatic-placement.ts','apps/desktop/main/markings.ts','apps/desktop/main/anatomical-placement.ts'];
const sourceHashes=async()=>Object.fromEntries(await Promise.all(auditedSources.map(async file=>[file,createHash('sha256').update(await readFile(file)).digest('hex')])));
let p:Project,matches:any[]=[];const report:any={passed:false,scope:'Fresh decoding of the original JPEG and default 1800 mm / 8-color background-excluding extraction. Existing default padded physical model is reused unchanged; no desktop/UI/dist build or full automatic placement is invoked. Four sources are matched by original raster footprint and exact pigment color, never source ID or new region numbering.',checks:[]};
function pixelPath(source:any,ref:any){const c=ref.calibration,dx=c.b.x-c.a.x,dy=c.b.y-c.a.y,pixel=(n:any)=>[c.a.x+(-dy*n.xMm+dx*n.yMm)/c.distanceMm,c.a.y+(dx*n.xMm+dy*n.yMm)/c.distanceMm],path=new Path2D(),curves=new Map((source.piece.curves??[]).map((c:any)=>[c.startNodeId,c]));for(const ring of [source.piece.nodes,...source.piece.holes??[]]){const a=pixel(ring[0]);path.moveTo(a[0],a[1]);for(let i=0;i<ring.length;i++){const c:any=curves.get(ring[i].id),q=pixel(ring[(i+1)%ring.length]);if(c){const a=pixel(c.c1),b=pixel(c.c2);path.bezierCurveTo(a[0],a[1],b[0],b[1],q[0],q[1]);}else path.lineTo(q[0],q[1]);}path.closePath();}return path;}
beforeAll(async()=>{
  await mkdir(output,{recursive:true});report.sourceHashesAtStart=await sourceHashes();const old=JSON.parse(await readFile('test-results/2026-10-25-pattern-quality/placement-skips-current-source/report.json','utf8')),base=JSON.parse(await readFile('test-results/reported-functional-acceptance/jpeg-padded-chain-round3/extracted-default-padded.json','utf8'));
  report.jpegSha256=createHash('sha256').update(await readFile('tests/fixtures/character-front-back.jpg')).digest('hex');report.physicalModelSha256=createHash('sha256').update(JSON.stringify(base.surface)).digest('hex');
  const references:Reference[]=[];for(const[view,left,width]of [['front',609,666],['back',0,609]]as const){const png=await sharp('tests/fixtures/character-front-back.jpg').extract({left,top:0,width,height:750}).png().toBuffer(),r=referenceFromPng(png,'Original JPEG '+view,view);r.sheet={id:r.id,width:1275,height:750,x:left,y:0};references.push(r);}
  const split=splitReferences(references,1800,8,true);p={...base,patternLibrary:split.regions,references:split.references,markings:[],modelLibrary:[],pieces:[]};await writeFile(resolve(output,'fresh-input-project.json'),JSON.stringify(p));
  for(const previous of old.cases){const oldRef=base.references.find((r:any)=>r.id===previous.source.referenceId),oldPath=pixelPath(previous.source,oldRef),box=previous.reference.pixelBounds,ctx=createCanvas(oldRef.width,oldRef.height).getContext('2d'),points:number[][]=[];for(let y=Math.floor(box.minY);y<Math.ceil(box.maxY);y++)for(let x=Math.floor(box.minX);x<Math.ceil(box.maxX);x++)if(ctx.isPointInPath(oldPath,x+.5,y+.5,'evenodd'))points.push([x+.5,y+.5]);
    const expectedColor=pairedJpegColors[previous.source.piece.color]??previous.source.piece.color,candidates=split.regions.filter(r=>r.view===previous.source.view&&r.piece.color===expectedColor).map(source=>{const ref=split.references.find(r=>r.id===source.referenceId)!,path=pixelPath(source,ref),overlap=points.filter(([x,y])=>ctx.isPointInPath(path,x,y,'evenodd')).length;return {source,overlap};}).sort((a,b)=>b.overlap-a.overlap);
    expect(candidates[0],'A spatial/color match for each original source must exist').toBeDefined();expect(candidates[0].overlap/points.length,'Fresh classification must retain the original pigment footprint').toBeGreaterThanOrEqual(.95);
    const match={oldId:previous.source.piece.id,oldName:previous.source.piece.name,oldAnatomy:previous.source.anatomy,oldPixelBounds:box,originalPixels:points.length,matchedPixels:candidates[0].overlap,source:candidates[0].source};matches.push(match);
  }
  report.matches=matches;report.sourceCount=split.regions.length;await writeFile(resolve(output,'report.json'),JSON.stringify(report,null,2));
},120000);
it.each([0,1])('fresh original inner-leg pigment %s has a supported side and produces an unreviewed same-leg automatic attachment',async index=>{
  const s=matches[index].source,before=JSON.stringify(p);try{expect(s.anatomy.part).toBe('leg');expect(s.anatomy.side).toBe('right');const m=await projectMarking(worker,p,s.piece.id,s.view,0,0,false,true);expect(m.fragments.length).toBeGreaterThan(0);expect(m.placement!.part).toBe('leg');expect(m.placement!.side).toBe('right');expect(m.placement!.regions).toEqual(['leg-left']);expect(m.placement!.reviewed).toBe(false);
    // The front-image screen-left material is the character's right leg. Its
    // legacy generated model group lies physically at x < 0; names alone do
    // not prove that the source was placed on the expected side.
    const faces=new Map(p.surface!.faces.map(f=>[f.id,f])),vertices=new Map(p.surface!.vertices.map(v=>[v.id,v])),xs=m.fragments.flatMap(f=>faces.get(f.faceId)!.vertices.map(id=>vertices.get(id)!.xMm));expect(Math.max(...xs)).toBeLessThan(0);
    expect(JSON.stringify(p)).toBe(before);report.checks.push({name:'leg-'+index,passed:true,anatomy:s.anatomy,fragments:m.fragments.length,physicalXRange:[Math.min(...xs),Math.max(...xs)],placement:m.placement,offset:[m.offsetXmm,m.offsetYmm]});}catch(e){report.checks.push({name:'leg-'+index,passed:false,error:String(e)});throw e;}
});
it('the original third dark claw is a paw source and the padded body does not invent a leg target for it',async()=>{
  const s=matches[2].source,before=JSON.stringify(p);try{expect(s.anatomy.part).toBe('paw');expect(s.anatomy.side).toBe('left');expect(placementAnatomies(s).every(a=>a.part==='paw')).toBe(true);expect(placementAnatomies(s).filter(a=>['body','arm','leg','foot'].includes(a.part))).toEqual([]);await expect(projectMarking(worker,p,s.piece.id,s.view,0,0,false,true)).rejects.toThrow('MODEL_PART_MISSING');expect(JSON.stringify(p)).toBe(before);report.checks.push({name:'claw',passed:true,anatomy:s.anatomy,result:'MODEL_PART_MISSING; public body-only auto context filter excludes paw'});}catch(e){report.checks.push({name:'claw',passed:false,error:String(e)});throw e;}
});
it('the real back-body accent with no corresponding visible location is skipped without moving its pigment, and the original source survives archive roundtrip',async()=>{
  const s=matches[3].source,before=JSON.stringify(p),original=structuredClone(s),placement=anatomicalPlacement(p,s);try{expect(s.anatomy.part).toBe('body');expect(placement.regions).toEqual(['torso']);expect(placement.scaleX).toBe(placement.scaleY);await expect(projectMarking(worker,p,s.piece.id,s.view,0,0,false,true)).rejects.toThrow('NO_VISIBLE_PROJECTION');
    const result=await automaticPlacement(worker,p,[s.piece.id]);expect(result.markings).toEqual([]);expect(result.skipped).toEqual([{pieceId:s.piece.id,name:s.piece.name,reason:'NO_VISIBLE_PROJECTION'}]);const archive=pack(p).bytes,path=resolve(output,'fresh-back-body-skipped.fpcad');await writeFile(path,archive);const restored=unpack(await readFile(path));expect(restored.markings).toEqual([]);expect(restored.patternLibrary!.find(r=>r.piece.id===s.piece.id)).toEqual(original);expect(s).toEqual(original);expect(JSON.stringify(p)).toBe(before);report.checks.push({name:'back-body',passed:true,result:'NO_VISIBLE_PROJECTION; no forced relocation',skipped:result.skipped,placement,archiveBytes:archive.length});
  }catch(e){report.checks.push({name:'back-body',passed:false,error:String(e)});throw e;}
});
afterAll(async()=>{report.passed=report.checks.length===4&&report.checks.every((r:any)=>r.passed);report.sourceHashesAtEnd=await sourceHashes();report.auditedSourcesUnchangedDuringRun=JSON.stringify(report.sourceHashesAtStart)===JSON.stringify(report.sourceHashesAtEnd);report.finished=new Date().toISOString();await writeFile(resolve(output,'report.json'),JSON.stringify(report,null,2));});
