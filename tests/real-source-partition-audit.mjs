import {spawnSync} from 'node:child_process';
import {readFile,writeFile,mkdtemp} from 'node:fs/promises';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import sharp from 'sharp';
import {auditRuntime,sha256} from './real-mapping-fixture-audit.mjs';

const inside=(x,y,ring)=>{let odd=false;for(let i=0,j=ring.length-1;i<ring.length;j=i++){const a=ring[i],b=ring[j];if((a[1]>y)!==(b[1]>y)&&x<(b[0]-a[0])*(y-a[1])/(b[1]-a[1])+a[0])odd=!odd;}return odd;};
const distance=(x,y,ring)=>{let best=Infinity;for(let i=0;i<ring.length;i++){const a=ring[i],b=ring[(i+1)%ring.length],dx=b[0]-a[0],dy=b[1]-a[1],length=dx*dx+dy*dy,t=length?Math.max(0,Math.min(1,((x-a[0])*dx+(y-a[1])*dy)/length)):0;best=Math.min(best,Math.hypot(x-a[0]-t*dx,y-a[1]-t*dy));}return best;};
/** Independent raster/vector audit. Real foreground edges have a 1.05 pixel
 * fitting allowance; interior material seams only have the disclosed 0.01 mm
 * diagonal bevel. Native flattening, never curve/ring signatures, supplies the
 * saved vector geometry. Each reference and every owner boundary is sampled. */
export async function auditSourcePartition(project,{worker,illustrationRegions,maxSeamSamples=20000,maxForegroundSamples=20000,bevelMm=.01}={}){
 const pieces=project.patternLibrary.map(s=>s.piece),geometry=[];
 for(let i=0;i<pieces.length;i+=30){const proc=spawnSync(worker,[],{windowsHide:true,input:JSON.stringify({protocolVersion:1,pieces:pieces.slice(i,i+30)}),maxBuffer:32*1024*1024,timeout:10000});if(proc.status!==0)throw Error('Native source audit failed: '+proc.stderr);const r=JSON.parse(proc.stdout);if(!r.ok)throw Error(JSON.stringify(r));geometry.push(...r.geometry);}
 const errors=geometry.flatMap(g=>g.issues.filter(i=>i.severity==='error'));if(errors.length)throw Error('Invalid saved source geometry: '+JSON.stringify(errors));
 const byId=new Map(geometry.map(g=>[g.id,g])),references=[];
 for(const ref of project.references){
  const png=Buffer.from(ref.png.split(',')[1],'base64'),rgba=await sharp(png).ensureAlpha().raw().toBuffer(),detected=illustrationRegions(ref.width,ref.height,new Uint8Array(rgba)),library=project.patternLibrary.filter(s=>s.referenceId===ref.id);
  if(library.length!==detected.regions.length)throw Error('Raster/source owner count changed: '+ref.view);
  const width=ref.width,height=ref.height,owners=new Int32Array(width*height).fill(-1),cal=ref.calibration,dx=cal.b.x-cal.a.x,dy=cal.b.y-cal.a.y,pixelMm=cal.distanceMm/Math.hypot(dx,dy),toPixel=p=>[cal.a.x+(-dy*p.xMm+dx*p.yMm)/cal.distanceMm,cal.a.y+(dx*p.xMm+dy*p.yMm)/cal.distanceMm];
  detected.regions.forEach((r,i)=>r.indices.forEach(p=>owners[p]=i));
  const vectors=library.map(s=>{const g=byId.get(s.piece.id),rings=[g.seam??s.piece.nodes,...g.seamHoles??s.piece.holes??[]].map(r=>r.map(toPixel)),points=rings.flat();return {id:s.piece.id,name:s.piece.name,color:s.piece.color,rings,bounds:[Math.min(...points.map(p=>p[0])),Math.min(...points.map(p=>p[1])),Math.max(...points.map(p=>p[0])),Math.max(...points.map(p=>p[1]))]};});
  const covering=(x,y)=>vectors.filter(v=>x>=v.bounds[0]&&x<=v.bounds[2]&&y>=v.bounds[1]&&y<=v.bounds[3]&&v.rings.reduce((odd,r)=>odd!==inside(x,y,r),false));
  const nearest=(x,y)=>{let best=Infinity,id;for(const v of vectors){const b=v.bounds,lower=Math.hypot(Math.max(b[0]-x,0,x-b[2]),Math.max(b[1]-y,0,y-b[3]));if(lower>best)continue;for(const r of v.rings){const d=distance(x,y,r);if(d<best){best=d;id=v.id;}}}return {distancePx:best,distanceMm:best*pixelMm,sourcePieceId:id};};
  // Distance from genuine raster background. An owner change is never treated
  // as background, so a fitted material seam cannot use the exterior budget.
  const farFromExterior=(x,y)=>{for(let yy=Math.floor(y-1.05);yy<=Math.floor(y+1.05);yy++)for(let xx=Math.floor(x-1.05);xx<=Math.floor(x+1.05);xx++){const nx=Math.max(xx,Math.min(xx+1,x)),ny=Math.max(yy,Math.min(yy+1,y));if(Math.hypot(nx-x,ny-y)>1.05)continue;if(xx<0||yy<0||xx>=width||yy>=height||owners[yy*width+xx]<0)return false;}return true;};
  // Flood genuine background from the image border. Remaining background is a
  // raster hole, checked independently of the saved vector's hole count.
  const exterior=new Uint8Array(width*height),queue=new Int32Array(width*height);let head=0,tail=0;
  const enqueue=i=>{if(owners[i]<0&&!exterior[i]){exterior[i]=1;queue[tail++]=i;}};for(let x=0;x<width;x++){enqueue(x);enqueue((height-1)*width+x);}for(let y=0;y<height;y++){enqueue(y*width);enqueue(y*width+width-1);}
  while(head<tail){const i=queue[head++],x=i%width,y=Math.floor(i/width);for(let yy=Math.max(0,y-1);yy<=Math.min(height-1,y+1);yy++)for(let xx=Math.max(0,x-1);xx<=Math.min(width-1,x+1);xx++)enqueue(yy*width+xx);}
  const holes=[];for(let i=0;i<owners.length;i++)if(owners[i]<0&&!exterior[i])holes.push([i%width+.5,Math.floor(i/width)+.5]);
  const rasterHoles={pixels:holes.length,sampled:0,interior:0,painted:0,samples:[]},holeStride=Math.max(1,Math.ceil(holes.length/maxForegroundSamples));
  for(let i=0;i<holes.length;i+=holeStride){const [x,y]=holes[i];rasterHoles.sampled++;let boundary=false;for(let yy=Math.floor(y-1.05);yy<=Math.floor(y+1.05);yy++)for(let xx=Math.floor(x-1.05);xx<=Math.floor(x+1.05);xx++){if(xx<0||yy<0||xx>=width||yy>=height||owners[yy*width+xx]<0)continue;const nx=Math.max(xx,Math.min(xx+1,x)),ny=Math.max(yy,Math.min(yy+1,y));if(Math.hypot(nx-x,ny-y)<=1.05)boundary=true;}if(boundary)continue;rasterHoles.interior++;const hits=covering(x,y);if(hits.length){rasterHoles.painted++;if(rasterHoles.samples.length<40)rasterHoles.samples.push({pixel:{x,y},sourcePieceIds:hits.map(v=>v.id)});}}
  const seam=[],foreground=[];for(let y=0;y<height;y++)for(let x=0;x<width;x++){const i=y*width+x;if(owners[i]<0)continue;foreground.push([x+.5,y+.5]);if(x+1<width&&owners[i+1]>=0&&owners[i]!==owners[i+1])seam.push([x+1,y+.5,owners[i],owners[i+1]]);if(y+1<height&&owners[i+width]>=0&&owners[i]!==owners[i+width])seam.push([x+.5,y+1,owners[i],owners[i+width]]);}
  // Color recovery is checked away from the original owner boundary, where a
  // legitimate bounded curve fit cannot move another material over this pixel.
  const colors={sampled:0,interior:0,wrong:0,samples:[]},colorStride=Math.max(1,Math.ceil(foreground.length/maxForegroundSamples));
  for(let i=0;i<foreground.length;i+=colorStride){const [x,y]=foreground[i],owner=owners[Math.floor(y)*width+Math.floor(x)];colors.sampled++;let boundary=false;for(let yy=Math.floor(y-1.05);yy<=Math.floor(y+1.05);yy++)for(let xx=Math.floor(x-1.05);xx<=Math.floor(x+1.05);xx++){if(xx>=0&&yy>=0&&xx<width&&yy<height&&owners[yy*width+xx]===owner)continue;const nx=Math.max(xx,Math.min(xx+1,x)),ny=Math.max(yy,Math.min(yy+1,y));if(Math.hypot(nx-x,ny-y)<=1.05)boundary=true;}if(boundary)continue;colors.interior++;const hits=covering(x,y),expected=detected.regions[owner].color;if(hits.length&&!hits.some(v=>v.color===expected)){colors.wrong++;if(colors.samples.length<40)colors.samples.push({pixel:{x,y},expected,actual:hits.map(v=>({id:v.id,color:v.color}))});}}
  const audit=(points,limit)=>{const stride=Math.max(1,Math.ceil(points.length/limit)),stats={available:points.length,sampled:0,interior:0,uncovered:0,unsupported:0,maxGapMm:0,gapWidthSumMm:0,overlapping:0,unsupportedOverlap:0,maxOverlapDepthMm:0,overlapDepthSumMm:0},samples=[],overlapSamples=[];
   for(let i=0;i<points.length;i+=stride){const [x,y,a,b]=points[i];stats.sampled++;if(!farFromExterior(x,y))continue;stats.interior++;const hits=covering(x,y),ownerIds=[a,b].filter(n=>n!==undefined).map(n=>library[n].piece.id);
    if(hits.length>1){const depths=hits.map(v=>({id:v.id,depthMm:Math.min(...v.rings.map(r=>distance(x,y,r)))*pixelMm})).filter(v=>v.depthMm>1e-5);if(depths.length>1){const depthMm=Math.min(...depths.map(v=>v.depthMm));stats.overlapping++;stats.maxOverlapDepthMm=Math.max(stats.maxOverlapDepthMm,depthMm);if(depthMm>bevelMm+1e-5){stats.unsupportedOverlap++;stats.overlapDepthSumMm+=2*depthMm*stride;if(overlapSamples.length<40)overlapSamples.push({pixel:{x,y},depthMm,covering:depths,ownerIds});}}}
    if(hits.length)continue;const near=nearest(x,y);if(near.distanceMm<=1e-5)continue;stats.uncovered++;stats.maxGapMm=Math.max(stats.maxGapMm,near.distanceMm);if(near.distanceMm<=bevelMm+1e-5)continue;stats.unsupported++;stats.gapWidthSumMm+=2*near.distanceMm*stride;if(samples.length<40)samples.push({pixel:{x,y},...near,ownerIds});}
   return {...stats,samples,overlapSamples};};
  const seams=audit(seam,maxSeamSamples),foregroundAudit=audit(foreground,maxForegroundSamples);references.push({view:ref.view,width,height,pngSha256:sha256(png),sources:library.length,pixelMm,foregroundPixels:foreground.length,rawSourceHoles:library.reduce((s,r)=>s+(r.piece.holes?.length??0),0),seams,foreground:foregroundAudit,rasterHoles,colors});
 }
 return {passed:references.every(r=>r.seams.unsupported===0&&r.foreground.unsupported===0&&r.seams.unsupportedOverlap===0&&r.foreground.unsupportedOverlap===0&&r.rasterHoles.painted===0&&r.colors.wrong===0),sources:pieces.length,sourceGeometrySha256:sha256(JSON.stringify(pieces)),exteriorAllowancePx:1.05,interiorBevelAllowanceMm:bevelMm,references};
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const project=JSON.parse(await readFile(process.argv[2],'utf8')),directory=await mkdtemp(resolve('.local/tests/source-partition-audit-')),helpers=await auditRuntime(directory),report=await auditSourcePartition(project,{worker:resolve('target/release/fpcad-worker.exe'),illustrationRegions:helpers.illustrationRegions});await writeFile(process.argv[3]??'test-results/real-source-partition-audit.json',JSON.stringify(report,null,2));console.log(JSON.stringify({...report,references:report.references.map(r=>({...r,seams:{...r.seams,samples:r.seams.samples.slice(0,2),overlapSamples:r.seams.overlapSamples.slice(0,2)},foreground:{...r.foreground,samples:r.foreground.samples.slice(0,2),overlapSamples:r.foreground.overlapSamples.slice(0,2)}}))},null,2));if(!report.passed)process.exitCode=1;
}
