import {randomUUID,createHash} from 'node:crypto';
import {mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {afterAll,expect,it} from 'vitest';
import {adversarialTipCases,adversarialTipSource} from '../fixtures/line-tip-adversarial-source';
import {sourceBoundaryDistance,sourcePolygonContains,type TipPoint} from '../fixtures/line-tip-source';
import {traceMask,calibratedPoint} from '../../apps/desktop/main/reference-segmentation';
import {imageBoundaryFit} from '../../packages/reference/image-contour';
import {recoverSharedContours} from '../../packages/reference/shared-contour';
import type {Piece} from '../../packages/schema/index';

const records:unknown[]=[],files=['packages/reference/image-line-corners.ts','packages/reference/image-contour.ts','packages/reference/shared-contour.ts','packages/reference/contour-topology.ts'];
const fingerprints=()=>Object.fromEntries(files.map(file=>[file,createHash('sha256').update(readFileSync(file)).digest('hex')]));
const loadedFingerprints=fingerprints();
function sample(piece:Piece,scale:number,height:number,ring=piece.nodes){return ring.flatMap((a,i)=>{const b=ring[(i+1)%ring.length],curve=ring===piece.nodes?piece.curves?.find(c=>c.startNodeId===a.id&&c.endNodeId===b.id):undefined,u=curve?.c1??a,v=curve?.c2??b,n=Math.max(1,Math.ceil((Math.hypot(a.xMm-u.xMm,a.yMm-u.yMm)+Math.hypot(u.xMm-v.xMm,u.yMm-v.yMm)+Math.hypot(v.xMm-b.xMm,v.yMm-b.yMm))/(scale*.15)));return Array.from({length:n},(_,j)=>{const t=j/n,s=1-t;return{x:(s**3*a.xMm+3*s*s*t*u.xMm+3*s*t*t*v.xMm+t**3*b.xMm)/scale,y:height-(s**3*a.yMm+3*s*s*t*u.yMm+3*s*t*t*v.yMm+t**3*b.yMm)/scale};});});}
function turns(piece:Piece,scale:number,height:number){return piece.nodes.map((n,i)=>{const a=piece.curves?.find(c=>c.endNodeId===n.id)?.c2??piece.nodes[(i+piece.nodes.length-1)%piece.nodes.length],b=piece.curves?.find(c=>c.startNodeId===n.id)?.c1??piece.nodes[(i+1)%piece.nodes.length];return{x:n.xMm/scale,y:height-n.yMm/scale,degrees:Math.abs(Math.atan2((n.xMm-a.xMm)*(b.yMm-n.yMm)-(n.yMm-a.yMm)*(b.xMm-n.xMm),(n.xMm-a.xMm)*(b.xMm-n.xMm)+(n.yMm-a.yMm)*(b.yMm-n.yMm)))*180/Math.PI};});}

it.each(adversarialTipCases)('$name preserves its independent source geometry through the complete shared network',async spec=>{
 const source=await adversarialTipSource(spec),{width,height,rgba}=source;let reference:TipPoint[]|undefined;
 for(const scale of spec.name.startsWith('phase-sharp-')?[1,.05,10]:[1]){
  const beforeRGBA=rgba.slice(),beforeMask=source.observedMask.slice(),calibration={a:{x:0,y:height},b:{x:0,y:0},distanceMm:height*scale},masks=[source.observedMask,Uint8Array.from(source.observedMask,v=>v?0:1)],originals=masks.map((mask,i)=>traceMask(width,height,mask,calibration,width,height,i?source.backgroundColor:source.foregroundColor,true).piece);
  const imageFit=imageBoundaryFit(width,height,rgba,p=>({xMm:p.xMm/scale,yMm:height-p.yMm/scale}),p=>calibratedPoint(p.xMm,p.yMm,calibration)),saved=recoverSharedContours(originals,.8*scale,randomUUID,imageFit),piece=saved.pieces[0],ring=sample(piece,scale,height),all=saved.pieces.map(p=>[sample(p,scale,height),...(p.holes??[]).map(h=>sample(p,scale,height,h))]),owns=(p:TipPoint,r:TipPoint[][])=>sourcePolygonContains(p,r[0])&&!r.slice(1).some(h=>sourcePolygonContains(p,h));
  const boundaryError=Math.max(...ring.map(p=>sourceBoundaryDistance(p,source.truthRing))),tipError=sourceBoundaryDistance(source.tip,ring),nearestTipNode=Math.min(...piece.nodes.map(p=>Math.hypot(p.xMm/scale-source.tip.x,height-p.yMm/scale-source.tip.y))),nodeTurns=turns(piece,scale,height),nearTip=nodeTurns.filter(p=>Math.hypot(p.x-source.tip.x,p.y-source.tip.y)<6&&p.degrees>40),maxLocalX=Math.max(...ring.map(p=>source.local(p).x)),calibrationDrift=reference?Math.max(...ring.map(p=>sourceBoundaryDistance(p,reference!)),...reference.map(p=>sourceBoundaryDistance(p,ring))):0;
  let gaps=0,overlaps=0,wrongInterior=0,unobservedClaimed=0;
  for(let y=.317;y<height;y+=3.7)for(let x=.371;x<width;x+=3.7){const p={x,y},owners=all.filter(r=>owns(p,r)).length;gaps+=+(owners===0);overlaps+=+(owners>1);if(sourceBoundaryDistance(p,source.truthRing)>1.5)wrongInterior+=+(owns(p,all[0])!==sourcePolygonContains(p,source.truthRing));}
  if(spec.kind==='transparent')for(let y=0;y<height;y++)for(let x=0;x<width;x++){const p={x:x+.5,y:y+.5};if(source.missingAt(p)&&sourceBoundaryDistance(p,source.truthRing)>1.5)unobservedClaimed+=+owns(p,all[0]);}
  const metrics={spec,scale,sourceTip:source.tip,sourceNose:source.nose,boundaryError,tipError,nearestTipNode,nearTip,maxLocalX,calibrationDrift,gaps,overlaps,wrongInterior,unobservedClaimed,rawNodes:originals.map(p=>p.nodes.length),savedNodes:nodeTurns,report:saved.report};records.push(metrics);const message=JSON.stringify(metrics);
  expect(rgba,'source RGBA is immutable').toEqual(beforeRGBA);expect(source.observedMask,'measured selection input is immutable').toEqual(beforeMask);
  expect.soft(boundaryError,message).toBeLessThanOrEqual(1.5);expect.soft({gaps,overlaps,wrongInterior,unobservedClaimed},message).toEqual({gaps:0,overlaps:0,wrongInterior:0,unobservedClaimed:0});
  expect.soft(calibrationDrift,message).toBeLessThanOrEqual(.02);
  if(spec.requiresTip){expect.soft(tipError,message).toBeLessThanOrEqual(1.5);expect.soft(nearestTipNode,message).toBeLessThanOrEqual(1.5);expect.soft(nearTip,message).toHaveLength(1);expect.soft(Math.max(0,...nearTip.map(p=>p.degrees)),message).toBeGreaterThanOrEqual(180-(spec.angle??44)-20);}
  if(spec.kind==='rounded')expect.soft(nodeTurns.filter(p=>Math.hypot(p.x-source.nose.x,p.y-source.nose.y)<5&&p.degrees>45),message).toHaveLength(0);
  if(spec.kind==='flat')expect.soft(maxLocalX,message).toBeLessThanOrEqual(24-spec.truncate!+1.5);
  if(spec.kind==='concave')expect.soft(owns(source.notch,all[0]),'the analytic notch cannot be filled into a convex polygon').toBe(false);
  for(const p of ring){expect.soft(p.x,message).toBeGreaterThanOrEqual(-1e-7);expect.soft(p.x,message).toBeLessThanOrEqual(width+1e-7);expect.soft(p.y,message).toBeGreaterThanOrEqual(-1e-7);expect.soft(p.y,message).toBeLessThanOrEqual(height+1e-7);}
  reference??=ring;
 }
});

afterAll(()=>{const directory='test-results/contour-repair/line-tip-adversarial';mkdirSync(directory,{recursive:true});const stage=process.env.FPCAD_TIP_ADVERSARIAL_STAGE??'diagnostic';if(!/^[a-z0-9-]+$/.test(stage))throw Error('INVALID_TIP_STAGE');writeFileSync(directory+'/'+stage+'-metrics.json',JSON.stringify({stage,oracle:'Fixed pre-rendered rounded/truncated/concave/cropped polygons, deterministic phases and RGB noise, explicit Gaussian/box/motion kernels. The transparent source notch is defined geometrically before rendering. Half-contrast masks are measured source-selection inputs only; they never define expected output.',route:'Both explicit material masks -> traceMask -> imageBoundaryFit -> recoverSharedContours -> actual final node/cubic ownership. This source-selected colour workflow does not certify broad illustration classification, persistence, desktop or printing.',loadedFingerprints,savedFingerprints:fingerprints(),records},null,2));});
