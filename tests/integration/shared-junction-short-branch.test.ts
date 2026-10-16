import{randomUUID}from'node:crypto';import{expect,it}from'vitest';
import{illustrationRegions}from'../../packages/reference/illustration';
import{imageBoundaryFit,type BoundaryFit}from'../../packages/reference/image-contour';
import{recoverSharedContours}from'../../packages/reference/shared-contour';
import{contourPolyline}from'../../packages/reference/recover-contour';
import{traceMask}from'../../apps/desktop/main/reference-segmentation';
import{cases,source,type XY}from'../fixtures/junction-overlap-source';
function contains(p:XY,ring:XY[]){let hit=false;for(let i=0,j=ring.length-1;i<ring.length;j=i++){const a=ring[i],b=ring[j];if((a.y>p.y)!==(b.y>p.y)&&p.x<(b.x-a.x)*(p.y-a.y)/(b.y-a.y)+a.x)hit=!hit;}return hit;}
const distance=(a:XY,b:XY)=>Math.hypot(a.x-b.x,a.y-b.y);
it.each(cases)('$name preserves actual material cores through the final full shared network',spec=>{
 const f=source(spec),bytes=f.rgba.slice();expect(f.cores.length,'independently rendered opaque cores must exist').toBeGreaterThan(4);
 for(const c of f.cores){expect(f.owner(f.local(c.p))).toBe(c.owner);const i=4*(Math.floor(c.p.y)*f.width+Math.floor(c.p.x));expect(Array.from(f.rgba.slice(i,i+4))).toEqual(c.rgba);}
 const classified=illustrationRegions(f.width,f.height,f.rgba,false,'head'),sourceOwners=f.seeds.map(p=>classified.regions.findIndex(r=>r.indices.includes(Math.floor(p.y)*f.width+Math.floor(p.x))));
 expect(sourceOwners.every(i=>i>=0)).toBe(true);expect(new Set(sourceOwners).size,'all four physical materials remain independently selected').toBe(4);
 const raw=classified.regions.map(r=>{const mask=new Uint8Array(f.width*f.height);for(const i of r.indices)mask[i]=1;return traceMask(f.width,f.height,mask,f.calibration,f.width,f.height,r.color,true).piece;}),before=structuredClone(raw),fit=imageBoundaryFit(f.width,f.height,f.rgba,p=>{const q=f.toPixel(p);return{xMm:q.x,yMm:q.y};},f.fromPixel),prepare=fit.prepare!,observed:{raw:XY[];output:XY[]|undefined}[]=[];
 // Observation only: preserve the actual prepare receiver and both arguments;
 // the real classification/image fit/shared recovery supplies all geometry.
 fit.prepare=function(this:BoundaryFit,branches,contours){const out=prepare.call(this,branches,contours);branches.forEach((b,i)=>{if(!b.closed)observed.push({raw:b.raw.map(f.toPixel),output:out?.[i]?.map(f.toPixel)});});return out;};
 const result=recoverSharedContours(raw,.8*spec.scale,randomUUID,fit),rings=result.pieces.map(p=>[contourPolyline(p.nodes,p.curves??[],true,Math.min(.001,spec.scale*.005),randomUUID).map(f.toPixel),...(p.holes??[]).map(h=>h.map(f.toPixel))]),owners=(p:XY)=>rings.flatMap((r,i)=>contains(p,r[0])&&!r.slice(1).some(h=>contains(p,h))?[i]:[]);
 const coreOwners=f.cores.map(c=>({source:c.owner,p:c.p,owners:owners(c.p)}));for(const c of coreOwners)expect(c.owners,JSON.stringify({spec,c})).toEqual([sourceOwners[c.source]]);
 let gaps=0,overlaps=0,wrongInterior=0;for(let y=3.317;y<f.height-3;y+=3.7)for(let x=3.731;x<f.width-3;x+=3.7){const p={x,y},v=owners(p);gaps+=+(v.length===0);overlaps+=+(v.length>1);if(f.boundaryDistance(p)>1.5&&v.length===1)wrongInterior+=+(v[0]!==sourceOwners[f.owner(f.local(p))]);}
 expect({gaps,overlaps,wrongInterior}).toEqual({gaps:0,overlaps:0,wrongInterior:0});
 const short=observed.filter(b=>b.raw.length>=2&&Math.min(distance(b.raw[0],f.tips[0])+distance(b.raw.at(-1)!,f.tips[1]),distance(b.raw[0],f.tips[1])+distance(b.raw.at(-1)!,f.tips[0]))<6),connected=result.pieces.map(p=>p.nodes.flatMap((a,i)=>{const b=p.nodes[(i+1)%p.nodes.length],x=f.toPixel(a),y=f.toPixel(b);return Math.min(distance(x,f.tips[0])+distance(y,f.tips[1]),distance(x,f.tips[1])+distance(y,f.tips[0]))<=3&&!p.curves?.some(c=>c.startNodeId===a.id&&c.endNodeId===b.id)?[{x,y}]:[];}));
 if(!spec.spur){expect(short.length,'the actual short two-junction arm must be observed; otherwise this is not the overlap case').toBeGreaterThan(0);expect(short.some(b=>b.output?.length===2&&distance(b.raw[0],b.output[0])>1e-7&&distance(b.raw.at(-1)!,b.output[1])>1e-7),'the real prepare output must move both original ends and exercise the two-tip chord branch').toBe(true);for(const id of sourceOwners.slice(0,2))expect(connected[id].length,'both final saved owners must share a direct two-tip line').toBeGreaterThan(0);}
 for(const tip of f.tips)expect(Math.min(...result.pieces.flatMap(p=>p.nodes.map(n=>distance(f.toPixel(n),tip))))).toBeLessThanOrEqual(1.5);
 for(const p of result.pieces){expect(p.holes?.length??0).toBe(0);for(const q of rings[result.pieces.indexOf(p)][0]){expect(q.x).toBeGreaterThanOrEqual(-1e-7);expect(q.x).toBeLessThanOrEqual(f.width+1e-7);expect(q.y).toBeGreaterThanOrEqual(-1e-7);expect(q.y).toBeLessThanOrEqual(f.height+1e-7);}}
 expect(raw).toEqual(before);expect(f.rgba).toEqual(bytes);
});
