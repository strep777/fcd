import {expect,it} from 'vitest';
import {randomUUID} from 'node:crypto';
import {resolve} from 'node:path';
import type {Project} from '../../packages/schema/index';
import {designMaterials} from '../../apps/desktop/main/design-materials';
import {prepareDesignSurface,visibleDesignMarkings} from '../../apps/desktop/main/design-cuts';
import {cutPreview} from '../../apps/desktop/main/cut-preview';
import {cutColorHash,bindingIssues,parseObj} from '../../apps/desktop/main/surface';
import {markingFingerprint} from '../../apps/desktop/main/marking-fingerprint';
import {markingIssues,projectMarking} from '../../apps/desktop/main/markings';
import {analyze} from '../../apps/desktop/main/worker';
import {Repository} from '../../apps/desktop/main/repository';
import {pack,unpack} from '../../apps/desktop/main/archive';
import {fabricMetadata,referenceFabricPlane,fabricWorker} from '../fixtures/reference-fabric';
import {trimPhysicalArea} from '../fixtures/detail-fabrication';
import {refreshLibraryRegionMetadata} from '../../apps/desktop/main/library-region-edit';
import {acceptedCutProject} from '../fixtures/accepted-cut';

const options={partitionStrategy:'design' as const,automaticCuts:true,colorBoundaryCuts:true,method:'arap' as const},candidate=async(p:Project)=>cutPreview(fabricWorker,p.surface!,p,options,resolve('dist/assets'));
const commit=(repo:Repository,command:Parameters<Repository['commit']>[0])=>repo.commit(command,randomUUID(),command.type);
function materialAreas(p:Project,c:Awaited<ReturnType<typeof candidate>>){const rows=new Map<string,number>();for(const b of c.run.bindings){const piece=c.run.pieces.find(piece=>piece.id===b.pieceId)!;rows.set(piece.color,(rows.get(piece.color)??0)+trimPhysicalArea(p.surface!,b));}return Object.fromEntries([...rows].sort());}
function coverage(p:Project,c:Awaited<ReturnType<typeof candidate>>){const sums=new Map<string,number>();for(const b of c.run.bindings)for(const t of b.trim!.triangles){const [a,b,c]=t.barycentric,ratio=Math.abs((b[1]-a[1])*(c[2]-a[2])-(b[2]-a[2])*(c[1]-a[1]));sums.set(t.faceId,(sums.get(t.faceId)??0)+ratio);}expect(new Set(sums.keys())).toEqual(new Set(p.surface!.faces.map(f=>f.id)));for(const value of sums.values())expect(value).toBeCloseTo(1,8);}
it('only one matching bright neutral white in each view chooses the original reference fabric base',()=>{const p=fabricMetadata();expect(designMaterials(p).baseColor).toBe('#ede7ea');});
it('empty-layer preparation uses the same selected white fabric as the saved palette',async()=>{
 const p=fabricMetadata();p.surface=parseObj('v 0 0 0\nv 100 0 0\nv 100 100 0\nv 0 100 0\nf 1 2 3\nf 1 3 4');p.markings=[];const before=structuredClone(p),working=await prepareDesignSurface(resolve('empty-layer-preparation-must-not-launch-worker.exe'),p,true,false);expect(new Set([...working.provenance.values()].map(row=>row.color))).toEqual(new Set([designMaterials(p).baseColor]));expect(p).toEqual(before);
});
it.each([
 {name:'no white',front:['#04a3f0'],back:['#02a6f4']},
 {name:'front only white',front:['#ede7ea'],back:['#02a6f4']},
 {name:'back only white',front:['#04a3f0'],back:['#dcd0d7']},
 {name:'multiple front whites',front:['#ede7ea','#cccccc'],back:['#dcd0d7']},
 {name:'multiple back whites',front:['#ede7ea'],back:['#dcd0d7','#eeeeee']},
 {name:'unmatched white brightness',front:['#ffffff'],back:['#999999']},
])('$name keeps the old base fallback',({front,back})=>{expect(designMaterials(fabricMetadata(front,back)).baseColor).toBe('#eceae5');});

it('reference white and unpainted cloth are one panel, adjacent blue view pigments join, and yellow/blue material boundaries remain',async()=>{
 const p=await referenceFabricPlane(),before=structuredClone(p),fingerprints=p.markings!.map(markingFingerprint),colorHash=cutColorHash(p),visible=await visibleDesignMarkings(fabricWorker,p),working=await prepareDesignSurface(fabricWorker,p,true),c=await candidate(p);
 expect(working.materialDomains).toBe(3);expect(c.run.pieces).toHaveLength(3);expect(c.run.pieces.filter(piece=>piece.color==='#02a6f4')).toHaveLength(1);expect(c.run.pieces.filter(piece=>piece.color==='#f9e33c')).toHaveLength(1);const areas=materialAreas(p,c);expect(areas['#ede7ea']).toBeCloseTo(8800,6);expect(areas['#02a6f4']).toBeCloseTo(800,6);expect(areas['#f9e33c']).toBeCloseTo(400,6);coverage(p,c);
 const visibleWhite=visible.find(m=>m.color==='#ede7ea')!;const vertices=new Map(p.surface!.vertices.map(v=>[v.id,v])),faces=new Map(p.surface!.faces.map(f=>[f.id,f]));let whitePaint=0;for(const f of visibleWhite.fragments){const triangle=faces.get(f.faceId)!.vertices.map(id=>vertices.get(id)!);for(const r of f.rings){const points=r.map(w=>[w.reduce((s,n,i)=>s+n*triangle[i].xMm,0),w.reduce((s,n,i)=>s+n*triangle[i].yMm,0)]);whitePaint+=points.reduce((s,a,i)=>{const b=points[(i+1)%points.length];return s+a[0]*b[1]-b[0]*a[1];},0)/2;}}expect(whitePaint).toBeCloseTo(4600,6);
 const ready={...p,pieces:c.run.pieces,bindings:c.run.bindings,markings:c.markings};expect((await analyze(fabricWorker,ready)).flatMap(g=>g.issues.filter(i=>i.severity==='error'))).toEqual([]);expect(bindingIssues(ready).filter(i=>i.severity==='error')).toEqual([]);expect(p).toEqual(before);expect(p.markings!.map(markingFingerprint)).toEqual(fingerprints);expect(cutColorHash(p)).toBe(colorHash);expect(c.run.materialPalette).toMatchObject({algorithm:'reference-fabric-1',baseColor:'#ede7ea'});
},60000);

it.each(['source manual','UV manual','custom source colour','mismatched colour','manual anatomy','inference'] as const)('%s preserves the current marking colour instead of treating it as automatic reference fabric',async mode=>{
 const p=await referenceFabricPlane(),m=p.markings!.find(m=>m.color==='#04a3f0')!,source=p.patternLibrary!.find(r=>r.piece.id===m.sourcePieceId)!;
 if(mode==='source manual'){m.source='manual';m.editMode='source-manual';}
 if(mode==='UV manual')m.editMode='uv-manual';
 if(mode==='custom source colour'){source.piece.color=m.color='#04a4f0';}
 if(mode==='mismatched colour')m.color='#04a4f0';
 if(mode==='manual anatomy')source.anatomy!.method='manual';
 if(mode==='inference')m.inference={algorithm:'exact-symmetry-x-1',sourceMarkingId:p.markings![0].id,sourceFingerprint:markingFingerprint(p.markings![0]),distanceMm:1,planeXmm:0,reviewed:false};
 const before=structuredClone(p);expect(designMaterials(p).color(m)).toBe(m.color);expect(p).toEqual(before);
});

it('visible paint can use a paired material colour even when only the other original view colour was actually attached',async()=>{
 const p=await referenceFabricPlane(),back=p.patternLibrary!.find(s=>s.piece.name==='Blue back source')!;p.markings=p.markings!.filter(m=>m.sourcePieceId!==back.piece.id);const before=structuredClone(p),visible=await visibleDesignMarkings(fabricWorker,p),blue=visible.find(m=>m.color==='#02a6f4')!;expect(blue).toBeDefined();expect(blue.sourcePieceId).toBe(p.patternLibrary!.find(s=>s.piece.name==='Blue front source')!.piece.id);expect(blue.fragments.length).toBeGreaterThan(0);expect(p.markings!.some(m=>m.color==='#02a6f4')).toBe(false);expect(p).toEqual(before);
});

it('with zero attached markings the selected reference-white base agrees with the saved material palette',async()=>{
 const source=await referenceFabricPlane(),p={...source,markings:[]},before=structuredClone(p),c=await candidate(p);expect(c.run.materialPalette?.baseColor).toBe('#ede7ea');expect(c.run.pieces.every(piece=>piece.color==='#ede7ea')).toBe(true);expect(c.run.pieces).toHaveLength(1);expect(Object.values(materialAreas(p,c)).reduce((a,b)=>a+b,0)).toBeCloseTo(10000,6);coverage(p,c);expect(p).toEqual(before);
});

it('white-base material union preserves every real user-locked physical edge and complete original area',async()=>{
 const p=await referenceFabricPlane(true),before=structuredClone(p),c=await candidate(p),vertices=new Map(p.surface!.vertices.map(v=>[v.id,v])),faces=new Map(p.surface!.faces.map(f=>[f.id,f]));let exposed=0;
 for(const binding of c.run.bindings){const t=binding.trim!,world=new Map<string,number[]>();for(const tri of t.triangles){const original=faces.get(tri.faceId)!.vertices.map(id=>vertices.get(id)!);tri.vertices.forEach((id,i)=>world.set(id,[0,1,2].map(axis=>tri.barycentric[i].reduce((s,n,j)=>s+n*[original[j].xMm,original[j].yMm,original[j].zMm][axis],0))));}const edges=new Map<string,{a:string;b:string;n:number}>();for(const tri of t.triangles)tri.vertices.forEach((a,i)=>{const b=tri.vertices[(i+1)%3],key=[a,b].sort().join(':'),e=edges.get(key)??{a,b,n:0};e.n++;edges.set(key,e);});for(const e of edges.values())if(e.n===1){const a=world.get(e.a)!,b=world.get(e.b)!;if(Math.abs(a[0]-50)<1e-8&&Math.abs(b[0]-50)<1e-8)exposed+=Math.hypot(...a.map((n,i)=>n-b[i]));}}
 expect(exposed).toBeCloseTo(200,6);coverage(p,c);expect(Object.values(materialAreas(p,c)).reduce((a,b)=>a+b,0)).toBeCloseTo(10000,6);expect(p).toEqual(before);
},60000);

it('real accept/archive/activation keeps material interpretation after removing all current references and sources, then recuts identically',async()=>{
 const p=await referenceFabricPlane(),repo=new Repository(':memory:');try{repo.open(p,null);const first=await candidate(repo.snapshot()!);commit(repo,{type:'unwrap.candidate',run:first.run,markings:first.markings});commit(repo,{type:'unwrap.accept'});const accepted=repo.snapshot()!,entry=structuredClone(accepted.cuttingLibrary![0]);expect(entry.run.materialPalette).toEqual(first.run.materialPalette);expect(accepted.markings!.every(m=>m.source==='cut-library')).toBe(true);expect(designMaterials(accepted).baseColor).toBe('#ede7ea');
  // A public library replacement removes current artwork, retaining the
  // immutable cut snapshot. Restore and derive materials from that snapshot.
  commit(repo,{type:'library.regions',regions:[],references:[],replaceViews:['front','back']});commit(repo,{type:'cutting.activate',entryId:entry.id});const restored=repo.snapshot()!;expect(restored.references).toEqual([]);expect(restored.patternLibrary).toEqual([]);expect(restored.cuttingLibrary![0]).toEqual(entry);const decoded=unpack(pack(restored).bytes);expect(decoded).toEqual(restored);expect(markingIssues(decoded)).toEqual([]);expect(bindingIssues(decoded)).toEqual([]);
  const blue=decoded.markings!.find(m=>m.color==='#04a3f0')!;expect(designMaterials(decoded).color(blue)).toBe('#02a6f4');expect(designMaterials(decoded).color({...blue,color:'#1260c0'})).toBe('#1260c0');expect(decoded.cuttingLibrary![0]).toEqual(entry);
  const next={...decoded,pieces:decoded.pieces.filter(piece=>!decoded.bindings!.some(b=>b.pieceId===piece.id))},second=await candidate(next),oldAreas=materialAreas(p,first),newAreas=materialAreas(next,second);expect(Object.keys(newAreas).sort()).toEqual(Object.keys(oldAreas).sort());for(const color of Object.keys(oldAreas))expect(newAreas[color]).toBeCloseTo(oldAreas[color],6);expect(second.run.pieces).toHaveLength(3);expect(second.run.materialPalette).toEqual(first.run.materialPalette);expect(entry).toEqual(restored.cuttingLibrary![0]);
 }finally{repo.close();}
},60000);

it('a genuine old accepted snapshot without a material palette retains its old base and archive contract',()=>{
 const p=acceptedCutProject(),repo=new Repository(':memory:');try{repo.open(p,null);commit(repo,{type:'cutting.activate',entryId:p.cuttingLibrary![0].id});const restored=repo.snapshot()!;expect(restored.cuttingLibrary![0].run.materialPalette).toBeUndefined();expect(designMaterials(restored).baseColor).toBe('#eceae5');expect(unpack(pack(restored).bytes)).toEqual(restored);}finally{repo.close();}
});

it('a public source-colour metadata edit retains the custom material and invalidates the older candidate instead of silently reusing it',async()=>{
 const p=await referenceFabricPlane(),repo=new Repository(':memory:');try{repo.open(p,null);const c=await candidate(repo.snapshot()!);commit(repo,{type:'unwrap.candidate',run:c.run,markings:c.markings});const beforeEdit=repo.snapshot()!,source=beforeEdit.patternLibrary!.find(s=>s.piece.name==='Blue front source')!,changed={...source,piece:{...source.piece,color:'#1260c0'}},updated=await refreshLibraryRegionMetadata(fabricWorker,beforeEdit,changed);commit(repo,{type:'library.region.update',...updated});
  const afterEdit=repo.snapshot()!,m=afterEdit.markings!.find(m=>m.sourcePieceId===source.piece.id)!;expect(m.color).toBe('#1260c0');expect(designMaterials(afterEdit).color(m)).toBe('#1260c0');expect(afterEdit.patternLibrary!.find(s=>s.piece.id===source.piece.id)!.piece.nodes).toEqual(source.piece.nodes);expect(afterEdit.references).toEqual(beforeEdit.references);const unchanged=repo.snapshot(),history=repo.status();expect(()=>commit(repo,{type:'unwrap.accept'})).toThrow();expect(repo.snapshot()).toEqual(unchanged);expect(repo.status()).toEqual(history);
  const fresh=await candidate(repo.snapshot()!);expect(fresh.run.pieces.filter(p=>p.color==='#1260c0')).toHaveLength(1);expect(materialAreas(afterEdit,fresh)['#1260c0']).toBeCloseTo(400,6);coverage(afterEdit,fresh);
 }finally{repo.close();}
},60000);

it('automatic white placement stays unreviewed and cannot be accepted without its explicit review command',async()=>{
 const p=await referenceFabricPlane(),white=p.patternLibrary!.find(s=>s.piece.name==='White source')!,old=p.markings!.find(m=>m.sourcePieceId===white.piece.id)!;const automatic=await projectMarking(fabricWorker,p,white.piece.id,'front',0,0,false,true);p.markings=p.markings!.map(m=>m.id===old.id?automatic:m);expect(automatic.placement!.reviewed).toBe(false);const repo=new Repository(':memory:');try{repo.open(p,null);const c=await candidate(repo.snapshot()!);commit(repo,{type:'unwrap.candidate',run:c.run,markings:c.markings});const before=repo.snapshot(),history=repo.status();expect(()=>commit(repo,{type:'unwrap.accept'})).toThrow('AUTOMATIC_PLACEMENT_REVIEW');expect(repo.snapshot()).toEqual(before);expect(repo.status()).toEqual(history);commit(repo,{type:'marking.placement.review',markingIds:[automatic.id],reviewed:true});const reviewed=await candidate(repo.snapshot()!);commit(repo,{type:'unwrap.candidate',run:reviewed.run,markings:reviewed.markings});commit(repo,{type:'unwrap.accept'});expect(repo.snapshot()!.cuttingLibrary).toHaveLength(1);}finally{repo.close();}
},60000);
