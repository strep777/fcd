import {randomUUID} from 'node:crypto';
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {expect,it,vi} from 'vitest';
import sharp from 'sharp';
import {splitReferences} from '../../apps/desktop/main/automatic-reference';
import * as shared from '../../packages/reference/shared-contour';
import * as recovery from '../../packages/reference/recover-contour';
import {pigmentFamily} from '../../packages/reference/illustration';
import type {Piece,Reference,Calibration} from '../../packages/schema/index';

type XY={x:number;y:number};
type Roi={name:string;left:number;top:number;width:number;height:number};
const straightSpans=[
 {name:'crown upper-left painted straight span',left:814,top:120,width:7,height:8},
 {name:'crown upper-right painted straight span',left:827,top:122,width:4,height:5},
 {name:'crown lower-left painted straight span',left:807,top:136,width:4,height:7}
];
const rois:Roi[]=[
 {name:'front-crown',left:766,top:28,width:148,height:150},
 {name:'front-legs',left:703,top:437,width:303,height:168},
 {name:'front-tail',left:992,top:378,width:249,height:253}
];
const inRoi=(p:XY,r:Roi)=>p.x>=r.left&&p.x<=r.left+r.width&&p.y>=r.top&&p.y<=r.top+r.height;
function pixel(p:{xMm:number;yMm:number},c:Calibration):XY{
 const dx=c.b.x-c.a.x,dy=c.b.y-c.a.y;
 return {x:609+c.a.x+(-dy*p.xMm+dx*p.yMm)/c.distanceMm,y:c.a.y+(dx*p.xMm+dy*p.yMm)/c.distanceMm};
}
const distance=(p:XY,a:XY,b:XY)=>{const dx=b.x-a.x,dy=b.y-a.y,l=dx*dx+dy*dy,t=l?Math.max(0,Math.min(1,((p.x-a.x)*dx+(p.y-a.y)*dy)/l)):0;return Math.hypot(p.x-a.x-t*dx,p.y-a.y-t*dy);};
function nearest(p:XY,ring:XY[]){let best=Infinity;for(let i=0;i<ring.length;i++)best=Math.min(best,distance(p,ring[i],ring[(i+1)%ring.length]));return best;}
function contains(p:XY,ring:XY[]){let hit=false;for(let i=0,j=ring.length-1;i<ring.length;j=i++){
 const a=ring[i],b=ring[j];if((a.y>p.y)!==(b.y>p.y)&&p.x<(b.x-a.x)*(p.y-a.y)/(b.y-a.y)+a.x)hit=!hit;
}return hit;}
function sample(piece:Piece,c:Calibration,ring=piece.nodes):XY[]{
 return ring.flatMap((a,i)=>{
  const b=ring[(i+1)%ring.length],curve=piece.curves?.find(v=>v.startNodeId===a.id&&v.endNodeId===b.id),pa=pixel(a,c),pb=pixel(b,c);
  const h1=curve?pixel(curve.c1,c):pa,h2=curve?pixel(curve.c2,c):pb;
  const reach=curve?Math.hypot(h1.x-pa.x,h1.y-pa.y)+Math.hypot(h2.x-h1.x,h2.y-h1.y)+Math.hypot(pb.x-h2.x,pb.y-h2.y):Math.hypot(pb.x-pa.x,pb.y-pa.y);
  const count=Math.max(1,Math.ceil(reach/.25));
  return Array.from({length:count},(_,k)=>{
   const t=k/count,s=1-t;
   return curve?{x:s**3*pa.x+3*s*s*t*h1.x+3*s*t*t*h2.x+t**3*pb.x,y:s**3*pa.y+3*s*s*t*h1.y+3*s*t*t*h2.y+t**3*pb.y}
    :{x:pa.x+t*(pb.x-pa.x),y:pa.y+t*(pb.y-pa.y)};
  });
 });
}
function turns(piece:Piece,c:Calibration,roi:Roi){
 return piece.nodes.flatMap((n,i)=>{
  const p=pixel(n,c);if(!inRoi(p,roi))return [];
  const a=pixel(piece.curves?.find(v=>v.endNodeId===n.id)?.c2??piece.nodes[(i+piece.nodes.length-1)%piece.nodes.length],c);
  const b=pixel(piece.curves?.find(v=>v.startNodeId===n.id)?.c1??piece.nodes[(i+1)%piece.nodes.length],c);
  const ux=p.x-a.x,uy=p.y-a.y,vx=b.x-p.x,vy=b.y-p.y;
  return [{...p,turnRad:Math.atan2(ux*vy-uy*vx,ux*vx+uy*vy),incomingPixels:Math.hypot(ux,uy),outgoingPixels:Math.hypot(vx,vy)}];
 });
}
function svgPath(piece:Piece,c:Calibration){
 return [piece.nodes,...piece.holes??[]].map(r=>r.map((a,i)=>{
  const b=r[(i+1)%r.length],p=pixel(a,c),q=pixel(b,c),curve=piece.curves?.find(v=>v.startNodeId===a.id&&v.endNodeId===b.id);
  const h1=curve&&pixel(curve.c1,c),h2=curve&&pixel(curve.c2,c);
  return `${i?'':`M${p.x} ${p.y}`}${curve?`C${h1!.x} ${h1!.y} ${h2!.x} ${h2!.y} ${q.x} ${q.y}`:`L${q.x} ${q.y}`}`;
 }).join('')+'Z').join('');
}
let evidencePromise:Promise<any>|undefined;
function collect(){return evidencePromise??=(async()=>{
 const output=resolve('test-results/current-task');await mkdir(output,{recursive:true});
 const calls:{originals:Piece[];result:ReturnType<typeof shared.recoverSharedContours>}[]=[];
 const proposals:{viewCall:number;kind:string;raw:Piece['nodes'];nodes:Piece['nodes'];curves:Piece['curves']}[]=[];
 let activeCall=0;
 let sourceCoordinates=new Map<string,Piece['nodes'][number]>();
 const capture=(kind:string,raw:Piece['nodes'],result:{nodes:Piece['nodes'];curves?:Piece['curves']})=>{
  // Diagnostic hooks may see a normalized internal frame. Original point IDs
  // establish its affine scale/offset, without assuming a specific fitter frame.
  const known=raw.filter(p=>sourceCoordinates.has(p.id)),a=known[0],b=known.find(p=>a&&Math.hypot(p.xMm-a.xMm,p.yMm-a.yMm)>1e-6);
  const wa=a&&sourceCoordinates.get(a.id),wb=b&&sourceCoordinates.get(b.id);
  const scale=a&&b&&wa&&wb?Math.hypot(wb.xMm-wa.xMm,wb.yMm-wa.yMm)/Math.hypot(b.xMm-a.xMm,b.yMm-a.yMm):1;
  const world=(p:Piece['nodes'][number])=>({...p,xMm:wa&&a?wa.xMm+(p.xMm-a.xMm)*scale:p.xMm,yMm:wa&&a?wa.yMm+(p.yMm-a.yMm)*scale:p.yMm});
  proposals.push({viewCall:activeCall,kind,raw:raw.map(world),nodes:result.nodes.map(world),curves:result.curves});
 };
 const actualContour=recovery.recoverContour,actualChain=recovery.recoverBoundaryChain,actualLoop=recovery.recoverBoundaryLoop;
 const contourSpy=vi.spyOn(recovery,'recoverContour').mockImplementation((piece,pixelMm,id)=>{const result=actualContour(piece,pixelMm,id);capture('closed',piece.nodes,result);return result;});
 const chainSpy=vi.spyOn(recovery,'recoverBoundaryChain').mockImplementation((points,pixelMm,id)=>{const result=actualChain(points,pixelMm,id);capture('open',points,result);return result;});
 const loopSpy=vi.spyOn(recovery,'recoverBoundaryLoop').mockImplementation((points,pixelMm,id,anchors)=>{const result=actualLoop(points,pixelMm,id,anchors);capture('anchored loop',points,result);return result;});
 const actual=shared.recoverSharedContours;
 const spy=vi.spyOn(shared,'recoverSharedContours').mockImplementation((originals,pixelMm,id,evidence)=>{
  activeCall=calls.length;sourceCoordinates=new Map(originals.flatMap(p=>[p.nodes,...p.holes??[]].flat()).map(p=>[p.id,p]));const result=actual(originals,pixelMm,id,evidence);calls.push({originals,result});return result;
 });
 const references:Reference[]=[];
 for(const [view,left,width]of [['back',0,609],['front',609,666]]as const){
  const png=await sharp('tests/fixtures/character-front-back.jpg').extract({left,top:0,width,height:750}).png().toBuffer();
  references.push({id:randomUUID(),name:view,view,width,height:750,png:'data:image/png;base64,'+png.toString('base64'),resources:{} as Reference['resources']});
 }
 let result:ReturnType<typeof splitReferences>;
 try{result=splitReferences(references,1800,6,true);}finally{spy.mockRestore();contourSpy.mockRestore();chainSpy.mockRestore();loopSpy.mockRestore();}
 const front=result.references.find(r=>r.view==='front')!,c=front.calibration!,frontCall=calls[1];
 const records=result.regions.filter(r=>r.view==='front');
 const roiMetrics=rois.map(roi=>({roi,regions:records.flatMap((r,i)=>{
  if(pigmentFamily(r.piece.color)!==pigmentFamily('#f9e33c'))return [];
  const raw=frontCall.originals[i],points=sample(r.piece,c),source=raw.nodes.map(n=>pixel(n,c));
  if(!points.some(p=>inRoi(p,roi)))return [];
  const localOutput=points.filter(p=>inRoi(p,roi)),localSource=sample(raw,c).filter(p=>inRoi(p,roi));
  const forward=Math.max(0,...localOutput.map(p=>nearest(p,source))),reverse=Math.max(0,...localSource.map(p=>nearest(p,points)));
  const rawSet=new Set(source.map(p=>`${p.x.toFixed(6)}:${p.y.toFixed(6)}`));
  const local=turns(r.piece,c,roi),retained=local.filter(p=>rawSet.has(`${p.x.toFixed(6)}:${p.y.toFixed(6)}`)).length;
  return [{index:i,name:r.piece.name,color:r.piece.color,crownSource:contains({x:824,y:135},source),rawNodes:raw.nodes.length,nodes:r.piece.nodes.length,curves:r.piece.curves?.length??0,localNodes:local.length,localExactRasterNodes:retained,maxBidirectionalPixels:Math.max(forward,reverse),localTurns:local}];
 })}));
 const sourceImage=await sharp('tests/fixtures/character-front-back.jpg').png().toBuffer();
 for(const roi of rois){
  const matching=records.map((r,i)=>({piece:r.piece,raw:frontCall.originals[i]})).filter(r=>pigmentFamily(r.piece.color)===pigmentFamily('#f9e33c')&&sample(r.piece,c).some(p=>inRoi(p,roi)));
  for(const version of ['raw','output']as const){
   const pieces=matching.map(r=>version==='raw'?r.raw:r.piece);
   const svg=`<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${roi.width*4}" height="${roi.height*4}" viewBox="${roi.left} ${roi.top} ${roi.width} ${roi.height}"><image x="0" y="0" width="1275" height="750" xlink:href="data:image/png;base64,${sourceImage.toString('base64')}"/>${pieces.map(p=>`<path d="${svgPath(p,c)}" fill="none" stroke="${version==='raw'?'#ff0077':'#00ffff'}" stroke-width=".55"/>${p.nodes.filter(n=>inRoi(pixel(n,c),roi)).map(n=>{const q=pixel(n,c);return `<circle cx="${q.x}" cy="${q.y}" r=".7" fill="${version==='raw'?'#ff0077':'#00ffff'}"/>`;}).join('')}`).join('')}</svg>`;
   await sharp(Buffer.from(svg)).png().toFile(resolve(output,`${roi.name}-${version}.png`));
  }
 }
 const crownProposals=proposals.filter(p=>p.viewCall===1&&p.raw.some(n=>inRoi(pixel(n,c),rois[0]))).map(p=>({kind:p.kind,rawNodes:p.raw.length,nodes:p.nodes.length,curves:p.curves?.length??0,sourceBounds:p.raw.map(n=>pixel(n,c)).reduce((b,p)=>({minX:Math.min(b.minX,p.x),maxX:Math.max(b.maxX,p.x),minY:Math.min(b.minY,p.y),maxY:Math.max(b.maxY,p.y)}),{minX:Infinity,maxX:-Infinity,minY:Infinity,maxY:-Infinity}),source:p.raw.map(n=>pixel(n,c)),output:p.nodes.map(n=>pixel(n,c))}));
 const report={source:'tests/fixtures/character-front-back.jpg',parameters:{heightMm:1800,clusters:6,excludeBackground:true,mode:'simple',subject:'character',calibration:'automatic default'},frontCalibration:c,sharedReports:calls.map(call=>call.result.report),roiMetrics,crownProposals};
 await writeFile(resolve(output,'default-real-edge-audit.json'),JSON.stringify(report,null,2));
 await writeFile(resolve(output,'default-real-edge-sources.json'),JSON.stringify({frontCalibration:c,pixelMm:c.distanceMm/Math.hypot(c.b.x-c.a.x,c.b.y-c.a.y),originals:frontCall.originals,regionNames:records.map(r=>r.piece.name)},null,2));
 await writeFile(resolve(output,'default-real-edge-output.json'),JSON.stringify(result,null,2));
 return {...report,frontSources:frontCall.originals};
})();}
it('records the real default split output and independent crown/leg/tail boundary evidence',async()=>{
 const report=await collect();expect(report.sharedReports).toHaveLength(2);
 for(const section of report.roiMetrics){expect(section.regions.length,section.roi.name).toBeGreaterThan(0);for(const region of section.regions)expect(region.maxBidirectionalPixels,`${section.roi.name} ${region.name}`).toBeLessThanOrEqual(1.05);}
},120000);

it.each(straightSpans)('default original JPEG $name has no raster staircase turns',async roi=>{
 const report=await collect(),crown=report.roiMetrics[0].regions.find((r:any)=>r.crownSource);
 expect(crown,'source crown must remain represented').toBeDefined();
 const local=crown.localTurns.filter((p:XY)=>inRoi(p,roi));
 expect(Math.max(0,...local.map((p:any)=>Math.abs(p.turnRad))),JSON.stringify(local)).toBeLessThanOrEqual(Math.PI/9);
},120000);

// Keep the default 1800-mm source within the UI's 1–10000-mm height range.
it.each([.05,1,5.5].flatMap(scale=>[0,.37].map(rotation=>({scale,rotation}))))
 ('the real shared narrow-gap network stays local at scale $scale rotation $rotation',async({scale,rotation})=>{
  const report=await collect(),c=report.frontCalibration,raw=report.frontSources as Piece[];
  const co=Math.cos(rotation),si=Math.sin(rotation);
  const transform=(p:{xMm:number;yMm:number})=>({xMm:1000+scale*(p.xMm*co-p.yMm*si),yMm:-1000+scale*(p.xMm*si+p.yMm*co)});
  const inverse=(p:{xMm:number;yMm:number})=>{const x=(p.xMm-1000)/scale,y=(p.yMm+1000)/scale;return {xMm:x*co+y*si,yMm:-x*si+y*co};};
  const map=(p:Piece,f:typeof transform):Piece=>({...p,nodes:p.nodes.map(n=>({...n,...f(n)})),holes:p.holes?.map(r=>r.map(n=>({...n,...f(n)}))),curves:p.curves?.map(v=>({...v,c1:{...v.c1,...f(v.c1)},c2:{...v.c2,...f(v.c2)}}))});
  const pixelMm=c.distanceMm/Math.hypot(c.b.x-c.a.x,c.b.y-c.a.y);
  const result=shared.recoverSharedContours(raw.map(p=>map(p,transform)),pixelMm*.8*scale,randomUUID);
  const index=report.roiMetrics[0].regions.find((r:any)=>r.crownSource).index;
  const crown=map(result.pieces[index],inverse),path=sample(crown,c),source=raw[index].nodes.map(p=>pixel(p,c));
  const bidirectional=Math.max(...path.map(p=>nearest(p,source)),...sample(raw[index],c).map(p=>nearest(p,path)));
  expect(bidirectional,'narrow-gap repair remains in the original pixel envelope').toBeLessThanOrEqual(1.05);
  for(const roi of straightSpans){const local=turns(crown,c,roi);expect(Math.max(0,...local.map(p=>Math.abs(p.turnRad))),`${roi.name}: ${JSON.stringify(local)}`).toBeLessThanOrEqual(Math.PI/9);}
 },120000);
