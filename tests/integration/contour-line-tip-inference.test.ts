import {randomUUID,createHash} from 'node:crypto';
import {mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {afterAll,expect,it} from 'vitest';
import {illustrationRegions,pigmentFamily} from '../../packages/reference/illustration';
import {imageBoundaryFit} from '../../packages/reference/image-contour';
import {recoverSharedContours} from '../../packages/reference/shared-contour';
import {traceMask,calibratedPoint} from '../../apps/desktop/main/reference-segmentation';
import {lineTipSource,sourcePolygonContains,sourceBoundaryDistance,type TipPoint,type TipSourceKind} from '../fixtures/line-tip-source';
import type {Piece} from '../../packages/schema/index';

const records:unknown[]=[],files=['packages/reference/image-contour.ts','packages/reference/shared-contour.ts','packages/reference/contour-topology.ts','packages/reference/illustration.ts'];
const fingerprints=()=>Object.fromEntries(files.map(file=>[file,createHash('sha256').update(readFileSync(file)).digest('hex')]));
const loadedFingerprints=fingerprints();
type Source=Awaited<ReturnType<typeof lineTipSource>>;
function sample(piece:Piece,scale:number,height:number){return piece.nodes.flatMap((a,i)=>{const b=piece.nodes[(i+1)%piece.nodes.length],curve=piece.curves?.find(c=>c.startNodeId===a.id&&c.endNodeId===b.id),u=curve?.c1??a,v=curve?.c2??b,n=Math.max(1,Math.ceil((Math.hypot(a.xMm-u.xMm,a.yMm-u.yMm)+Math.hypot(u.xMm-v.xMm,u.yMm-v.yMm)+Math.hypot(v.xMm-b.xMm,v.yMm-b.yMm))/(scale*.15)));return Array.from({length:n},(_,j)=>{const t=j/n,s=1-t;return{x:(s**3*a.xMm+3*s*s*t*u.xMm+3*s*t*t*v.xMm+t**3*b.xMm)/scale,y:height-(s**3*a.yMm+3*s*s*t*u.yMm+3*s*t*t*v.yMm+t**3*b.yMm)/scale};});});}
function turns(piece:Piece,scale:number,height:number){return piece.nodes.map((n,i)=>{const a=piece.curves?.find(c=>c.endNodeId===n.id)?.c2??piece.nodes[(i+piece.nodes.length-1)%piece.nodes.length],b=piece.curves?.find(c=>c.startNodeId===n.id)?.c1??piece.nodes[(i+1)%piece.nodes.length];return{x:n.xMm/scale,y:height-n.yMm/scale,degrees:Math.abs(Math.atan2((n.xMm-a.xMm)*(b.yMm-n.yMm)-(n.yMm-a.yMm)*(b.xMm-n.xMm),(n.xMm-a.xMm)*(b.xMm-n.xMm)+(n.yMm-a.yMm)*(b.yMm-n.yMm)))*180/Math.PI};});}

function recover(source:Source,scale:number){
 const {width,height,rgba}=source,classification=illustrationRegions(width,height,rgba,false,'head'),calibration={a:{x:0,y:height},b:{x:0,y:0},distanceMm:height*scale};
 const originals=classification.regions.map(region=>{const mask=new Uint8Array(width*height);for(const i of region.indices)mask[i]=1;return traceMask(width,height,mask,calibration,width,height,region.color,true).piece;});
 const toPixel=(p:{xMm:number;yMm:number})=>({xMm:p.xMm/scale,yMm:height-p.yMm/scale}),fromPixel=(p:{xMm:number;yMm:number})=>calibratedPoint(p.xMm,p.yMm,calibration),imageFit=imageBoundaryFit(width,height,rgba,toPixel,fromPixel),result=recoverSharedContours(originals,.8*scale,randomUUID,imageFit);
 const sourceIndex=Math.floor(source.seed.y)*width+Math.floor(source.seed.x),selected=classification.regions.findIndex(r=>r.indices.includes(sourceIndex));expect(selected,'the prescribed yellow interior must survive classification').toBeGreaterThanOrEqual(0);
 const piece=result.pieces[selected],ring=sample(piece,scale,height),all=result.pieces.map(p=>[sample(p,scale,height),...(p.holes??[]).map(h=>h.map(p=>({x:p.xMm/scale,y:height-p.yMm/scale})))]),owners=(p:TipPoint)=>all.map((r,i)=>({r,i})).filter(({r})=>sourcePolygonContains(p,r[0])&&!r.slice(1).some(h=>sourcePolygonContains(p,h))).map(({i})=>i);
 expect(pigmentFamily(piece.color!)).toBe(2);
 const direct=imageFit(originals[selected].nodes,true,[piece.color!,'#ede7ea'],randomUUID),directPiece=direct?{...originals[selected],...direct}:undefined;
 return{piece,ring,all,owners,selected,classification,raw:originals[selected],report:result.report,direct:directPiece?{supported:true,tipError:sourceBoundaryDistance(source.tip,sample(directPiece,scale,height)),nodes:directPiece.nodes.length}:{supported:false},nodeTurns:turns(piece,scale,height)};
}
function networkMetrics(saved:ReturnType<typeof recover>,source:Source){let gaps=0,overlaps=0;for(let y=3.317;y<source.height-3;y+=5.7)for(let x=3.731;x<source.width-3;x+=5.7){const count=saved.owners({x,y}).length;gaps+=+(count===0);overlaps+=+(count>1);}return{gaps,overlaps};}
function record(source:Source,scale:number,saved:ReturnType<typeof recover>,metrics:Record<string,unknown>){const result={kind:source.kind,angle:source.angle,rotation:source.rotation,blur:source.blur,scale,sourceTip:source.tip,reliableSideSegments:source.reliableSideSegments,clipped:source.clipped,...metrics,direct:saved.direct,raw:saved.raw.nodes.map(p=>({x:p.xMm/scale,y:source.height-p.yMm/scale})),savedNodes:saved.nodeTurns,report:saved.report};records.push(result);return JSON.stringify(result);}

it.each([28,44,60].flatMap((angle,i)=>[1.5,2,3].map(blur=>({angle,rotation:[0,35,90][i],blur}))))('two reliable sides recover the original $angle degree tip at rotation $rotation blur $blur',async options=>{
 const source=await lineTipSource('sharp',options);let first:TipPoint[]|undefined;
 for(const scale of [1,.05,10]){
  const saved=recover(source,scale),tipError=sourceBoundaryDistance(source.tip,saved.ring),nearestNode=Math.min(...saved.nodeTurns.map(p=>Math.hypot(p.x-source.tip.x,p.y-source.tip.y))),sharp=saved.nodeTurns.filter(p=>Math.hypot(p.x-source.tip.x,p.y-source.tip.y)<6&&p.degrees>40),boundaryError=Math.max(...saved.ring.map(p=>sourceBoundaryDistance(p,source.truthRing))),network=networkMetrics(saved,source),calibrationDrift=first?Math.max(...saved.ring.map(p=>sourceBoundaryDistance(p,first!)),...first.map(p=>sourceBoundaryDistance(p,saved.ring))):0,message=record(source,scale,saved,{tipError,nearestNode,sharp,boundaryError,calibrationDrift,network});
  // The user authorizes inferring the original intersection beyond the blur
  // ridge. The unblurred source lines, never a1.05px raw-mask tube, are truth.
  expect.soft(tipError,message).toBeLessThanOrEqual(1.5);expect.soft(nearestNode,message).toBeLessThanOrEqual(1.5);
  expect.soft(sharp,message).toHaveLength(1);expect.soft(Math.max(0,...sharp.map(p=>p.degrees)),message).toBeGreaterThanOrEqual(180-source.angle-20);
  expect.soft(boundaryError,message).toBeLessThanOrEqual(1.5);expect.soft(calibrationDrift,message).toBeLessThanOrEqual(.02);expect.soft(network,message).toEqual({gaps:0,overlaps:0});
  first??=saved.ring;
 }
});

it.each(['round-cap','flat-cap','one-straight-side','third-material','thin-strip','cropped-tip']as TipSourceKind[])('%s does not invent an unsupported pointed extension',async kind=>{
 const source=await lineTipSource(kind,{blur:kind==='thin-strip'?1.5:2}),saved=recover(source,1),boundaryError=Math.max(...saved.ring.map(p=>sourceBoundaryDistance(p,source.truthRing))),maxLocalX=Math.max(...saved.ring.map(p=>source.local(p).x)),network=networkMetrics(saved,source),nearNose=saved.nodeTurns.filter(p=>Math.hypot(p.x-source.nose.x,p.y-source.nose.y)<6),message=record(source,1,saved,{boundaryError,maxLocalX,nearNose,network});
 expect.soft(boundaryError,message).toBeLessThanOrEqual(1.5);expect.soft(network,message).toEqual({gaps:0,overlaps:0});
 if(kind==='round-cap'||kind==='one-straight-side')expect.soft(nearNose.filter(p=>p.degrees>45),message).toHaveLength(0);
 if(kind==='flat-cap')expect.soft(maxLocalX,message).toBeLessThanOrEqual(13.5);
 if(kind==='third-material'){expect.soft(maxLocalX,message).toBeLessThanOrEqual(11.5);const owner=saved.owners(source.thirdProbe);expect.soft(owner,message).toHaveLength(1);expect.soft(owner[0],message).not.toBe(saved.selected);if(owner.length===1)expect.soft(pigmentFamily(saved.classification.regions[owner[0]].color),message).toBe(1);}
 if(kind==='thin-strip')expect.soft(maxLocalX,message).toBeLessThanOrEqual(19.5);
 if(kind==='cropped-tip')for(const p of saved.ring){expect.soft(p.x,message).toBeGreaterThanOrEqual(-1e-7);expect.soft(p.x,message).toBeLessThanOrEqual(source.width+1e-7);expect.soft(p.y,message).toBeGreaterThanOrEqual(-1e-7);expect.soft(p.y,message).toBeLessThanOrEqual(source.height+1e-7);}
});

afterAll(()=>{const directory='test-results/contour-repair/line-tip-inference';mkdirSync(directory,{recursive:true});const stage=process.env.FPCAD_TIP_STAGE??'diagnostic';if(!/^[a-z0-9-]+$/.test(stage))throw Error('INVALID_TIP_STAGE');writeFileSync(directory+'/'+stage+'-metrics.json',JSON.stringify({stage,acceptance:'User authorizes reconstructing a sharp original tip from two reliable flanking straight boundaries, including beyond the blurred visible ridge. Independent pre-rendered source intersection1.5px, calibration drift.02px; no old raw-mask max-distance oracle. Rounded/flat/single-sided/occluded/thin/cropped source negatives cannot invent extensions.',route:'illustrationRegions -> traceMask each classified material -> imageBoundaryFit/recoverSharedContours. No desktop, project persistence, Rust or full JPEG replay.',loadedFingerprints,savedFingerprints:fingerprints(),records},null,2));});
