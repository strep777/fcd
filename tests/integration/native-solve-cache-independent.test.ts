import {expect,it} from 'vitest';
import {randomUUID} from 'node:crypto';
import {resolve} from 'node:path';
import type {Surface,SurfaceReport} from '../../packages/schema/index';
import {nativeSurfaceResponseSchema} from '../../packages/surface/native-report';
import {nativeSolveIdentity,restoreCachedReports} from '../../apps/desktop/main/native-solve-cache';
import {request} from '../../apps/desktop/main/worker';

type Input=Parameters<typeof nativeSolveIdentity>[0];
const worker=resolve('target/release/fpcad-worker.exe');
function annulus():Input{
 const vertices:Surface['vertices']=[],faces:Surface['faces']=[],ids:string[][]=[];
 for(let y=0;y<4;y++){ids[y]=[];for(let x=0;x<4;x++){const id=randomUUID();ids[y][x]=id;vertices.push({id,xMm:x*100,yMm:y*100,zMm:0});}}
 for(let y=0;y<3;y++)for(let x=0;x<3;x++){if(x===1&&y===1)continue;const [a,b,c,d]=[ids[y][x],ids[y][x+1],ids[y+1][x+1],ids[y+1][x]];for(const row of [[a,b,c],[a,c,d]])faces.push({id:randomUUID(),region:'cloth',vertices:row as [string,string,string]});}
 return{protocolVersion:1,operation:'surface.unwrap',mesh:{vertices,faces,repair_cuts:false,method:'lscm',iterations:100,initial_uv:vertices.map(v=>({vertexId:v.id,xMm:v.xMm,yMm:v.yMm}))}};
}
function cylinder():Input{
 const n=6,r=100,height=60,vertices:Surface['vertices']=[],faces:Surface['faces']=[],chord=2*r*Math.sin(.6/n/2);
 for(let y=0;y<2;y++)for(let i=0;i<=n;i++){const theta=-.3+.6*i/n;vertices.push({id:randomUUID(),xMm:r*Math.sin(theta),yMm:y*height,zMm:r*Math.cos(theta)});}
 for(let i=0;i<n;i++)for(const row of [[i,i+1,n+2+i],[i,n+2+i,n+1+i]])faces.push({id:randomUUID(),region:'cylinder',vertices:row.map(j=>vertices[j].id) as [string,string,string]});
 return{protocolVersion:1,operation:'surface.unwrap',mesh:{vertices,faces,repair_cuts:false,method:'arap-seamed',iterations:100,initial_uv:vertices.map((v,i)=>({vertexId:v.id,xMm:i%(n+1)*chord,yMm:i>n?height:0}))}};
}
function rename(input:Input){
 const copy=structuredClone(input),ids=new Map(copy.mesh.vertices.map(v=>[v.id,randomUUID()]));
 copy.mesh.vertices=copy.mesh.vertices.map(v=>({...v,id:ids.get(v.id)!}));copy.mesh.faces=copy.mesh.faces.map(f=>({...f,id:randomUUID(),region:'renamed:'+f.region,vertices:f.vertices.map(id=>ids.get(id)!) as [string,string,string]}));
 if(copy.mesh.initial_uv)copy.mesh.initial_uv=copy.mesh.initial_uv.map(p=>({...p,vertexId:ids.get(p.vertexId)!}));return copy;
}
async function native(input:Input){return nativeSurfaceResponseSchema.parse(await request(worker,input)).patches;}
function previous(input:Input){return{vertices:input.mesh.vertices.map(v=>v.id),faces:input.mesh.faces.map(f=>f.id)};}
function checkIds(patches:SurfaceReport[],input:Input){
 const vertices=new Set(input.mesh.vertices.map(v=>v.id)),faces=new Set(input.mesh.faces.map(f=>f.id));
 for(const p of patches){expect(p.faceIds.every(id=>faces.has(id))).toBe(true);expect(p.uv.every(v=>vertices.has(v.vertexId))).toBe(true);expect([p.boundary,...p.holes??[]].flat().every(id=>vertices.has(id))).toBe(true);expect((p.faceDistortion??[]).every(f=>faces.has(f.faceId))).toBe(true);}
}

it.each(['annulus','cylinder'] as const)('a real native %s is identical after ID/region renaming and seed reordering, including cached output identities',async kind=>{
 const a=kind==='annulus'?annulus():cylinder(),b=rename(a);b.mesh.initial_uv!.reverse();const before=structuredClone({a,b});expect(nativeSolveIdentity(a)).toBe(nativeSolveIdentity(b));
 const actualA=await native(a),actualB=await native(b),saved=structuredClone(actualA),restored=restoreCachedReports(actualA,previous(a),b.mesh);
 expect(restored).toEqual(actualB);checkIds(restored,b);expect(actualA).toEqual(saved);expect({a,b}).toEqual(before);expect(restored.flatMap(p=>p.faceIds)).toHaveLength(b.mesh.faces.length);
 for(const p of restored){expect(p.areaErrorMax).toBeLessThan(1e-8);expect(p.edgeErrorMax).toBeLessThan(1e-8);expect(p.distortionMax).toBeLessThan(1e-8);}
 if(kind==='annulus'){expect(restored).toHaveLength(1);expect(restored[0].holes).toHaveLength(1);expect(restored[0].boundary).toHaveLength(12);expect(restored[0].holes![0]).toHaveLength(4);}
 // A consumer editing returned UV/face/boundary/hole/distortion IDs cannot
 // poison the cached template for a later different ID namespace.
 restored[0].uv[0].xMm+=123;restored[0].faceIds.reverse();restored[0].boundary.reverse();restored[0].holes?.[0]?.reverse();if(restored[0].faceDistortion?.[0])restored[0].faceDistortion[0].distortion=999;
 expect(actualA).toEqual(saved);expect(restoreCachedReports(actualA,previous(a),b.mesh)).toEqual(actualB);
});

it('coincident coordinates with a different cut vertex fan never share a solve identity',()=>{
 const a=annulus(),b=structuredClone(a),original=b.mesh.vertices.find(v=>v.id===b.mesh.faces[0].vertices[0])!,copy={...original,id:randomUUID()};b.mesh.vertices.push(copy);b.mesh.faces[0].vertices[0]=copy.id;b.mesh.initial_uv!.push({vertexId:copy.id,xMm:copy.xMm,yMm:copy.yMm});
 const world=(input:Input)=>{const vertices=new Map(input.mesh.vertices.map(v=>[v.id,v]));return input.mesh.faces.map(f=>f.vertices.map(id=>{const v=vertices.get(id)!;return[v.xMm,v.yMm,v.zMm];}));};
 expect(world(b)).toEqual(world(a));expect(nativeSolveIdentity(b)).not.toBe(nativeSolveIdentity(a));
});

it.each(['seed','seed omitted','region boundary','face order','vertex order','method','iterations','repair cuts'] as const)('%s differences remain part of solve identity',change=>{
 const a=annulus(),b=structuredClone(a);
 if(change==='seed')b.mesh.initial_uv![0].xMm+=.000001;
 if(change==='seed omitted')delete b.mesh.initial_uv;
 if(change==='region boundary')b.mesh.faces[0].region='separate-material';
 if(change==='face order')b.mesh.faces.reverse();
 if(change==='vertex order')b.mesh.vertices.reverse();
 if(change==='method')b.mesh.method='arap';
 if(change==='iterations')b.mesh.iterations++;
 if(change==='repair cuts')b.mesh.repair_cuts=true;
 expect(nativeSolveIdentity(b)).not.toBe(nativeSolveIdentity(a));
});

it('region names can change only while their complete equality partition stays unchanged',()=>{
 const a=annulus();a.mesh.faces.forEach((f,i)=>f.region=i<8?'first':'second');const b=rename(a);expect(nativeSolveIdentity(a)).toBe(nativeSolveIdentity(b));b.mesh.faces[0].region='renamed:second';expect(nativeSolveIdentity(a)).not.toBe(nativeSolveIdentity(b));
});

it.each(['duplicate vertex ID','duplicate face ID','missing face vertex','missing seed row','duplicate seed row','unknown seed ID','nonfinite seed'] as const)('invalid %s cannot reuse a valid or differently named invalid namespace',kind=>{
 const good=annulus(),invalid=structuredClone(good);
 if(kind==='duplicate vertex ID')invalid.mesh.vertices[1].id=invalid.mesh.vertices[0].id;
 if(kind==='duplicate face ID')invalid.mesh.faces[1].id=invalid.mesh.faces[0].id;
 if(kind==='missing face vertex')invalid.mesh.faces[0].vertices[0]=randomUUID();
 if(kind==='missing seed row')invalid.mesh.initial_uv!.pop();
 if(kind==='duplicate seed row')invalid.mesh.initial_uv![1]=structuredClone(invalid.mesh.initial_uv![0]);
 if(kind==='unknown seed ID')invalid.mesh.initial_uv![0].vertexId=randomUUID();
 if(kind==='nonfinite seed')invalid.mesh.initial_uv![0].xMm=NaN;
 const differentlyNamed=structuredClone(invalid);differentlyNamed.mesh.faces.forEach(f=>f.id=randomUUID());
 expect(nativeSolveIdentity(invalid)).not.toBe(nativeSolveIdentity(good));expect(nativeSolveIdentity(invalid)).not.toBe(nativeSolveIdentity(differentlyNamed));
});

it('a real reflected-seed failure cannot reuse a valid result or mutate the cached template',async()=>{
 const good=cylinder(),bad=rename(good);bad.mesh.initial_uv!.forEach(v=>v.xMm=-v.xMm);const before=structuredClone({good,bad}),valid=await native(good),saved=structuredClone(valid);
 expect(nativeSolveIdentity(good)).not.toBe(nativeSolveIdentity(bad));await expect(native(bad)).rejects.toMatchObject({code:'UNWRAP_FLIPPED'});expect(valid).toEqual(saved);expect(await native(good)).toEqual(valid);expect({good,bad}).toEqual(before);
});
