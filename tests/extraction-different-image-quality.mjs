import {build} from 'esbuild';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import sharp from 'sharp';
const folder=resolve('.local/tests/different-image-quality');await mkdir(folder,{recursive:true});
const report={views:[]};
for(const baseline of [true,false]){
 const outfile=resolve(folder,baseline?'before.mjs':'after.mjs');
 await build({stdin:{contents:"export {splitReferences} from './apps/desktop/main/automatic-reference';export {dualViewSplit} from './packages/reference/dual-view-split';export {analyze} from './apps/desktop/main/worker';export {project} from './tests/fixtures';",resolveDir:process.cwd()},bundle:true,platform:'node',format:'esm',outfile,plugins:baseline?[{name:'previous-dark-core',setup(b){b.onLoad({filter:/reference[\\/]illustration\.ts$/},async args=>{let code=await readFile(args.path,'utf8');code=code.replace('!dark(i)','value[i]>=.28||saturation[i]>=.45').replace('!dark((y+dy)*width+x+dx)','value[(y+dy)*width+x+dx]>=.28||saturation[(y+dy)*width+x+dx]>=.45').replace('dark(n)','value[n]<.28&&saturation[n]<.45').replace('x<1||x>=width-1||y<1||y>=height-1','x<2||x>=width-2||y<2||y>=height-2').replace('dy=-1;dy<=1','dy=-2;dy<=2').replace('dx=-1;dx<=1','dx=-2;dx<=2').replace('group.length>=12&&b.maxX-b.minX>=2&&b.maxY-b.minY>=2','group.length>=16&&b.maxX-b.minX>=4&&b.maxY-b.minY>=4').replace('entry.distance>=3','entry.distance>=2').replace('label!==6&&group.length<64','group.length<64');return {contents:code,loader:'ts'};});}}]:[]});
 const api=await import(pathToFileURL(outfile)),file='tests/fixtures/character-blue-white-front-back.png',meta=await sharp(file).metadata(),proxy=await sharp(file).resize(512).ensureAlpha().raw().toBuffer({resolveWithObject:true}),mid=api.dualViewSplit(proxy.info.width,proxy.info.height,new Uint8Array(proxy.data),meta.width).x,refs=[];
 for(const [view,left,width] of [['front',0,mid],['back',mid,meta.width-mid]]){const {data,info}=await sharp(file).extract({left,top:0,width,height:meta.height}).png().toBuffer({resolveWithObject:true});refs.push({id:crypto.randomUUID(),name:view,view,width:info.width,height:info.height,png:'data:image/png;base64,'+data.toString('base64'),resources:{}});}
 const t=Date.now(),result=api.splitReferences(refs,1800,6,true),p=api.project();p.pieces=result.regions.map(r=>r.piece);const geometry=await api.analyze(resolve('target/release/fpcad-worker.exe'),p),errors=geometry.flatMap(g=>g.issues.filter(i=>i.severity==='error').map(i=>({name:p.pieces.find(p=>p.id===g.id).name,color:p.pieces.find(p=>p.id===g.id).color,nodes:p.pieces.find(p=>p.id===g.id).nodes.length,rule:i.messageKey})));report.views.push({baseline,mid,regions:result.regions.length,errors,ms:Date.now()-t});console.log(JSON.stringify(report.views.at(-1)));
}
await writeFile('test-results/extraction-different-image-quality.json',JSON.stringify(report,null,2));
