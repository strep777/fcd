import type {Paper} from '../schema/index';
export type PrintPage={number:number;row:number;column:number;xMm:number;yMm:number};
export type PrintPlan={paper:Paper;widthMm:number;heightMm:number;contentWidthMm:number;contentHeightMm:number;stepXmm:number;stepYmm:number;columns:number;rows:number;pages:PrintPage[]};
/** One top-to-bottom tiling convention for on-screen preview, PDF and native printing. */
export function printPlan(widthMm:number,heightMm:number,paper:Paper):PrintPlan{
 const contentWidthMm=paper.widthMm-2*paper.marginMm,contentHeightMm=paper.heightMm-2*paper.marginMm,stepXmm=contentWidthMm-paper.overlapMm,stepYmm=contentHeightMm-paper.overlapMm;
 if(![widthMm,heightMm,...Object.values(paper)].every(Number.isFinite)||widthMm<=0||heightMm<=0||paper.marginMm<6||paper.overlapMm<0||contentWidthMm<100||contentHeightMm<20||stepXmm<=0||stepYmm<=0)throw Error('PAPER_TOO_SMALL');
 const columns=Math.max(1,Math.ceil((widthMm-paper.overlapMm)/stepXmm)),rows=Math.max(1,Math.ceil((heightMm-paper.overlapMm)/stepYmm));if(columns*rows>200)throw Error('RESOURCE_LIMIT');
 const pages=Array.from({length:columns*rows},(_,i)=>({number:i+1,row:Math.floor(i/columns)+1,column:i%columns+1,xMm:(i%columns)*stepXmm,yMm:Math.floor(i/columns)*stepYmm}));
 return {paper:{...paper},widthMm,heightMm,contentWidthMm,contentHeightMm,stepXmm,stepYmm,columns,rows,pages};
}
export function selectedPrintPages(plan:PrintPlan,numbers?:number[]){
 if(!numbers)return plan.pages;
 if(!numbers.length||new Set(numbers).size!==numbers.length||numbers.some(n=>!Number.isInteger(n)||n<1||n>plan.pages.length))throw Error('INVALID_SELECTION');
 const chosen=new Set(numbers);return plan.pages.filter(p=>chosen.has(p.number));
}
export function svgPrintPlan(svg:string,paper:Paper){const root=svg.match(/^<svg[^>]*viewBox="0 0 ([\d.]+) ([\d.]+)"[^>]*>/);if(!root)throw Error('INVALID_GEOMETRY');return printPlan(Number(root[1]),Number(root[2]),paper);}
/** Input is the application's escaped, generated SVG, never an imported raw document. */
export function printPageSvg(svg:string,plan:PrintPlan,page:PrintPage){
 const {paper,contentWidthMm:cw,contentHeightMm:ch}=plan,{widthMm:pw,heightMm:ph,marginMm:m,overlapMm:overlap}=paper,inner=svg.slice(svg.indexOf('>')+1,svg.lastIndexOf('</svg>'));
 const crosses=[m,pw-m].flatMap(x=>[m,ph-m].map(y=>[x,y]));
 if(overlap){for(const x of [m+overlap,pw-m-overlap])for(const y of [m,ph-m])crosses.push([x,y]);for(const y of [m+overlap,ph-m-overlap])for(const x of [m,pw-m])crosses.push([x,y]);}
 const marks=crosses.map(([x,y])=>`M ${x-2} ${y} H ${x+2} M ${x} ${y-2} V ${y+2}`).join(' ');
 const neighbors=[page.column>1?`← ${page.number-1}`:'',page.column<plan.columns?`${page.number+1} →`:'',page.row>1?`↑ ${page.number-plan.columns}`:'',page.row<plan.rows?`${page.number+plan.columns} ↓`:''].filter(Boolean).join(' / ');
 return `<svg xmlns="http://www.w3.org/2000/svg" width="${pw}mm" height="${ph}mm" viewBox="0 0 ${pw} ${ph}"><rect width="${pw}" height="${ph}" fill="white"/><svg x="${m}" y="${m}" width="${cw}" height="${ch}" viewBox="${page.xMm} ${page.yMm} ${cw} ${ch}" overflow="hidden">${inner}</svg><g fill="none" stroke="#77818b" stroke-width=".15" stroke-dasharray="2 1"><rect x="${m}" y="${m}" width="${cw}" height="${ch}"/>${overlap&&page.column<plan.columns?`<path d="M ${pw-m-overlap} ${m} V ${ph-m}"/>`:''}${overlap&&page.row<plan.rows?`<path d="M ${m} ${ph-m-overlap} H ${pw-m}"/>`:''}</g><path d="${marks} M ${m} 5 H ${m+100} M ${m} 4 V 6 M ${m+100} 4 V 6" fill="none" stroke="black" stroke-width=".25"/><g fill="black" font-family="sans-serif"><text x="${m}" y="3" font-size="2.1">100 mm = 10 cm · 1:1 / 100%</text><text x="${m}" y="${ph-4}" font-size="2">${page.row},${page.column} · ${page.number}/${plan.pages.length} · overlap ${overlap} mm · ${neighbors}</text><text x="${m}" y="${ph-1.5}" font-size="1.6">Trim blank margins; align crosses and shared outlines. Do not scale to fit.</text></g></svg>`;
}
