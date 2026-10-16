// Read-only audit of saved default split output against the original JPEG.
// This independently measures chromatic transitions; it does not classify,
// alter, fit or smooth any application contour.
import {readFile,writeFile} from 'node:fs/promises';
import sharp from 'sharp';
const output='test-results/current-task';
const result=JSON.parse(await readFile(`${output}/default-real-edge-output.json`,'utf8'));
const {data,info}=await sharp('tests/fixtures/character-front-back.jpg').ensureAlpha().raw().toBuffer({resolveWithObject:true});
const reference=result.references.find(r=>r.view==='front'),c=reference.calibration;
const pixel=p=>{const dx=c.b.x-c.a.x,dy=c.b.y-c.a.y;return {x:609+c.a.x+(-dy*p.xMm+dx*p.yMm)/c.distanceMm,y:c.a.y+(dx*p.xMm+dy*p.yMm)/c.distanceMm};};
function signal(x,y){
 const ix=Math.floor(x-.5),iy=Math.floor(y-.5),fx=x-.5-ix,fy=y-.5-iy;
 let r=0,g=0,b=0;
 for(const [dx,dy,weight]of [[0,0,(1-fx)*(1-fy)],[1,0,fx*(1-fy)],[0,1,(1-fx)*fy],[1,1,fx*fy]]){
  const index=(Math.max(0,Math.min(info.height-1,iy+dy))*info.width+Math.max(0,Math.min(info.width-1,ix+dx)))*4;
  r+=data[index]*weight;g+=data[index+1]*weight;b+=data[index+2]*weight;
 }
 return (r+g-2*b)/(r+g+b+1);
}
const rois=[
 {name:'left-leg',left:728,right:795,top:469,bottom:591},
 {name:'right-leg',left:847,right:999,top:468,bottom:593},
 {name:'tail',left:995,right:1240,top:385,bottom:625}
];
const matches=(p,roi)=>p.x>=roi.left&&p.x<=roi.right&&p.y>=roi.top&&p.y<=roi.bottom;
function samples(piece){return piece.nodes.flatMap((a,i)=>{
 const b=piece.nodes[(i+1)%piece.nodes.length],curve=piece.curves?.find(v=>v.startNodeId===a.id&&v.endNodeId===b.id),pa=pixel(a),pb=pixel(b),h1=curve?pixel(curve.c1):pa,h2=curve?pixel(curve.c2):pb;
 const reach=curve?Math.hypot(h1.x-pa.x,h1.y-pa.y)+Math.hypot(h2.x-h1.x,h2.y-h1.y)+Math.hypot(pb.x-h2.x,pb.y-h2.y):Math.hypot(pb.x-pa.x,pb.y-pa.y),count=Math.max(1,Math.ceil(reach/1.5));
 return Array.from({length:count},(_,j)=>{
  const t=(j+.5)/count,s=1-t;
  const p=curve?{x:s**3*pa.x+3*s*s*t*h1.x+3*s*t*t*h2.x+t**3*pb.x,y:s**3*pa.y+3*s*s*t*h1.y+3*s*t*t*h2.y+t**3*pb.y}:{x:pa.x+t*(pb.x-pa.x),y:pa.y+t*(pb.y-pa.y)};
  const d=curve?{x:3*(s*s*(h1.x-pa.x)+2*s*t*(h2.x-h1.x)+t*t*(pb.x-h2.x)),y:3*(s*s*(h1.y-pa.y)+2*s*t*(h2.y-h1.y)+t*t*(pb.y-h2.y))}:{x:pb.x-pa.x,y:pb.y-pa.y};
  const length=Math.hypot(d.x,d.y);return {...p,nx:-d.y/length,ny:d.x/length};
 });});}
const observations=[];
for(const [index,region]of result.regions.filter(r=>r.view==='front').entries()){
 const [r,g,b]=[1,3,5].map(i=>parseInt(region.piece.color.slice(i,i+2),16));
 if(!(r>130&&g>100&&b<Math.min(r,g)*.8))continue;
 for(const p of samples(region.piece))for(const roi of rois){
  if(!matches(p,roi)||!Number.isFinite(p.nx))continue;
  const q=t=>signal(p.x+t*p.nx,p.y+t*p.ny);
  const ends=[q(-5),q(5)];if(Math.max(...ends)<.25||Math.min(...ends)>.15||Math.abs(ends[0]-ends[1])<.2)continue;
  const profile=Array.from({length:41},(_,i)=>{const offset=(i-20)*.25;return {offset,strength:Math.abs(q(offset+.5)-q(offset-.5))};});
  const strongest=Math.max(...profile.map(v=>v.strength));if(strongest<.1)continue;
  // Keep the closest substantial peak, so an unrelated internal shadow cannot
  // win solely because its RGB gradient is steeper than the painted boundary.
  const peaks=profile.filter((v,i)=>v.strength>=strongest*.75&&v.strength>=(profile[i-1]?.strength??0)&&v.strength>=(profile[i+1]?.strength??0));
  const edge=peaks.sort((a,b)=>Math.abs(a.offset)-Math.abs(b.offset))[0];if(!edge)continue;
  observations.push({roi:roi.name,region:index,name:region.piece.name,x:p.x,y:p.y,profileOffsetPixels:edge.offset,imageTransition:{x:p.x+edge.offset*p.nx,y:p.y+edge.offset*p.ny},gradientStrength:edge.strength,signalAtSavedContour:q(0),signalAtImageTransition:q(edge.offset),signalOnOppositeSides:ends});
 }
}
const summaries=rois.map(roi=>{
 const points=observations.filter(p=>p.roi===roi.name),offsets=points.map(p=>Math.abs(p.profileOffsetPixels)).sort((a,b)=>a-b);
 return {roi:roi.name,highContrastSamples:points.length,medianOffsetPixels:offsets[Math.floor(offsets.length*.5)],p95OffsetPixels:offsets[Math.floor(offsets.length*.95)],maxOffsetPixels:offsets.at(-1),over2Pixels:points.filter(p=>Math.abs(p.profileOffsetPixels)>2).length};
});
const report={source:'tests/fixtures/character-front-back.jpg',method:'Independent bilinear JPEG chromatic profile normal to saved contour. Signal=(R+G-2B)/(R+G+B+1); opposing-side contrast >=0.2; closest gradient peak >=75% of local strongest. This is image evidence, not a certified geometry bound.',summaries,suspectSamples:observations.filter(p=>Math.abs(p.profileOffsetPixels)>2).sort((a,b)=>Math.abs(b.profileOffsetPixels)-Math.abs(a.profileOffsetPixels)),observations};
await writeFile(`${output}/image-boundary-profile.json`,JSON.stringify(report,null,2));
console.log(JSON.stringify({summaries,suspectSamples:report.suspectSamples.slice(0,12)},null,2));
