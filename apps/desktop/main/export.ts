import {printPlan,selectedPrintPages} from '../../../packages/manufacturing/print-pages';
import {interiorAnchor} from '../../../packages/pattern/interior';
import {resolvePiece,materialIssues} from '../../../packages/manufacturing/material';
import {markingIssues} from './markings';
import fontkit from '@pdf-lib/fontkit';
import { exportFont } from './export-assets';
import { PDFDocument,rgb,pushGraphicsState,popGraphicsState,rectangle as pdfRectangle,clip as pdfClip,endPath } from 'pdf-lib';
import { paperSchema,type Project,type Geometry,type Point,type Paper } from '../../../packages/schema/index';
import { DomainError } from './repository';
import {validateNesting,placedPoint} from './nesting';
import {seamIssues} from './seams';
import {bindingIssues} from './surface';
import {assertOutputBudget} from '../../../packages/manufacturing/output-limits';
const escape=(s:string)=>s.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]!));
type XY={xMm:number;yMm:number};
export function gate(project:Project,geometry:Geometry[],ack:string[]){
 const materials=materialIssues(project);if(materials.some(i=>i.severity==='error'))throw new DomainError(materials.find(i=>i.severity==='error')!.messageKey);if(materials.some(i=>i.severity==='warning'&&!ack.includes(i.ruleId)))throw new DomainError('WARNING_ACK_REQUIRED');
 const markingErrors=markingIssues(project);if(markingErrors.length)throw new DomainError(markingErrors[0].messageKey);
 if(!project.pieces.length)throw new DomainError('EMPTY_PROJECT');
 if(seamIssues(project,geometry).length)throw new DomainError('INVALID_SEAMS');
 const bindings=bindingIssues(project);if(bindings.some(i=>i.severity==='error'))throw new DomainError('STALE_BINDING');if(bindings.some(i=>i.severity==='warning'&&!ack.includes(i.ruleId)))throw new DomainError('WARNING_ACK_REQUIRED');
 if(geometry.length!==project.pieces.length||geometry.some((g,i)=>g.id!==project.pieces[i].id||g.issues.some(i=>i.severity==='error')||g.cut.length<3))throw new DomainError('INVALID_GEOMETRY');
 if(geometry.some(g=>g.issues.some(i=>i.severity==='warning'&&!ack.includes(i.ruleId))))throw new DomainError('WARNING_ACK_REQUIRED');
}
function notchLines(piece:Project['pieces'][number],cut:Point[],geometry?:Geometry):{points:XY[];label:string}[]{
 if(geometry?.notchSegments)return geometry.notchSegments.map(n=>({points:[n.start,n.end],label:n.label}));
 return (piece.notches??[]).map(n=>{
  const i=piece.nodes.findIndex(p=>p.id===n.nodeId),a=piece.nodes[i],b=piece.nodes[(i+1)%piece.nodes.length];
  if(!a||!b)throw new DomainError('invalidNotch');
  const area=piece.nodes.reduce((sum,p,j)=>{const q=piece.nodes[(j+1)%piece.nodes.length];return sum+p.xMm*q.yMm-q.xMm*p.yMm;},0);
  const length=Math.hypot(b.xMm-a.xMm,b.yMm-a.yMm),sign=area>0?1:-1,dx=sign*(b.yMm-a.yMm)/length,dy=-sign*(b.xMm-a.xMm)/length;
  const x=a.xMm+(b.xMm-a.xMm)*n.position,y=a.yMm+(b.yMm-a.yMm)*n.position;
  let travel=Infinity;
  for(let j=0;j<cut.length;j++){
   const p=cut[j],q=cut[(j+1)%cut.length],ex=q.xMm-p.xMm,ey=q.yMm-p.yMm,den=dx*ey-dy*ex;
   if(Math.abs(den)<1e-12)continue;const t=((p.xMm-x)*ey-(p.yMm-y)*ex)/den,u=((p.xMm-x)*dy-(p.yMm-y)*dx)/den;
   if(t>=0&&u>=0&&u<=1)travel=Math.min(travel,t);
  }
  if(!Number.isFinite(travel)||travel<=n.depthMm)throw new DomainError('invalidNotch');
  return {points:[{xMm:x+dx*travel,yMm:y+dy*travel},{xMm:x+dx*(travel-n.depthMm),yMm:y+dy*(travel-n.depthMm)}],label:n.label};
 });
}
export function layout(project:Project,geometry:Geometry[],nested=false,layoutWidthMm=1000){try{assertOutputBudget(project,geometry);}catch(error){throw new DomainError((error as Error).message);}let x=10,yOffset=0,rowHeight=0;
 if(nested){
  if(!project.nesting)throw new DomainError('NESTING_MISSING');validateNesting(project,geometry,project.nesting);
  return project.nesting.sheets.flatMap(sheet=>{const offset=x;x+=project.nesting!.options.widthMm+20;return sheet.placements.map(p=>{
   const piece=resolvePiece(project,project.pieces.find(piece=>piece.id===p.pieceId)!),g=geometry.find(g=>g.id===p.pieceId)!,index=project.pieces.findIndex(v=>v.id===piece.id)+1;
   const transform=(n:XY)=>{const r=placedPoint(n,p,piece,g);return {...r,xMm:r.xMm+offset,yMm:r.yMm+20};};
   const origin={xMm:offset+p.xMm,yMm:20+p.yMm},anchor=transform(interiorAnchor(g.seam??piece.nodes,g.seamHoles??piece.holes??[])),arrowLength=Math.min(15,interiorAnchor(g.seam??piece.nodes,g.seamHoles??piece.holes??[]).clearanceMm*.8);
   return {piece:{...piece,furRad:(p.mirror?Math.PI-piece.furRad:piece.furRad)+p.angleRad},index,instance:p.instance,mirror:p.mirror,cut:g.cut.map(transform),cutHoles:(g.cutHoles??[]).map(h=>h.map(transform)),seam:(g.seam??piece.nodes).map(transform),seamHoles:(g.seamHoles??piece.holes??[]).map(h=>h.map(transform)),notches:notchLines(piece,g.cut,g).map(n=>({...n,points:n.points.map(transform)})),markings:(project.markings??[]).flatMap(m=>m.paths.filter(v=>v.pieceId===piece.id).map(v=>({name:m.name,color:m.color,rings:v.rings.map(r=>r.map(transform))}))),labels:(piece.labels??[]).map(l=>({...transform(l),text:l.text})),x:origin.xMm,width:p.widthMm,height:p.yMm+p.heightMm,arrowLength,centerX:anchor.xMm,centerY:anchor.yMm,labelY:origin.yMm+p.heightMm/2,captionY:origin.yMm+p.heightMm/2,nested:true};
  });});
 }
 return project.pieces.flatMap((rawPiece,i)=>{const piece=resolvePiece(project,rawPiece);
  const g=geometry[i],minX=Math.min(...g.cut.map(n=>n.xMm)),minY=Math.min(...g.cut.map(n=>n.yMm)),maxX=Math.max(...g.cut.map(n=>n.xMm)),maxY=Math.max(...g.cut.map(n=>n.yMm));
  const notches=notchLines(piece,g.cut,g);
  return Array.from({length:piece.cutQty},(_,instance)=>{
   const itemWidth=Math.max(60,maxX-minX);if(x>10&&x+itemWidth>layoutWidthMm){x=10;yOffset+=rowHeight+65;rowHeight=0;}rowHeight=Math.max(rowHeight,maxY-minY);
   const mirror=piece.mirror&&instance%2===1;
   const transform=(n:XY)=>({xMm:x+(mirror?maxX-n.xMm:n.xMm-minX),yMm:20+yOffset+n.yMm-minY});
   const sourceAnchor=interiorAnchor(g.seam??piece.nodes,g.seamHoles??piece.holes??[]),anchor=transform(sourceAnchor);
   const result={piece,index:i+1,instance:instance+1,mirror,cut:g.cut.map(transform),cutHoles:(g.cutHoles??[]).map(h=>h.map(transform)),seam:(g.seam??piece.nodes).map(transform),seamHoles:(g.seamHoles??piece.holes??[]).map(h=>h.map(transform)),notches:notches.map(n=>({...n,points:n.points.map(transform)})),markings:(project.markings??[]).flatMap(m=>m.paths.filter(v=>v.pieceId===piece.id).map(v=>({name:m.name,color:m.color,rings:v.rings.map(r=>r.map(transform))}))),labels:(piece.labels??[]).map(l=>({...transform(l),text:l.text})),x,width:maxX-minX,height:yOffset+maxY-minY,arrowLength:Math.min(15,sourceAnchor.clearanceMm*.8),centerX:anchor.xMm,centerY:anchor.yMm,labelY:yOffset+maxY-minY+24,captionY:yOffset+10,nested:false};
   x+=Math.max(60,maxX-minX)+20;return result;
  });
 });
}
function captionLines(p:ReturnType<typeof layout>[number]){
 const lines:string[]=[],limit=Math.max(20,Math.floor(Math.max(60,p.width)/3));
 for(const text of [`P${p.index}/${p.instance} ${p.piece.name}`,`材料 / Material: ${p.piece.material}`,`缝份 / SA ${p.piece.allowanceMm}mm${p.piece.edgeAllowances?.length?' · Edge SA '+p.piece.edgeAllowances.length:''} · 裁剪 / Cut ${p.piece.cutQty}${p.mirror?' · 镜像 / MIRROR':''}`,`ID ${p.piece.id}`]){
  let chars=Array.from(text);while(chars.length){const lastSpace=chars.slice(0,limit+1).lastIndexOf(' '),end=chars.length<=limit?chars.length:lastSpace>limit/2?lastSpace:limit;lines.push(chars.slice(0,end).join(''));chars=chars.slice(end);while(chars[0]===' ')chars.shift();}
 }return lines;
}
function printDimensions(placed:ReturnType<typeof layout>){
 return {width:Math.max(130,...placed.map(p=>p.x+Math.max(60,p.width)+10)),height:Math.max(80,...placed.map(p=>Math.max(p.height+40,p.labelY+(captionLines(p).length-1)*3+20)))};
}
export function svgExport(project:Project,geometry:Geometry[],ack:string[],nested=false,layoutWidthMm=1000){
 gate(project,geometry,ack);const placed=layout(project,geometry,nested,layoutWidthMm),{width,height}=printDimensions(placed);if(width>1e6||height>1e6)throw new DomainError('RESOURCE_LIMIT');
 const path=(points:XY[],closed=true)=>points.map((p,i)=>`${i?'L':'M'}${p.xMm},${height-p.yMm}`).join(' ')+(closed?' Z':'');
 const arrow=(p:typeof placed[number])=>{const a=p.piece.furRad,x=p.centerX,y=p.centerY,dx=(p.mirror&&!p.nested?-1:1)*Math.cos(a)*p.arrowLength,dy=Math.sin(a)*p.arrowLength;return [{xMm:x,yMm:y},{xMm:x+dx,yMm:y+dy},{xMm:x+dx*.7-dy*.2,yMm:y+dy*.7+dx*.2},{xMm:x+dx,yMm:y+dy},{xMm:x+dx*.7+dy*.2,yMm:y+dy*.7-dx*.2}];};
 return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}mm" height="${height}mm" viewBox="0 0 ${width} ${height}"><metadata>${escape(JSON.stringify({revision:project.revision,unit:'mm',warningAckIds:ack,profile:'2d-manufacturing-3',materials:project.materials??[],defaultAllowanceMm:project.defaultAllowanceMm??10,curveToleranceMm:0.01,pieces:placed.map(p=>({id:p.piece.id,instance:p.instance,mirror:p.mirror,materialId:p.piece.materialId,allowanceMm:p.piece.allowanceMm,edgeAllowances:p.piece.edgeAllowances??[],grainRad:p.piece.grainRad}))}))}</metadata><g id="Color" stroke="none">${placed.map(p=>`<path fill="${p.piece.color}" fill-rule="evenodd" d="${[p.cut,...p.cutHoles].map(h=>path(h)).join(' ')}"/>`).join('')}</g><g id="Cut" fill="none" stroke="black" stroke-width="0.25">${placed.map(p=>`<path d="${[p.cut,...p.cutHoles].map(h=>path(h)).join(' ')}"/>`).join('')}</g><g id="Seam" fill="none" stroke="#567080" stroke-width="0.2" stroke-dasharray="2 1">${placed.map(p=>`<path d="${[p.seam,...p.seamHoles].map(h=>path(h)).join(' ')}"/>`).join('')}</g><g id="Marking" fill="none" stroke="#a65b22" stroke-width="0.2">${placed.flatMap(p=>p.markings.map(m=>`<path fill="${m.color}" fill-rule="evenodd" d="${m.rings.map(r=>path(r)).join(' ')}"><title>${escape(m.name)}</title></path>`)).join('')}</g><g id="Notch" fill="none" stroke="black" stroke-width="0.25">${placed.flatMap(p=>p.notches.map(n=>`<path d="${path(n.points,false)}"/>`)).join('')}</g><g id="Label" font-family="sans-serif" font-size="3">${placed.map(p=>`${captionLines(p).map((text,index,lines)=>`<text x="${p.x}" y="${height-p.labelY-(lines.length-1-index)*3}">${escape(text)}</text>`).join('')}${p.labels.map(l=>`<text x="${l.xMm}" y="${height-l.yMm}">${escape(l.text)}</text>`).join('')}${p.notches.filter(n=>n.label).map(n=>`<text x="${n.points[1].xMm}" y="${height-n.points[1].yMm}">${escape(n.label)}</text>`).join('')}`).join('')}<text x="10" y="8">FurryPattern CAD · revision ${project.revision} · 1:1 · 100 mm</text><text x="10" y="${height-4}">Cut: solid · Seam: dashed · Notch: short line · Grain: arrow</text></g><g id="Grain" fill="none" stroke="black" stroke-width="0.25">${placed.map(p=>`<path d="${path(arrow(p),false)}"/>`).join('')}</g><path id="calibration-100mm" d="M10 12 H110 M10 10 V14 M110 10 V14" fill="none" stroke="black" stroke-width="0.25"/></svg>`;
}
export async function pdfExport(project:Project,geometry:Geometry[],ack:string[],options?:Paper,nested=false,pageNumbers?:number[]){
 gate(project,geometry,ack);const paper=paperSchema.parse(options??{widthMm:210,heightMm:297,marginMm:10,overlapMm:10}),m=paper.marginMm,pw=paper.widthMm,ph=paper.heightMm,cw=pw-2*m,ch=ph-2*m;
 if(cw<100||m<6)throw new DomainError('PAPER_TOO_SMALL');
 const placed=layout(project,geometry,nested),{width,height:fullHeight}=printDimensions(placed);
 const pdf=await PDFDocument.create(),pt=72/25.4;pdf.registerFontkit(fontkit);const font=await pdf.embedFont(await exportFont(),{subset:true}),supported=new Set(font.getCharacterSet());
 const checked=(text:string)=>{for(const char of text)if(!supported.has(char.codePointAt(0)!))throw new DomainError('FONT_GLYPH_MISSING');return text;};
 const labels=placed.map(p=>captionLines(p).map(checked));
 let plan,pages;try{plan=printPlan(width,fullHeight,paper);pages=selectedPrintPages(plan,pageNumbers);}catch(error){throw new DomainError((error as Error).message);}
 const {columns:cols,rows}=plan;
 pdf.setTitle(`FurryPattern CAD revision ${project.revision}`);
 for(const tile of pages){const row=tile.row-1,col=tile.column-1;
  const page=pdf.addPage([pw*pt,ph*pt]),x0=tile.xMm,y0=fullHeight-tile.yMm-ch;
  const line=(a:XY,b:XY,seam=false)=>{const c=clip(a.xMm-x0,a.yMm-y0,b.xMm-x0,b.yMm-y0,cw,ch);if(c)page.drawLine({start:{x:(m+c[0])*pt,y:(m+c[1])*pt},end:{x:(m+c[2])*pt,y:(m+c[3])*pt},thickness:(seam?.18:.25)*pt,color:seam?rgb(.35,.45,.5):rgb(0,0,0),dashArray:seam?[2*pt,pt]:undefined});};
  const draw=(r:XY[],seam=false)=>{for(let i=0;i<r.length;i++)line(r[i],r[(i+1)%r.length],seam);};
  for(const [i,p] of placed.entries()){
   const color=(hex:string)=>rgb(parseInt(hex.slice(1,3),16)/255,parseInt(hex.slice(3,5),16)/255,parseInt(hex.slice(5,7),16)/255);
   const fill=(rings:XY[][],hex:string)=>{const d=rings.map(r=>r.map((v,i)=>(i?'L':'M')+(v.xMm-x0)*pt+' '+(-(v.yMm-y0)*pt)).join(' ')+' Z').join(' ');page.drawSvgPath(d,{x:m*pt,y:m*pt,color:color(hex)});};
   page.pushOperators(pushGraphicsState(),pdfRectangle(m*pt,m*pt,cw*pt,ch*pt),pdfClip(),endPath());
   fill([p.cut,...p.cutHoles],p.piece.color);for(const marking of p.markings)fill(marking.rings,marking.color);
   page.pushOperators(popGraphicsState());
   [p.cut,...p.cutHoles].forEach(r=>draw(r));[p.seam,...p.seamHoles].forEach(r=>draw(r,true));p.notches.forEach(n=>line(n.points[0],n.points[1]));p.markings.forEach(m=>m.rings.forEach(r=>draw(r,true)));
   const a=p.piece.furRad,c={xMm:p.centerX,yMm:p.centerY},dx=(p.mirror&&!p.nested?-1:1)*Math.cos(a)*p.arrowLength,dy=Math.sin(a)*p.arrowLength,e={xMm:c.xMm+dx,yMm:c.yMm+dy};
   line(c,e);line(e,{xMm:e.xMm-dx*.3-dy*.2,yMm:e.yMm-dy*.3+dx*.2});line(e,{xMm:e.xMm-dx*.3+dy*.2,yMm:e.yMm-dy*.3-dx*.2});
   page.pushOperators(pushGraphicsState(),pdfRectangle(m*pt,m*pt,cw*pt,ch*pt),pdfClip(),endPath());
   labels[i].forEach((text,index)=>{const y=p.labelY+(labels[i].length-1-index)*3-y0;if(y>=-3&&y<=ch+3)page.drawText(text,{x:(m+p.x-x0)*pt,y:(m+y)*pt,size:7,font});});
   for(const l of [...p.labels,...p.notches.filter(n=>n.label).map(n=>({...n.points[1],text:n.label}))])page.drawText(checked(l.text),{x:(m+l.xMm-x0)*pt,y:(m+l.yMm-y0)*pt,size:7,font});
   page.pushOperators(popGraphicsState());
  }
  page.drawText(`1:1 / 100% | overlap ${paper.overlapMm}mm | R${project.revision} | ${row+1},${col+1} | ${row*cols+col+1}/${rows*cols}`,{x:m*pt,y:4*pt,size:5,font});
  page.drawText('纸样: 实线切割 / Cut | 虚线缝线 / Seam | 短线剪口 / Notch | 箭头毛向 / Grain',{x:m*pt,y:1.5*pt,size:5,font});
  page.drawLine({start:{x:m*pt,y:(ph-5)*pt},end:{x:(m+100)*pt,y:(ph-5)*pt},thickness:.25*pt});page.drawText('100 mm · 按实际尺寸打印 / Actual size',{x:m*pt,y:(ph-3)*pt,size:6,font});
  for(const x of [m,m+100])page.drawLine({start:{x:x*pt,y:(ph-6)*pt},end:{x:x*pt,y:(ph-4)*pt},thickness:.25*pt});
  if(paper.overlapMm&&col<cols-1)page.drawLine({start:{x:(pw-m-paper.overlapMm)*pt,y:m*pt},end:{x:(pw-m-paper.overlapMm)*pt,y:(ph-m)*pt},thickness:.15*pt,color:rgb(.45,.5,.55),dashArray:[2*pt,pt]});
  if(paper.overlapMm&&row<rows-1)page.drawLine({start:{x:m*pt,y:(m+paper.overlapMm)*pt},end:{x:(pw-m)*pt,y:(m+paper.overlapMm)*pt},thickness:.15*pt,color:rgb(.45,.5,.55),dashArray:[2*pt,pt]});
  const crosses=[m,pw-m].flatMap(x=>[m,ph-m].map(y=>[x,y]));if(paper.overlapMm){for(const x of [m+paper.overlapMm,pw-m-paper.overlapMm])for(const y of [m,ph-m])crosses.push([x,y]);for(const y of [m+paper.overlapMm,ph-m-paper.overlapMm])for(const x of [m,pw-m])crosses.push([x,y]);}
  for(const [x,y] of crosses){page.drawLine({start:{x:(x-2)*pt,y:y*pt},end:{x:(x+2)*pt,y:y*pt},thickness:.2*pt});page.drawLine({start:{x:x*pt,y:(y-2)*pt},end:{x:x*pt,y:(y+2)*pt},thickness:.2*pt});}
 }
 await pdf.attach(Buffer.from(JSON.stringify({revision:project.revision,warningAckIds:ack,paper,curveToleranceMm:0.01,materials:project.materials??[],defaultAllowanceMm:project.defaultAllowanceMm??10,legend:{cut:'solid',seam:'dashed',notch:'short line',grain:'arrow'},pieces:project.pieces},null,2)),'manufacturing-metadata.json',{mimeType:'application/json'});
 return pdf.save();
}
function clip(x1:number,y1:number,x2:number,y2:number,w:number,h:number){let low=0,high=1;const dx=x2-x1,dy=y2-y1;const p=[-dx,dx,-dy,dy],q=[x1,w-x1,y1,h-y1];for(let i=0;i<4;i++){if(p[i]===0){if(q[i]<0)return null;}else{const r=q[i]/p[i];if(p[i]<0)low=Math.max(low,r);else high=Math.min(high,r);if(low>high)return null;}}return [x1+low*dx,y1+low*dy,x1+high*dx,y1+high*dy];}
export function dxfExport(project:Project,geometry:Geometry[],ack:string[],nested=false){
 gate(project,geometry,ack);const placed=layout(project,geometry,nested),pairs:(string|number)[]=[];
 const put=(...values:(string|number)[])=>pairs.push(...values);
 const text=(s:string)=>s.replace(/[\r\n]/g,' ').replace(/[^\x20-\x7e]/g,c=>`\\U+${c.charCodeAt(0).toString(16).toUpperCase().padStart(4,'0')}`);
 const poly=(layer:string,r:XY[],closed=true)=>{put(0,'LWPOLYLINE',100,'AcDbEntity',8,layer,100,'AcDbPolyline',90,r.length,70,closed?1:0);r.forEach(p=>put(10,p.xMm,20,p.yMm));};
 const label=(value:string,x:number,y:number)=>put(0,'TEXT',100,'AcDbEntity',8,'LABEL',100,'AcDbText',10,x,20,y,30,0,40,3,1,text(value));
 put(0,'SECTION',2,'HEADER',9,'$ACADVER',1,'AC1015',9,'$INSUNITS',70,4,9,'$DWGCODEPAGE',3,'ANSI_1252',0,'ENDSEC',0,'SECTION',2,'TABLES',0,'TABLE',2,'LAYER',70,6);
 for(const layer of ['CUT','SEAM','NOTCH','GRAIN','LABEL','MARKING'])put(0,'LAYER',100,'AcDbSymbolTableRecord',100,'AcDbLayerTableRecord',2,layer,70,0,62,7,6,'CONTINUOUS');
 put(0,'ENDTAB',0,'ENDSEC',0,'SECTION',2,'ENTITIES');
 for(const p of placed){
  [p.cut,...p.cutHoles].forEach(r=>poly('CUT',r));p.markings.forEach(m=>m.rings.forEach(r=>poly('MARKING',r)));[p.seam,...p.seamHoles].forEach(r=>poly('SEAM',r));p.notches.forEach(n=>{poly('NOTCH',n.points,false);if(n.label)label(n.label,n.points[1].xMm,n.points[1].yMm);});
  label(`${p.piece.name} / ${p.instance} / ${p.piece.material} / SA ${p.piece.allowanceMm} mm${p.piece.edgeAllowances?.length?' / Edge SA '+p.piece.edgeAllowances.length:''}${p.mirror?' / MIRROR':''}`,p.x,p.labelY);p.labels.forEach(l=>label(l.text,l.xMm,l.yMm));
  const a=p.piece.furRad,c={xMm:p.centerX,yMm:p.centerY},dx=(p.mirror&&!p.nested?-1:1)*Math.cos(a)*p.arrowLength,dy=Math.sin(a)*p.arrowLength,e={xMm:c.xMm+dx,yMm:c.yMm+dy};poly('GRAIN',[c,e],false);poly('GRAIN',[{xMm:e.xMm-dx*.3-dy*.2,yMm:e.yMm-dy*.3+dx*.2},e,{xMm:e.xMm-dx*.3+dy*.2,yMm:e.yMm-dy*.3-dx*.2}],false);
 }
 poly('LABEL',[{xMm:10,yMm:0},{xMm:110,yMm:0}],false);label(`100 mm / 1:1 / R${project.revision}`,10,4);put(0,'ENDSEC',0,'EOF');return pairs.join('\r\n')+'\r\n';
}
