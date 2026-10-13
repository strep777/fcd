import assert from 'node:assert/strict';

/** Wait for this fresh candidate or its failure, rather than hiding a failed
 * design job behind a ten-minute locator timeout. */
export async function waitForCutCandidate(page){
 await page.waitForFunction(()=>!!document.querySelector('.run-report > strong')||!!document.querySelector('.error-banner'),undefined,{timeout:600000});
 const errors=await page.locator('.error-banner').allTextContents();assert.deepEqual(errors,[],'Cut candidate failed: '+errors.join(' '));
}

/** Independently measure the actual saved trim on original physical faces.
 * Piece count and whole-face ID coverage alone cannot establish conservation. */
export function assertDesignCutContract(project){
 const surface=project.surface,run=project.surfaceRun;assert(surface&&run);assert.equal(run.options.partitionStrategy,'design');assert(run.pieces.length>0&&run.pieces.length<=500);
 assert.equal(run.bindings.length,run.pieces.length);const vertices=new Map(surface.vertices.map(v=>[v.id,[v.xMm,v.yMm,v.zMm]])),faces=new Map(surface.faces.map(f=>[f.id,f])),pieces=new Set(run.pieces.map(p=>p.id)),covered=new Set();
 const triangleArea=([a,b,c])=>{const u=b.map((v,i)=>v-a[i]),w=c.map((v,i)=>v-a[i]);return Math.hypot(u[1]*w[2]-u[2]*w[1],u[2]*w[0]-u[0]*w[2],u[0]*w[1]-u[1]*w[0])/2;};
 const modelArea=surface.faces.reduce((sum,f)=>sum+triangleArea(f.vertices.map(id=>vertices.get(id))),0);let boundArea=0;
 for(const binding of run.bindings){assert(pieces.has(binding.pieceId));assert(binding.trim?.triangles.length>0,'Design pieces require actual trim triangles');for(const key of ['areaErrorMax','edgeErrorMax','distortionMax']){const value=binding.report[key],limit=key==='edgeErrorMax'?.10:.15;assert(Number.isFinite(value)&&value>=0&&value<=limit,`${key}=${value} exceeds ${limit}`);}
  for(const t of binding.trim.triangles){const face=faces.get(t.faceId);assert(face,'Trim refers to an original physical face');covered.add(t.faceId);const source=face.vertices.map(id=>vertices.get(id));const points=t.barycentric.map(weights=>{assert(weights.every(w=>Number.isFinite(w)&&w>=-1e-8&&w<=1+1e-8));assert(Math.abs(weights.reduce((a,b)=>a+b,0)-1)<1e-8);return [0,1,2].map(axis=>weights.reduce((sum,w,i)=>sum+w*source[i][axis],0));});boundArea+=triangleArea(points);}
 }
 assert.equal(covered.size,surface.faces.length);assert(modelArea>0&&Math.abs(boundArea-modelArea)/modelArea<=1e-8,'Actual trim must conserve physical model area');return {modelArea,boundArea,coverage:boundArea/modelArea};
}

export function markingPathArea(marking){return marking.paths.reduce((sum,path)=>sum+path.rings.reduce((total,ring)=>{const o=ring[0];return total+ring.reduce((a,p,i)=>{const q=ring[(i+1)%ring.length];return a+(p.xMm-o.xMm)*(q.yMm-o.yMm)-(q.xMm-o.xMm)*(p.yMm-o.yMm);},0)/2;},0),0);}
