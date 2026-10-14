// Algorithm evidence, not a desktop screenshot. Read the comparison source
// from Git; no historical source checkout or user project data is modified.
import {execFileSync} from 'node:child_process';
import {mkdir,writeFile} from 'node:fs/promises';
import {build} from 'esbuild';
import sharp from 'sharp';
const output='test-results/edge-fidelity';
await mkdir(output,{recursive:true});
const baseline=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8',windowsHide:true}).trim();
async function api(before){
 const source=before
  ?"export {fitCandidate as custom} from './packages/pattern/bezier-fit';"
  :"import {fitReferenceCandidate} from './apps/desktop/main/reference-contour-fit'; export const custom=(p,t,id)=>fitReferenceCandidate(p,t,.04,id);";
 const bundled=await build({stdin:{contents:source+"export {traceMask} from './apps/desktop/main/reference-segmentation';export {recoverContour} from './packages/reference/recover-contour';export {contourBoundaryError} from './packages/reference/contour-topology';",resolveDir:process.cwd()},bundle:true,platform:'node',format:'esm',write:false,plugins:before?[{name:'git-baseline',setup(b){b.onLoad({filter:/packages[\\/]reference[\\/]recover-contour\.ts$/},()=>({contents:execFileSync('git',['show',`${baseline}:packages/reference/recover-contour.ts`],{encoding:'utf8',windowsHide:true}),loader:'ts'}));}}]:[]});
 return import('data:text/javascript;base64,'+Buffer.from(bundled.outputFiles[0].text).toString('base64'));
}
const old=await api(true),current=await api(false);
const cases=[
 {name:'Acute rotated diamond',size:520,scale:1,fill:(x,y)=>{const a=.087,u=(x-260)*Math.cos(a)+(y-260)*Math.sin(a),v=-(x-260)*Math.sin(a)+(y-260)*Math.cos(a);return Math.abs(u)/35+Math.abs(v)/190<1;}},
 {name:'Thin diagonal stripe (slope 1.37)',size:160,scale:1,fill:(x,y)=>{const a=Math.atan(1.37),u=(x-80)*Math.cos(a)+(y-80)*Math.sin(a),v=-(x-80)*Math.sin(a)+(y-80)*Math.cos(a);return Math.abs(u)<56&&Math.abs(v)<3;}},
 {name:'Custom fit: straight diamond',size:150,scale:.05,custom:true,fill:(x,y)=>Math.abs(x-75)/35+Math.abs(y-75)/55<1},
];
const path=p=>p.nodes.map((a,i)=>{const b=p.nodes[(i+1)%p.nodes.length],c=p.curves?.find(c=>c.startNodeId===a.id);return `${i?'':'M'+a.xMm+','+a.yMm+' '}${c?'C'+c.c1.xMm+','+c.c1.yMm+' '+c.c2.xMm+','+c.c2.yMm+' '+b.xMm+','+b.yMm:'L'+b.xMm+','+b.yMm}`;}).join(' ')+'Z';
const panels=[],metrics=[];
for(const [row,c]of cases.entries()){
 const mask=new Uint8Array(c.size*c.size);for(let y=0;y<c.size;y++)for(let x=0;x<c.size;x++)if(c.fill(x+.5,y+.5))mask[y*c.size+x]=1;
 const raw=current.traceMask(c.size,c.size,mask,{a:{x:0,y:c.size},b:{x:0,y:0},distanceMm:c.size*c.scale},c.size,c.size,'#555555',true).piece;
 const versions=[old,current].map(a=>c.custom?a.custom(raw,.5,()=>crypto.randomUUID()).piece:a.recoverContour(raw,.8*c.scale,()=>crypto.randomUUID()));
 const xs=raw.nodes.map(p=>p.xMm),ys=raw.nodes.map(p=>p.yMm),minX=Math.min(...xs),minY=Math.min(...ys),width=Math.max(...xs)-minX,height=Math.max(...ys)-minY,zoom=Math.min(350/width,280/height);
 for(const [col,p]of versions.entries()){
  const error=current.contourBoundaryError(p,raw,.1*c.scale,Infinity)/c.scale;
  panels.push(`<g transform="translate(${col*440+30},${row*370+85})"><text font-size="17" fill="#18212c">${c.name}</text><text y="25" font-size="13" fill="#53616f">${col?'CURRENT':'GIT BASELINE'} · ${p.nodes.length} nodes · ${(p.curves??[]).length} curves · ${error.toFixed(3)} px bound</text><g transform="translate(${195-width*zoom/2},320) scale(${zoom},${-zoom}) translate(${-minX},${-minY})"><path d="${path(raw)}" fill="#edf0f3" stroke="#939da7" stroke-width="${1/zoom}"/><path d="${path(p)}" fill="none" stroke="${col?'#087f8c':'#cc3d46'}" stroke-width="${1.8/zoom}"/>${p.nodes.map(n=>`<circle cx="${n.xMm}" cy="${n.yMm}" r="${2/zoom}" fill="${col?'#087f8c':'#cc3d46'}"/>`).join('')}</g></g>`);
 }
 metrics.push({case:c.name,rawNodes:raw.nodes.length,...Object.fromEntries(versions.map((p,i)=>[i?'current':'baseline',{nodes:p.nodes.length,curves:p.curves?.length??0,boundPixels:current.contourBoundaryError(p,raw,.1*c.scale,Infinity)/c.scale}]))});
}
const svg=`<svg xmlns="http://www.w3.org/2000/svg" width="900" height="1210"><rect width="900" height="1210" fill="white"/><g font-family="Arial, sans-serif"><text x="30" y="35" font-size="23" fill="#18212c">Source-constrained contour recovery</text><text x="30" y="59" font-size="13" fill="#53616f">Grey: original pixel boundary · dots: editable nodes · generated algorithm comparison</text>${panels.join('')}</g></svg>`;
await sharp(Buffer.from(svg)).png().toFile(`${output}/comparison.png`);
await writeFile(`${output}/comparison.json`,JSON.stringify({baseline,generatedAt:new Date().toISOString(),kind:'algorithm visualization, not desktop screenshot',metrics},null,2));
console.log(JSON.stringify(metrics,null,2));
