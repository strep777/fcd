import type {Project,Geometry,PatternOverview} from '../../../packages/schema/index';
import {svgExport} from './export';
/** Screen layout uses every exact cut contour but never allocates print pages.
 * Printing still uses the original millimetre layout and bounded page plan. */
export function patternOverview(project:Project,geometry:Geometry[],ack:string[]):PatternOverview {
 let total=0,widest=130;
 for(const [i,p] of project.pieces.entries()){
  const nodes=geometry[i].cut,x=nodes.map(n=>n.xMm),y=nodes.map(n=>n.yMm),w=Math.max(...x)-Math.min(...x),h=Math.max(...y)-Math.min(...y);
  total+=p.cutQty*(Math.max(60,w)+20)*(h+65);widest=Math.max(widest,w+20);
 }
 // Similar heights share rows in the screen layout, preserving print order.
 const rows=project.pieces.map((piece,i)=>({piece,geometry:geometry[i],height:Math.max(...geometry[i].cut.map(p=>p.yMm))-Math.min(...geometry[i].cut.map(p=>p.yMm))})).sort((a,b)=>b.height-a.height);
 const svg=svgExport({...project,pieces:rows.map(r=>r.piece)},rows.map(r=>r.geometry),ack,false,Math.max(widest,Math.sqrt(total*1.5)));
 const match=svg.match(/^<svg[^>]*viewBox="0 0 ([\d.]+) ([\d.]+)"/)!;
 return {svg,widthMm:Number(match[1]),heightMm:Number(match[2]),revision:project.revision,pieceIds:project.pieces.map(p=>p.id)};
}
