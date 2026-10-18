import {fitCandidate} from '../pattern/bezier-fit';
import {contourPiece,pieceContour,sampleShapeContour,type ShapeContour} from './shape-contour';
import {drawingIssue} from './drawing';

/** Fit the completed paint boundary, never the pointer samples. The fitter
 * bounds both directions of contour deviation in millimetres. Retain the
 * original if fitting changes topology or cannot certify its error budget. */
export function compactPaintContour<T extends ShapeContour>(shape:T,toleranceMm=.25):T {
 if(shape.curves?.length||shape.spline||shape.nodes.length<8)return shape;
 // Polygon unions may leave micron-length edges where successive brush caps
 // meet. They make endpoint tangents ill-conditioned; remove only adjacent
 // coincident stations, charging their displacement to the fitting budget.
 const epsilon=.0001,nodes:typeof shape.nodes=[];
 for(const p of shape.nodes){const last=nodes.at(-1);if(!last||Math.hypot(p.xMm-last.xMm,p.yMm-last.yMm)>epsilon)nodes.push(p);}
 if(nodes.length>1&&Math.hypot(nodes[0].xMm-nodes.at(-1)!.xMm,nodes[0].yMm-nodes.at(-1)!.yMm)<=epsilon)nodes.pop();
 if(nodes.length<3)return shape;
 let id=0;
 const fitted=pieceContour(fitCandidate(contourPiece({...shape,nodes},()=>String(id++)),Math.max(.01,Math.min(.5,toleranceMm)-epsilon),()=>String(id++),true).piece);
 if(fitted.nodes.length>=shape.nodes.length)return shape;
 const sampled=sampleShapeContour(fitted);
 if(sampled.length>2000||drawingIssue(sampled))return shape;
 // Hole edges are exact. Refuse a fitted outer edge approaching a hole closer
 // than the fitting budget; this preserves narrow bridges and hole containment.
 for(const hole of shape.holes??[])for(const p of hole)for(let i=0;i<sampled.length;i++){
  const a=sampled[i],b=sampled[(i+1)%sampled.length],dx=b.xMm-a.xMm,dy=b.yMm-a.yMm,length=dx*dx+dy*dy;
  const t=length?Math.max(0,Math.min(1,((p.xMm-a.xMm)*dx+(p.yMm-a.yMm)*dy)/length)):0;
  if(Math.hypot(p.xMm-a.xMm-t*dx,p.yMm-a.yMm-t*dy)<=toleranceMm*2)return shape;
 }
 return {...shape,...fitted};
}
