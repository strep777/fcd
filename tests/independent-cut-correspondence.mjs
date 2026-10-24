// Read-only geometry audit. Run only after the coordinated build/test freeze.
// node tests/independent-cut-correspondence.mjs INPUT.json CANDIDATE.json [--strict-seams]
// Optional limits: --seam-mm 1 --seam-relative .01 --mapping-samples 5 --name NAME
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {build} from 'esbuild';
import {segments as polylineSegments,prepareDistance,distanceBounds,uncoveredLength} from './fixtures/polyline-correspondence-oracle.mjs';

const args=process.argv.slice(2),inputPath=resolve(args.shift()??''),candidatePath=resolve(args.shift()??'');
if(!inputPath.endsWith('.json')||!candidatePath.endsWith('.json'))throw Error('Provide input.json and candidate.json paths');
const option=(name,fallback)=>{const i=args.indexOf(name);return i<0?fallback:args[i+1];};
const limits={geometryMm:1e-5,barycentric:1e-8,coverageRatio:1e-6,mappingMm:1e-4,uvOverlapAreaMm2:1e-7,seamMm:Number(option('--seam-mm',1)),seamRelative:Number(option('--seam-relative',.01)),mappingTrianglesPerPiece:Number(option('--mapping-samples',5))};
assert(Object.values(limits).every(n=>Number.isFinite(n)&&n>0));
assert(Number.isInteger(limits.mappingTrianglesPerPiece));
const name=option('--name','independent-cut-correspondence');assert(/^[a-z0-9-]+$/.test(name));
const output=resolve('test-results/current-repair'),strictSeams=args.includes('--strict-seams');
const [inputBytes,candidateBytes]=await Promise.all([readFile(inputPath),readFile(candidatePath)]);
const input=JSON.parse(inputBytes),candidate=JSON.parse(candidateBytes),project=input.project??input,surface=project.surface,run=candidate.run??candidate;
assert(surface?.faces?.length&&run?.bindings?.length&&run?.pieces?.length,'Missing surface, bindings or pieces');
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
const report={passed:false,strictSeams,inputPath,candidatePath,inputSha256:digest(inputBytes),candidateSha256:digest(candidateBytes),limits,scope:'Independent full-source-surface trim audit; no geometry solver, UI, repository or user library access. Sewing limits are explicitly supplied audit policy, not a material guarantee.',counts:{faces:surface.faces.length,pieces:run.pieces.length,bindings:run.bindings.length},issues:[]};
const issues=report.issues,issue=(kind,data)=>{issues.push({kind,...data});};
const sub=(a,b)=>a.map((v,i)=>v-b[i]),add=(a,b)=>a.map((v,i)=>v+b[i]),mul=(a,n)=>a.map(v=>v*n),dot=(a,b)=>a.reduce((s,v,i)=>s+v*b[i],0),norm=a=>Math.hypot(...a),distance=(a,b)=>norm(sub(a,b)),mix=(a,b,t)=>add(a,mul(sub(b,a),t));
const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]],cross2=(a,b)=>a[0]*b[1]-a[1]*b[0];
const area=points=>Math.abs(points.reduce((s,a,i)=>s+cross2(a,points[(i+1)%points.length]),0))/2;
const uv=p=>[p.xMm,p.yMm],xyz=p=>[p.xMm,p.yMm,p.zMm];
const vertices=new Map(surface.vertices.map(v=>[v.id,xyz(v)])),faces=new Map(surface.faces.map(f=>[f.id,f])),pieces=new Map(run.pieces.map(p=>[p.id,p]));
assert.equal(pieces.size,run.pieces.length,'Duplicate piece IDs');
const edgeFaces=new Map();
for(const face of surface.faces)for(let i=0;i<3;i++){const key=[face.vertices[i],face.vertices[(i+1)%3]].sort().join(':');const list=edgeFaces.get(key)??[];list.push(face.id);edgeFaces.set(key,list);}
const byFace=new Map(),byPiece=new Map(),supports=new Map(),sourceAreas=new Map();
for(const face of surface.faces){const p=face.vertices.map(id=>vertices.get(id));assert(p.every(Boolean),'Missing original vertex');const a=norm(cross(sub(p[1],p[0]),sub(p[2],p[0])))/2;assert(a>0,'Degenerate original face');sourceAreas.set(face.id,a);}
function barycentric(point,triangle){
 // UV is two-dimensional. The direct determinant avoids subtracting two
 // almost equal squared dot products for a long, micrometre-thin triangle.
 const v0=sub(triangle[1],triangle[0]),v1=sub(triangle[2],triangle[0]),v2=sub(point,triangle[0]),den=cross2(v0,v1);
 if(Math.abs(den)<=1e-28)return null;
 const b=cross2(v2,v1)/den,c=cross2(v0,v2)/den;return [1-b-c,b,c];
}
const weighted=(points,weights)=>points[0].map((_,axis)=>weights.reduce((s,w,i)=>s+w*points[i][axis],0));
function addEdge(row,i){
 const j=(i+1)%3,a=row.world[i],b=row.world[j],length=distance(a,b);if(!(length>0)||!Number.isFinite(length)){issue('degenerate-triangle-edge',{pieceId:row.pieceId,faceId:row.faceId});return;}
 // Only the same original face or the same topological source edge may match.
 // Coincident but disconnected surfaces must never become sewing partners.
 const zero=[0,1,2].find(k=>Math.abs(row.bary[i][k])<=limits.barycentric&&Math.abs(row.bary[j][k])<=limits.barycentric),face=faces.get(row.faceId);
 const support=zero===undefined?'face:'+row.faceId:'edge:'+face.vertices.filter((_,k)=>k!==zero).sort().join(':');
 const list=supports.get(support)??[];list.push({pieceId:row.pieceId,faceId:row.faceId,a,b,uvA:row.uv[i],uvB:row.uv[j]});supports.set(support,list);
}
for(const binding of run.bindings){
 assert(pieces.has(binding.pieceId),'Binding references missing piece');assert(!byPiece.has(binding.pieceId),'Duplicate piece binding');
 assert(binding.surfaceId===surface.id&&binding.topologyVersion===surface.topologyVersion,'Binding belongs to a different surface/topology');
 const trim=binding.trim;assert(trim?.triangles?.length,'This oracle requires exact trim provenance; legacy report-only bindings are unsupported');
 const positions=new Map(trim.vertices.map(v=>[v.id,uv(v)])),rows=[];
 for(const [index,t] of trim.triangles.entries()){
  const face=faces.get(t.faceId);assert(face,'Trim references missing original face');const source=face.vertices.map(id=>vertices.get(id)),points=t.vertices.map(id=>positions.get(id));assert(points.every(Boolean),'Trim references missing UV vertex');
  assert(t.barycentric.every(w=>w.length===3&&w.every(Number.isFinite))&&points.flat().every(Number.isFinite),'Nonfinite trim coordinates');
  if(t.barycentric.some(w=>Math.min(...w)<-limits.barycentric||Math.max(...w)>1+limits.barycentric||Math.abs(w.reduce((a,b)=>a+b,0)-1)>limits.barycentric))issue('barycentric-outside-source',{pieceId:binding.pieceId,faceId:t.faceId,index});
  const row={pieceId:binding.pieceId,faceId:t.faceId,index,uv:points,bary:t.barycentric,world:t.barycentric.map(w=>weighted(source,w))};
  row.coverageRatio=2*area(row.bary.map(w=>[w[1],w[2]]));
  if(row.coverageRatio<=1e-14||area(points)<=1e-16)issue('degenerate-triangle',{pieceId:row.pieceId,faceId:row.faceId,index});
  rows.push(row);const list=byFace.get(t.faceId)??[];list.push(row);byFace.set(t.faceId,list);for(let i=0;i<3;i++)addEdge(row,i);
 }
 byPiece.set(binding.pieceId,{binding,rows});
}
for(const piece of run.pieces)if(!byPiece.has(piece.id))issue('piece-without-binding',{pieceId:piece.id});

// Independent convex clipping detects overlaps that a summed-area check misses.
function intersectionArea(a,b){
 let polygon=a.map(p=>[...p]);const sign=cross2(sub(b[1],b[0]),sub(b[2],b[0]))<0?-1:1;
 for(let i=0;i<3&&polygon.length;i++){
  const origin=b[i],edge=sub(b[(i+1)%3],origin),side=p=>sign*cross2(edge,sub(p,origin)),next=[];
  for(let j=0;j<polygon.length;j++){const p=polygon[j],q=polygon[(j+1)%polygon.length],sp=side(p),sq=side(q),insideP=sp>=0,insideQ=sq>=0;if(insideP)next.push(p);if(insideP!==insideQ)next.push(mix(p,q,sp/(sp-sq)));}polygon=next;
 }
 return polygon.length>=3?area(polygon):0;
}
const coverage=[];let sourceAreaMm2=0,coveredAreaMm2=0,totalOverlapMm2=0,maxCoverageError=0,maxOverlapRatio=0;
for(const face of surface.faces){
 const rows=byFace.get(face.id)??[],sum=rows.reduce((s,r)=>s+r.coverageRatio,0);let overlap=0;
 for(let i=0;i<rows.length;i++)for(let j=i+1;j<rows.length;j++)overlap+=2*intersectionArea(rows[i].bary.map(w=>[w[1],w[2]]),rows[j].bary.map(w=>[w[1],w[2]]));
 const physical=sourceAreas.get(face.id),error=Math.abs(sum-1);sourceAreaMm2+=physical;coveredAreaMm2+=physical*sum;totalOverlapMm2+=physical*overlap;maxCoverageError=Math.max(maxCoverageError,error);maxOverlapRatio=Math.max(maxOverlapRatio,overlap);
 if(error>limits.coverageRatio||overlap>limits.coverageRatio)coverage.push({faceId:face.id,coverage:sum,overlapRatio:overlap,areaMm2:physical,trimTriangles:rows.length});
}
report.coverage={sourceAreaMm2,coveredAreaMm2,totalOverlapMm2,maxCoverageError,maxOverlapRatio,failedFaces:coverage.length};if(coverage.length)issue('source-face-coverage',{count:coverage.length});

// A piece may cover source faces exactly while folding distinct faces over each
// other in 2D. Check every UV triangle pair whose axis-aligned bounds overlap;
// public-map sampling alone would not prove injectivity.
const uvOverlaps=[];let uvOverlapPairs=0,totalUvOverlapMm2=0,maxUvOverlapMm2=0;
for(const [pieceId,{rows}] of byPiece){
 const sorted=rows.map(row=>({row,minX:Math.min(...row.uv.map(p=>p[0])),maxX:Math.max(...row.uv.map(p=>p[0])),minY:Math.min(...row.uv.map(p=>p[1])),maxY:Math.max(...row.uv.map(p=>p[1]))})).sort((a,b)=>a.minX-b.minX);let active=[];
 for(const next of sorted){active=active.filter(old=>old.maxX>next.minX);for(const old of active){if(old.maxY<=next.minY||next.maxY<=old.minY)continue;const overlap=intersectionArea(old.row.uv,next.row.uv);if(overlap<=limits.uvOverlapAreaMm2)continue;uvOverlapPairs++;totalUvOverlapMm2+=overlap;maxUvOverlapMm2=Math.max(maxUvOverlapMm2,overlap);if(uvOverlaps.length<1000)uvOverlaps.push({pieceId,firstTriangle:old.row.index,secondTriangle:next.row.index,areaMm2:overlap});}active.push(next);}
}
report.uvInjectivity={overlapPairs:uvOverlapPairs,totalOverlapMm2:totalUvOverlapMm2,maxOverlapMm2:maxUvOverlapMm2,detailsLimitedTo:1000};if(uvOverlapPairs)issue('uv-triangle-overlap',{count:uvOverlapPairs});

// Canonicalize supporting lines by geometric predicates, not rounded IDs.
// Each supporting line gets one sweep over every endpoint, resolving unequal
// subdivisions before cancelling internal edges or pairing exposed boundaries.
const shared=[],unmatched=[],nonmanifold=[],exposedByPiece=new Map();let internalLengthMm=0,exteriorLengthMm=0;
function expose(edge,lo,hi,group){
 const start=dot(sub(edge.a,group.base),group.axis),end=dot(sub(edge.b,group.base),group.axis),u=(lo-start)/(end-start),v=(hi-start)/(end-start);
 const row={pieceId:edge.pieceId,faceId:edge.faceId,uvA:mix(edge.uvA,edge.uvB,u),uvB:mix(edge.uvA,edge.uvB,v)};row.lengthMm=distance(row.uvA,row.uvB);return row;
}
for(const [support,edges] of supports){
 const groups=[];
 for(const edge of edges){let axis=mul(sub(edge.b,edge.a),1/distance(edge.a,edge.b));if((axis.find(v=>Math.abs(v)>1e-12)??1)<0)axis=mul(axis,-1);
  let group=groups.find(g=>norm(cross(g.axis,axis))<1e-7&&norm(cross(sub(edge.a,g.base),g.axis))<=limits.geometryMm&&norm(cross(sub(edge.b,g.base),g.axis))<=limits.geometryMm);
  if(!group){group={axis,base:edge.a,edges:[]};groups.push(group);}group.edges.push(edge);
 }
 for(const group of groups){
  const spans=group.edges.map(e=>{const a=dot(sub(e.a,group.base),group.axis),b=dot(sub(e.b,group.base),group.axis);return {edge:e,lo:Math.min(a,b),hi:Math.max(a,b)};}),raw=spans.flatMap(s=>[s.lo,s.hi]).sort((a,b)=>a-b),cuts=[];
  // Welding nearly identical stations must not erase a real short edge. Keep
  // the existing absolute welding ceiling, tightened only when necessary so
  // each measured source span retains at least 99.99% of its parameter range.
  const stationTolerance=Math.min(limits.geometryMm,Math.min(...spans.map(s=>s.hi-s.lo).filter(n=>n>0))*1e-4);
  for(const t of raw)if(!cuts.length||t-cuts.at(-1)>stationTolerance)cuts.push(t);
  for(let i=1;i<cuts.length;i++){
   const lo=cuts[i-1],hi=cuts[i],length=hi-lo;if(!(length>0))continue;const mid=(lo+hi)/2,active=spans.filter(s=>mid>s.lo-stationTolerance*.01&&mid<s.hi+stationTolerance*.01),sides=active.map(s=>expose(s.edge,lo,hi,group));if(!sides.length)continue;
   const worldA=add(group.base,mul(group.axis,lo)),worldB=add(group.base,mul(group.axis,hi));
   const continuityTolerance=Math.min(limits.geometryMm,length*1e-4);
   if(sides.length===2&&sides[0].pieceId===sides[1].pieceId&&distance(sides[0].uvA,sides[1].uvA)<=continuityTolerance&&distance(sides[0].uvB,sides[1].uvB)<=continuityTolerance){internalLengthMm+=length;continue;}
   for(const side of sides){const list=exposedByPiece.get(side.pieceId)??[];list.push(side);exposedByPiece.set(side.pieceId,list);}
   if(sides.length===2){sides.sort((a,b)=>a.pieceId.localeCompare(b.pieceId));const differenceMm=Math.abs(sides[0].lengthMm-sides[1].lengthMm),relative=differenceMm/Math.max(sides[0].lengthMm,sides[1].lengthMm,1e-12);shared.push({support,worldA,worldB,physicalLengthMm:length,sides,differenceMm,relative,selfSeam:sides[0].pieceId===sides[1].pieceId});}
   else if(sides.length===1&&support.startsWith('edge:')&&edgeFaces.get(support.slice(5))?.length===1)exteriorLengthMm+=length;
   else (sides.length===1?unmatched:nonmanifold).push({support,worldA,worldB,physicalLengthMm:length,sides});
  }
 }
}
if(unmatched.length)issue('unmatched-interior-boundary',{count:unmatched.length,lengthMm:unmatched.reduce((s,r)=>s+r.physicalLengthMm,0)});
if(nonmanifold.length)issue('nonmanifold-trim-boundary',{count:nonmanifold.length});

// Compare actual finite sewing boundaries by Hausdorff distance. A short trim
// edge can be slightly tilted by bounded simplification; extrapolating its line
// over a long piece edge falsely turns micrometres of deviation into missing
// millimetres of perimeter. Topological welding still uses geometryMm above.
const outlines=[],outlineChecks=[];
for(const [pieceId,data] of byPiece){
 const piece=pieces.get(pieceId);assert(!(piece.curves?.length),'Curved candidate outlines require an explicit curve-length oracle');
 const outline=[piece.nodes,...piece.holes??[]].flatMap(r=>polylineSegments(r.map(uv))),trim=data.binding.trim,points=new Map(trim.vertices.map(p=>[p.id,uv(p)])),triangleEdges=new Map();
 for(const t of trim.triangles)for(let i=0;i<3;i++){const a=t.vertices[i],b=t.vertices[(i+1)%3],key=[a,b].sort().join(':'),edge=triangleEdges.get(key);if(edge)edge.count++;else triangleEdges.set(key,{a:points.get(a),b:points.get(b),count:1});}
 const rawBoundary=[...triangleEdges.values()].filter(e=>e.count===1),declared=data.binding.report.boundaryToleranceMm,maxRadius=Math.max(limits.mappingMm,declared??0),fromTrim=prepareDistance(rawBoundary,outline,maxRadius),fromOutline=prepareDistance(outline,rawBoundary,maxRadius);
 const trimToOutline=distanceBounds(fromTrim,maxRadius),outlineToTrim=distanceBounds(fromOutline,maxRadius),roundingLengthMm=1e-10;
 const mappingPassed=uncoveredLength(fromTrim,limits.mappingMm)<=roundingLengthMm&&uncoveredLength(fromOutline,limits.mappingMm)<=roundingLengthMm;
 const declaredPassed=declared===undefined?null:uncoveredLength(fromTrim,declared)<=roundingLengthMm&&uncoveredLength(fromOutline,declared)<=roundingLengthMm;
 const row={pieceId,trimToOutline,outlineToTrim,mappingPassed,declaredBoundaryToleranceMm:declared??null,declaredPassed};outlineChecks.push(row);if(!mappingPassed)outlines.push(row);if(declaredPassed===false)issue('declared-boundary-tolerance-exceeded',{pieceId,declaredBoundaryToleranceMm:declared,trimToOutline,outlineToTrim});
}
report.outlineCorrespondence={checkedPieces:outlineChecks.length,failedPieces:outlines.length,declaredToleranceFailures:outlineChecks.filter(r=>r.declaredPassed===false).length,maxDistanceUpperMm:Math.max(...outlineChecks.flatMap(r=>[r.trimToOutline.upperMm??Infinity,r.outlineToTrim.upperMm??Infinity])),distanceLimitMm:limits.mappingMm,scope:'Bidirectional finite-polyline Hausdorff distance; also checks each declared boundaryToleranceMm. Exact capsule coverage uses a 1e-10 mm arithmetic length floor and reports 1e-9 mm distance brackets.'};if(outlines.length)issue('exported-outline-does-not-match-trim',{count:outlines.length});

const distribution=values=>{const a=values.sort((a,b)=>a-b),at=q=>a.length?a[Math.min(a.length-1,Math.ceil(q*a.length)-1)]:null;return {count:a.length,min:a[0]??null,median:at(.5),p95:at(.95),p99:at(.99),max:a.at(-1)??null};};
// Assemble connected shared chains per pair of pieces, with tolerant endpoint
// welding. Report local mismatches too: aggregate cancellation cannot hide them.
const pairGroups=new Map();for(const row of shared){const key=row.sides.map(s=>s.pieceId).join(':');const list=pairGroups.get(key)??[];list.push(row);pairGroups.set(key,list);}
const chains=[];
for(const [pair,rows] of pairGroups){
 const parent=rows.map((_,i)=>i),find=i=>parent[i]===i?i:parent[i]=find(parent[i]),unite=(a,b)=>{a=find(a);b=find(b);if(a!==b)parent[b]=a;},grid=new Map(),scale=limits.geometryMm;
 rows.forEach((row,i)=>{for(const p of [row.worldA,row.worldB]){const cell=p.map(v=>Math.floor(v/scale));for(let x=-1;x<=1;x++)for(let y=-1;y<=1;y++)for(let z=-1;z<=1;z++)for(const old of grid.get([cell[0]+x,cell[1]+y,cell[2]+z].join(','))??[])if(distance(p,old.point)<=scale)unite(i,old.index);const key=cell.join(','),list=grid.get(key)??[];list.push({point:p,index:i});grid.set(key,list);}});
 const components=new Map();rows.forEach((row,i)=>{const key=find(i),list=components.get(key)??[];list.push(row);components.set(key,list);});
 for(const component of components.values()){const aMm=component.reduce((s,r)=>s+r.sides[0].lengthMm,0),bMm=component.reduce((s,r)=>s+r.sides[1].lengthMm,0),differenceMm=Math.abs(aMm-bMm);chains.push({pair,pieceIds:component[0].sides.map(s=>s.pieceId),segments:component.length,aMm,bMm,differenceMm,relative:differenceMm/Math.max(aMm,bMm),sumAbsoluteLocalMismatchMm:component.reduce((s,r)=>s+r.differenceMm,0),maxLocalRelative:Math.max(...component.map(r=>r.relative)),physicalLengthMm:component.reduce((s,r)=>s+r.physicalLengthMm,0),selfSeam:component[0].selfSeam});}
}
const failedChains=chains.filter(r=>r.differenceMm>limits.seamMm||r.relative>limits.seamRelative),failedSegments=shared.filter(r=>r.relative>limits.seamRelative);
report.seams={sharedSegments:shared.length,chains:chains.length,internalLengthMm,exteriorLengthMm,unmatchedSegments:unmatched.length,nonmanifoldSegments:nonmanifold.length,chainMismatchMm:distribution(chains.map(r=>r.differenceMm)),chainMismatchRelative:distribution(chains.map(r=>r.relative)),localMismatchMm:distribution(shared.map(r=>r.differenceMm)),localMismatchRelative:distribution(shared.map(r=>r.relative)),failedChains:failedChains.length,failedLocalSegments:failedSegments.length,qualityPassed:failedChains.length===0&&failedSegments.length===0};

// The oracle above imports no production geometry. These additional checks
// exercise the public production maps against independently reconstructed world
// positions. Bundling happens in memory only when this audit is explicitly run.
const bundle=await build({entryPoints:[resolve('packages/surface/mapping.ts')],bundle:true,format:'esm',platform:'node',write:false});
const {mapToSurface,mapFromSurface}=await import('data:text/javascript;base64,'+Buffer.from(bundle.outputFiles[0].text).toString('base64'));
const mappingFailures=[];let mappingSamples=0,maxWorldErrorMm=0,maxUvErrorMm=0,maxAffineRoundtripMm=0;
for(const [pieceId,{binding,rows}] of byPiece){
 // Every triangle is checked for independent affine invertibility.
 for(const row of rows){const weights=[.2,.3,.5],point=weighted(row.uv,weights),solved=barycentric(point,row.uv);if(!solved){issue('noninvertible-uv-triangle',{pieceId,index:row.index});continue;}maxAffineRoundtripMm=Math.max(maxAffineRoundtripMm,distance(weighted(row.world,solved),weighted(row.world,weights)));}
 const indices=[...new Set(Array.from({length:Math.min(rows.length,limits.mappingTrianglesPerPiece)},(_,i)=>Math.round(i*(rows.length-1)/Math.max(1,Math.min(rows.length,limits.mappingTrianglesPerPiece)-1))))];
 for(const index of indices)for(const weights of [[1/3,1/3,1/3],[.6,.2,.2],[.2,.6,.2]]){
  const row=rows[index],expectedUv=weighted(row.uv,weights),expectedWorld=weighted(row.world,weights),sourceWeights=weighted(row.bary,weights),to=mapToSurface(surface,binding,{xMm:expectedUv[0],yMm:expectedUv[1]}),from=mapFromSurface(binding,row.faceId,sourceWeights,surface);mappingSamples++;
  const worldError=to?distance(xyz(to.position),expectedWorld):Infinity,uvError=from?distance(uv(from),expectedUv):Infinity;
  const again=from?mapToSurface(surface,binding,from):null,back=to?mapFromSurface(binding,to.faceId,to.barycentric,surface):null;
  const backWorldError=again?distance(xyz(again.position),expectedWorld):Infinity,backUvError=back?distance(uv(back),expectedUv):Infinity;
  maxWorldErrorMm=Math.max(maxWorldErrorMm,worldError,backWorldError);maxUvErrorMm=Math.max(maxUvErrorMm,uvError,backUvError);
  if(Math.max(worldError,uvError,backWorldError,backUvError)>limits.mappingMm)mappingFailures.push({pieceId,triangleIndex:index,faceId:row.faceId,worldErrorMm:worldError,uvErrorMm:uvError,backWorldErrorMm:backWorldError,backUvErrorMm:backUvError});
 }
}
report.mapping={samples:mappingSamples,trianglesPerPieceLimit:limits.mappingTrianglesPerPiece,allPiecesSampled:byPiece.size===run.pieces.length,maxWorldErrorMm,maxUvErrorMm,maxAffineRoundtripMm,failures:mappingFailures.length,scope:'Independent affine check on every triangle plus UV triangle-overlap audit; deterministic interior production-map samples spanning every piece.'};
if(mappingFailures.length||maxAffineRoundtripMm>limits.mappingMm)issue('mapping-roundtrip',{count:mappingFailures.length});
report.geometryPassed=issues.length===0;report.passed=report.geometryPassed&&(!strictSeams||report.seams.qualityPassed);
await mkdir(output,{recursive:true});
const details={coverageFailures:coverage,uvOverlaps,outlineChecks,outlineFailures:outlines,mappingFailures,chains:chains.sort((a,b)=>b.differenceMm-a.differenceMm),sharedSegments:shared,unmatched,nonmanifold};
await writeFile(resolve(output,name+'-details.json'),JSON.stringify(details,(_,v)=>typeof v==='number'&&!Number.isFinite(v)?String(v):v,2));
await writeFile(resolve(output,name+'.json'),JSON.stringify(report,(_,v)=>typeof v==='number'&&!Number.isFinite(v)?String(v):v,2));
console.log(JSON.stringify(report,null,2));if(!report.passed)process.exitCode=1;
