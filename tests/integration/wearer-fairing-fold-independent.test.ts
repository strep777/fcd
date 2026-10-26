import {afterEach,expect,it,vi} from 'vitest';
import {mkdirSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {generateSpecies,speciesDefaults} from '../../apps/desktop/main/species';
import {assembleSpecies} from '../../apps/desktop/main/species-assembly';
import * as fairing from '../../apps/desktop/main/wearer-fairing';
import {speciesParamsSchema,type SpeciesParams,type Surface} from '../../packages/schema/index';

type Point=[number,number,number];
type Shell={positions:Point[];triangles:[number,number,number][]};
type Capture=Shell&{properties:number[];numProp:number;runIndex:number[];runOriginalID:number[]};
const output=resolve('test-results/2026-10-27-sewing-lines/wearer-fairing-independent');
const subtract=(a:Point,b:Point):Point=>[a[0]-b[0],a[1]-b[1],a[2]-b[2]];
const dot=(a:Point,b:Point)=>a.reduce((sum,n,i)=>sum+n*b[i],0);
const normal=(shell:Shell,triangle:[number,number,number]):Point=>{const [a,b,c]=triangle.map(i=>shell.positions[i]),u=subtract(b,a),v=subtract(c,a);return[u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0]];};
const cosine=(a:Point,b:Point)=>dot(a,b)/(Math.hypot(...a)*Math.hypot(...b));
const angle=(a:Point,b:Point)=>Math.acos(Math.max(-1,Math.min(1,cosine(a,b))))*180/Math.PI;
function capture(mesh:Parameters<typeof fairing.fairWearerJoins>[0]):Capture{
 return {positions:Array.from({length:mesh.numVert},(_,i)=>[mesh.vertProperties[i*mesh.numProp],mesh.vertProperties[i*mesh.numProp+1],mesh.vertProperties[i*mesh.numProp+2]]),triangles:Array.from({length:mesh.numTri},(_,i)=>[mesh.triVerts[i*3],mesh.triVerts[i*3+1],mesh.triVerts[i*3+2]]),properties:[...mesh.vertProperties],numProp:mesh.numProp,runIndex:[...mesh.runIndex],runOriginalID:[...mesh.runOriginalID]};
}
function surfaceShell(surface:Surface):Shell{
 const indices=new Map(surface.vertices.map((vertex,i)=>[vertex.id,i]));
 return {positions:surface.vertices.map(vertex=>[vertex.xMm,vertex.yMm,vertex.zMm]),triangles:surface.faces.map(face=>face.vertices.map(id=>indices.get(id)!) as [number,number,number])};
}
function edgeOwners(shell:Shell){
 const edges=new Map<string,{a:number;b:number;faces:number[];directions:number[]}>();
 shell.triangles.forEach((triangle,index)=>triangle.forEach((a,i)=>{const b=triangle[(i+1)%3],key=[a,b].sort((x,y)=>x-y).join(':'),row=edges.get(key)??{a,b,faces:[],directions:[]};row.faces.push(index);row.directions.push(a<b?1:-1);edges.set(key,row);}));
 return edges;
}
function foldingAudit(before:Shell,after:Shell){
 const oldNormals=before.triangles.map(triangle=>normal(before,triangle)),newNormals=after.triangles.map(triangle=>normal(after,triangle)),worsened:{edge:number[];beforeDeg:number;afterDeg:number;points:Point[]}[]=[];
 const validOriginal=oldNormals.map((n,i)=>Math.hypot(...n)>0?i:-1).filter(i=>i>=0),preExistingDegenerateFaces=oldNormals.map((n,i)=>Math.hypot(...n)===0?i:-1).filter(i=>i>=0),newDegenerateFaces=validOriginal.filter(i=>Math.hypot(...newNormals[i])===0);
 let maxBeforeDeg=0,maxAfterDeg=0,nearBefore=0,nearAfter=0;
 for(const edge of edgeOwners(before).values())if(edge.faces.length===2){
  const [a,b]=edge.faces;
  // The raw Boolean mesh may contain pre-existing zero-area stations that
  // Manifold removes when rebuilding the solid. They have no defined normal
  // angle. Keep them separate from valid material newly made degenerate.
  if(Math.hypot(...oldNormals[a])===0||Math.hypot(...oldNormals[b])===0)continue;
  const previous=angle(oldNormals[a],oldNormals[b]),current=angle(newNormals[a],newNormals[b]);
  maxBeforeDeg=Math.max(maxBeforeDeg,previous);maxAfterDeg=Math.max(maxAfterDeg,current);
  if(previous>120)nearBefore++;if(current>120)nearAfter++;
  // Compare the SAME original edge. A pre-existing concave armpit may exceed
  // 90 degrees; it must not be mistaken for a newly introduced fold.
  // 0.05 degrees accommodates the persisted Float32 station rounding.
  if(current>Math.max(90,previous)+.05)worsened.push({edge:[edge.a,edge.b],beforeDeg:previous,afterDeg:current,points:[after.positions[edge.a],after.positions[edge.b]]});
 }
 return {maxBeforeDeg,maxAfterDeg,nearBefore,nearAfter,worsened,preExistingDegenerateFaces,newDegenerateFaces,minNormalAgreement:Math.min(...validOriginal.map(i=>Math.hypot(...newNormals[i])>0?cosine(oldNormals[i],newNormals[i]):-1)),minAreaRatio:Math.min(...validOriginal.map(i=>Math.hypot(...newNormals[i])/Math.hypot(...oldNormals[i]))),movedVertices:before.positions.filter((point,i)=>point.some((n,axis)=>n!==after.positions[i][axis])).length};
}
function topology(shell:Shell){
 const edges=[...edgeOwners(shell).values()],boundary=edges.filter(edge=>edge.faces.length===1),links=new Map<number,number[]>(),adjacent=new Map<number,number[]>();
 for(const edge of edges){adjacent.set(edge.a,[...adjacent.get(edge.a)??[],edge.b]);adjacent.set(edge.b,[...adjacent.get(edge.b)??[],edge.a]);}
 for(const edge of boundary){links.set(edge.a,[...links.get(edge.a)??[],edge.b]);links.set(edge.b,[...links.get(edge.b)??[],edge.a]);}
 const components=(graph:Map<number,number[]>)=>{const seen=new Set<number>(),groups:number[][]=[];for(const start of graph.keys())if(!seen.has(start)){const queue=[start],group:number[]=[];while(queue.length){const id=queue.pop()!;if(seen.has(id))continue;seen.add(id);group.push(id);queue.push(...graph.get(id)!);}groups.push(group);}return groups;};
 return {components:components(adjacent).length,manifold:edges.every(edge=>edge.faces.length<=2),oriented:edges.every(edge=>edge.faces.length!==2||edge.directions[0]!==edge.directions[1]),simpleBoundary:[...links.values()].every(neighbors=>neighbors.length===2),boundaryLoops:components(links),boundaryEdges:boundary.length};
}
function allAngles(shell:Shell){
 const normals=shell.triangles.map(triangle=>normal(shell,triangle));
 return [...edgeOwners(shell).values()].filter(edge=>edge.faces.length===2).map(edge=>angle(normals[edge.faces[0]],normals[edge.faces[1]]));
}
afterEach(()=>vi.restoreAllMocks());

it('the independent fold audit allows an existing concavity and detects a newly folded join',()=>{
 const hinge=(degrees:number):Shell=>({positions:[[0,0,0],[1,0,0],[0,1,0],[0,-Math.cos(degrees*Math.PI/180),Math.sin(degrees*Math.PI/180)]],triangles:[[0,1,2],[1,0,3]]});
 expect(foldingAudit(hinge(120),hinge(120)).worsened).toEqual([]);
 expect(foldingAudit(hinge(120),hinge(174)).worsened).toHaveLength(1);
 expect(foldingAudit(hinge(20),hinge(154)).worsened).toHaveLength(1);
});

const padded=speciesDefaults('canine','padded');
function scaledWearer(scale:number){return Object.fromEntries(Object.entries(padded).map(([key,value])=>[key,key.endsWith('Mm')&&typeof value==='number'?value*scale:value])) as SpeciesParams;}
const cases:[string,SpeciesParams][]=[
 ['padded-default',padded],
 ['padded-zero',{...padded,hipPaddingMm:0,thighPaddingMm:0,calfPaddingMm:0}],
 ['padded-max-hip',{...padded,hipPaddingMm:200}],
 ['padded-max-thigh',{...padded,thighPaddingMm:200}],
 ['padded-calf-60',{...padded,calfPaddingMm:60}],
 ['padded-max-calf',{...padded,calfPaddingMm:200}],
 ['padded-small',scaledWearer(.75)],
 ['padded-large',scaledWearer(1.25)],
 ['dtd-default',speciesDefaults('canine','dtd')],
];

it('maximum calf padding preserves its exterior thickness while leaving a ten millimetre ankle gap',()=>{
 const parameters={...padded,calfPaddingMm:200},base=generateSpecies({...parameters,calfPaddingMm:0}),expanded=generateSpecies(parameters);
 const rings=(surface:Surface)=>{
  const selected=new Set(surface.faces.filter(face=>face.region==='leg-right').flatMap(face=>face.vertices)),rows=new Map<number,Surface['vertices']>();
  for(const vertex of surface.vertices)if(selected.has(vertex.id)&&vertex.yMm>=parameters.legLengthMm*.1-1e-8&&vertex.yMm<=parameters.legLengthMm*.3+1e-8)rows.set(vertex.yMm,[...rows.get(vertex.yMm)??[],vertex]);
  return rows;
 };
 const original=rings(base),actual=rings(expanded),measured=[];
 expect(actual.size).toBeGreaterThan(2);expect([...actual.keys()]).toEqual([...original.keys()]);
 for(const [height,points]of actual){
  const previous=original.get(height)!,maxX=Math.max(...points.map(point=>point.xMm)),minX=Math.min(...points.map(point=>point.xMm)),maxZ=Math.max(...points.map(point=>point.zMm)),minZ=Math.min(...points.map(point=>point.zMm)),outerAddition=maxX-Math.max(...previous.map(point=>point.xMm)),frontAddition=maxZ-Math.max(...previous.map(point=>point.zMm)),backAddition=Math.min(...previous.map(point=>point.zMm))-minZ;
  expect(outerAddition).toBeCloseTo(110,8);expect(frontAddition).toBeCloseTo(200,8);expect(backAddition).toBeCloseTo(200,8);
  expect(minX).toBeGreaterThanOrEqual(5-1e-8);
  measured.push({heightMm:height,innerRightXmm:minX,outerAdditionMm:outerAddition,frontAdditionMm:frontAddition,backAdditionMm:backAddition});
 }
 mkdirSync(output,{recursive:true});writeFileSync(resolve(output,'maximum-calf-thickness.json'),JSON.stringify(measured,null,2));
});

it.each(cases)('%s preserves join orientation without manufacturing new folds, holes or dimension drift',async(name,raw)=>{
 const parameters=speciesParamsSchema.parse(raw),source=generateSpecies(parameters),beforeSource=structuredClone(source),snapshots:Capture[]=[];
 const native=fairing.fairWearerJoins;
 vi.spyOn(fairing,'fairWearerJoins').mockImplementation((mesh,...args)=>{snapshots.push(capture(mesh));native(mesh,...args);snapshots.push(capture(mesh));});
 mkdirSync(output,{recursive:true});
 let surface:Surface;
 try{surface=await assembleSpecies(source);}catch(error){writeFileSync(resolve(output,name+'-failure.json'),JSON.stringify({name,parameters,error:String(error),fairing:snapshots.length===2?foldingAudit(snapshots[0],snapshots[1]):null},null,2));throw error;}
 expect(source).toEqual(beforeSource);expect(snapshots).toHaveLength(2);
 const [before,after]=snapshots,audit=foldingAudit(before,after),rawTopology=topology(after),shell=surfaceShell(surface),finalTopology=topology(shell),angles=allAngles(shell),positions=shell.positions;
 const minY=Math.min(...positions.map(point=>point[1])),maxY=Math.max(...positions.map(point=>point[1])),expectedMin=parameters.bodyMode==='padded'?parameters.legLengthMm*.1:0,expectedMax=parameters.bodyMode==='padded'?parameters.heightMm*.86+25:parameters.heightMm;
 const mirrored=new Set(positions.map(([x,y,z])=>[x,y,z].map(n=>Math.round(n*1e5)).join(','))),unpaired=positions.filter(([x,y,z])=>!mirrored.has([-x,y,z].map(n=>Math.round(n*1e5)).join(',')));
 const report={name,parameters,vertices:positions.length,faces:shell.triangles.length,fairing:audit,rawTopology,finalTopology,minimumYmm:minY,maximumYmm:maxY,expectedMin,expectedMax,unpairedMirrorVertices:unpaired.length,finalMaxAngleDeg:Math.max(...angles),finalOver120:angles.filter(value=>value>120).length,finalOver150:angles.filter(value=>value>150).length};
 writeFileSync(resolve(output,name+'-metrics.json'),JSON.stringify(report,null,2));
 if(audit.worsened.length)writeFileSync(resolve(output,name+'-join-snapshots.json'),JSON.stringify({before,after}));
 expect(after.triangles).toEqual(before.triangles);expect(after.runIndex).toEqual(before.runIndex);expect(after.runOriginalID).toEqual(before.runOriginalID);
 expect(after.positions).toHaveLength(before.positions.length);
 for(let i=0;i<before.positions.length;i++)for(let axis=3;axis<before.numProp;axis++)expect(after.properties[i*after.numProp+axis]).toBe(before.properties[i*before.numProp+axis]);
 expect(audit.movedVertices).toBeGreaterThan(0);
 expect(audit.newDegenerateFaces).toEqual([]);
 expect(audit.minNormalAgreement).toBeGreaterThan(0);
 expect(audit.minAreaRatio).toBeGreaterThanOrEqual(.02-1e-5);
 expect(audit.worsened).toEqual([]);
 expect(rawTopology.components).toBe(1);expect(rawTopology.manifold).toBe(true);expect(rawTopology.oriented).toBe(true);expect(rawTopology.boundaryEdges).toBe(0);
 expect(finalTopology.components).toBe(1);expect(finalTopology.manifold).toBe(true);expect(finalTopology.oriented).toBe(true);expect(finalTopology.simpleBoundary).toBe(true);
 expect(finalTopology.boundaryLoops).toHaveLength(parameters.bodyMode==='padded'?5:0);
 expect(unpaired).toEqual([]);expect(Math.abs(minY-expectedMin)).toBeLessThan(.002);expect(Math.abs(maxY-expectedMax)).toBeLessThan(.002);
 expect(Math.min(...after.positions.map(point=>point[1]))).toBe(Math.min(...before.positions.map(point=>point[1])));
 expect(Math.max(...after.positions.map(point=>point[1]))).toBe(Math.max(...before.positions.map(point=>point[1])));
 for(const triangle of shell.triangles)expect(Math.hypot(...normal(shell,triangle))).toBeGreaterThan(0);
 if(name==='padded-default'){
  expect(audit.nearBefore).toBe(0);expect(audit.nearAfter).toBe(0);
  expect(report.finalOver150).toBe(0);
 }
 if(parameters.bodyMode==='padded'){
  expect(surface.faces.some(face=>/^(head|hand|foot)(-|$)/.test(face.region))).toBe(false);
  const shoulder=parameters.heightMm*.86-70,ax=parameters.shoulderWidthMm*.5;
  const openings=finalTopology.boundaryLoops.map(loop=>{
   const points=loop.map(index=>positions[index]);
   if(points.every(point=>Math.abs(point[1]-expectedMax)<.002))return'collar';
   if(points.every(point=>Math.abs(point[1]-expectedMin)<.002))return points.every(point=>point[0]<0)?'left ankle':points.every(point=>point[0]>0)?'right ankle':'unexpected';
   for(const side of [-1,1]){const cx=side*(ax+parameters.armLengthMm*Math.sqrt(.75)),cy=shoulder-parameters.armLengthMm*.5;if(points.every(point=>Math.abs(side*Math.sqrt(.75)*(point[0]-cx)-.5*(point[1]-cy))<.002))return side<0?'left cuff':'right cuff';}
   return'unexpected';
  });
  expect(openings.sort()).toEqual(['collar','left ankle','left cuff','right ankle','right cuff']);
  if(name==='padded-max-calf'){
   const zero=generateSpecies({...parameters,calfPaddingMm:0}),measured=[];
   for(const loop of finalTopology.boundaryLoops){
    const points=loop.map(index=>positions[index]);if(!points.every(point=>Math.abs(point[1]-expectedMin)<.002))continue;
    expect(Math.min(...points.map(point=>Math.abs(point[0])))).toBeGreaterThanOrEqual(5-.002);
    const side=points[0][0]<0?-1:1,region='leg-'+(side<0?'left':'right'),ids=new Set(zero.faces.filter(face=>face.region===region).flatMap(face=>face.vertices)),baseline=zero.vertices.filter(vertex=>ids.has(vertex.id)&&Math.abs(vertex.yMm-expectedMin)<.002);
    const outerAddition=Math.max(...points.map(point=>side*point[0]))-Math.max(...baseline.map(vertex=>side*vertex.xMm)),frontAddition=Math.max(...points.map(point=>point[2]))-Math.max(...baseline.map(vertex=>vertex.zMm)),backAddition=Math.min(...baseline.map(vertex=>vertex.zMm))-Math.min(...points.map(point=>point[2]));
    expect(Math.abs(outerAddition-110)).toBeLessThan(.002);expect(Math.abs(frontAddition-200)).toBeLessThan(.002);expect(Math.abs(backAddition-200)).toBeLessThan(.002);
    measured.push({side,outerAdditionMm:outerAddition,frontAdditionMm:frontAddition,backAdditionMm:backAddition});
   }
   expect(measured).toHaveLength(2);writeFileSync(resolve(output,'maximum-calf-final-hem-thickness.json'),JSON.stringify(measured,null,2));
  }
 }
},120000);
