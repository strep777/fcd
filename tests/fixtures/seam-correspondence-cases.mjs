// Analytic fixtures for seam acceptance; no production solver or geometry import.
import {createHash} from 'node:crypto';
const id=label=>{const h=createHash('sha256').update('seam-oracle:'+label).digest('hex');return h.slice(0,8)+'-'+h.slice(8,12)+'-4'+h.slice(13,16)+'-8'+h.slice(17,20)+'-'+h.slice(20,32);};
const sub=(a,b)=>a.map((v,i)=>v-b[i]),dot=(a,b)=>a.reduce((s,v,i)=>s+v*b[i],0),distance=(a,b)=>Math.hypot(...sub(a,b)),cross=(a,b)=>a[0]*b[1]-a[1]*b[0];
const xyz=v=>[v.xMm,v.yMm,v.zMm];
function input(name,vertices,faces){return {schemaVersion:2,id:id(name+':project'),name,unit:'mm',revision:0,createdAt:'2026-10-20T00:00:00.000Z',updatedAt:'2026-10-20T00:00:00.000Z',pieces:[],defaultAllowanceMm:0,surface:{id:id(name+':surface'),source:'obj',topologyVersion:1,vertices,faces},markings:[]};}
function boundaryLoops(triangles){
 const counts=new Map(),oriented=[];for(const t of triangles)for(let i=0;i<3;i++){const a=t.vertices[i],b=t.vertices[(i+1)%3],key=[a,b].sort().join(':');counts.set(key,(counts.get(key)??0)+1);oriented.push([a,b,key]);}
 const outgoing=new Map(oriented.filter(([, ,key])=>counts.get(key)===1).map(([a,b])=>[a,b])),loops=[];
 while(outgoing.size){const start=outgoing.keys().next().value,loop=[];let current=start;do{if(!outgoing.has(current))throw Error('Invalid analytic boundary');loop.push(current);const next=outgoing.get(current);outgoing.delete(current);current=next;}while(current!==start);loops.push(loop);}return loops;
}
function candidateFor(project,domains,{reverse=false}={}){
 const sourceVertices=new Map(project.surface.vertices.map(v=>[v.id,xyz(v)])),sourceFaces=new Map(project.surface.faces.map(f=>[f.id,f])),pieces=[],bindings=[];
 for(const [index,domain] of domains.entries()){
  const pieceId=id(project.name+':piece:'+index),points=new Map(),triangles=[];
  for(const item of domain.triangles){const face=sourceFaces.get(item.faceId),vertices=reverse?[...item.vertices].reverse():item.vertices;for(const v of vertices)points.set(v.id,{id:v.id,xMm:v.uv[0],yMm:v.uv[1]});triangles.push({faceId:face.id,vertices:vertices.map(v=>v.id),barycentric:vertices.map(v=>face.vertices.map(vertexId=>vertexId===v.sourceId?1:0))});}
  const loops=boundaryLoops(triangles),signedArea=ring=>ring.reduce((sum,a,i)=>{const b=points.get(ring[(i+1)%ring.length]),p=points.get(a);return sum+p.xMm*b.yMm-p.yMm*b.xMm;},0)/2;loops.sort((a,b)=>Math.abs(signedArea(b))-Math.abs(signedArea(a)));
  const point=(vertexId,i)=>{const p=points.get(vertexId);return {id:id(pieceId+':node:'+vertexId+':'+i),xMm:p.xMm,yMm:p.yMm};};
  const piece={id:pieceId,name:domain.name??'Panel '+index,nodes:loops[0].map(point),holes:loops.slice(1).map(r=>r.map(point)),closed:true,allowanceMm:0,cutQty:1,mirror:false,material:'Fur',furRad:0,color:index?'#6655aa':'#cc9955'};
  const errors=[];for(const t of triangles){const face=sourceFaces.get(t.faceId),world=t.barycentric.map(w=>w.map((_,axis)=>w.reduce((sum,n,i)=>sum+n*sourceVertices.get(face.vertices[i])[axis],0))),uv=t.vertices.map(v=>{const p=points.get(v);return [p.xMm,p.yMm];}),a=sub(world[1],world[0]),b=sub(world[2],world[0]),physicalArea=Math.hypot(a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0])/2,flatArea=Math.abs(cross(sub(uv[1],uv[0]),sub(uv[2],uv[0])))/2;errors.push({areaError:Math.abs(flatArea/physicalArea-1),edgeError:Math.max(...[0,1,2].map(i=>Math.abs(distance(uv[i],uv[(i+1)%3])/distance(world[i],world[(i+1)%3])-1)))});}
  const areaError=Math.max(...errors.map(e=>e.areaError)),edgeError=Math.max(...errors.map(e=>e.edgeError)),report={faceIds:domain.triangles.map(t=>t.faceId),uv:[...points.values()].map(p=>({vertexId:p.id,xMm:p.xMm,yMm:p.yMm})),boundary:loops[0],boundaryToleranceMm:0,areaErrorMax:areaError,edgeErrorMax:edgeError,distortionMean:Math.max(areaError,edgeError),distortionP95:Math.max(areaError,edgeError),distortionMax:Math.max(areaError,edgeError),status:'acceptable'};
  pieces.push(piece);bindings.push({pieceId,surfaceId:project.surface.id,topologyVersion:1,geometryHash:'0'.repeat(64),surfaceHash:'0'.repeat(64),trim:{vertices:[...points.values()],triangles,boundary:loops[0],holes:loops.slice(1)},report});
 }
 return {run:{sourceHash:'0'.repeat(64),algorithm:'lscm-arap-1',pieces,bindings,accepted:false},markings:[]};
}
function grid(name,xs,ys,world,owner,flat,{reverse=false}={}){
 const vertices=[],faces=[],cellByFace=new Map(),vertex=(x,y)=>id(name+':v:'+x+':'+y);
 for(let y=0;y<ys.length;y++)for(let x=0;x<xs.length;x++){const p=world(xs[x],ys[y]);vertices.push({id:vertex(x,y),xMm:p[0],yMm:p[1],zMm:p[2]});}
 for(let y=0;y<ys.length-1;y++)for(let x=0;x<xs.length-1;x++)for(const [n,indices] of [[[x,y],[x+1,y],[x+1,y+1]],[[x,y],[x+1,y+1],[x,y+1]]].entries()){const face={id:id(name+':f:'+x+':'+y+':'+n),vertices:indices.map(([x,y])=>vertex(x,y)),region:'panel'};faces.push(face);cellByFace.set(face.id,{x,y,indices});}
 const project=input(name,vertices,faces),groups=new Map();
 for(const face of faces){const cell=cellByFace.get(face.id),group=owner(cell.x,cell.y),domain=groups.get(group)??{name:String(group),triangles:[]};domain.triangles.push({faceId:face.id,vertices:cell.indices.map(([x,y])=>({id:vertex(x,y),sourceId:vertex(x,y),uv:flat(xs[x],ys[y],group)}))});groups.set(group,domain);}
 return {input:project,candidate:candidateFor(project,[...groups.values()],{reverse})};
}
function unfoldStrip(faces,positions){
 const uv=new Map(),pending=[...faces];
 while(pending.length){let changed=false;for(let i=pending.length-1;i>=0;i--){const face=pending[i],known=face.vertices.filter(v=>uv.has(v));if(!uv.size){const [a,b,c]=face.vertices,ab=distance(positions.get(a),positions.get(b)),ac=distance(positions.get(a),positions.get(c)),bc=distance(positions.get(b),positions.get(c)),x=(ac*ac+ab*ab-bc*bc)/(2*ab);uv.set(a,[0,0]);uv.set(b,[ab,0]);uv.set(c,[x,Math.sqrt(Math.max(0,ac*ac-x*x))]);}
   else if(known.length===2){const a=known[0],b=known[1],c=face.vertices.find(v=>!uv.has(v)),pa=uv.get(a),pb=uv.get(b),ab=distance(pa,pb),ac=distance(positions.get(a),positions.get(c)),bc=distance(positions.get(b),positions.get(c)),x=(ac*ac+ab*ab-bc*bc)/(2*ab),y=Math.sqrt(Math.max(0,ac*ac-x*x)),axis=sub(pb,pa).map(v=>v/ab),candidate=sign=>[pa[0]+axis[0]*x-sign*axis[1]*y,pa[1]+axis[1]*x+sign*axis[0]*y];let p=candidate(1);const triangle=face.vertices.map(v=>v===c?p:uv.get(v));if(cross(sub(triangle[1],triangle[0]),sub(triangle[2],triangle[0]))<0)p=candidate(-1);uv.set(c,p);}
   else if(known.length<3)continue;pending.splice(i,1);changed=true;}
  if(!changed)throw Error('Analytic strip must be a triangle dual tree');
 }
 return uv;
}
function curvedNeighbors(){
 const name='curved-neighbor-strips',xs=Array.from({length:7},(_,i)=>-.3+i*.1),ys=[-.12,0,.12],value=grid(name,xs,ys,(u,v)=>[120*Math.cos(v)*Math.cos(u),120*Math.cos(v)*Math.sin(u),120*Math.sin(v)],(_,y)=>y,(u,v)=>[u*120,v*120]);
 const positions=new Map(value.input.surface.vertices.map(v=>[v.id,xyz(v)])),domains=[0,1].map(y=>{const faces=value.input.surface.faces.filter((_,i)=>Math.floor(i/12)===y),uv=unfoldStrip(faces,positions);return {name:'Curved strip '+y,triangles:faces.map(face=>({faceId:face.id,vertices:face.vertices.map(sourceId=>({id:sourceId,sourceId,uv:uv.get(sourceId)}))}))};});value.candidate=candidateFor(value.input,domains);return value;
}
function coneDart(mismatch=false){
 const name=mismatch?'cone-dart-mismatch':'cone-dart',radius=100,height=50,slant=Math.hypot(radius,height),angle=Math.acos(height*height/(radius*radius+height*height)),center=id(name+':tip'),outer=Array.from({length:4},(_,i)=>id(name+':outer:'+i)),vertices=[{id:center,xMm:0,yMm:0,zMm:height},...outer.map((vertexId,i)=>({id:vertexId,xMm:radius*Math.cos(i*Math.PI/2),yMm:radius*Math.sin(i*Math.PI/2),zMm:0}))],faces=outer.map((vertexId,i)=>({id:id(name+':face:'+i),vertices:[center,vertexId,outer[(i+1)%4]],region:'cone'})),project=input(name,vertices,faces),seamVertex=i=>({id:i===4?id(name+':duplicate-seam'):outer[i],sourceId:outer[i%4],uv:[slant*Math.cos(i*angle)*(mismatch&&i===4?1.02:1),slant*Math.sin(i*angle)*(mismatch&&i===4?1.02:1)]});
 return {input:project,candidate:candidateFor(project,[{name:'Dart panel',triangles:faces.map((face,i)=>({faceId:face.id,vertices:[{id:center,sourceId:center,uv:[0,0]},seamVertex(i),seamVertex(i+1)]}))}])};
}
export function seamCorrespondenceCases(){
 const cases=[];
 for(const scale of [.001,1,1000]){const r=100*scale,step=.1,chord=2*r*Math.sin(step/2),xs=Array.from({length:9},(_,i)=>i*step),ys=[0,30*scale,60*scale],name='cylinder-mm-scale-'+String(scale).replace('.','-');cases.push({name,...grid(name,xs,ys,(theta,z)=>[r*Math.cos(theta),r*Math.sin(theta),z],(_,y)=>y,(theta,z)=>[theta/step*chord,z]),expect:{passed:true,sharedChainsAtLeast:1,isometric:true}});}
 cases.push({name:'curved-neighbor-strips',...curvedNeighbors(),expect:{passed:true,sharedChainsAtLeast:1,isometric:true}});
 for(const reverse of [false,true]){const name=reverse?'hole-reversed':'hole';cases.push({name,...grid(name,[0,25,50,75,100],[0,25,50,75,100],(x,y)=>[x,y,0],(x,y)=>x>=1&&x<=2&&y>=1&&y<=2?'inset':'ring',(x,y)=>[x,y],{reverse}),expect:{passed:true,sharedChainsAtLeast:1,isometric:true,hole:true}});}
 cases.push({name:'cone-dart',...coneDart(),expect:{passed:true,sharedChainsAtLeast:1,isometric:true,selfSeam:true}});
 cases.push({name:'cone-dart-mismatch',...coneDart(true),expect:{passed:false,localMismatch:true}});
 const cancellation=grid('local-errors-cancel',[0,50,100],[0,50,100],(x,y)=>[x,y,0],x=>x,(x,y,group)=>[x,y+(group&&y===50?2.5:0)]);cases.push({name:'local-errors-cancel',...cancellation,expect:{passed:false,localMismatch:true,totalLengthMatches:true}});
 for(const step of [.00002,.000005]){const name='micro-edge-'+String(step).replace('.','-'),value=grid(name,[0,50,100],[0,step,2*step],(x,y)=>[x,y,0],x=>x,(x,y,group)=>[x,y+(group&&y===step?step*.05:0)]);cases.push({name,...value,expect:{passed:false,localMismatch:true,totalLengthMatches:true,microEdgeMm:step}});}
 return cases;
}
