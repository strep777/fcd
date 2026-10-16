import assert from 'node:assert/strict';
import sharp from 'sharp';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';

// Fixed interior landmarks in the checked-in original PNG. These specify
// distinct visible materials, anatomical sides and source-vector coverage;
// the number of unrelated incidental color components is not their oracle.
const anchors=[
 ['front',280,560,'paw','right','dark'],['front',270,555,'paw','right','pink'],
 ['front',332,603,'leg','right','navy'],['front',521,603,'leg','left','navy'],
 ['back',75,560,'paw','left','dark'],['back',440,560,'paw','right','dark'],
 ['back',178,925,'foot','left','blue'],['back',320,925,'foot','right','blue'],
 ['back',167,604,'leg','left','navy'],['back',362,606,'leg','right','navy'],
 ['back',260,350,'body','center','blue'],
];
const matches=(kind,[r,g,b])=>kind==='dark'?Math.max(r,g,b)<80:kind==='pink'?r-b>60:kind==='navy'?r<35&&b-r>50&&b<130:b-r>80;
function inside(p,ring){let hit=false;for(let i=0,j=ring.length-1;i<ring.length;j=i++){const a=ring[i],b=ring[j];if((a.y>p.y)!==(b.y>p.y)&&p.x<(b.x-a.x)*(p.y-a.y)/(b.y-a.y)+a.x)hit=!hit;}return hit;}
function sample(piece,ring,pixel){return ring.flatMap((a,i)=>{
 const b=ring[(i+1)%ring.length],c=piece.curves?.find(c=>c.startNodeId===a.id&&c.endNodeId===b.id),p=pixel(a),q=pixel(b),u=c?pixel(c.c1):p,v=c?pixel(c.c2):q;
 const count=Math.max(1,Math.ceil((Math.hypot(u.x-p.x,u.y-p.y)+Math.hypot(v.x-u.x,v.y-u.y)+Math.hypot(q.x-v.x,q.y-v.y))/.25));
 return Array.from({length:count},(_,j)=>{const t=j/count,s=1-t;return{x:s**3*p.x+3*s*s*t*u.x+3*s*t*t*v.x+t**3*q.x,y:s**3*p.y+3*s*s*t*u.y+3*s*t*t*v.y+t**3*q.y};});
});}
export async function assertBlueWhiteSourceAnchors(project){
 const records=[];
 for(const ref of project.references){
  const rgba=await sharp(Buffer.from(ref.png.split(',')[1],'base64')).ensureAlpha().raw().toBuffer(),c=ref.calibration,dx=c.b.x-c.a.x,dy=c.b.y-c.a.y;
  const pixel=p=>({x:c.a.x+(-dy*p.xMm+dx*p.yMm)/c.distanceMm,y:c.a.y+(dx*p.xMm+dy*p.yMm)/c.distanceMm});
  const sources=project.patternLibrary.filter(s=>s.referenceId===ref.id).map(source=>({source,rings:[source.piece.nodes,...source.piece.holes??[]].map(r=>sample(source.piece,r,pixel))}));
  for(const[view,x,y,part,side,kind]of anchors.filter(a=>a[0]===ref.view)){
   const rgb=Array.from(rgba.subarray((y*ref.width+x)*4,(y*ref.width+x)*4+3));assert(matches(kind,rgb),`Original ${view} ${kind} landmark ${x},${y} must retain its visible pigment`);
   const p={x:x+.5,y:y+.5},owners=sources.filter(s=>inside(p,s.rings[0])&&!s.rings.slice(1).some(r=>inside(p,r)));
   assert.equal(owners.length,1,`Saved vectors must cover original ${view} material ${x},${y} exactly once`);
   const source=owners[0].source,color=[1,3,5].map(i=>parseInt(source.piece.color.slice(i,i+2),16));
   assert(matches(kind,color),`Saved ${view} material must preserve the original ${kind} pigment`);assert.equal(source.anatomy?.part,part);assert.equal(source.anatomy?.side,side);
   records.push({view,x,y,kind,part,side,originalRgb:rgb,sourcePieceId:source.piece.id,color:source.piece.color});
  }
 }
 assert.equal(records.length,anchors.length);assert.equal(new Set(records.map(r=>r.sourcePieceId)).size,anchors.length,'All eleven independently visible material instances stay separate');return records;
}
export function assertOriginalPigmentCore(reference,rgba,raw,source,feature){
 const{left,top,right,bottom}=feature.coreBounds,c=reference.calibration,dx=c.b.x-c.a.x,dy=c.b.y-c.a.y;
 const pixel=p=>({x:c.a.x+(-dy*p.xMm+dx*p.yMm)/c.distanceMm,y:c.a.y+(dx*p.xMm+dy*p.yMm)/c.distanceMm}),piece=source.piece,rings=[piece.nodes,...piece.holes??[]].map(r=>sample(piece,r,pixel)),owners=new Set(raw.indices),points=[];
 const isCore=(x,y)=>{if(x<0||y<0||x>=reference.width||y>=reference.height)return false;const i=(y*reference.width+x)*4;return matches('navy',[rgba[i],rgba[i+1],rgba[i+2]]);};
 for(let y=top+2;y<=bottom-2;y++)for(let x=left+2;x<=right-2;x++){
  let certain=true;for(let oy=-2;oy<=2&&certain;oy++)for(let ox=-2;ox<=2;ox++)if(!isCore(x+ox,y+oy)){certain=false;break;}
  if(!certain)continue;const p={x:x+.5,y:y+.5};points.push(p);assert(owners.has(y*reference.width+x),'Every original flat-pigment core pixel must retain its actual material owner');assert(inside(p,rings[0])&&!rings.slice(1).some(r=>inside(p,r)),'Saved source vectors must cover every independently measured pigment-core point');
 }
 assert(points.length>=feature.minimumCorePixels,'The original image must supply a substantial unambiguous flat-pigment core');return{bounds:feature.coreBounds,originalRgbPredicate:'r<35, b-r>50, b<130',requiredUniformNeighborhood:5,measuredCorePixels:points.length,minimumCorePixels:feature.minimumCorePixels,savedCoreCoverage:1};
}
export async function assertReviewedBlueWhitePartition(project,illustrationRegions){
 const expected=JSON.parse(await readFile(new URL('./fixtures/blue-white-material-partition-baseline.json',import.meta.url),'utf8')),sha=v=>createHash('sha256').update(v).digest('hex'),records=[];
 assert.equal(sha(await readFile(new URL('./fixtures/'+expected.source,import.meta.url))),expected.sourceSha256,'Use the reviewed original PNG, identified independently of its classified masks');
 assert.equal(project.patternLibrary.length,132,'Retain all 132 source components reviewed against original pixels and Git HEAD');
 for(const baseline of expected.references){
  const ref=project.references.find(r=>r.view===baseline.view);assert(ref);assert.equal(ref.width,baseline.width);assert.equal(ref.height,baseline.height);
  const rgba=await sharp(Buffer.from(ref.png.split(',')[1],'base64')).ensureAlpha().raw().toBuffer();assert.equal(sha(rgba),baseline.rgbaSha256,'Compare the original reviewed pixels before checking their material partition');
  const detected=illustrationRegions(ref.width,ref.height,new Uint8Array(rgba)),components=detected.regions.map(r=>({color:r.color,pixels:r.indices.length,maskSha256:sha(JSON.stringify([...r.indices].sort((a,b)=>a-b)))})).sort((a,b)=>a.maskSha256.localeCompare(b.maskSha256));
  const expectedComponents=baseline.components.map(({color,pixels,maskSha256})=>({color,pixels,maskSha256}));
  assert.deepEqual(components,expectedComponents,'Every reviewed component retains its complete color and pixel ownership; one loss cannot be hidden by another gain');
  assert.equal(project.patternLibrary.filter(s=>s.referenceId===ref.id).length,components.length);
  records.push({view:ref.view,components:components.length,rgbaSha256:baseline.rgbaSha256,partitionSha256:sha(JSON.stringify(components))});
 }
 return records;
}
