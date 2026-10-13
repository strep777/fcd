// Offline diagnostics from fixed native-resolution regression images. No user DB writes or desktop launch.
import {build} from 'esbuild';
import sharp from 'sharp';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import path from 'node:path';
const folder=path.resolve('.local/tests/extraction-context-quality');await mkdir(folder,{recursive:true});await mkdir('test-results',{recursive:true});
for(const baseline of [true,false]){
 const outfile=path.join(folder,baseline?'before.mjs':'after.mjs');
 await build({stdin:{contents:`export {illustrationRegions,pigmentFamily} from './packages/reference/illustration';export {traceMask} from './apps/desktop/main/reference-segmentation';export {smoothContour} from './packages/reference/smooth-contour';export {safeContour,contourBoundaryError} from './packages/reference/contour-topology';`,resolveDir:process.cwd()},bundle:true,platform:'node',format:'esm',outfile,plugins:baseline?[{name:'prior-context-and-shadows',setup(builder){builder.onLoad({filter:/reference[\\/]illustration\.ts$/},async args=>{
  let code=await readFile(args.path,'utf8');const shadow='const recoveredShadowPixels=recoverYellowShadows(width,height,rgba,foreground,ink,labels,hue,saturation,value);',head="if(t<.3)return x<headBox.minX||x>=headBox.maxX?{part:'unknown',side:'unknown',confidence:0}:{part:'head',side:'center',confidence:.85};";
  if(!code.includes(shadow)||!code.includes(head))throw Error('Baseline patch no longer matches implementation');
  code=code.replace(shadow,'const recoveredShadowPixels=0;').replace(head,"if(t<.3)return {part:'head',side:'center',confidence:.85};").replace('const supportedHead=faceSupport>=Math.max(16,group.length*.03);','const supportedHead=false;');
  code=code.replace(/const partBounds=bodyParts\.flatMap\(part=>\{const ids=contextual\.get\(part\);return ids\?\.length\?\[\{part,\.\.\.box\(ids,width\)\}\]:\[\];\}\);/,"const partBounds=bodyParts.flatMap(part=>{const ids=regions.filter(r=>r.part===part).flatMap(r=>r.indices);return ids.length?[{part,...box(ids,width)}]:[];});");
  if(code.includes('const ids=contextual.get(part)'))throw Error('Bounds baseline patch failed');return {contents:code,loader:'ts'};
 });}}]:[]});
}
const before=await import(pathToFileURL(path.join(folder,'before.mjs'))),after=await import(pathToFileURL(path.join(folder,'after.mjs'))),report={baseline:'Same pipeline with contextual bounds, warm yellow-shadow recovery and centrally supported blue-head exception disabled',probeScope:'Five manually inspected golden-brown thigh-shadow points and four separate white/pink negative points; not whole-image segmentation accuracy.',views:[]};
const shadow=[[348,547],[350,556],[352,566],[331,573],[356,575]],negative=[[165,85],[217,310],[337,673],[45,243]],panels=[];
function yellow(result,api,w,h){const mask=new Uint8Array(w*h);for(const r of result.regions.filter(r=>api.pigmentFamily(r.color)===2))for(const i of r.indices)mask[i]=1;return mask;}
function edges(mask,w,h){let p='';for(let i=0;i<mask.length;i++)if(mask[i]){const x=i%w,y=Math.floor(i/w);if(!y||!mask[i-w])p+=`M${x},${y}h1`;if(y+1===h||!mask[i+w])p+=`M${x},${y+1}h1`;if(!x||!mask[i-1])p+=`M${x},${y}v1`;if(x+1===w||!mask[i+1])p+=`M${x+1},${y}v1`;}return p;}
for(const [view,area] of [['front',{left:609,top:0,width:666,height:750}],['back',{left:0,top:0,width:609,height:750}]]){
 const {data,info}=await sharp('tests/fixtures/character-front-back.jpg').extract(area).ensureAlpha().raw().toBuffer({resolveWithObject:true}),w=info.width,h=info.height,rgba=new Uint8Array(data),b=before.illustrationRegions(w,h,rgba),a=after.illustrationRegions(w,h,rgba),bm=yellow(b,before,w,h),am=yellow(a,after,w,h),outlineErrors=[];
 for(const region of a.regions.filter(r=>after.pigmentFamily(r.color)===2&&r.indices.length>100)){
  const mask=new Uint8Array(w*h);for(const i of region.indices)mask[i]=1;const raw=after.traceMask(w,h,mask,{a:{x:0,y:h},b:{x:0,y:0},distanceMm:h},w,h,region.color,true).piece,fit=after.smoothContour(raw,.8,()=>crypto.randomUUID());if(!after.safeContour(fit,raw,.8))throw Error('Unsafe yellow contour');outlineErrors.push(after.contourBoundaryError(fit,raw,.2,1.4));
 }
 const m=(r,mask)=>({foreground:r.foregroundPixels,discarded:r.discardedPixels,regions:r.regions.length,yellowPixels:mask.reduce((n,v)=>n+v,0),partBounds:r.partBounds,...(view==='front'?{shadowProbeRetained:shadow.filter(([x,y])=>mask[y*w+x]).length,negativeProbeFalsePositive:negative.filter(([x,y])=>mask[y*w+x]).length}:{})});
 report.views.push({view,before:m(b,bm),after:m(a,am),recoveredShadowPixels:a.recoveredShadowPixels,maxSmoothedBoundaryErrorPx:Math.max(...outlineErrors),testedYellowContours:outlineErrors.length});
 const image=(await sharp(data,{raw:{width:w,height:h,channels:4}}).png().toBuffer()).toString('base64');
 for(const [caption,r,mask] of [['BEFORE',b,bm],['AFTER',a,am]]){
  const box=r.partBounds.find(b=>b.part==='body'),head=r.partBounds.find(b=>b.part==='head'),frames=[['#e85545',box],['#14a78b',head]].map(([color,b])=>b?`<rect x="${b.minX}" y="${b.minY}" width="${b.maxX-b.minX}" height="${b.maxY-b.minY}" fill="none" stroke="${color}" stroke-width="3"/>`:'').join('');
  const svg=`<svg xmlns="http://www.w3.org/2000/svg" width="360" height="445"><rect width="360" height="445" fill="white"/><text x="10" y="23" font-size="16">${view.toUpperCase()} ${caption}</text><svg x="10" y="35" width="340" height="400" viewBox="0 0 ${w} ${h}"><image width="${w}" height="${h}" href="data:image/png;base64,${image}"/>${frames}</svg></svg>`;
  panels.push(await sharp(Buffer.from(svg)).png().toBuffer());
  if(view==='front'){
   const crop=`<svg xmlns="http://www.w3.org/2000/svg" width="480" height="420"><rect width="480" height="420" fill="white"/><text x="10" y="23" font-size="16">YELLOW THIGH SHADOW ${caption}</text><svg x="0" y="35" width="480" height="385" viewBox="265 495 120 96.25"><image width="${w}" height="${h}" href="data:image/png;base64,${image}"/><path d="${edges(mask,w,h)}" fill="none" stroke="#d822b2" stroke-width=".35"/></svg></svg>`;await sharp(Buffer.from(crop)).png().toFile(path.join(folder,`yellow-shadow-${caption.toLowerCase()}.png`));
  }
 }
}
await sharp({create:{width:1440,height:445,channels:4,background:'#ffffff'}}).composite(panels.map((input,i)=>({input,left:i*360,top:0}))).png().toFile(path.join(folder,'anatomical-frames-before-after.png'));
await sharp({create:{width:960,height:420,channels:4,background:'#ffffff'}}).composite(await Promise.all(['before','after'].map(async(name,i)=>({input:await readFile(path.join(folder,`yellow-shadow-${name}.png`)),left:i*480,top:0})))).png().toFile(path.join(folder,'yellow-shadow-before-after.png'));
{
 const w=200,h=130,rgba=new Uint8Array(w*h*4).fill(255),truth=new Uint8Array(w*h),points=[[20,20],[120,20],[175,27],[130,38],[181,47],[132,57],[180,70],[127,80],[173,95],[120,105],[20,105]],inside=(x,y)=>{let odd=false;for(let i=0,j=points.length-1;i<points.length;j=i++){const a=points[i],b=points[j];if((a[1]>y)!==(b[1]>y)&&x<(b[0]-a[0])*(y-a[1])/(b[1]-a[1])+a[0])odd=!odd;}return odd;};
 for(let y=0;y<h;y++)for(let x=0;x<w;x++){const i=y*w+x;if(inside(x+.5,y+.5)){truth[i]=1;const t=Math.max(0,Math.min(1,(x-120)/60)),v=235-110*t,hue=(56-34*t)/60,c=v*.76,secondary=c*(1-Math.abs(hue%2-1)),m=v-c;rgba.set([c+m,secondary+m,m,255].map(Math.round),i*4);}else if(y>=106&&y<122&&x>=25&&x<170)rgba.set([240,145,162,255],i*4);}
 const metrics=api=>{const result=api.illustrationRegions(w,h,rgba,true,'head'),mask=yellow(result,api,w,h);let intersection=0,union=0;for(let i=0;i<mask.length;i++){if(mask[i]&&truth[i])intersection++;if(mask[i]||truth[i])union++;}return {maskIoU:intersection/union,shadowFurTipRecall:[[172,27],[177,47],[176,70],[170,94]].filter(([x,y])=>mask[y*w+x]).length/4,hardPinkFalsePositive:!!mask[115*w+80],whiteFalsePositive:!!mask[40*w+190]};};
 report.syntheticFurTips={scope:'Hand-defined jagged golden fur polygon with continuous hue/value shadow ramp against sharp pink and white',before:metrics(before),after:metrics(after)};
}
report.artifacts={frames:path.join(folder,'anatomical-frames-before-after.png'),shadow:path.join(folder,'yellow-shadow-before-after.png')};await writeFile('test-results/extraction-context-quality.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));
