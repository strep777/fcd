import {expect,it} from 'vitest';
import {randomUUID} from 'node:crypto';
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import type {Binding,Surface,SurfaceReport,SurfaceRun,Piece} from '../../packages/schema/index';
import type {MaterialFace} from '../../packages/surface/design-cuts';
import {weldClosedTrimDarts} from '../../apps/desktop/main/trim-weld';
import {restoreDesignBindings} from '../../apps/desktop/main/design-cuts';
import {project} from '../fixtures';

function fixture(opening=0){
 const source:Surface={id:'surface',source:'obj',topologyVersion:1,vertices:[{id:'a',xMm:0,yMm:0,zMm:0},{id:'b',xMm:10,yMm:0,zMm:0},{id:'c',xMm:10,yMm:10,zMm:0},{id:'d',xMm:0,yMm:10,zMm:0},{id:'o',xMm:5,yMm:5,zMm:0}],faces:[['a','b','o'],['b','c','o'],['c','d','o'],['d','a','o']].map((vertices,i)=>({id:'face-'+i,vertices:vertices as [string,string,string],region:'body'}))};
 // Four non-overlapping triangles cover a square. A radial slit from a to o
 // duplicates only its boundary station; all triangles retain the same tip o.
 const trim:NonNullable<Binding['trim']>={vertices:[...source.vertices.map(v=>({id:v.id,xMm:v.xMm,yMm:v.yMm})),{id:'duplicate',xMm:opening,yMm:0}],triangles:source.faces.map((f,i)=>({faceId:f.id,vertices:(i===3?['d','duplicate','o']:[...f.vertices]) as [string,string,string],barycentric:[[1,0,0],[0,1,0],[0,0,1]]})),boundary:['a','b','c','d','duplicate','o'],holes:[]};
 return{source,trim};
}
it('welds a closed trial slit while repeated shared triangle stations terminate and preserve correspondence',()=>{
 const {source,trim}=fixture();weldClosedTrimDarts(trim,source);
 expect(trim.vertices.map(v=>v.id)).toEqual(['a','b','c','d','o']);
 expect(trim.triangles.map(t=>t.vertices)).toEqual(source.faces.map(f=>f.vertices));
 expect(new Set(trim.triangles.map(t=>[...t.vertices].sort().join(':'))).size).toBe(4);
 expect(new Set(trim.triangles.map(t=>t.faceId)).size).toBe(source.faces.length);
 const uv=new Map(trim.vertices.map(v=>[v.id,v])),vertices=new Map(source.vertices.map(v=>[v.id,v])),faces=new Map(source.faces.map(f=>[f.id,f])),edges=new Map<string,string[]>();let coveredArea=0;
 for(const t of trim.triangles){
  const [a,b,c]=t.vertices.map(id=>uv.get(id)!),area=((b.xMm-a.xMm)*(c.yMm-a.yMm)-(b.yMm-a.yMm)*(c.xMm-a.xMm))/2;expect(area).toBe(25);coveredArea+=area;
  t.vertices.forEach((id,i)=>{const q=uv.get(id)!,w=t.barycentric[i],face=faces.get(t.faceId)!;expect([q.xMm,q.yMm]).toEqual(['xMm','yMm'].map(axis=>w.reduce((sum,weight,k)=>sum+weight*vertices.get(face.vertices[k])![axis as 'xMm'|'yMm'],0)));const next=t.vertices[(i+1)%3],key=[id,next].sort().join(':'),directions=edges.get(key)??[];directions.push(id+':'+next);edges.set(key,directions);});
 }
 expect(coveredArea).toBe(100);expect([...edges.values()].filter(rows=>rows.length===1)).toHaveLength(4);expect([...edges.values()].filter(rows=>rows.length===2)).toHaveLength(4);
 expect([...edges.values()].every(rows=>rows.length<=2&&(rows.length===1||rows[0]!==rows[1]))).toBe(true);
 expect(trim.vertices.length-edges.size+trim.triangles.length).toBe(1);
 // The caller subsequently rebuilds the exported outline; the weld itself
 // must keep every existing boundary reference resolved to its new identity.
 expect(trim.boundary).toEqual(['a','b','c','d','a','o']);expect(trim.boundary.every(id=>uv.has(id))).toBe(true);
 const once=structuredClone(trim);weldClosedTrimDarts(trim,source);expect(trim).toEqual(once);
});
it('retains a genuine open dart even when its two sides share the same source station',()=>{
 const {source,trim}=fixture(2),before=structuredClone(trim);weldClosedTrimDarts(trim,source);expect(trim).toEqual(before);
});
it('does not weld touching UV stations that refer to different material positions',()=>{
 const {source,trim}=fixture();trim.triangles[3].barycentric[1]=[.5,.5,0];
 const before=structuredClone(trim);weldClosedTrimDarts(trim,source);expect(trim).toEqual(before);
});

type LockedFixture=ReturnType<typeof fixture>&{area:number;outer:string[]};
const output=resolve('test-results/closed-trim-user-lock-regression',process.env.FPCAD_DART_RUN??new Date().toISOString().replace(/\D/g,'')),key=(a:string,b:string)=>[a,b].sort().join(':');
function lockedFixture():LockedFixture{const f=fixture();f.source.cutConstraints=[{a:'a',b:'o',locked:true}];return{...f,area:100,outer:['a','b','c','d']};}
function midpointFixture(t:number):LockedFixture{
 const f=lockedFixture(),a:[number,number,number]=[1,0,0],b:[number,number,number]=[0,1,0],c:[number,number,number]=[0,0,1],left:[number,number,number]=[1-t,0,t],right:[number,number,number]=[0,1-t,t];f.trim.vertices.push({id:'mid',xMm:5*t,yMm:5*t},{id:'duplicate-mid',xMm:5*t,yMm:5*t});
 f.trim.triangles=[{faceId:'face-0',vertices:['a','b','mid'],barycentric:[a,b,left]},{faceId:'face-0',vertices:['b','o','mid'],barycentric:[b,c,left]},f.trim.triangles[1],f.trim.triangles[2],{faceId:'face-3',vertices:['d','duplicate','duplicate-mid'],barycentric:[a,b,right]},{faceId:'face-3',vertices:['d','duplicate-mid','o'],barycentric:[a,right,c]}];f.trim.boundary=['a','b','c','d','duplicate','duplicate-mid','o','mid'];return f;
}
function asymmetricMidpointFixture(t:number):LockedFixture{
 const f=midpointFixture(t);f.trim.vertices=f.trim.vertices.filter(v=>v.id!=='duplicate-mid');f.trim.triangles=f.trim.triangles.slice(0,4);f.trim.triangles.push({faceId:'face-3',vertices:['d','duplicate','o'],barycentric:[[1,0,0],[0,1,0],[0,0,1]]});f.trim.boundary=['a','b','c','d','duplicate','o','mid'];return f;
}
function segmentedFixture(reverse=false):LockedFixture{
 const f=lockedFixture();f.source.vertices.push({id:'m',xMm:2.5,yMm:2.5,zMm:0});f.source.faces=[['a','b','m'],['b','o','m'],['b','c','o'],['c','d','o'],['d','a','m'],['d','m','o']].map((vertices,i)=>({id:'split-face-'+i,region:'body',vertices:vertices as [string,string,string]}));f.source.cutConstraints=[{a:'a',b:'m',locked:true},{a:'m',b:'o',locked:true}].map(e=>reverse?{...e,a:e.b,b:e.a}:e);
 f.trim.vertices=[...f.source.vertices.map(v=>({id:v.id,xMm:v.xMm,yMm:v.yMm})),{id:'duplicate',xMm:0,yMm:0},{id:'duplicate-mid',xMm:2.5,yMm:2.5}];f.trim.triangles=f.source.faces.map((face,i)=>({faceId:face.id,vertices:face.vertices.map(id=>i>=4?(id==='a'?'duplicate':id==='m'?'duplicate-mid':id):id) as [string,string,string],barycentric:[[1,0,0],[0,1,0],[0,0,1]]}));f.trim.boundary=['a','b','c','d','duplicate','duplicate-mid','o','m'];return f;
}
function nearbyTrialFixture():LockedFixture{
 const f=lockedFixture();f.source.vertices.push({id:'e',xMm:20,yMm:0,zMm:0},{id:'f',xMm:20,yMm:10,zMm:0},{id:'p',xMm:15,yMm:5,zMm:0});f.source.faces.push(...[['b','e','p'],['e','f','p'],['f','c','p'],['c','b','p']].map((vertices,i)=>({id:'right-face-'+i,region:'body',vertices:vertices as [string,string,string]})));f.trim.vertices=[...f.source.vertices.map(v=>({id:v.id,xMm:v.xMm,yMm:v.yMm})),{id:'duplicate',xMm:0,yMm:0},{id:'trial-duplicate',xMm:20,yMm:10}];f.trim.triangles.push(...f.source.faces.slice(4).map((face,i)=>({faceId:face.id,vertices:face.vertices.map(id=>i===2&&id==='f'?'trial-duplicate':id) as [string,string,string],barycentric:[[1,0,0],[0,1,0],[0,0,1]] as [[number,number,number],[number,number,number],[number,number,number]]})));f.trim.boundary=['a','b','e','f','p','trial-duplicate','c','d','duplicate','o'];f.area=200;f.outer=['a','b','e','f','c','d'];return f;
}
function componentCount<T>(ids:Iterable<T>,neighbors:Map<T,Set<T>>){const seen=new Set<T>();let count=0;for(const start of ids)if(!seen.has(start)){count++;const todo=[start];while(todo.length){const id=todo.pop()!;if(seen.has(id))continue;seen.add(id);todo.push(...neighbors.get(id)??[]);}}return count;}
function protectedGeometry(f:LockedFixture,trim:NonNullable<Binding['trim']>){
 const faces=new Map(f.source.faces.map(face=>[face.id,face])),vertices=new Map(f.source.vertices.map(v=>[v.id,v])),uv=new Map(trim.vertices.map(v=>[v.id,v])),counts=new Map<string,number>(),edges=new Map<string,{a:string;b:string;owners:number[]}>(),vertexTriangles=new Map<string,Set<number>>();for(const [index,t]of trim.triangles.entries()){for(const id of t.vertices)vertexTriangles.set(id,new Set([...vertexTriangles.get(id)??[],index]));for(let i=0;i<3;i++){const a=t.vertices[i],b=t.vertices[(i+1)%3],k=key(a,b),row=edges.get(k)??{a,b,owners:[]};row.owners.push(index);edges.set(k,row);counts.set(k,(counts.get(k)??0)+1);}}const rows=[];
 // Source cut sides must stay separate vertex fans as well as separate edge
 // keys. A partial endpoint weld can otherwise create a degree4 junction
 // while every subdivided locked side still has edge-use count1.
 const boundaryLinks=new Map<string,Set<string>>(),faceLinks=new Map<number,Set<number>>(trim.triangles.map((_,i)=>[i,new Set()]));for(const e of edges.values()){expect(e.owners.length).toBeLessThanOrEqual(2);if(e.owners.length===1){boundaryLinks.set(e.a,new Set([...boundaryLinks.get(e.a)??[],e.b]));boundaryLinks.set(e.b,new Set([...boundaryLinks.get(e.b)??[],e.a]));}else{faceLinks.get(e.owners[0])!.add(e.owners[1]);faceLinks.get(e.owners[1])!.add(e.owners[0]);}}
 const boundaryDegrees=Object.fromEntries([...boundaryLinks].map(([id,links])=>[id,links.size]));expect([...boundaryLinks.values()].every(links=>links.size===2),'Welding must not turn the simple boundary into a branching user-cut junction').toBe(true);expect(componentCount(boundaryLinks.keys(),boundaryLinks),'The real sheet boundary remains one closed loop').toBe(1);expect(componentCount(faceLinks.keys(),faceLinks),'Every physical triangle remains in the same connected sheet').toBe(1);
 const vertexFanComponents:Record<string,number>={};for(const [id,incident]of vertexTriangles){const fan=new Map<number,Set<number>>([...incident].map(i=>[i,new Set()]));for(const e of edges.values())if((e.a===id||e.b===id)&&e.owners.length===2){fan.get(e.owners[0])!.add(e.owners[1]);fan.get(e.owners[1])!.add(e.owners[0]);}vertexFanComponents[id]=componentCount(incident,fan);expect(vertexFanComponents[id],'A user-cut vertex must not acquire disconnected incident triangle fans: '+id).toBe(1);}
 for(const lock of f.source.cutConstraints!.filter(e=>e.locked)){const a=vertices.get(lock.a)!,b=vertices.get(lock.b)!,length=Math.hypot(a.xMm-b.xMm,a.yMm-b.yMm,a.zMm-b.zMm),sides=[];for(const t of trim.triangles){const face=faces.get(t.faceId)!;if(!face.vertices.includes(lock.a)||!face.vertices.includes(lock.b))continue;const other=face.vertices.findIndex(id=>id!==lock.a&&id!==lock.b),end=face.vertices.indexOf(lock.b);for(let i=0;i<3;i++){const j=(i+1)%3;if(t.barycentric[i][other]!==0||t.barycentric[j][other]!==0)continue;const t0=t.barycentric[i][end],t1=t.barycentric[j][end];if(t0===t1)continue;sides.push({faceId:t.faceId,ids:[t.vertices[i],t.vertices[j]],useCount:counts.get(key(t.vertices[i],t.vertices[j])),lengthMm:length*Math.abs(t1-t0)});}}expect(sides.length).toBeGreaterThanOrEqual(2);expect(sides.every(e=>e.useCount===1),'Actual locked trim sides remain exposed, not an interior edge hidden behind cutEdges metadata').toBe(true);expect(new Set(sides.map(e=>key(...e.ids as [string,string]))).size).toBe(sides.length);expect(sides.reduce((sum,e)=>sum+e.lengthMm,0)).toBeCloseTo(2*length,12);rows.push({lock,lengthMm:length,sides});}
 const coverage=new Map<string,number>();let area=0;for(const t of trim.triangles){const face=faces.get(t.faceId)!,q=t.vertices.map(id=>uv.get(id)!);expect(q.every(Boolean)).toBe(true);const flat=((q[1].xMm-q[0].xMm)*(q[2].yMm-q[0].yMm)-(q[1].yMm-q[0].yMm)*(q[2].xMm-q[0].xMm))/2;expect(flat).toBeGreaterThan(0);area+=flat;const [a,b,c]=t.barycentric,ratio=(b[1]-a[1])*(c[2]-a[2])-(b[2]-a[2])*(c[1]-a[1]);coverage.set(t.faceId,(coverage.get(t.faceId)??0)+ratio);t.vertices.forEach((id,i)=>{const p=uv.get(id)!;expect([p.xMm,p.yMm]).toEqual((['xMm','yMm'] as const).map(axis=>t.barycentric[i].reduce((sum,w,j)=>sum+w*vertices.get(face.vertices[j])![axis],0)));});}expect(area).toBe(f.area);for(const face of f.source.faces)expect(coverage.get(face.id)).toBeCloseTo(1,12);expect(trim.boundary.every(id=>uv.has(id))).toBe(true);return{rows,areaMm2:area,triangles:trim.triangles.length,boundaryDegrees,boundaryComponents:componentCount(boundaryLinks.keys(),boundaryLinks),vertexFanComponents};
}
async function checkedWeld(f:LockedFixture,name:string){
 const before=structuredClone(f),source=JSON.stringify(f.source),geometryBefore=protectedGeometry(f,f.trim);weldClosedTrimDarts(f.trim,f.source);expect(JSON.stringify(f.source)).toBe(source);expect(f.trim.triangles.length).toBe(before.trim.triangles.length);expect(f.trim.triangles.map(t=>({faceId:t.faceId,barycentric:t.barycentric}))).toEqual(before.trim.triangles.map(t=>({faceId:t.faceId,barycentric:t.barycentric})));const geometryAfter=protectedGeometry(f,f.trim),once=structuredClone(f.trim);weldClosedTrimDarts(f.trim,f.source);expect(f.trim).toEqual(once);await mkdir(output,{recursive:true});await writeFile(resolve(output,name+'.json'),JSON.stringify({before,after:f,geometryBefore,geometryAfter},null,2));return f;
}

it.each(['forward','reversed constraint','reversed storage'] as const)('a same-binding zero-opening locked slit keeps both real triangle boundary identities (%s)',async variant=>{
 const f=lockedFixture();if(variant==='reversed constraint')f.source.cutConstraints=[{a:'o',b:'a',locked:true}];if(variant==='reversed storage'){f.source.faces.reverse();f.trim.triangles.reverse();}const before=structuredClone(f.trim);await checkedWeld(f,'simple-'+variant.replaceAll(' ','-'));expect(f.trim).toEqual(before);
});
it.each([false,true])('every segment of a real two-edge source lock keeps both exposed sides (reversed=%s)',async reverse=>{await checkedWeld(segmentedFixture(reverse),'segmented-'+reverse);});
it.each([.25,.5])('exact barycentric stations inside a protected source edge retain their complete two-sided slit (t=%s)',async t=>{const f=await checkedWeld(midpointFixture(t),'barycentric-'+String(t).replace('.','-'));expect(protectedGeometry(f,f.trim).rows[0].sides).toHaveLength(4);});
it.each([.25,.5])('unequal station counts on the two real locked sides preserve a simple loop and each vertex fan (t=%s)',async t=>{const f=await checkedWeld(asymmetricMidpointFixture(t),'asymmetric-barycentric-'+String(t).replace('.','-'));expect(protectedGeometry(f,f.trim).rows[0].sides).toHaveLength(3);});
it('protecting one slit still permits a nearby unrelated zero-opening trial slit to weld in the same connected sheet',async()=>{
 const f=await checkedWeld(nearbyTrialFixture(),'nearby-unlocked-trial');expect(f.trim.vertices.some(v=>v.id==='trial-duplicate')).toBe(false);expect(f.trim.triangles.find(t=>t.faceId==='right-face-2')!.vertices).toEqual(['f','c','p']);expect(f.trim.vertices.some(v=>v.id==='duplicate')).toBe(true);
});
it.each(['simple slit outline','simple outer outline','barycentric quarter','asymmetric quarter','asymmetric half','segmented lock','nearby trial'] as const)('actual binding restoration preserves real locked trim sides together with run.cutEdges (%s)',async variant=>{
 const f=variant==='barycentric quarter'?midpointFixture(.25):variant==='asymmetric quarter'?asymmetricMidpointFixture(.25):variant==='asymmetric half'?asymmetricMidpointFixture(.5):variant==='segmented lock'?segmentedFixture():variant==='nearby trial'?nearbyTrialFixture():lockedFixture(),before=structuredClone(f),workingFaces=f.trim.triangles.map(t=>({id:randomUUID(),region:'body',vertices:[...t.vertices] as [string,string,string]})),workingSurface:Surface={...structuredClone(f.source),vertices:f.trim.vertices.map(v=>({...v,zMm:0})),faces:workingFaces},provenance=new Map<string,MaterialFace>(workingFaces.map((face,i)=>[face.id,{faceId:f.trim.triangles[i].faceId,barycentric:f.trim.triangles[i].barycentric,color:'#315579'}])),working={surface:workingSurface,provenance} as Parameters<typeof restoreDesignBindings>[1],uv=new Map(f.trim.vertices.map(v=>[v.id,v])),order=variant==='simple slit outline'?f.trim.boundary:f.outer,piece:Piece={id:randomUUID(),name:variant,nodes:order.map(id=>({id:randomUUID(),xMm:uv.get(id)!.xMm,yMm:uv.get(id)!.yMm})),closed:true,allowanceMm:0,cutQty:1,mirror:false,material:'Fabric',furRad:0,color:'#315579'},report:SurfaceReport={faceIds:workingFaces.map(f=>f.id),uv:f.trim.vertices.map(v=>({vertexId:v.id,xMm:v.xMm,yMm:v.yMm})),boundary:[...f.trim.boundary],holes:[],areaErrorMax:0,edgeErrorMax:0,distortionMean:0,distortionP95:0,distortionMax:0,status:'acceptable'},run:SurfaceRun={sourceHash:'0'.repeat(64),algorithm:'lscm-arap-seamed-1',pieces:[piece],bindings:[{pieceId:piece.id,surfaceId:f.source.id,topologyVersion:1,geometryHash:'0'.repeat(64),surfaceHash:'0'.repeat(64),report}],accepted:false},p={...project(),pieces:[],surface:structuredClone(f.source)},projectBefore=structuredClone(p),restored=restoreDesignBindings(p,working,run),actual=protectedGeometry(f,restored.bindings[0].trim!);
 expect(restored.cutEdges).toEqual(f.source.cutConstraints!.filter(e=>e.locked).map(e=>[e.a,e.b]));expect(restored.bindings).toHaveLength(1);expect(restored.bindings[0].trim!.triangles).toHaveLength(f.trim.triangles.length);expect(f).toEqual(before);expect(p).toEqual(projectBefore);if(variant==='nearby trial')expect(restored.bindings[0].trim!.vertices.some(v=>v.id==='trial-duplicate')).toBe(false);await mkdir(output,{recursive:true});await writeFile(resolve(output,'restored-'+variant.replaceAll(' ','-')+'.json'),JSON.stringify({before,workingSurface,provenance:[...provenance],restored,actual},null,2));
});
