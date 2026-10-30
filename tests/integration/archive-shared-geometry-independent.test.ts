import {expect,it} from 'vitest';
import {randomUUID,createHash} from 'node:crypto';
import {mkdtemp,readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {strToU8,unzipSync,zipSync} from 'fflate';
import UPNG from '@pdf-lib/upng';
import {pack,unpack,atomicWrite,readProject} from '../../apps/desktop/main/archive';
import {Repository,hash} from '../../apps/desktop/main/repository';
import {bindingIssues,pieceGeometryHash} from '../../apps/desktop/main/surface';
import {markingFingerprint} from '../../apps/desktop/main/marking-fingerprint';
import {workflowBytes,readWorkflow,cutBundle,readCutBundle} from '../../apps/desktop/main/workflow-exchange';
import {referenceFromPng} from '../../apps/desktop/main/references';
import {projectSchema,surfaceSchema,type Project,type Binding,type Marking,type Surface} from '../../packages/schema/index';
import {acceptedCutProject} from '../fixtures/accepted-cut';

// Independent synthetic physical fan. No private project or task artifact is
// required. Repeated owners intentionally have distinct JS object identities.
function sharedProject():Project{
 const p=acceptedCutProject(),piece=p.pieces[0],count=1024;
 piece.name='archive-geometry:'+'a'.repeat(64);piece.allowanceMm=2;piece.nodes=Array.from({length:count},(_,i)=>({id:randomUUID(),xMm:i===0?-5.5108101000737325e-15:100*Math.cos(Math.PI/2+i*2*Math.PI/count),yMm:100*Math.sin(Math.PI/2+i*2*Math.PI/count)}));
 const centre={id:randomUUID(),xMm:0,yMm:0,zMm:0},outer=piece.nodes.map(v=>({...v,zMm:0})),surface:Surface=surfaceSchema.parse({id:p.surface!.id,source:'obj',topologyVersion:1,vertices:[centre,...outer],faces:outer.map((v,i)=>({id:randomUUID(),region:'cloth',vertices:[centre.id,v.id,outer[(i+1)%count].id]})),cutConstraints:[{a:outer[0].id,b:outer[1].id,locked:true}]});
 const surfaceHash=hash(JSON.stringify(surface)),geometryHash=pieceGeometryHash(piece),binding:Binding={pieceId:piece.id,surfaceId:surface.id,topologyVersion:1,surfaceHash,geometryHash,materialResolved:true,report:{faceIds:surface.faces.map(f=>f.id),uv:surface.vertices.map(({id,xMm,yMm})=>({vertexId:id,xMm,yMm})),boundary:outer.map(v=>v.id),areaErrorMax:0,edgeErrorMax:0,distortionMean:0,distortionP95:0,distortionMax:0,status:'acceptable'},trim:{vertices:surface.vertices.map(({id,xMm,yMm})=>({id,xMm,yMm})),triangles:surface.faces.map(f=>({faceId:f.id,vertices:f.vertices,barycentric:[[1,0,0],[0,1,0],[0,0,1]]})),boundary:outer.map(v=>v.id),holes:[]}};
 const ring=piece.nodes.map(({xMm,yMm})=>({xMm,yMm})),shape={nodes:ring,origin:[0,0,0] as [number,number,number],axes:[[1,0,0],[0,1,0],[0,0,1]] as [[number,number,number],[number,number,number],[number,number,number]]};
 const paint:Marking={id:randomUUID(),name:'Unchanged locked source',source:'surface',color:'#2086ba',surfaceId:surface.id,topologyVersion:1,surfaceHash,sourceHash:hash(JSON.stringify(shape)),view:'front',offsetXmm:0,offsetYmm:0,locked:true,surfaceShape:shape,fragments:surface.faces.map(f=>({faceId:f.id,rings:[[[1,0,0],[0,1,0],[0,0,1]]]})),paths:[{pieceId:piece.id,geometryHash,rings:[ring]}]};
 const inference:Marking={...structuredClone(paint),id:randomUUID(),name:'Unreviewed inference remains unreviewed',source:'inferred',locked:false,surfaceShape:undefined,sourceHash:markingFingerprint(paint),inference:{algorithm:'exact-symmetry-x-1',sourceMarkingId:paint.id,sourceFingerprint:markingFingerprint(paint),distanceMm:200,planeXmm:0,reviewed:false}};
 p.surface=surface;p.bindings=[binding];p.markings=[paint,inference];p.previewMarkings=structuredClone(p.markings);p.surfaceRun={sourceHash:surfaceHash,algorithm:'lscm-cg-1',pieces:structuredClone(p.pieces),bindings:structuredClone(p.bindings),accepted:true};
 p.modelLibrary=[{id:surface.id,name:'Active original fan',surface:structuredClone(surface),pieces:structuredClone(p.pieces),bindings:structuredClone(p.bindings),markings:structuredClone(p.markings),seams:[]}];
 const inactive=structuredClone(p.modelLibrary[0]);inactive.id=randomUUID();inactive.surface.id=inactive.id;inactive.name='Inactive different geometry';inactive.surface.vertices[1].zMm=.125;for(const b of inactive.bindings!)b.surfaceId=inactive.id;for(const m of inactive.markings!)m.surfaceId=inactive.id;p.modelLibrary.push(inactive);
 p.cuttingLibrary=[{id:randomUUID(),name:'First exact saved fan',createdAt:p.createdAt,sourceRevision:0,surface:structuredClone(surface),run:structuredClone(p.surfaceRun),markings:structuredClone(p.markings),seams:[]}];
 const different=structuredClone(p.cuttingLibrary[0]);different.id=randomUUID();different.name='Different historical coordinates';different.run.pieces[0].nodes[0].xMm+=.125;different.run.bindings[0].geometryHash=pieceGeometryHash(different.run.pieces[0]);for(const m of different.markings)for(const path of m.paths)path.geometryHash=different.run.bindings[0].geometryHash;p.cuttingLibrary.push(different);p.activeCutId=p.cuttingLibrary[0].id;
 p.name='archive-geometry:'+'0'.repeat(64);p.workflow=[{key:'archive-geometry:user-key',title:'asset:still-user-text',notes:'archive-geometry:'+'b'.repeat(64),completed:false}];
 return projectSchema.parse(p);
}

// Reproduce the old inline schema-v2 wire layout independently of current pack.
// This deliberately has no shared-geometry extension or generic reference walk.
function legacyInline(project:Project){
 const {pieces,materials,surface,surfaceRun,bindings,maskSources,references,referenceRun,markings,seams,nesting,...meta}=project,files:Record<string,Uint8Array>={'project.json':strToU8(JSON.stringify(meta)),'patterns.json':strToU8(JSON.stringify({schemaVersion:2,pieces}))};
 for(const key of ['character','body','markings','seams','uv','materials','nesting','simulation'])files[key+'.json']=strToU8(JSON.stringify({schemaVersion:2,items:[]}));
 for(const[key,value]of Object.entries({materials:{schemaVersion:2,materials},body:{schemaVersion:2,surface,surfaceRun},uv:{schemaVersion:2,bindings},markings:{schemaVersion:2,maskSources,references,referenceRun,markings},seams:{schemaVersion:2,seams},nesting:{schemaVersion:2,nesting}}))files[key+'.json']=strToU8(JSON.stringify(value));
 const entries=Object.keys(files).sort((a,b)=>Buffer.compare(Buffer.from(a),Buffer.from(b))).map(path=>({path,size:files[path].length,sha256:hash(files[path])}));files['manifest.json']=strToU8(JSON.stringify({format:'fpcad',formatVersion:1,schemaVersion:2,migrationVersion:1,applicationVersion:'0.8.0',unit:'mm',createdAt:project.createdAt,updatedAt:project.updatedAt,projectId:project.id,contentHash:hash(JSON.stringify(entries)),files:entries}));return zipSync(files,{level:0});
}

it('repeated current/run/model/history geometry saves once without losing any owner, coordinate, approval or lock',()=>{
 const p=sharedProject(),before=structuredClone(p),packed=pack(p),restored=unpack(packed.bytes),inline=legacyInline(p);
 expect(restored).toEqual(p);expect(p).toEqual(before);expect(packed.bytes.length).toBeLessThan(inline.length*.75);expect(packed.bytes.length).toBeLessThan(200*1024*1024);
 expect(restored.surface!.vertices[1].xMm).toBe(-5.5108101000737325e-15);expect(restored.pieces[0].nodes[0].xMm).toBe(-5.5108101000737325e-15);expect(restored.markings![0].locked).toBe(true);expect(restored.markings![1].inference!.reviewed).toBe(false);expect(restored.surface!.cutConstraints).toEqual(p.surface!.cutConstraints);
 expect(restored.modelLibrary![1].surface.vertices[1].zMm).toBe(.125);expect(restored.modelLibrary![0].surface.vertices[1].zMm).toBe(0);expect(restored.cuttingLibrary![1].run.pieces[0].nodes[0].xMm).toBe(p.cuttingLibrary![1].run.pieces[0].nodes[0].xMm);
 expect(pack(restored).contentHash).toBe(packed.contentHash);expect(Object.keys(unzipSync(pack(acceptedCutProject()).bytes))).toHaveLength(11);
});

it('reopened shared values are independent across current state, pending run, inactive model and immutable history',()=>{
 const p=sharedProject(),before=structuredClone(p),q=unpack(pack(p).bytes),history=structuredClone(q.cuttingLibrary),models=structuredClone(q.modelLibrary),run=structuredClone(q.surfaceRun);q.pieces[0].nodes[0].xMm+=7;q.bindings![0].trim!.vertices[0].xMm+=11;q.markings![0].fragments[0].rings[0][0][0]=.5;
 expect(q.cuttingLibrary).toEqual(history);expect(q.modelLibrary).toEqual(models);expect(q.surfaceRun).toEqual(run);expect(q.previewMarkings).toEqual(p.previewMarkings);expect(p).toEqual(before);
});

it('legacy inline-v2 geometry reads losslessly and resaves without interpreting user strings as references',()=>{
 const p=sharedProject(),bytes=legacyInline(p),digest=createHash('sha256').update(bytes).digest('hex'),q=unpack(bytes);expect(q).toEqual(p);expect(createHash('sha256').update(bytes).digest('hex')).toBe(digest);expect(unpack(pack(q).bytes)).toEqual(p);expect(q.name).toBe(p.name);expect(q.workflow).toEqual(p.workflow);expect(q.pieces[0].name).toBe(p.pieces[0].name);
});

it('versioned shared workflows keep all geometry and read legacy-v1 workflows while small projects retain v1',()=>{
 const p=sharedProject(),before=structuredClone(p),legacy=strToU8(JSON.stringify({format:'fpcad-workflow',version:1,project:p},null,2)),bytes=workflowBytes(p);
 expect(JSON.parse(new TextDecoder().decode(bytes)).version).toBe(2);expect(bytes.length).toBeLessThan(legacy.length*.75);expect(readWorkflow(bytes)).toEqual(p);expect(readWorkflow(legacy)).toEqual(p);expect(p).toEqual(before);
 const small=acceptedCutProject(),smallBytes=workflowBytes(small);expect(JSON.parse(new TextDecoder().decode(smallBytes)).version).toBe(1);expect(readWorkflow(smallBytes)).toEqual(small);
});

it('shared geometry coexists with complete sheet pixels and every source/proxy/thumbnail inside archives and nested cut bundles',()=>{
 const p=sharedProject(),codec=(UPNG as unknown as {default?:typeof UPNG}).default??UPNG,rgba=new Uint8Array(8*6*4);for(let i=0;i<rgba.length;i+=4)rgba.set([i%251,(i*7)%251,(i*11)%251,255],i);
 const reference=referenceFromPng(Buffer.from(codec.encode([rgba.buffer],8,6,0)),'archive-geometry:ordinary image name','front');reference.sheet={id:randomUUID(),width:8,height:6,x:0,y:0,png:reference.png};p.references=[reference];p.patternLibrary=[{piece:structuredClone(p.pieces[0]),referenceId:reference.id,view:'front',category:'body'}];const before=structuredClone(p);
 expect(unpack(pack(p).bytes)).toEqual(p);expect(readWorkflow(workflowBytes(p))).toEqual(p);const bytes=cutBundle(p,[]),q=readCutBundle(bytes);expect(q).toEqual(p);expect(q.references![0]).toEqual(reference);expect(p).toEqual(before);
});

it('atomic save/reopen retains every field and restoring saved history does not mutate other cuts or the inactive model',async()=>{
 const p=sharedProject(),directory=await mkdtemp(resolve('.local/tests/shared-archive-')),path=resolve(directory,'工程.fpcad');await atomicWrite(path,pack(p).bytes);const bytes=await readFile(path),q=await readProject(path);expect(q).toEqual(p);expect(unpack(bytes)).toEqual(p);
 const repo=new Repository(':memory:');try{repo.open(q,null);const cuts=structuredClone(q.cuttingLibrary),inactive=structuredClone(q.modelLibrary![1]);repo.commit({type:'cutting.activate',entryId:q.cuttingLibrary![1].id},randomUUID(),'restore different saved cloth');expect(repo.snapshot()!.pieces).toEqual(cuts![1].run.pieces);expect(repo.snapshot()!.cuttingLibrary).toEqual(cuts);expect(repo.snapshot()!.modelLibrary!.find(m=>m.id===inactive.id)).toEqual(inactive);expect(bindingIssues(repo.snapshot()!)).toEqual([]);repo.historyMove(false);expect(repo.snapshot()!.pieces).toEqual(p.pieces);repo.historyMove(true);expect(repo.snapshot()!.pieces).toEqual(cuts![1].run.pieces);expect(repo.snapshot()!.markings![1].inference!.reviewed).toBe(false);}finally{repo.close();}
});
