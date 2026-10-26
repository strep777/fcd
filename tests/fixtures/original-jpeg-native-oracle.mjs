import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {gunzipSync} from 'node:zlib';

// Fixed expectations from the immutable original JPEG, independent of the
// production palette implementation. Generated IDs cannot affect geometry.
const colors={
 '#ede7ea':'#ede7ea','#dcd0d7':'#ede7ea',
 '#04a3f0':'#02a6f4','#02a6f4':'#02a6f4',
 '#f9e33c':'#f9e33c','#f7e13c':'#f9e33c',
 '#09080b':'#09080b','#080608':'#09080b',
 '#fab2b3':'#fab2b3','#cc8c93':'#cc8c93',
};
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
function shape(region){
 const p=region.piece,points=new Map([...p.nodes,...(p.holes??[]).flat()].map(n=>[n.id,[n.xMm,n.yMm]]));
 const ring=nodes=>{const rows=nodes.map(n=>[n.xMm,n.yMm]),start=rows.reduce((best,v,i)=>v[0]<rows[best][0]||v[0]===rows[best][0]&&v[1]<rows[best][1]?i:best,0);return [...rows.slice(start),...rows.slice(0,start)];};
 return {view:region.view,category:region.category,anatomy:region.anatomy,name:p.name,color:p.color,nodes:ring(p.nodes),holes:(p.holes??[]).map(ring).sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b))),curves:(p.curves??[]).map(c=>({start:points.get(c.startNodeId),end:points.get(c.endNodeId),c1:[c.c1.xMm,c.c1.yMm],c2:[c.c2.xMm,c.c2.yMm]})).sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b)))};
}
export async function assertFreshOriginalJpegSources(project,imagePath){
 const provenance=JSON.parse(await readFile(new URL('./original-jpeg-before-detail.provenance.json',import.meta.url),'utf8'));
 const bytes=gunzipSync(await readFile(new URL('./original-jpeg-before-detail.sources.json.gz',import.meta.url)));
 assert.equal(sha(bytes),provenance.captureSha256);assert.equal(sha(await readFile(imagePath)),provenance.jpegSha256);
 const old=JSON.parse(bytes.toString()),sort=rows=>rows.sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b)));
 const expected=sort(old.regions.map(r=>shape({...r,piece:{...r.piece,color:colors[r.piece.color]??r.piece.color}}))),actual=sort(project.patternLibrary.map(shape));
 assert.deepEqual(actual,expected,'Every original contour, Bezier, hole, dimension, view and anatomy survives fresh extraction; only the explicit paired material RGBs may change');
 assert.equal(project.patternLibrary.length,101);
 for(const view of ['front','back']){const before=old.references.find(r=>r.view===view),after=project.references.find(r=>r.view===view);for(const key of ['width','height','calibration','calibrationMode'])assert.deepEqual(after[key],before[key],'Original '+view+' '+key+' remains unchanged');}
 const front=project.references.find(r=>r.view==='front'),c=front.calibration,dx=c.b.x-c.a.x,dy=c.b.y-c.a.y;
 const eyes=project.patternLibrary.filter(r=>r.view==='front'&&r.piece.nodes.every(n=>{const x=609+c.a.x+(-dy*n.xMm+dx*n.yMm)/c.distanceMm,y=c.a.y+(dx*n.xMm+dy*n.yMm)/c.distanceMm;return x>=770&&x<=895&&y>=160&&y<=205;}));
 assert.equal(eyes.length,4);assert.deepEqual(project.patternLibrary.filter(r=>r.fabrication==='detail').map(r=>r.piece.id).sort(),eyes.map(r=>r.piece.id).sort());
 return {passed:true,sources:actual.length,geometryAndAnatomyUnchanged:true,calibrationsUnchanged:true,canonicalSourceSha256:sha(JSON.stringify(actual)),originalCaptureSha256:provenance.captureSha256,jpegSha256:provenance.jpegSha256,expectedColorMap:colors,eyeDetailSources:eyes.map(r=>({id:r.piece.id,name:r.piece.name}))};
}
