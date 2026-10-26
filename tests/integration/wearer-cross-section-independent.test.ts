import {expect,it} from 'vitest';
import {createHash} from 'node:crypto';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {generateSpecies,speciesDefaults} from '../../apps/desktop/main/species';
import {assembleSpecies} from '../../apps/desktop/main/species-assembly';
import type {Surface,SpeciesParams} from '../../packages/schema/index';

type XZ=[number,number];
type Segment={a:XZ;b:XZ};
const output=resolve(process.env.FPCAD_WEARER_SECTION_RESULTS??'test-results/wearer-independent-cross-sections');
const sha=(data:string|Uint8Array)=>createHash('sha256').update(data).digest('hex');
const segmentDistance=(p:XZ,a:XZ,b:XZ)=>{const dx=b[0]-a[0],dz=b[1]-a[1],length=dx*dx+dz*dz,t=length?Math.max(0,Math.min(1,((p[0]-a[0])*dx+(p[1]-a[1])*dz)/length)):0;return Math.hypot(p[0]-a[0]-t*dx,p[1]-a[1]-t*dz);};
const perimeter=(ring:XZ[])=>ring.reduce((s,p,i)=>{const q=ring[(i+1)%ring.length];return s+Math.hypot(p[0]-q[0],p[1]-q[1]);},0);
const area=(ring:XZ[])=>Math.abs(ring.reduce((s,p,i)=>{const q=ring[(i+1)%ring.length];return s+p[0]*q[1]-q[0]*p[1];},0)/2);
function contains(ring:XZ[],p:XZ){let inside=false;for(let i=0,j=ring.length-1;i<ring.length;j=i++){const a=ring[i],b=ring[j];if((a[1]>p[1])!==(b[1]>p[1])&&p[0]<(b[0]-a[0])*(p[1]-a[1])/(b[1]-a[1])+a[0])inside=!inside;}return inside;}

/** Independent horizontal triangle/plane intersections. No production slice,
 * recipe ring IDs, anatomy labels or assembly measurement enters this oracle.
 * Endpoint keys only connect duplicate arithmetic intersections; all measured
 * lengths use the original Float64 intersection coordinates. */
function horizontalSection(mesh:Surface,y:number){
 const vertices=new Map(mesh.vertices.map(v=>[v.id,v])),pointKey=(p:XZ)=>p.map(n=>Math.round(n*1e6)).join(','),segments=new Map<string,Segment>();
 for(const face of mesh.faces){
  const corners=face.vertices.map(id=>vertices.get(id)!),dist=corners.map(p=>p.yMm-y);if(dist.every(d=>Math.abs(d)<1e-9))continue;
  const points=new Map<string,XZ>();
  for(let i=0;i<3;i++){const j=(i+1)%3,a=corners[i],b=corners[j],u=dist[i],v=dist[j];
   if(Math.abs(u)<1e-9){const p:XZ=[a.xMm,a.zMm];points.set(pointKey(p),p);}
   if(u*v<0){const t=u/(u-v),p:XZ=[a.xMm+t*(b.xMm-a.xMm),a.zMm+t*(b.zMm-a.zMm)];points.set(pointKey(p),p);}
  }
  if(points.size!==2)continue;const [a,b]=[...points.values()],ids=[pointKey(a),pointKey(b)];if(ids[0]===ids[1])continue;segments.set(ids.sort().join('|'),{a,b});
 }
 const rows=[...segments.values()],points=new Map<string,XZ>(),links=new Map<string,string[]>();
 for(const {a,b}of rows){const x=pointKey(a),z=pointKey(b);points.set(x,a);points.set(z,b);links.set(x,[...links.get(x)??[],z]);links.set(z,[...links.get(z)??[],x]);}
 const degrees=[...links].filter(([,neighbors])=>neighbors.length!==2).map(([key,neighbors])=>({point:points.get(key)!,degree:neighbors.length}));
 const seen=new Set<string>(),rings:XZ[][]=[];
 if(!degrees.length)for(const start of links.keys())if(!seen.has(start)){let previous='',current=start;const ring:XZ[]=[];do{seen.add(current);ring.push(points.get(current)!);const next=links.get(current)!.find(id=>id!==previous)!;previous=current;current=next;}while(current!==start&&!seen.has(current));if(current===start&&ring.length>=3)rings.push(ring);}
 const symmetryMaxMm=rows.length?Math.max(...rows.flatMap(({a,b})=>[a,b]).map(p=>Math.min(...rows.map(s=>segmentDistance([-p[0],p[1]],s.a,s.b))))):0;
 const loops=rings.map(ring=>{const minX=Math.min(...ring.map(p=>p[0])),maxX=Math.max(...ring.map(p=>p[0])),minZ=Math.min(...ring.map(p=>p[1])),maxZ=Math.max(...ring.map(p=>p[1]));return{perimeterMm:perimeter(ring),areaMm2:area(ring),bounds:{minX,maxX,minZ,maxZ},centerX:(minX+maxX)/2,containsBodyAxis:contains(ring,[0,0]),points:ring};}).sort((a,b)=>a.centerX-b.centerX);
 return {yMm:y,segments:rows.length,nonCyclePoints:degrees,symmetryMaxMm,loops};
}
function topology(mesh:Surface){
 const edges=new Map<string,{a:string;b:string;count:number}>(),neighbors=new Map<string,Set<string>>();
 for(const face of mesh.faces)for(let i=0;i<3;i++){const a=face.vertices[i],b=face.vertices[(i+1)%3],key=[a,b].sort().join(':'),e=edges.get(key)??{a,b,count:0};e.count++;edges.set(key,e);neighbors.set(a,new Set([...neighbors.get(a)??[],b]));neighbors.set(b,new Set([...neighbors.get(b)??[],a]));}
 const points=new Map(mesh.vertices.map(v=>[v.id,v])),exposed=[...edges.values()].filter(e=>e.count===1),links=new Map<string,string[]>();
 for(const e of exposed){links.set(e.a,[...links.get(e.a)??[],e.b]);links.set(e.b,[...links.get(e.b)??[],e.a]);}
 const boundarySeen=new Set<string>(),loops=[];
 for(const start of links.keys())if(!boundarySeen.has(start)){const queue=[start],ring:string[]=[];while(queue.length){const next=queue.pop()!;if(boundarySeen.has(next))continue;boundarySeen.add(next);ring.push(next);queue.push(...links.get(next)!);}const pp=ring.map(id=>points.get(id)!);loops.push({vertices:ring.length,points:pp,bounds:bounds(pp)});}
 const connected=new Set<string>();let components=0;for(const start of neighbors.keys())if(!connected.has(start)){components++;const queue=[start];while(queue.length){const id=queue.pop()!;if(connected.has(id))continue;connected.add(id);queue.push(...neighbors.get(id)!);}}
 return{components,nonmanifoldEdges:[...edges.values()].filter(e=>e.count>2).length,boundaryEdges:exposed.length,boundaryDegreesValid:[...links.values()].every(n=>n.length===2),boundaryLoops:loops};
}
function bounds(vertices:Surface['vertices']){return{minX:Math.min(...vertices.map(v=>v.xMm)),maxX:Math.max(...vertices.map(v=>v.xMm)),minY:Math.min(...vertices.map(v=>v.yMm)),maxY:Math.max(...vertices.map(v=>v.yMm)),minZ:Math.min(...vertices.map(v=>v.zMm)),maxZ:Math.max(...vertices.map(v=>v.zMm))};}
const stations=[{name:'chest-body-control',yMm:1350.84,inputGirthMm:1000},{name:'waist-body-control',yMm:1108.08,inputGirthMm:850},{name:'hip-body-control',yMm:900,inputGirthMm:1000},{name:'upper-thigh-body-control',yMm:864,inputGirthMm:580},{name:'thigh-padding-peak',yMm:684},{name:'knee-control',yMm:387},{name:'calf-body-control',yMm:270,inputGirthMm:380},{name:'lower-calf-continuity',yMm:261},{name:'neck-body-control',yMm:1523,inputGirthMm:380}];
const lowerLegHeights=[89,90,91,100,120,140,160,180,200,220,240,260,270];

it('independent fixed-height slicing measures a twelve-sided cylinder against its analytic chord perimeter',()=>{
 const n=12,r=10,vertices=Array.from({length:2*n},(_,i)=>({id:String(i),xMm:r*Math.cos(i%n*2*Math.PI/n),yMm:i<n?0:20,zMm:r*Math.sin(i%n*2*Math.PI/n)})),faces:Surface['faces']=[];
 for(let i=0;i<n;i++){const j=(i+1)%n;for(const ids of [[i,j,n+i],[j,n+j,n+i]])faces.push({id:'f'+faces.length,region:'oracle',vertices:ids.map(String) as [string,string,string]});}
 const result=horizontalSection({id:'oracle',source:'obj',topologyVersion:1,vertices,faces},7.3);expect(result.nonCyclePoints).toEqual([]);expect(result.loops).toHaveLength(1);expect(result.loops[0].perimeterMm).toBeCloseTo(n*2*r*Math.sin(Math.PI/n),10);expect(result.symmetryMaxMm).toBeLessThan(1e-10);
});

it('saves real source and assembled wearer geometry and independently audits fixed-height shell sections and padding effects',async()=>{
 await mkdir(output,{recursive:true});
 const {assertBodyModelScope}=await import(pathToFileURL(resolve('tests/fixtures/character-functional-oracle.mjs')).href);
 const sourceFiles=['apps/desktop/main/species.ts','apps/desktop/main/wearer.ts','apps/desktop/main/species-loft.ts','apps/desktop/main/species-assembly.ts','apps/desktop/main/wearer-fairing.ts','packages/body/defaults.ts','packages/schema/index.ts'];
 const sourceHashes=await Promise.all(sourceFiles.map(async file=>({file,sha256:sha(await readFile(resolve(file)))}))),padded=speciesDefaults('canine','padded'),zero={...padded,hipPaddingMm:0,thighPaddingMm:0,calfPaddingMm:0};
 const allCases:[string,SpeciesParams][]=[['dtd-default',speciesDefaults('canine','dtd')],['padded-default',padded],['padded-zero',zero],['padded-hip-only',{...zero,hipPaddingMm:55}],['padded-thigh-only',{...zero,thighPaddingMm:115}],['padded-calf-only',{...zero,calfPaddingMm:30}]],selected=(process.env.FPCAD_WEARER_SECTION_CASES??'dtd-default,padded-default,padded-zero').split(','),cases=allCases.filter(([name])=>selected.includes(name));
 const report:{startedAt:string;runtime:unknown;sourceHashes:typeof sourceHashes;sourceHash:string;stationDefinition:unknown;cases:unknown[];comparisons?:unknown;sourceHashesAfter?:unknown;completedAt?:string}={startedAt:new Date().toISOString(),runtime:{node:process.version,platform:process.platform,architecture:process.arch,execPath:process.execPath},sourceHashes,sourceHash:sha(JSON.stringify(sourceHashes)),stationDefinition:{coordinateSystem:'millimetres; floor y=0; sagittal mirror x=0',stations,heightInputMm:1800,hipYmm:900,shoulderYmm:1478,collarYmm:1573,paddingSupports:{hip:{valueMm:55,lowYmm:830.64,peakYmm:900,highYmm:1142.76,physicalAction:'torso radial x and 0.6-scaled depth z'},thigh:{valueMm:115,lowYmm:360,peakYmm:684,highYmm:1098,physicalAction:'outer thigh x only; front/back z; inner x unchanged'},calf:{valueMm:30,lowYmm:90,peakYmm:261,highYmm:432,physicalAction:'leg x scaled 0.55 and depth z'}}},cases:[]};
 const models=new Map<string,{source:Surface;assembled:Surface;slices:ReturnType<typeof horizontalSection>[]} >();
 Object.assign(report.stationDefinition as object,{bottomYmm:90,spanMm:1483,lowerLegHeights,calfPaddingSupport:{valueMm:30,constantBelowYmm:270,decaysToZeroYmm:432,physicalAction:'constant lower-leg radial x=16.5 and z=30 mm additions, smoothly decaying toward the knee; no ankle pinch'}});
 delete (report.stationDefinition as {paddingSupports:{calf?:unknown}}).paddingSupports.calf;
 await writeFile(resolve(output,'report.json'),JSON.stringify(report,null,2));
 for(const [name,parameters]of cases){
  const started=Date.now(),source=generateSpecies(parameters),sourceText=JSON.stringify(source);await writeFile(resolve(output,name+'-recipe.json'),sourceText);
  let assembled:Surface;try{assembled=await assembleSpecies(source);}catch(error){report.cases.push({name,parameters,recipe:{file:name+'-recipe.json',sha256:sha(sourceText)},assemblyFailure:{message:String(error),stack:error instanceof Error?error.stack:undefined}});await writeFile(resolve(output,'report.json'),JSON.stringify(report,null,2));throw error;}
  const assembledText=JSON.stringify(assembled),physicalTopology=topology(assembled),physicalBounds=bounds(assembled.vertices),slices=stations.map(station=>horizontalSection(assembled,station.yMm)),lowerLegSections=parameters.bodyMode==='padded'?lowerLegHeights.map(y=>horizontalSection(assembled,y)):[];
  const geometryDigest=(mesh:Surface)=>sha(JSON.stringify({positions:mesh.vertices.map(({xMm,yMm,zMm})=>[xMm,yMm,zMm]),triangles:mesh.faces.map(f=>({vertices:f.vertices.map(id=>mesh.vertices.findIndex(v=>v.id===id)),region:f.region}))}));
  await writeFile(resolve(output,name+'-recipe.json'),sourceText);await writeFile(resolve(output,name+'-assembled.json'),assembledText);
  const obj=assembled.vertices.map(p=>'v '+[p.xMm,p.yMm,p.zMm].join(' '));const indices=new Map(assembled.vertices.map((v,i)=>[v.id,i+1]));let previous='';for(const face of assembled.faces){if(face.region!==previous){obj.push('g '+face.region);previous=face.region;}obj.push('f '+face.vertices.map(id=>indices.get(id)!).join(' '));}await writeFile(resolve(output,name+'-assembled.obj'),obj.join('\n')+'\n');
  models.set(name,{source,assembled,slices});
  const positions=new Map(assembled.vertices.map(v=>[v.id,v])),regionRows=new Map<string,{faces:number;areaMm2:number;minX:number;maxX:number}>();
  for(const face of assembled.faces){const p=face.vertices.map(id=>positions.get(id)!),[a,b,c]=p,u=[b.xMm-a.xMm,b.yMm-a.yMm,b.zMm-a.zMm],v=[c.xMm-a.xMm,c.yMm-a.yMm,c.zMm-a.zMm],row=regionRows.get(face.region)??{faces:0,areaMm2:0,minX:Infinity,maxX:-Infinity};row.faces++;row.areaMm2+=Math.hypot(u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0])/2;row.minX=Math.min(row.minX,...p.map(v=>v.xMm));row.maxX=Math.max(row.maxX,...p.map(v=>v.xMm));regionRows.set(face.region,row);}
  report.cases.push({name,parameters,durationMs:Date.now()-started,recipe:{file:name+'-recipe.json',sha256:sha(sourceText),geometrySha256:geometryDigest(source),vertices:source.vertices.length,faces:source.faces.length,bounds:bounds(source.vertices)},assembled:{file:name+'-assembled.json',obj:name+'-assembled.obj',sha256:sha(assembledText),geometrySha256:geometryDigest(assembled),vertices:assembled.vertices.length,faces:assembled.faces.length,bounds:physicalBounds,physicalTopology,regions:[...new Set(assembled.faces.map(f=>f.region))].sort(),regionPhysicalMetrics:Object.fromEntries(regionRows),headHandFaceCount:assembled.faces.filter(f=>/^(head|hand-)/.test(f.region)).length},sections:slices.map((slice,i)=>({...stations[i],...slice}))});
  await writeFile(resolve(output,'report.json'),JSON.stringify(report,null,2));
  await writeFile(resolve(output,name+'-lower-leg-sections.json'),JSON.stringify({scope:'Independent fixed physical heights; original nine stations remain unchanged. Below the new ankle hem there must be no mesh; above it, two separate continuous leg tubes.',sections:lowerLegSections},null,2));
  const bodyScope=assertBodyModelScope(assembled,parameters.bodyMode);await writeFile(resolve(output,name+'-body-scope.json'),JSON.stringify(bodyScope,null,2));
  expect(physicalTopology.components,name).toBe(1);expect(physicalTopology.nonmanifoldEdges,name).toBe(0);expect(physicalTopology.boundaryDegreesValid,name).toBe(true);expect(physicalTopology.boundaryLoops,name).toHaveLength(parameters.bodyMode==='padded'?5:0);
  expect(physicalBounds.minY,name).toBeCloseTo(parameters.bodyMode==='padded'?90:0,3);expect(physicalBounds.maxY,name).toBeCloseTo(parameters.bodyMode==='padded'?1573:1800,3);expect(physicalBounds.maxY-physicalBounds.minY,name+' independent physical span').toBeCloseTo(parameters.bodyMode==='padded'?1483:1800,3);
  for(const slice of slices){expect(slice.nonCyclePoints,name+' at y='+slice.yMm).toEqual([]);expect(slice.loops.length,name+' at y='+slice.yMm).toBeGreaterThan(0);expect(slice.symmetryMaxMm,name+' actual mirrored section at y='+slice.yMm).toBeLessThanOrEqual(1e-5);}
  for(const part of ['arm','leg',...(parameters.bodyMode==='dtd'?['hand','foot']:[])]){
   const left=regionRows.get(part+'-left')!,right=regionRows.get(part+'-right')!;expect(left,name+' '+part+' left provenance').toBeDefined();expect(right,name+' '+part+' right provenance').toBeDefined();expect(left.maxX,name+' '+part+'-left stays in x<=0').toBeLessThanOrEqual(1e-5);expect(right.minX,name+' '+part+'-right stays in x>=0').toBeGreaterThanOrEqual(-1e-5);expect(Math.abs(left.areaMm2-right.areaMm2),name+' '+part+' mirrored physical area').toBeLessThanOrEqual(Math.max(1e-7,(left.areaMm2+right.areaMm2)*1e-12));
  }
  if(parameters.bodyMode==='padded'){
   expect(assembled.faces.filter(f=>/^(head|hand|foot)(-|$)/.test(f.region)),name).toEqual([]);expect(source.faces.filter(f=>/^(head|hand|foot)(-|$)/.test(f.region)),name+' recipe scope').toEqual([]);
   const openings=physicalTopology.boundaryLoops.map(loop=>{
    if(loop.points.every(p=>Math.abs(p.yMm-1573)<.001))return'collar';
    if(loop.points.every(p=>Math.abs(p.yMm-90)<.001))return loop.points.every(p=>p.xMm<0)?'left ankle':loop.points.every(p=>p.xMm>0)?'right ankle':'unexpected';
    for(const side of [-1,1]){const cx=side*(240+600*Math.sqrt(.75)),cy=1178;if(loop.points.every(p=>Math.abs(side*Math.sqrt(.75)*(p.xMm-cx)-.5*(p.yMm-cy))<.001))return side<0?'left cuff':'right cuff';}return'unexpected';
   });expect(openings.sort(),name+' independently located collar, cuffs and ankles').toEqual(['collar','left ankle','left cuff','right ankle','right cuff']);
   for(const slice of lowerLegSections){expect(slice.nonCyclePoints,name+' lower leg y='+slice.yMm).toEqual([]);expect(slice.symmetryMaxMm,name+' mirrored lower legs y='+slice.yMm).toBeLessThanOrEqual(1e-5);expect(slice.loops,name+' lower leg y='+slice.yMm).toHaveLength(slice.yMm<90?0:2);if(slice.yMm>=90){expect(slice.loops[0].bounds.maxX).toBeLessThan(0);expect(slice.loops[1].bounds.minX).toBeGreaterThan(0);}}
   const tube=lowerLegSections.filter(s=>s.yMm>=100);for(let i=1;i<tube.length;i++)for(let side=0;side<2;side++){
    const previous=tube[i-1].loops[side],current=tube[i].loops[side],label=name+' continuous lower-leg tube y='+tube[i].yMm;
    expect(current.perimeterMm+1e-5,label+' has no local calf lobe above a narrowed ankle').toBeGreaterThanOrEqual(previous.perimeterMm);
    expect(current.bounds.maxX-current.bounds.minX+1e-5,label+' width').toBeGreaterThanOrEqual(previous.bounds.maxX-previous.bounds.minX);
    expect(current.bounds.maxZ-current.bounds.minZ+1e-5,label+' depth').toBeGreaterThanOrEqual(previous.bounds.maxZ-previous.bounds.minZ);
   }
  }
 }
 const zeroModel=models.get('padded-zero')!,deltas=[];
 for(const name of ['padded-default','padded-hip-only','padded-thigh-only','padded-calf-only'].filter(name=>models.has(name))){
  const model=models.get(name)!;
  const recipeDisplacement=model.source.vertices.map((p,i)=>{const q=zeroModel.source.vertices[i];return{x:p.xMm-q.xMm,y:p.yMm-q.yMm,z:p.zMm-q.zMm,atYmm:q.yMm,region:zeroModel.source.faces.find(f=>f.vertices.includes(q.id))?.region};}),moved=recipeDisplacement.filter(d=>Math.hypot(d.x,d.y,d.z)>1e-9);
  deltas.push({case:name,relativeTo:'padded-zero',recipe:{maxAbsDx:Math.max(...recipeDisplacement.map(d=>Math.abs(d.x))),maxAbsDy:Math.max(...recipeDisplacement.map(d=>Math.abs(d.y))),maxAbsDz:Math.max(...recipeDisplacement.map(d=>Math.abs(d.z))),changedVertexCount:moved.length,changedRegionNames:[...new Set(moved.map(d=>d.region))].sort(),actualChangedYRange:moved.length?[Math.min(...moved.map(d=>d.atYmm)),Math.max(...moved.map(d=>d.atYmm))]:[]},fixedSectionDeltas:model.slices.map((s,i)=>({station:stations[i].name,yMm:s.yMm,zeroPerimetersMm:zeroModel.slices[i].loops.map(l=>l.perimeterMm),casePerimetersMm:s.loops.map(l=>l.perimeterMm),zeroLoopCentersX:zeroModel.slices[i].loops.map(l=>l.centerX),caseLoopCentersX:s.loops.map(l=>l.centerX),symmetryMaxMm:s.symmetryMaxMm}))});
 }
 report.comparisons=deltas;report.sourceHashesAfter=await Promise.all(sourceFiles.map(async file=>({file,sha256:sha(await readFile(resolve(file)))})));report.completedAt=new Date().toISOString();await writeFile(resolve(output,'report.json'),JSON.stringify(report,null,2));
 expect(report.sourceHashesAfter,'Production source must remain the same throughout the captured diagnostic run').toEqual(sourceHashes);
},120000);

it('compares the retained recipe and assembled geometry directly without regenerating or trusting assembly measurements',async()=>{
 const capture=JSON.parse(await readFile(resolve(output,'report.json'),'utf8')) as {sourceHash:string;cases:{name:string;recipe:{file:string;sha256:string};assembled:{file:string;sha256:string}}[]};
 const rows=[];
 for(const entry of capture.cases.filter(entry=>entry.assembled)){
  const recipeText=await readFile(resolve(output,entry.recipe.file),'utf8'),assembledText=await readFile(resolve(output,entry.assembled.file),'utf8');expect(sha(recipeText)).toBe(entry.recipe.sha256);expect(sha(assembledText)).toBe(entry.assembled.sha256);
  const recipe=JSON.parse(recipeText) as Surface,assembled=JSON.parse(assembledText) as Surface;
  rows.push({case:entry.name,stations:stations.map(station=>{const raw=horizontalSection(recipe,station.yMm),final=horizontalSection(assembled,station.yMm);return{...station,recipeSymmetryMaxMm:raw.symmetryMaxMm,assembledSymmetryMaxMm:final.symmetryMaxMm,recipeLoops:raw.loops.map(l=>({centerX:l.centerX,perimeterMm:l.perimeterMm,containsBodyAxis:l.containsBodyAxis})),assembledLoops:final.loops.map(l=>({centerX:l.centerX,perimeterMm:l.perimeterMm,containsBodyAxis:l.containsBodyAxis})),recipeNonCyclePoints:raw.nonCyclePoints};})});
 }
 await writeFile(resolve(output,'recipe-versus-assembled-sections.json'),JSON.stringify({capturedProductionSourceHash:capture.sourceHash,createdAt:new Date().toISOString(),cases:rows},null,2));
});
