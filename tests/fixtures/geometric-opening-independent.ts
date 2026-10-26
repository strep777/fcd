import {randomUUID} from 'node:crypto';
import type {Surface} from '../../packages/schema/index';
import type {FaceCut} from '../../packages/surface/refine';

export type Point3=[number,number,number];
export type TraceSegment={a:Point3;b:Point3};
export type GuideEdge={a:string;b:string};
export const openingToleranceMm=1e-4;

const subtract=(a:Point3,b:Point3):Point3=>[a[0]-b[0],a[1]-b[1],a[2]-b[2]];
const dot=(a:Point3,b:Point3)=>a.reduce((sum,n,i)=>sum+n*b[i],0);
export const pointDistance=(a:Point3,b:Point3)=>Math.hypot(...subtract(a,b));
export const traceLength=(trace:TraceSegment[])=>trace.reduce((sum,s)=>sum+pointDistance(s.a,s.b),0);

/** Decode the public barycentric result directly, without production mapping,
 * cut-path validation, sectioning or polyline-distance helpers. */
export function openingWorldTrace(surface:Surface,cuts:FaceCut[]):TraceSegment[]{
 const faces=new Map(surface.faces.map(face=>[face.id,face]));
 const vertices=new Map(surface.vertices.map(vertex=>[vertex.id,vertex]));
 return cuts.map(cut=>{
  const face=faces.get(cut.faceId);
  if(!face)throw Error('Opening references a missing source face');
  const corners=face.vertices.map(id=>vertices.get(id));
  if(corners.some(vertex=>!vertex))throw Error('Opening references a missing source vertex');
  const world=(weights:number[]):Point3=>{
   if(weights.length!==3||weights.some(n=>!Number.isFinite(n)||n< -1e-8||n>1+1e-8)||Math.abs(weights.reduce((sum,n)=>sum+n,0)-1)>1e-8)throw Error('Invalid opening barycentric station');
   return (['xMm','yMm','zMm'] as const).map(axis=>weights.reduce((sum,n,i)=>sum+n*corners[i]![axis],0)) as Point3;
  };
  const segment={a:world(cut.a),b:world(cut.b)};
  if(pointDistance(segment.a,segment.b)<=1e-9)throw Error('Zero-length opening segment');
  return segment;
 });
}

/** Whole finite-segment oracle for a known straight opening. Every point of a
 * segment is within tolerance if both endpoints are, since distance to a fixed
 * finite segment is convex. Projected intervals certify complete coverage;
 * length and endpoint degree checks reject retraces, overlaps and extra arms.
 * Exact physical duplicates from the two incident source faces are one cut. */
export function requireAnalyticOpening(trace:TraceSegment[],start:Point3,end:Point3,tolerance=openingToleranceMm){
 if(!trace.length)throw Error('Missing opening');
 const direction=subtract(end,start),length=pointDistance(start,end),square=length*length;
 if(!Number.isFinite(length)||length<=tolerance)throw Error('Invalid analytic opening');
 const parameter=(point:Point3)=>dot(subtract(point,start),direction)/square;
 const distanceToExpected=(point:Point3)=>{
  const t=Math.max(0,Math.min(1,parameter(point)));
  return pointDistance(point,start.map((n,i)=>n+t*direction[i]) as Point3);
 };
 const stations:Point3[]=[],edges=new Set<string>(),segments:TraceSegment[]=[],degrees:number[]=[];
 const station=(point:Point3)=>{
  let index=stations.findIndex(saved=>pointDistance(point,saved)<=1e-8);
  if(index<0){index=stations.length;stations.push(point);degrees.push(0);}
  return index;
 };
 for(const segment of trace){
  if([...segment.a,...segment.b].some(n=>!Number.isFinite(n))||Math.max(distanceToExpected(segment.a),distanceToExpected(segment.b))>tolerance)throw Error('Opening leaves the analytic finite line');
  const a=station(segment.a),b=station(segment.b),key=a<b?a+':'+b:b+':'+a;
  if(a===b)throw Error('Zero-length opening segment');
  if(edges.has(key))continue;
  edges.add(key);degrees[a]++;degrees[b]++;segments.push(segment);
 }
 const intervals=segments.map(segment=>[parameter(segment.a),parameter(segment.b)].sort((a,b)=>a-b)).sort((a,b)=>a[0]-b[0]);
 let covered=0;
 for(const [lo,hi]of intervals){
  if(lo>covered+tolerance/length)throw Error('Opening contains a gap');
  covered=Math.max(covered,hi);
 }
 if(intervals[0][0]>tolerance/length||covered<1-tolerance/length)throw Error('Opening misses an endpoint');
 if(Math.abs(traceLength(segments)-length)>tolerance)throw Error('Opening retraces or lengthens the analytic line');
 const ends=stations.filter((_,i)=>degrees[i]===1);
 if(ends.length!==2||degrees.some(degree=>degree!==1&&degree!==2))throw Error('Opening is not one unbranched chain');
 if(!ends.some(point=>pointDistance(point,start)<=tolerance)||!ends.some(point=>pointDistance(point,end)<=tolerance))throw Error('Opening endpoints changed');
 return {lengthMm:traceLength(segments),segments:segments.length};
}

export function planarOpeningFixture(options:{subdivisions?:number;flipDiagonals?:boolean;permuted?:boolean;tilted?:boolean;hole?:boolean}={}){
 const subdivisions=options.subdivisions??1,columns=6*subdivisions,rows=5*subdivisions,step=20/subdivisions;
 const transform=([x,y]:[number,number]):Point3=>options.tilted?[17+.8*x,-23+y,11+.6*x]:[x,y,0];
 const vertices:Surface['vertices']=[],faces:Surface['faces']=[],ids:string[][]=[];
 for(let y=0;y<=rows;y++){
  ids[y]=[];
  for(let x=0;x<=columns;x++){
   const id=randomUUID(),[xMm,yMm,zMm]=transform([x*step,y*step]);
   ids[y][x]=id;vertices.push({id,xMm,yMm,zMm});
  }
 }
 for(let y=0;y<rows;y++)for(let x=0;x<columns;x++){
  // Remove a physical 20x20 mm opening. The jagged guide still follows its
  // boundary, but the intended direct line would cross absent material.
  if(options.hole&&x>=2*subdivisions&&x<3*subdivisions&&y>=subdivisions&&y<2*subdivisions)continue;
  const a=ids[y][x],b=ids[y][x+1],c=ids[y+1][x],d=ids[y+1][x+1];
  const triangles=options.flipDiagonals?[[a,b,c],[b,d,c]]:[[a,b,d],[a,d,c]];
  for(const triangle of triangles)faces.push({id:randomUUID(),vertices:triangle as [string,string,string],region:'cloth'});
 }
 const coarsePath=[[0,0],[1,0],[1,1],[2,1],[2,2],[3,2],[4,2],[4,3],[5,3],[5,4],[6,4]],path:string[]=[];
 for(let i=1;i<coarsePath.length;i++){
  const [x,y]=coarsePath[i-1],[nextX,nextY]=coarsePath[i];
  if(i===1)path.push(ids[y*subdivisions][x*subdivisions]);
  for(let j=1;j<=subdivisions;j++)path.push(ids[y*subdivisions+(nextY-y)*j][x*subdivisions+(nextX-x)*j]);
 }
 if(options.permuted){vertices.reverse();faces.reverse();for(const face of faces)face.vertices=[face.vertices[1],face.vertices[2],face.vertices[0]];}
 const surface:Surface={id:randomUUID(),source:'obj',topologyVersion:1,vertices,faces};
 const guideEdges=path.slice(1).map((id,i)=>({a:path[i],b:id}));
 return {surface,guideEdges,start:transform([0,0]),end:transform([120,80]),ids,transform};
}

export function coneOpeningFixture(sectors=16,levels=4,sector=0){
 const radius=80,height=120,vertices:Surface['vertices']=[{id:randomUUID(),xMm:0,yMm:0,zMm:height}],faces:Surface['faces']=[],rings:string[][]=[];
 for(let level=1;level<=levels;level++){
  const r=radius*level/levels;rings[level]=[];
  for(let j=0;j<sectors;j++){
   const angle=j*2*Math.PI/sectors,id=randomUUID();rings[level][j]=id;
   vertices.push({id,xMm:r*Math.cos(angle),yMm:r*Math.sin(angle),zMm:height*(1-level/levels)});
  }
 }
 const emit=(triangle:string[])=>faces.push({id:randomUUID(),vertices:triangle as [string,string,string],region:'cone'});
 for(let j=0;j<sectors;j++){
  const next=(j+1)%sectors;emit([vertices[0].id,rings[1][j],rings[1][next]]);
  for(let level=1;level<levels;level++){
   const a=rings[level][j],b=rings[level][next],c=rings[level+1][j],d=rings[level+1][next];emit([a,c,d]);emit([a,d,b]);
  }
 }
 const next=(sector+1)%sectors,path=[vertices[0].id,rings[1][next],rings[2][next],rings[2][sector],...Array.from({length:levels-2},(_,i)=>rings[i+3][sector])];
 const surface:Surface={id:randomUUID(),source:'obj',topologyVersion:1,vertices,faces};
 const endVertex=vertices.find(vertex=>vertex.id===rings[levels][sector])!;
 return {surface,guideEdges:path.slice(1).map((id,i)=>({a:path[i],b:id})),start:[0,0,height] as Point3,end:[endVertex.xMm,endVertex.yMm,endVertex.zMm] as Point3,motherLineMm:Math.hypot(radius,height)};
}

export function guideWorldTrace(surface:Surface,guide:GuideEdge[]):TraceSegment[]{
 const positions=new Map(surface.vertices.map(vertex=>[vertex.id,[vertex.xMm,vertex.yMm,vertex.zMm] as Point3]));
 return guide.map(edge=>({a:positions.get(edge.a)!,b:positions.get(edge.b)!}));
}

/** A zero-width physical crack has two different vertex banks. They meet only
 * at its tip, so the mesh guide can detour around the tip while a direct
 * geometric section cannot cross between coincident material positions. */
export function coincidentCrackOpeningFixture(){
 const fixture=planarOpeningFixture(),copies=new Map<string,string>(),vertices=new Map(fixture.surface.vertices.map(vertex=>[vertex.id,vertex]));
 for(let y=0;y<3;y++){
  const source=vertices.get(fixture.ids[y][2])!,id=randomUUID();copies.set(source.id,id);fixture.surface.vertices.push({...source,id});
 }
 fixture.surface.faces=fixture.surface.faces.map(face=>{
  const points=face.vertices.map(id=>vertices.get(id)!);
  if(!points.every(point=>point.xMm>=40)||!points.some(point=>point.xMm>40))return face;
  return {...face,vertices:face.vertices.map(id=>copies.get(id)??id) as [string,string,string]};
 });
 const path=[[0,0],[1,0],[1,1],[1,2],[1,3],[2,3],[3,3],[4,3],[4,4],[5,4],[6,4]].map(([x,y])=>fixture.ids[y][x]);
 fixture.guideEdges=path.slice(1).map((id,i)=>({a:path[i],b:id}));
 return {...fixture,copies};
}

/** A fully folded, zero-thickness coupon has two coincident planar facets,
 * joined along the outside boundary. Every triangle is nondegenerate, all
 * edges have two owners, and the back facet has distinct interior identities.
 * Opposite normals cancel, leaving only a coplanar section proposal. */
export function coplanarFoldedOpeningFixture(alternateFan=false){
 const boundary:[number,number][]=[...Array.from({length:6},(_,i)=>[i*20,0] as [number,number]),...Array.from({length:5},(_,i)=>[120,i*20] as [number,number]),...Array.from({length:6},(_,i)=>[120-i*20,100] as [number,number]),...Array.from({length:5},(_,i)=>[0,100-i*20] as [number,number])];
 const vertices:Surface['vertices']=boundary.map(([xMm,yMm])=>({id:randomUUID(),xMm,yMm,zMm:0})),faces:Surface['faces']=[];
 const center=alternateFan?[71,29]:[43,57],front=randomUUID(),back=randomUUID();
 vertices.push({id:front,xMm:center[0],yMm:center[1],zMm:0},{id:back,xMm:center[0],yMm:center[1],zMm:0});
 for(let i=0;i<boundary.length;i++){
  const a=vertices[i].id,b=vertices[(i+1)%boundary.length].id;
  faces.push({id:randomUUID(),region:'cloth',vertices:[a,b,front]},{id:randomUUID(),region:'cloth',vertices:[a,back,b]});
 }
 const path=vertices.slice(0,12).map(vertex=>vertex.id),surface:Surface={id:randomUUID(),source:'obj',topologyVersion:1,vertices,faces};
 return {surface,guideEdges:path.slice(1).map((id,i)=>({a:path[i],b:id})),start:[0,0,0] as Point3,end:[120,100,0] as Point3};
}
