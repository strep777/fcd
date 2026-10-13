import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
// Exact union in a face's barycentric chart counts material area, not the number
// of faces touched by a tiny fragment. Winding keeps source holes empty.
export function mappingCoverage(project,worker){
 const vertices=new Map(project.surface.vertices.map(v=>[v.id,v])),rows=[];
 for(const view of ['front','back']){
  const fragments=new Map();for(const marking of project.markings.filter(m=>m.view===view))for(const fragment of marking.fragments){const key=fragment.faceId+'|'+marking.color;const entry=fragments.get(key)??{faceId:fragment.faceId,color:marking.color,rings:[]};entry.rings.push(...fragment.rings.map(r=>r.map(w=>[w[1],w[2]])));fragments.set(key,entry);}
  const jobs=[...fragments.values()],unions=[];for(let i=0;i<jobs.length;i+=300){const batch=jobs.slice(i,i+300);const r=spawnSync(worker,[],{windowsHide:true,input:JSON.stringify({protocolVersion:1,operation:'geometry.clip',jobs:batch.map(j=>({subjects:j.rings,union:true,precisionDigits:12}))}),maxBuffer:32*1024*1024});assert.equal(r.status,0,r.stderr.toString());const response=JSON.parse(r.stdout.toString());assert(response.ok,JSON.stringify(response));unions.push(...response.results.map(r=>r.rings));}
  const groups=new Map();for(const face of project.surface.faces){const [a,b,c]=face.vertices.map(id=>vertices.get(id)),area=(view==='front'?1:-1)*((b.xMm-a.xMm)*(c.yMm-a.yMm)-(c.xMm-a.xMm)*(b.yMm-a.yMm))/2;if(area<=1e-7)continue;const row=groups.get(face.region)??{view,region:face.region,visibleProjectedAreaMm2:0,colors:{}};row.visibleProjectedAreaMm2+=area;groups.set(face.region,row);}
  for(const [i,job]of jobs.entries()){const row=groups.get(project.surface.faces.find(f=>f.id===job.faceId).region);if(!row)continue;const face=project.surface.faces.find(f=>f.id===job.faceId),[a,b,c]=face.vertices.map(id=>vertices.get(id)),twiceArea=Math.abs((b.xMm-a.xMm)*(c.yMm-a.yMm)-(c.xMm-a.xMm)*(b.yMm-a.yMm)),unitArea=Math.abs(unions[i].reduce((sum,r)=>sum+r.reduce((n,a,j)=>{const b=r[(j+1)%r.length];return n+a[0]*b[1]-b[0]*a[1];},0)/2,0));row.colors[job.color]=(row.colors[job.color]??0)+twiceArea*unitArea;}
  rows.push(...groups.values());
 }
 return rows;
}
export function collarCoverage(project,worker){
 const ids=project.patternLibrary.filter(s=>{if(!['#282b30','#272a30'].includes(s.piece.color))return false;const xs=s.piece.nodes.map(n=>n.xMm),ys=s.piece.nodes.map(n=>n.yMm);return Math.min(...ys)>1000&&Math.max(...ys)<1420&&Math.max(...xs)-Math.min(...xs)>200&&Math.max(...ys)-Math.min(...ys)>140;}).map(s=>s.piece.id);
 assert.equal(ids.length,2,'The actual front and back black collars must both be present as intact source components');
 return mappingCoverage({...project,markings:project.markings.filter(m=>ids.includes(m.sourcePieceId))},worker);
}
export function assertBlueWhiteCoverage(rows,collars){
 const ratio=(view,region,color)=>{const row=rows.find(r=>r.view===view&&r.region===region);assert(row,'Missing target '+region);return (row.colors[color]??0)/row.visibleProjectedAreaMm2;};
 for(const view of ['front','back'])for(const side of ['left','right']){assert(ratio(view,'arm-'+side,'#fefaf8')>.25,`${view} ${side} white arm must cover real area`);assert(ratio(view,'leg-'+side,'#fefaf8')>.25,`${view} ${side} white leg must cover real area`);assert(ratio(view,'ear-'+side,view==='front'?'#282b30':'#272a30')>.1,`${view} ${side} black outer ear must cover real area`);assert(ratio(view,'arm-'+side,view==='front'?'#7aaded':'#79aded')>.015,`${view} ${side} blue shoulder must cover real area`);assert(ratio(view,'leg-'+side,view==='front'?'#7aaded':'#79aded')>.025,`${view} ${side} blue outer leg must cover real area`);}
 assert(collars,'Audit the distinct collar sources; black torso side strips cannot stand in for a missing collar');for(const view of ['front','back']){const row=collars.find(r=>r.view===view&&r.region==='torso');assert(row&&(row.colors[view==='front'?'#282b30':'#272a30']??0)/row.visibleProjectedAreaMm2>.02,`${view} actual black collar must cover torso area`);}
}
import sharp from 'sharp';
export async function assertActualPigmentFeatures(project,worker,helpers,features){
 const checks=[];
 for(const feature of features){
  const reference=project.references.find(r=>r.view===feature.view),rgba=new Uint8Array(await sharp(Buffer.from(reference.png.split(',')[1],'base64')).ensureAlpha().raw().toBuffer()),detected=helpers.illustrationRegions(reference.width,reference.height,rgba),pixel=feature.y*reference.width+feature.x,index=detected.regions.findIndex(r=>r.indices.includes(pixel));
  assert(index>=0,`Actual pigment missing at ${feature.view} pixel ${feature.x},${feature.y}`);const raw=detected.regions[index],source=project.patternLibrary.filter(s=>s.referenceId===reference.id)[index];assert.equal(raw.color,feature.color);assert.equal(source.piece.color,feature.color);assert.equal(raw.indices.length,feature.pixels);
  const markings=project.markings.filter(m=>m.sourcePieceId===source.piece.id&&m.placement?.part===feature.part&&m.placement.side===feature.side);assert(markings.length,`${source.piece.name} must have its supported ${feature.part} placement`);
  const rows=mappingCoverage({...project,markings},worker),area=rows.filter(r=>r.view===feature.view).reduce((n,r)=>n+(r.colors[feature.color]??0),0),c=reference.calibration,pixelMm=c.distanceMm/Math.hypot(c.b.x-c.a.x,c.b.y-c.a.y),scaledSourceArea=raw.indices.length*pixelMm**2*markings[0].placement.scaleX*markings[0].placement.scaleY;
  assert(area>scaledSourceArea*.3,`${source.piece.name} must retain a substantial projected feature, not a tiny touched-face sliver`);checks.push({...feature,sourcePieceId:source.piece.id,projectedAreaMm2:area,scaledSourceAreaMm2:scaledSourceArea,visibleAreaFraction:area/scaledSourceArea});
 }
 return checks;
}
// Area centroids measure the actual clipped attachment, rather than the source
// bounding box or a touched-face count. Stations run from shoulder (0) to wrist
// (1) along the model arm's outward axis.
export function armPigmentStations(project,view,side){
 const vertices=new Map(project.surface.vertices.map(v=>[v.id,v])),faces=new Map(project.surface.faces.map(f=>[f.id,f])),arms=project.markings.filter(m=>m.view===view&&m.placement?.part==='arm'&&m.placement.side===side),marks=project.markings.filter(m=>m.view===view&&['arm','paw'].includes(m.placement?.part)&&m.placement.side===side);
 assert(arms.length,`Missing ${view}/${side} arm attachments`);const sign=view==='front'?1:-1,regions=arms[0].placement.regions,arm=project.surface.faces.filter(f=>regions.includes(f.region)).flatMap(f=>f.vertices.map(id=>vertices.get(id))),body=project.surface.faces.filter(f=>f.region==='torso').flatMap(f=>f.vertices.map(id=>vertices.get(id)));
 assert(body.length,'The real species torso supplies the proximal arm anchor');const center=points=>({x:(Math.min(...points.map(v=>sign*v.xMm))+Math.max(...points.map(v=>sign*v.xMm)))/2,y:(Math.min(...points.map(v=>v.yMm))+Math.max(...points.map(v=>v.yMm)))/2}),a=center(arm),b=center(body),length=Math.hypot(a.x-b.x,a.y-b.y),axis={x:(a.x-b.x)/length,y:(a.y-b.y)/length},positions=arm.map(v=>axis.x*sign*v.xMm+axis.y*v.yMm),min=Math.min(...positions),span=Math.max(...positions)-min,rows=[];
 assert(length>1e-6&&span>1e-6,'The real arm must supply a nondegenerate shoulder-to-wrist axis');
 for(const m of marks){let area=0,mx=0,my=0;const regionAreas={};for(const fragment of m.fragments){const face=faces.get(fragment.faceId);assert(face,'Attachment must reference a real surface face');let fragmentArea=0;for(const ring of fragment.rings){const nodes=ring.map(w=>({x:sign*w.reduce((n,v,i)=>n+v*vertices.get(face.vertices[i]).xMm,0),y:w.reduce((n,v,i)=>n+v*vertices.get(face.vertices[i]).yMm,0)}));for(let i=0;i<nodes.length;i++){const p=nodes[i],q=nodes[(i+1)%nodes.length],cross=p.x*q.y-q.x*p.y;area+=cross/2;fragmentArea+=cross/2;mx+=(p.x+q.x)*cross/6;my+=(p.y+q.y)*cross/6;}}regionAreas[face.region]=(regionAreas[face.region]??0)+Math.abs(fragmentArea);}assert(Math.abs(area)>1e-6,'Attachment must have measurable pigment area');rows.push({sourcePieceId:m.sourcePieceId,color:m.color,part:m.placement.part,side:m.placement.side,modelSide:m.placement.modelSide,regions:m.placement.regions,regionAreas,areaMm2:Math.abs(area),station:(axis.x*mx/area+axis.y*my/area-min)/span});}
 return {view,side,modelSide:arms[0].placement.modelSide,rows};
}
export function assertJpegCuffOrder(project){
 const checks=[armPigmentStations(project,'front','left'),armPigmentStations(project,'back','right')];
 for(const check of checks){
  const row=color=>check.rows.find(r=>r.part==='arm'&&r.color===color),back=check.view==='back',blue=row(back?'#02a6f4':'#04a3f0'),yellow=row(back?'#f7e13c':'#f9e33c'),sources=project.patternLibrary.filter(s=>s.view===check.view),reference=project.references.find(r=>r.view===check.view),modelSide=back?'left':'right';
  assert(blue&&yellow,'Keep the original raised-arm blue and yellow cuff attachments');assert.equal(check.modelSide,modelSide,'Keep the front/back species side transform');assert.equal(yellow.sourcePieceId,sources[back?26:24]?.piece.id,'Keep the actual yellow cuff source');
  assert(reference?.calibration,'The actual source calibration supplies the pigment area');const c=reference.calibration,pixelMm=c.distanceMm/Math.hypot(c.b.x-c.a.x,c.b.y-c.a.y),pawRegion=new RegExp(`^(?:palm(?:-pad)?|finger|hand-claw)-${modelSide}(?:-|$)`),palmRegion=new RegExp(`^palm-${modelSide}(?:-|$)`);
  const features=(back?[[2,'#dcd0d7',2722],[37,'#080608',255],[38,'#080608',142]]:[[7,'#ede7ea',2340],[47,'#08060a',251],[48,'#08060a',111]]).map(([index,color,pixels],i)=>{
   const source=sources[index];assert(source,'Keep each original hand and separate claw source');assert.equal(source.piece.color,color);assert.equal(source.anatomy?.part,'paw','The actual hand and claw sources must be classified as paws');assert.equal(source.anatomy.side,check.side,'Keep the source front/back side transform');
   const attachments=project.markings.filter(m=>m.sourcePieceId===source.piece.id);assert.equal(attachments.length,1,'Each original hand and separate claw must have its own paw attachment');const m=attachments[0];assert.equal(m.view,check.view);assert.equal(m.color,color);assert.equal(m.placement?.part,'paw','The actual hand and claw pigments must attach to a paw');assert.equal(m.placement.side,check.side);assert.equal(m.placement.modelSide,modelSide,'Attach to the correct species paw side');assert(m.placement.regions.length&&m.placement.regions.every(r=>pawRegion.test(r)),'Paw targets must be actual palm, finger or hand-claw regions on the correct side');
   const pigment=check.rows.find(r=>r.sourcePieceId===source.piece.id);assert(pigment,'The actual paw attachment must share the arm station audit');assert(Object.keys(pigment.regionAreas).every(r=>pawRegion.test(r)),'Actual hand and claw fragments must remain on real paw faces');const scaledSourceAreaMm2=pixels*pixelMm**2*m.placement.scaleX*m.placement.scaleY;
   assert(pigment.areaMm2>scaledSourceAreaMm2*.3,'Each actual hand and claw must retain a substantial projected feature, not a tiny touched-face sliver');if(i===0)assert(Object.entries(pigment.regionAreas).filter(([r])=>palmRegion.test(r)).reduce((n,[,area])=>n+area,0)>scaledSourceAreaMm2*.3,'The actual neutral hand must cover substantial palm area');return Object.assign(pigment,{sourcePixels:pixels,scaledSourceAreaMm2,visibleAreaFraction:pigment.areaMm2/scaledSourceAreaMm2});
  });
  const [hand,...claws]=features;assert(yellow.station>blue.station+.1,`${check.view} yellow cuff must be beyond its blue arm, not towards the shoulder`);assert(hand.station>yellow.station,`${check.view} hand must be beyond its cuff`);assert(claws.every(c=>c.station>yellow.station),`${check.view} black claws must remain at the hand end`);
 }
 return checks;
}
