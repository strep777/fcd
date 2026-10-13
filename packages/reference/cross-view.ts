import type {Piece,Project} from '../schema/index';
import {mapPiece} from '../pattern/edit';
type Region=NonNullable<Project['patternLibrary']>[number];
const rgb=(color:string)=>[1,3,5].map(i=>parseInt(color.slice(i,i+2),16));
/** Rank only opposite-view pigment candidates. Labels are a hint, not a geometric cut. */
export function companionRegions(base:Region,regions:Region[]){
 const a=rgb(base.piece.color);
 return regions.filter(r=>r.referenceId!==base.referenceId&&r.view!==base.view).map(region=>({region,distance:Math.hypot(...rgb(region.piece.color).map((v,i)=>v-a[i]))+(region.anatomy?.part===base.anatomy?.part?0:35)})).filter(r=>r.distance<110).sort((a,b)=>a.distance-b.distance).map(r=>r.region);
}
function frame(piece:Piece){
 const n=piece.nodes;if(n.length<3)throw Error('INVALID_GEOMETRY');
 const x=n.reduce((s,p)=>s+p.xMm,0)/n.length,y=n.reduce((s,p)=>s+p.yMm,0)/n.length;
 let xx=0,yy=0,xy=0;for(const p of n){xx+=(p.xMm-x)**2;yy+=(p.yMm-y)**2;xy+=(p.xMm-x)*(p.yMm-y);}
 return {x,y,angle:.5*Math.atan2(2*xy,xx-yy)};
}
/** Rigid initial registration preserves millimetres. Different poses still require review. */
export function alignCompanion(base:Piece,other:Piece,mirror=true,angleOffset=0,dx=0,dy=0):Piece{
 if(![angleOffset,dx,dy].every(Number.isFinite)||Math.abs(dx)>100000||Math.abs(dy)>100000)throw Error('INVALID_PLACEMENT');
 const source=mirror?mapPiece(other,p=>({xMm:-p.xMm,yMm:p.yMm})):other,a=frame(base),b=frame(source);
 const angle=a.angle-b.angle+angleOffset,c=Math.cos(angle),s=Math.sin(angle);
 return mapPiece(source,p=>({xMm:a.x+dx+c*(p.xMm-b.x)-s*(p.yMm-b.y),yMm:a.y+dy+s*(p.xMm-b.x)+c*(p.yMm-b.y)}));
}
