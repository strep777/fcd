import {expect,it} from 'vitest';
import {randomUUID} from 'node:crypto';
import {inferTips,sourceTipPolygon} from '../../packages/reference/image-line-corners';
import {imageBoundaryFit} from '../../packages/reference/image-contour';
import {recoverSharedContours} from '../../packages/reference/shared-contour';
import type {Piece} from '../../packages/schema/index';
import {traceMask} from '../../apps/desktop/main/reference-segmentation';
import {adversarialTipSource} from '../fixtures/line-tip-adversarial-source';
import {sourcePolygonContains} from '../fixtures/line-tip-source';

// Only analytic source geometry defines expected positions. The
// bounded RGB observation changes neither alpha nor the source-selected mask.
type XY={x:number;y:number};
function boundaryDistance(q:XY,ring:XY[]){
 let best=Infinity;
 for(let i=0;i<ring.length;i++){
  const a=ring[i],b=ring[(i+1)%ring.length],dx=b.x-a.x,dy=b.y-a.y,length2=dx*dx+dy*dy,t=length2?Math.max(0,Math.min(1,((q.x-a.x)*dx+(q.y-a.y)*dy)/length2)):0;
  best=Math.min(best,Math.hypot(q.x-a.x-t*dx,q.y-a.y-t*dy));
 }
 return best;
}
type Source=Awaited<ReturnType<typeof adversarialTipSource>>;
function sampled(piece:Piece,height:number,ring=piece.nodes):XY[]{
 return ring.flatMap((a,i)=>{
  const b=ring[(i+1)%ring.length],c=ring===piece.nodes?piece.curves?.find(c=>c.startNodeId===a.id&&c.endNodeId===b.id):undefined,u=c?.c1??a,v=c?.c2??b;
  const n=Math.max(1,Math.ceil((Math.hypot(a.xMm-u.xMm,a.yMm-u.yMm)+Math.hypot(u.xMm-v.xMm,u.yMm-v.yMm)+Math.hypot(v.xMm-b.xMm,v.yMm-b.yMm))/.15));
  return Array.from({length:n},(_,j)=>{const t=j/n,s=1-t;return{x:s**3*a.xMm+3*s*s*t*u.xMm+3*s*t*t*v.xMm+t**3*b.xMm,y:height-(s**3*a.yMm+3*s*s*t*u.yMm+3*s*t*t*v.yMm+t**3*b.yMm)};});
 });
}
function sampledTruth(ring:XY[]):XY[]{return ring.flatMap((a,i)=>{const b=ring[(i+1)%ring.length],n=Math.max(1,Math.ceil(Math.hypot(b.x-a.x,b.y-a.y)/.15));return Array.from({length:n},(_,j)=>({x:a.x+(b.x-a.x)*j/n,y:a.y+(b.y-a.y)*j/n}));});}
function verifyFinalNetwork(source:Source,rgba:Uint8Array,requiresTip=true){
 const {width,height}=source,calibration={a:{x:0,y:height},b:{x:0,y:0},distanceMm:height},masks=[source.observedMask,Uint8Array.from(source.observedMask,v=>v?0:1)];
 const originals=masks.map((mask,i)=>traceMask(width,height,mask,calibration,width,height,i?source.backgroundColor:source.foregroundColor,true).piece),before=structuredClone(originals),rgbaBefore=rgba.slice();
 const fit=imageBoundaryFit(width,height,rgba,p=>({xMm:p.xMm,yMm:height-p.yMm}),p=>({xMm:p.xMm,yMm:height-p.yMm}));
 const saved=recoverSharedContours(originals,.8,randomUUID,fit),selected=saved.pieces[0],rings=saved.pieces.map(piece=>[sampled(piece,height),...(piece.holes??[]).map(h=>sampled(piece,height,h))]),foreground=rings[0][0];
 const frame=[{x:0,y:0},{x:width,y:0},{x:width,y:height},{x:0,y:height}],truthSamples=sampledTruth(source.truthRing);
 const tipError=boundaryDistance(source.tip,foreground),tipNodeError=Math.min(...selected.nodes.map(p=>Math.hypot(p.xMm-source.tip.x,height-p.yMm-source.tip.y)));
 const forward=Math.max(...foreground.map(p=>boundaryDistance(p,source.truthRing))),reverse=Math.max(...truthSamples.map(p=>boundaryDistance(p,foreground)));
 const everyBoundary=Math.max(...rings.flat(2).map(p=>Math.min(boundaryDistance(p,source.truthRing),boundaryDistance(p,frame))));
 const backgroundReverse=Math.max(...[...truthSamples,...sampledTruth(frame)].map(p=>Math.min(...rings[1].map(r=>boundaryDistance(p,r)))));
 const owns=(p:XY,rs:XY[][])=>sourcePolygonContains(p,rs[0])&&!rs.slice(1).some(h=>sourcePolygonContains(p,h));
 let gaps=0,overlaps=0,wrongInterior=0;
 for(let y=.317;y<height;y+=3.7)for(let x=.371;x<width;x+=3.7){const p={x,y},owners=rings.filter(rs=>owns(p,rs)).length;gaps+=+(owners===0);overlaps+=+(owners>1);if(boundaryDistance(p,source.truthRing)>1.5)wrongInterior+=+(owns(p,rings[0])!==sourcePolygonContains(p,source.truthRing));}
 const sharedDeviation=Math.max(...foreground.map(p=>Math.min(...rings[1].map(r=>boundaryDistance(p,r))))),sourceNoseX=source.local(source.nose).x,maxOutputX=Math.max(...foreground.map(p=>source.local(p).x));
 const metrics={sourceTip:source.tip,tipError,tipNodeError,forward,reverse,everyBoundary,backgroundReverse,sharedDeviation,sourceNoseX,maxOutputX,gaps,overlaps,wrongInterior,report:saved.report,finalNodes:selected.nodes,finalCurves:selected.curves},message=JSON.stringify(metrics);
 // Candidate existence is insufficient: these are the actually saved nodes,
 // cubics and both owners, all checked against pre-rendered source geometry.
 for(const value of [forward,reverse,everyBoundary,backgroundReverse,sharedDeviation])expect.soft(value,message).toBeLessThanOrEqual(1.5);
 if(requiresTip)for(const value of [tipError,tipNodeError])expect.soft(value,message).toBeLessThanOrEqual(1.5);
 else expect.soft(maxOutputX,message).toBeLessThanOrEqual(sourceNoseX+1.5);
 expect.soft({gaps,overlaps,wrongInterior},message).toEqual({gaps:0,overlaps:0,wrongInterior:0});
 expect(originals).toEqual(before);expect(Buffer.from(rgba).equals(Buffer.from(rgbaBefore))).toBe(true);
}
function measure(source:Source){
 const sourceRGBA=source.rgba.slice(),mask=source.observedMask.slice(),truth=structuredClone(source.truthRing),rgba=source.rgba.slice();
 for(let y=0;y<source.height;y++)for(let x=0;x<source.width;x++)for(let k=0;k<3;k++){
  const noise=((x*37+y*19+k*11)%17)-8,index=4*(y*source.width+x)+k;
  rgba[index]=Math.max(0,Math.min(255,rgba[index]+noise));
 }
 const alpha=Uint8Array.from({length:source.width*source.height},(_,i)=>sourceRGBA[4*i+3]);
 expect(Uint8Array.from({length:alpha.length},(_,i)=>rgba[4*i+3])).toEqual(alpha);
 const calibration={a:{x:0,y:source.height},b:{x:0,y:0},distanceMm:source.height};
 const piece=traceMask(source.width,source.height,source.observedMask,calibration,source.width,source.height,source.foregroundColor,true).piece;
 const raw=piece.nodes.map(p=>({...p,yMm:source.height-p.yMm})),rawBefore=structuredClone(raw),rgbaBefore=rgba.slice();
 const model=inferTips(raw,true,source.width,source.height,rgba);
 const unchanged=()=>{
  expect(raw).toEqual(rawBefore);expect(rgba).toEqual(rgbaBefore);expect(source.rgba).toEqual(sourceRGBA);expect(source.observedMask).toEqual(mask);expect(source.truthRing).toEqual(truth);
  expect(Uint8Array.from({length:alpha.length},(_,i)=>rgba[4*i+3])).toEqual(alpha);
 };
 return{model,raw,rgba,unchanged};
}

it.each([0,35])('independent straight RGB sides retain a sharp noisy tip at rotation %s',async rotation=>{
 const source=await adversarialTipSource({name:'independent-noisy-two-flanks-'+rotation,kind:'sharp',angle:44,rotation,blur:2,requiresTip:true}),saved=measure(source);
 const near=saved.model.candidates.filter(c=>c.accepted&&Math.hypot(c.tip.xMm-source.tip.x,c.tip.yMm-source.tip.y)<=1.5);
 const message=JSON.stringify({rotation,physicalBoundary:source.truthRing,sourceTip:source.tip,near:near.map(c=>({tip:c.tip,fitError:c.fitError})),candidates:saved.model.candidates.map(c=>({tip:c.tip,accepted:c.accepted,error:c.error,fitError:c.fitError}))});
 verifyFinalNetwork(source,saved.rgba);
 expect(near,message).not.toHaveLength(0);
 for(const c of near)expect(boundaryDistance({x:c.tip.xMm,y:c.tip.yMm},source.truthRing),message).toBeLessThanOrEqual(1.5);
 saved.unchanged();
});

it.each([0,35].flatMap(rotation=>[
 {name:'noisy-rounded12-'+rotation,kind:'rounded' as const,cut:12,blur:2,rotation},
 {name:'noisy-flat3.5-'+rotation,kind:'flat' as const,truncate:3.5,blur:2,rotation},
]))('$name cannot invent a pointed extension',async spec=>{
 const source=await adversarialTipSource(spec),saved=measure(source);
 // Candidate.point is the original observed-boundary proposal at source[i],
 // before fitted tip translation/rotation. Its fixed source-nose window
 // determines applicability; moving an output tip cannot evade rejection.
 const capProposals=saved.model.candidates.filter(c=>Math.hypot(c.point.xMm-source.nose.x,c.point.yMm-source.nose.y)<6),falseAccepted=capProposals.filter(c=>c.accepted);
 const polygon=sourceTipPolygon(saved.raw,source.width,source.height,saved.rgba,randomUUID,saved.model),message=JSON.stringify({spec,sourceTip:source.tip,sourceNose:source.nose,capProposals,falseAccepted,polygon});
 verifyFinalNetwork(source,saved.rgba,false);
 expect(falseAccepted,message).toHaveLength(0);
 expect(polygon,message).toBeUndefined();
 if(spec.kind==='flat')for(const c of falseAccepted){expect(source.local({x:c.tip.xMm,y:c.tip.yMm}).x,message).toBeLessThanOrEqual(24-spec.truncate!+1.5);expect(boundaryDistance({x:c.tip.xMm,y:c.tip.yMm},source.truthRing),message).toBeLessThanOrEqual(1.5);}
 if(polygon)for(let i=0;i<polygon.nodes.length;i++){
  const a=polygon.nodes[i],b=polygon.nodes[(i+1)%polygon.nodes.length],n=Math.max(1,Math.ceil(Math.hypot(b.xMm-a.xMm,b.yMm-a.yMm)/.15));
  for(let j=0;j<=n;j++){const t=j/n,q={x:a.xMm+(b.xMm-a.xMm)*t,y:a.yMm+(b.yMm-a.yMm)*t};expect(boundaryDistance(q,source.truthRing),message).toBeLessThanOrEqual(1.5);if(spec.kind==='flat')expect(source.local(q).x,message).toBeLessThanOrEqual(24-spec.truncate!+1.5);}
 }
 saved.unchanged();
});
