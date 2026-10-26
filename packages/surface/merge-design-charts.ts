import type {Surface,SurfaceReport} from '../schema/index';
import {edgeKey} from './refine';
import {designQualityFailure} from './design-partition';
import {narrowPanelSplit} from './panel-neck';
import {joinedChartSeed} from './joined-chart-seed';
import {partialChartJoins} from './partial-chart-join';

export type ManufacturingMerge = {
 materialRegion:(region:string)=>string;
 accept:(report:SurfaceReport)=>Promise<boolean>;
};
export type DartMerge = {
 solve:(faces:Surface['faces'],vertices:Surface['vertices'],seed?:SurfaceReport['uv'])=>Promise<SurfaceReport|undefined>;
 accept:(report:SurfaceReport)=>Promise<boolean>;
};

/** Remove unnecessary trial seams after successful flattening. Only charts
 * sharing an uncut mesh edge and a material domain may merge. Every proposal
 * is solved and measured again; rejected unions never change either chart. */
export async function mergeDesignCharts(mesh:Surface,input:SurfaceReport[],solve:(faces:Surface['faces'],seed?:SurfaceReport['uv'])=>Promise<SurfaceReport|undefined>,rejectedGeometry=new Set<string>(),continueMerging=()=>true,rejoinTrialSeams=false,canRejoinSourceFaces?:(a:string,b:string)=>boolean,maxAttempts=2000,repair?:ManufacturingMerge,dart?:DartMerge){
 if(input.length<2)return input;
 const vertices=new Map(mesh.vertices.map(v=>[v.id,v])),faces=new Map(mesh.faces.map(f=>[f.id,f])),edges=new Map<string,{a:string;b:string;faces:string[]}>();
 const material=(region:string)=>repair?.materialRegion(region)??region;
 const position=(id:string)=>{const p=vertices.get(id)!;return [p.xMm,p.yMm,p.zMm].join(',');};
 for(const f of mesh.faces)for(let i=0;i<3;i++){const a=f.vertices[i],b=f.vertices[(i+1)%3],key=rejoinTrialSeams?[position(a),position(b)].sort().join('|'):edgeKey(a,b),row=edges.get(key)??{a,b,faces:[]};row.faces.push(f.id);edges.set(key,row);}
 const areas=new Map(mesh.faces.map(f=>{const [a,b,c]=f.vertices.map(id=>vertices.get(id)!),u=[b.xMm-a.xMm,b.yMm-a.yMm,b.zMm-a.zMm],v=[c.xMm-a.xMm,c.yMm-a.yMm,c.zMm-a.zMm];return[f.id,Math.hypot(u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0])/2];}));
 const charts=new Map(input.map((r,i)=>[i,r])),rejected=new Set<string>();let next=input.length,attempts=0;
 while(charts.size>1&&attempts<maxAttempts&&continueMerging()){
  const owners=new Map([...charts].flatMap(([i,r])=>r.faceIds.map(id=>[id,i] as const))),links=new Map<string,{a:number;b:number;length:number}>();
  for(const e of edges.values()){
   if(e.faces.length!==2||material(faces.get(e.faces[0])!.region)!==material(faces.get(e.faces[1])!.region)||canRejoinSourceFaces&&!canRejoinSourceFaces(e.faces[0],e.faces[1]))continue;
   const a=owners.get(e.faces[0]),b=owners.get(e.faces[1]);if(a===undefined||b===undefined||a===b)continue;
   const key=Math.min(a,b)+':'+Math.max(a,b);if(rejected.has(key))continue;
   const p=vertices.get(e.a)!,q=vertices.get(e.b)!,row=links.get(key)??{a,b,length:0};row.length+=Math.hypot(p.xMm-q.xMm,p.yMm-q.yMm,p.zMm-q.zMm);links.set(key,row);
  }
  // Absorb narrow and small charts before spending the finite solve budget
  // on large panels. Absolute shared length alone starved tiny intersection
  // fragments. This score is scale invariant in ordering and each proposed
  // union still passes the same complete native distortion/sewing checks.
  const chartArea=new Map([...charts].map(([id,r])=>[id,r.faceIds.reduce((sum,id)=>sum+areas.get(id)!,0)]));
  const score=(link:{a:number;b:number;length:number})=>link.length/Math.max(1e-20,Math.min(chartArea.get(link.a)!,chartArea.get(link.b)!));
  // Cheap small-detail unions must not wait behind a tiny ear attached to a
  // whole torso. That expensive solve can consume the search budget and leave
  // two adjacent, readily unfoldable material fragments permanently apart.
  const smallLocal=(link:{a:number;b:number})=>Math.min(chartArea.get(link.a)!,chartArea.get(link.b)!)<100&&chartArea.get(link.a)!+chartArea.get(link.b)!<10000?1:0;
  const bounds=new Map([...charts].map(([id,r])=>[id,r.faceIds.reduce((box,id)=>{for(const vertexId of faces.get(id)!.vertices){const p=vertices.get(vertexId)!;[p.xMm,p.yMm,p.zMm].forEach((n,i)=>{box[i*2]=Math.min(box[i*2],n);box[i*2+1]=Math.max(box[i*2+1],n);});}return box;},[Infinity,-Infinity,Infinity,-Infinity,Infinity,-Infinity]) ]));
  const geometricTie=(a:{a:number;b:number},b:{a:number;b:number})=>{const extent=(link:typeof a)=>bounds.get(link.a)!.map((n,i)=>i%2?Math.max(n,bounds.get(link.b)![i]):Math.min(n,bounds.get(link.b)![i])),p=extent(a),q=extent(b);for(let i=0;i<p.length;i++)if(Math.abs(p[i]-q[i])>1e-8)return p[i]-q[i];return 0;};
  const compare=(a:number,b:number)=>Math.abs(a-b)>1e-9*Math.max(1,Math.abs(a),Math.abs(b))?a-b:0;
  const candidates=[...links].sort((a,b)=>smallLocal(b[1])-smallLocal(a[1])||compare(score(b[1]),score(a[1]))||compare(b[1].length,a[1].length)||geometricTie(a[1],b[1]));let merged=false;
  for(const [key,link]of candidates){
   if(++attempts>maxAttempts||!continueMerging())break;
   const a=charts.get(link.a)!,b=charts.get(link.b)!,ids=new Set([...a.faceIds,...b.faceIds]);
   const region=faces.get(a.faceIds[0])!.region;
   if([...ids].some(id=>material(faces.get(id)!.region)!==material(region))){rejected.add(key);continue;}
   // A successful trial dart duplicates its vertex fan. If later subdivision
   // makes that dart unnecessary, two charts can share a real edge while its
   // vertex IDs differ. Reconnect exact coincident stations only for a trial
   // union; retain every original station when the native solve rejects it.
   // Callers enable this only when there are no user-defined seam constraints.
   const replacements=new Map<string,string>(),left=new Map<string,string>();
   if(rejoinTrialSeams){
    const aIds=new Set(a.faceIds),bIds=new Set(b.faceIds),stations=new Set<string>();
    for(const e of edges.values())if(e.faces.length===2&&(aIds.has(e.faces[0])&&bIds.has(e.faces[1])||bIds.has(e.faces[0])&&aIds.has(e.faces[1]))&&(!canRejoinSourceFaces||canRejoinSourceFaces(e.faces[0],e.faces[1]))){stations.add(position(e.a));stations.add(position(e.b));}
    for(const id of a.faceIds)for(const v of faces.get(id)!.vertices)if(stations.has(position(v)))left.set(position(v),v);
    for(const id of b.faceIds)for(const v of faces.get(id)!.vertices){const match=left.get(position(v));if(match&&match!==v)replacements.set(v,match);}
   }
   // Repair labels separate solve groups, not cloth materials. Normalize only
   // this proposed union; its original groups survive every rejected solve.
   const rightFaces=new Set(b.faceIds),union=[...ids].map(id=>{const f=faces.get(id)!;return {...f,region,vertices:replacements.size&&rightFaces.has(id)?f.vertices.map(v=>replacements.get(v)??v) as [string,string,string]:f.vertices};}),geometryKey=union.map(f=>f.id+':'+f.region+':'+f.vertices.map(id=>{const v=vertices.get(id)!;return [id,v.xMm,v.yMm,v.zMm].join(',');}).join(';')).sort().join('|');
   // Joining one permitted edge can also join the endpoints of another seam.
   // Check the complete proposed topology, including those incidental edges,
   // before solving or mutating either chart. A protected source edge may
   // never become an interior edge through indirect vertex replacement.
   if(rejoinTrialSeams&&canRejoinSourceFaces){const joinedEdges=new Map<string,string[]>();for(const face of union)for(let i=0;i<3;i++){const edge=edgeKey(face.vertices[i],face.vertices[(i+1)%3]),rows=joinedEdges.get(edge)??[];rows.push(face.id);joinedEdges.set(edge,rows);}if([...joinedEdges.values()].some(rows=>rows.length===2&&!canRejoinSourceFaces(rows[0],rows[1]))){rejected.add(key);rejectedGeometry.add(geometryKey);continue;}}
   if(rejectedGeometry.has(geometryKey)&&!dart){rejected.add(key);continue;}
   const revisedB=replacements.size?{...b,uv:[...new Map(b.uv.map(p=>{const vertexId=replacements.get(p.vertexId)??p.vertexId;return [vertexId,{...p,vertexId}] as const;})).values()]}:b;
   const acceptable=(report:SurfaceReport|undefined,trial:Surface)=>!!report&&!designQualityFailure(report)&&report.faceIds.length===ids.size&&!report.faceIds.some(id=>!ids.has(id))&&!narrowPanelSplit(trial,report);
   let report=rejectedGeometry.has(geometryKey)?undefined:await solve(union,joinedChartSeed(a,revisedB)),acceptedFaces=union,acceptedVertices=mesh.vertices;
   if(!acceptable(report,{...mesh,faces:union})||repair&&!await repair.accept(report!)){
    report=undefined;rejectedGeometry.add(geometryKey);
    if(dart&&rejoinTrialSeams&&canRejoinSourceFaces)for(const trial of partialChartJoins(mesh,a,b,canRejoinSourceFaces)){
     if(++attempts>maxAttempts||!continueMerging())break;
     const normalized=trial.faces.map(f=>({...f,region})),joinedEdges=new Map<string,string[]>();
     for(const f of normalized)for(let i=0;i<3;i++){const edge=edgeKey(f.vertices[i],f.vertices[(i+1)%3]),rows=joinedEdges.get(edge)??[];rows.push(f.id);joinedEdges.set(edge,rows);}
     if([...joinedEdges.values()].some(rows=>rows.length===2&&!canRejoinSourceFaces(rows[0],rows[1])))continue;
     const candidate=await dart.solve(normalized,trial.vertices,joinedChartSeed(a,trial.right));
     if(!acceptable(candidate,{...mesh,faces:normalized,vertices:trial.vertices})||!await dart.accept(candidate!))continue;
     report=candidate;acceptedFaces=normalized;acceptedVertices=trial.vertices;break;
    }
    if(!report){rejected.add(key);continue;}
   }
   const revised=new Map(acceptedFaces.map(f=>[f.id,f]));mesh.faces=mesh.faces.map(f=>revised.get(f.id)??f);for(const f of acceptedFaces)faces.set(f.id,f);
   mesh.vertices=acceptedVertices;for(const v of acceptedVertices)vertices.set(v.id,v);
   charts.delete(link.a);charts.delete(link.b);charts.set(next++,report!);merged=true;break;
  }
  if(!merged)break;
 }
 return [...charts.values()];
}
