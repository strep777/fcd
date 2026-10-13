import type {Piece} from '../schema/index';
import {pointBounds} from '../pattern/edit';
/** A screen ruler reports world millimetres; camera zoom never scales pattern geometry. */
export function previewRuler(pixelsPerMm:number,targetPx=100){
 if(!Number.isFinite(pixelsPerMm)||pixelsPerMm<=0)return {mm:0,pixels:0};
 const desired=targetPx/pixelsPerMm,magnitude=10**Math.floor(Math.log10(desired)),fraction=desired/magnitude;
 const mm=(fraction>=5?5:fraction>=2?2:1)*magnitude;
 return {mm,pixels:mm*pixelsPerMm};
}

/** Exact cubic extrema keep dimensions honest before worker geometry is available. */
export function pieceDimensions(piece:Pick<Piece,'nodes'|'curves'>){
 const points=[...piece.nodes],nodes=new Map(piece.nodes.map(p=>[p.id,p]));
 for(const curve of piece.curves??[]){const a=nodes.get(curve.startNodeId),b=nodes.get(curve.endNodeId);if(!a||!b)continue;
  for(const axis of ['xMm','yMm'] as const){const A=-a[axis]+3*curve.c1[axis]-3*curve.c2[axis]+b[axis],B=2*(a[axis]-2*curve.c1[axis]+curve.c2[axis]),C=curve.c1[axis]-a[axis],d=B*B-4*A*C;
   const roots=Math.abs(A)<1e-12?(Math.abs(B)<1e-12?[]:[-C/B]):d<0?[]:[(-B+Math.sqrt(d))/(2*A),(-B-Math.sqrt(d))/(2*A)];
   for(const t of roots)if(t>0&&t<1){const u=1-t,at=(key:'xMm'|'yMm')=>u*u*u*a[key]+3*u*u*t*curve.c1[key]+3*u*t*t*curve.c2[key]+t*t*t*b[key];points.push({id:'',xMm:at('xMm'),yMm:at('yMm')});}
  }
 }
 if(!points.length)return {widthMm:0,heightMm:0};const bounds=pointBounds(points);return {widthMm:bounds.maxX-bounds.minX,heightMm:bounds.maxY-bounds.minY};
}
