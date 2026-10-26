import {expect,it} from 'vitest';
import {randomUUID} from 'node:crypto';
import {resolve} from 'node:path';
import {PDFDocument,PDFArray,PDFRawStream,decodePDFRawStream} from 'pdf-lib';
import type {Project,Surface,SurfaceReport} from '../../packages/schema/index';
import {surfaceReportSchema,surfaceSchema,projectSchema} from '../../packages/schema/index';
import {nativeSurfaceResponseSchema} from '../../packages/surface/native-report';
import {mapFromSurface,mapToSurface} from '../../packages/surface/mapping';
import {cutPreview} from '../../apps/desktop/main/cut-preview';
import {bindingIssues,validateSurface,pieceGeometryHash} from '../../apps/desktop/main/surface';
import {analyze,request} from '../../apps/desktop/main/worker';
import {svgExport,dxfExport,pdfExport} from '../../apps/desktop/main/export';
import {Repository,hash} from '../../apps/desktop/main/repository';
import {pack,unpack} from '../../apps/desktop/main/archive';
import {project,rectangle} from '../fixtures';

const worker=resolve('target/release/fpcad-worker.exe'),assets=resolve('dist/assets');
type XY={xMm:number;yMm:number};
const area=(r:XY[])=>Math.abs(r.reduce((s,a,i)=>{const b=r[(i+1)%r.length];return s+a.xMm*b.yMm-b.xMm*a.yMm;},0)/2);
const perimeter=(r:XY[])=>r.reduce((s,a,i)=>{const b=r[(i+1)%r.length];return s+Math.hypot(a.xMm-b.xMm,a.yMm-b.yMm);},0);
const reportHoles=(r:SurfaceReport)=>(r as SurfaceReport&{holes?:string[][]}).holes??[];

/** A folded sheet with zero intrinsic curvature: every rectangular cylinder
 * facet is rigid. Its developed width is chord length, not smooth arc length.
 * Removing cells makes real topological openings; no UV result is used to
 * construct the independent expected dimensions. */
function cylinderWindows(holes:1|2=1){
 const columns=8,rows=6,radius=160,stepAngle=.12,stepY=20,chord=2*radius*Math.sin(stepAngle/2);
 const windows=holes===1?[[2,4,2,4]]:[[1,3,2,4],[5,7,2,4]];
 const vertices:Surface['vertices']=[],uv:SurfaceReport['uv']=[],grid:string[][]=[];
 for(let j=0;j<=rows;j++){
  grid[j]=[];
  for(let i=0;i<=columns;i++){
   const id=randomUUID(),angle=(i-columns/2)*stepAngle;grid[j][i]=id;
   vertices.push({id,xMm:radius*Math.sin(angle),yMm:j*stepY,zMm:radius*Math.cos(angle)});
   uv.push({vertexId:id,xMm:i*chord,yMm:j*stepY});
  }
 }
 const faces:Surface['faces']=[];
 for(let j=0;j<rows;j++)for(let i=0;i<columns;i++){
  if(windows.some(([x0,x1,y0,y1])=>i>=x0&&i<x1&&j>=y0&&j<y1))continue;
  const [a,b,c,d]=[grid[j][i],grid[j][i+1],grid[j+1][i+1],grid[j+1][i]];
  for(const ids of [[a,b,c],[a,c,d]])faces.push({id:randomUUID(),region:'curved-window',vertices:ids as [string,string,string]});
 }
 const used=new Set(faces.flatMap(f=>f.vertices));
 const surface=surfaceSchema.parse({id:randomUUID(),source:'obj',topologyVersion:1,vertices:vertices.filter(v=>used.has(v.id)),faces});
 const width=columns*chord,height=rows*stepY;
 return {surface,grid,uv:uv.filter(v=>used.has(v.vertexId)),windows,chord,width,height,
  netArea:width*height-windows.reduce((s,[a,b,c,d])=>s+(b-a)*chord*(d-c)*stepY,0),
  holeArea:4*chord*stepY,holePerimeter:4*(chord+stepY),perimeter:2*(width+height)+holes*4*(chord+stepY)};
}
function inputProject(surface:Surface):Project{return projectSchema.parse({...project(),pieces:[],surface,defaultAllowanceMm:0});}
async function native(surface:Surface,initial_uv?:SurfaceReport['uv']){
 return nativeSurfaceResponseSchema.parse(await request(worker,{protocolVersion:1,operation:'surface.unwrap',mesh:{vertices:surface.vertices,faces:surface.faces,method:'lscm',repair_cuts:false,...(initial_uv?{initial_uv}:{})}}));
}
function strictReport(report:SurfaceReport){
 expect(report.areaErrorMax).toBeLessThanOrEqual(.15);expect(report.edgeErrorMax).toBeLessThanOrEqual(.1);expect(report.distortionMax).toBeLessThanOrEqual(.15);
 expect(report.seamErrorMax??0).toBeLessThanOrEqual(.0005);expect(report.seamLengthErrorMm??0).toBeLessThanOrEqual(.25);
}
async function preview(holes:1|2){
 const f=cylinderWindows(holes),p=inputProject(f.surface),before=structuredClone(p);
 validateSurface(f.surface);
 const candidate=await cutPreview(worker,f.surface,p,{partitionStrategy:'design',method:'arap',automaticCuts:true,colorBoundaryCuts:true},assets);
 expect(p).toEqual(before);expect(candidate.run.pieces,JSON.stringify(candidate.run.designCutReport)).toHaveLength(1);
 expect(candidate.run.designCutReport).toMatchObject({materialDomains:1,userSeams:0,topologySeams:0,distortionSeams:0,manufacturingSeams:0});
 const ready={...p,pieces:candidate.run.pieces,bindings:candidate.run.bindings,markings:candidate.markings};
 expect(bindingIssues(ready)).toEqual([]);
 const [geometry]=await analyze(worker,ready);expect(geometry.issues.filter(i=>i.severity==='error')).toEqual([]);
 expect(ready.pieces[0].holes).toHaveLength(holes);expect(geometry.seamHoles).toHaveLength(holes);expect(geometry.cutHoles).toHaveLength(holes);
 expect(geometry.areaMm2).toBeCloseTo(f.netArea,2);expect(perimeter(geometry.seam!)+(geometry.seamHoles??[]).reduce((s,r)=>s+perimeter(r),0)).toBeCloseTo(f.perimeter,3);
 for(const ring of geometry.seamHoles!){expect(area(ring)).toBeCloseTo(f.holeArea,2);expect(perimeter(ring)).toBeCloseTo(f.holePerimeter,3);}
 const binding=ready.bindings[0];strictReport(binding.report);expect(reportHoles(binding.report)).toHaveLength(holes);
 const reportPoints=new Map(binding.report.uv.map(v=>[v.vertexId,v]));
 for(const ring of reportHoles(binding.report)){
  for(const id of ring)expect(reportPoints.has(id),'saved hole vertex '+id).toBe(true);
  expect(area(ring.map(id=>reportPoints.get(id)!))).toBeCloseTo(f.holeArea,2);
 }
 expect(new Set(binding.report.faceIds)).toEqual(new Set(f.surface.faces.map(face=>face.id)));
 expect(binding.report.faceIds).toHaveLength(f.surface.faces.length);
 expect(binding.trim?.holes).toHaveLength(holes);
 const coverage=new Map<string,number>();
 for(const triangle of binding.trim!.triangles){const [a,b,c]=triangle.barycentric,ratio=Math.abs((b[1]-a[1])*(c[2]-a[2])-(b[2]-a[2])*(c[1]-a[1]));coverage.set(triangle.faceId,(coverage.get(triangle.faceId)??0)+ratio);}
 for(const face of f.surface.faces)expect(coverage.get(face.id)).toBeCloseTo(1,8);
 return {f,p,candidate,ready,geometry};
}

it.each([1,2] as const)('native LSCM preserves %s curved opening(s), all source faces and independently measured boundaries without repair cuts',async holes=>{
 const f=cylinderWindows(holes),before=structuredClone(f.surface),response=await native(f.surface);
 expect(response.patches).toHaveLength(1);const report=response.patches[0];
 expect(reportHoles(report)).toHaveLength(holes);expect(report.planarExact).not.toBe(true);
 expect(report.faceIds).toHaveLength(f.surface.faces.length);expect(new Set(report.faceIds)).toEqual(new Set(f.surface.faces.map(f=>f.id)));
 const points=new Map(report.uv.map(v=>[v.vertexId,v]));
 const outer=report.boundary.map(id=>points.get(id)!),inner=reportHoles(report).map(r=>r.map(id=>points.get(id)!));
 expect(area(outer)-inner.reduce((s,r)=>s+area(r),0)).toBeCloseTo(f.netArea,2);
 expect(perimeter(outer)+inner.reduce((s,r)=>s+perimeter(r),0)).toBeCloseTo(f.perimeter,3);
 for(const hole of inner){expect(area(hole)).toBeCloseTo(f.holeArea,2);expect(perimeter(hole)).toBeCloseTo(f.holePerimeter,3);}
 strictReport(report);expect(f.surface).toEqual(before);
},30000);

it.each([1,2] as const)('design preview keeps %s real curved hole(s) in one manufacturable material panel with complete source coverage',async holes=>{await preview(holes);},60000);

it('acceptance, archive and undo/redo preserve both holes and exact forward/inverse source correspondence',async()=>{
 const {f,p,candidate}=await preview(2),repo=new Repository(':memory:');
 try{
  repo.open(p,null);repo.commit({type:'unwrap.candidate',...candidate},randomUUID(),'curved holes candidate');
  expect(repo.snapshot()!.pieces).toEqual([]);repo.commit({type:'unwrap.accept'},randomUUID(),'accept curved holes');
  const accepted=repo.snapshot()!,loaded=unpack(pack(accepted).bytes);expect(loaded).toEqual(accepted);expect(bindingIssues(loaded)).toEqual([]);
  const binding=loaded.bindings![0];
  for(const face of f.surface.faces){
   const weights:[number,number,number]=[.2,.3,.5],uv=mapFromSurface(binding,face.id,weights,loaded.surface!)!;expect(uv).not.toBeNull();
   const hit=mapToSurface(loaded.surface!,binding,uv)!;expect(hit).not.toBeNull();
   const corners=face.vertices.map(id=>f.surface.vertices.find(v=>v.id===id)!);
   for(const axis of ['xMm','yMm','zMm'] as const)expect(hit.position[axis]).toBeCloseTo(corners.reduce((s,v,i)=>s+v[axis]*weights[i],0),6);
  }
  for(const ring of loaded.pieces[0].holes!){const center={xMm:ring.reduce((s,v)=>s+v.xMm,0)/ring.length,yMm:ring.reduce((s,v)=>s+v.yMm,0)/ring.length};expect(mapToSurface(loaded.surface!,binding,center)).toBeNull();}
  repo.historyMove(false);expect(repo.snapshot()!.pieces).toEqual([]);repo.historyMove(true);expect(repo.snapshot()!.bindings).toEqual(accepted.bindings);
  const changed=structuredClone(loaded);changed.pieces[0].holes![0][0].xMm+=1;expect(bindingIssues(changed).map(i=>i.messageKey)).toContain('STALE_BINDING');
  expect(mapToSurface({...loaded.surface!,topologyVersion:2},binding,{xMm:0,yMm:0})).toBeNull();
 }finally{repo.close();}
},60000);

it('SVG, DXF and actual-size PDF retain two independent curved openings and the 100 mm calibration',async()=>{
 const {f,ready,geometry}=await preview(2),ack=geometry.issues.filter(i=>i.severity==='warning').map(i=>i.ruleId);
 const svg=svgExport(ready,[geometry],ack),cut=svg.match(/<g id="Cut"[^>]*>(.*?)<\/g>/s)![1];
 expect(cut.match(/\bM/g)).toHaveLength(3);expect(cut.match(/\bZ/g)).toHaveLength(3);expect(svg).toContain('id="calibration-100mm"');
 const paths=[...cut.matchAll(/M([^MZ]+)\s*Z/g)].map(m=>[...m[1].matchAll(/([-\d.eE]+),([-\d.eE]+)/g)].map(p=>({xMm:Number(p[1]),yMm:Number(p[2])})));
 expect(area(paths[0])-paths.slice(1).reduce((s,r)=>s+area(r),0)).toBeCloseTo(f.netArea,2);
 const dxf=dxfExport(ready,[geometry],ack),lines=dxf.trim().split(/\r?\n/),entities:Map<number,string[]>[]=[];let entity:Map<number,string[]>|undefined;
 for(let i=0;i<lines.length;i+=2){const code=Number(lines[i]),value=lines[i+1];if(code===0){entity=value==='LWPOLYLINE'?new Map():undefined;if(entity)entities.push(entity);}else if(entity){entity.set(code,[...entity.get(code)??[],value]);}}
 const rings=entities.filter(e=>e.get(8)?.[0]==='CUT').map(e=>(e.get(10)??[]).map((x,i)=>({xMm:Number(x),yMm:Number(e.get(20)![i])})));
 expect(rings).toHaveLength(3);expect(area(rings[0])-rings.slice(1).reduce((s,r)=>s+area(r),0)).toBeCloseTo(f.netArea,2);expect(dxf).toContain('$INSUNITS\r\n70\r\n4');
 // A3 contains this freely rotated measured chart on one page; rotation must
 // not be constrained merely to make an A4 pagination assertion pass.
 const pdf=await PDFDocument.load(await pdfExport(ready,[geometry],ack,{widthMm:297,heightMm:420,marginMm:10,overlapMm:10}));expect(pdf.getPageCount()).toBe(1);
 const page=pdf.getPage(0);expect(page.getWidth()*25.4/72).toBeCloseTo(297,8);expect(page.getHeight()*25.4/72).toBeCloseTo(420,8);
 const contents=page.node.Contents(),refs=contents instanceof PDFArray?contents.asArray():[contents],text=refs.map(ref=>{const stream=pdf.context.lookup(ref!);return stream instanceof PDFRawStream?new TextDecoder().decode(decodePDFRawStream(stream).decode()):'';}).join('\n');
 const segments=[...text.matchAll(/([-\d.eE]+) ([-\d.eE]+) m\s+([-\d.eE]+) ([-\d.eE]+) l\s+S/g)].map(m=>({a:{xMm:Number(m[1])*25.4/72,yMm:Number(m[2])*25.4/72},b:{xMm:Number(m[3])*25.4/72,yMm:Number(m[4])*25.4/72}}));
 expect(segments.some(({a,b})=>Math.abs(Math.hypot(b.xMm-a.xMm,b.yMm-a.yMm)-100)<1e-8)).toBe(true);
 const [a,b]=rings[0],reference=segments.find(s=>Math.abs(s.a.xMm-a.xMm-10)<.001&&Math.abs((s.b.xMm-s.a.xMm)-(b.xMm-a.xMm))<.001&&Math.abs((s.b.yMm-s.a.yMm)-(b.yMm-a.yMm))<.001)!;
 expect(reference).toBeDefined();const shiftY=reference.a.yMm-a.yMm;
 const matches=(actual:XY,source:XY)=>Math.hypot(actual.xMm-source.xMm-10,actual.yMm-source.yMm-shiftY)<.001;
 // Check every distinct hole edge at its actual page position. Identical
 // opening sizes alone cannot reveal when one of two openings disappears.
 for(const hole of rings.slice(1))for(let i=0;i<hole.length;i++){const a=hole[i],b=hole[(i+1)%hole.length];expect(segments.some(s=>matches(s.a,a)&&matches(s.b,b)||matches(s.a,b)&&matches(s.b,a))).toBe(true);}
},60000);

it('adjacent independent markings with the same material color remain one curved annulus',async()=>{
 const f=cylinderWindows(),p=inputProject(f.surface),color='#315579',sources=[rectangle(),rectangle()].map(source=>({...source,color}));
 p.patternLibrary=sources.map(piece=>({piece,referenceId:randomUUID(),view:'front',category:'paint'}));
 // These independently authored triangle fragments are authoritative UV paint;
 // automatic reference reprojection would replace them with the source box.
 p.markings=[0,1].map(half=>({id:randomUUID(),name:'Same color '+half,color,source:'reference' as const,editMode:'uv-manual' as const,sourcePieceId:sources[half].id,sourceHash:pieceGeometryHash(sources[half]),surfaceId:f.surface.id,topologyVersion:1,surfaceHash:hash(JSON.stringify(f.surface)),view:'front' as const,offsetXmm:0,offsetYmm:0,fragments:f.surface.faces.filter((_,i)=>i%2===half).map(face=>({faceId:face.id,rings:[[[1,0,0],[0,1,0],[0,0,1]] as [number,number,number][]]})),paths:[]}));
 const before=structuredClone(p),{run}=await cutPreview(worker,f.surface,p,{partitionStrategy:'design',method:'arap',automaticCuts:true,colorBoundaryCuts:true},assets);
 expect(p).toEqual(before);expect(run.pieces,JSON.stringify({seams:run.designCutReport,pieces:run.pieces.map(piece=>({color:piece.color,holes:piece.holes?.length,nodes:piece.nodes.length})),reports:run.bindings.map(b=>({faces:b.report.faceIds.length,area:b.report.areaErrorMax,edge:b.report.edgeErrorMax,distortion:b.report.distortionMax,seam:b.report.seamErrorMax,seamMm:b.report.seamLengthErrorMm}))})).toHaveLength(1);expect(run.pieces[0].color).toBe(color);expect(run.pieces[0].holes).toHaveLength(1);expect(run.designCutReport?.topologySeams).toBe(0);
 const [g]=await analyze(worker,{...p,pieces:run.pieces});expect(g.areaMm2).toBeCloseTo(f.netArea,2);
},60000);

it('preserving a curved opening never erases an explicit user seam across the lower sheet',async()=>{
 const f=cylinderWindows(),edges=f.grid[1].slice(0,-1).map((a,i)=>({a,b:f.grid[1][i+1],locked:true}));
 f.surface.cutConstraints=edges;f.surface.cutBaseConstraints=edges;f.surface.cutLines=[{id:randomUUID(),name:'User structural seam',kind:'pen',enabled:true,closed:false,symmetric:false,controlPoints:[],tension:.5,edges:edges.map(({a,b})=>({a,b}))}];
 const p=inputProject(f.surface),before=structuredClone(p),{run}=await cutPreview(worker,f.surface,p,{partitionStrategy:'design',method:'arap',automaticCuts:true,colorBoundaryCuts:true},assets);
 expect(p).toEqual(before);expect(run.pieces).toHaveLength(2);expect(run.designCutReport?.userSeams).toBe(1);expect(run.pieces.reduce((s,p)=>s+(p.holes?.length??0),0)).toBe(1);
 const keys=(rows:[string,string][])=>new Set(rows.map(e=>[...e].sort().join(':')));expect(keys(run.cutEdges??[])).toEqual(keys(edges.map(e=>[e.a,e.b])));
 const geometry=await analyze(worker,{...p,pieces:run.pieces});expect(geometry.reduce((s,g)=>s+g.areaMm2,0)).toBeCloseTo(f.netArea,2);
},60000);

it('two open cylinder ends are not accepted as a flat inner hole without a longitudinal cut',async()=>{
 const n=12,radius=50,height=120,vertices=Array.from({length:2*n},(_,i)=>({id:randomUUID(),xMm:radius*Math.cos(i%n*2*Math.PI/n),yMm:i<n?0:height,zMm:radius*Math.sin(i%n*2*Math.PI/n)})),faces:Surface['faces']=[];
 for(let i=0;i<n;i++){const j=(i+1)%n;for(const tri of [[i,j,n+i],[j,n+j,n+i]])faces.push({id:randomUUID(),region:'closed-around',vertices:tri.map(k=>vertices[k].id) as [string,string,string]});}
 const surface:Surface={id:randomUUID(),source:'obj',topologyVersion:1,vertices,faces},p=inputProject(surface),before=structuredClone(p);
 // A native diagnostic report may describe the unavoidable stretch. It must
 // never claim that the uncut sleeve is a physically acceptable flat panel.
 try{const result=await native(surface);expect(result.patches.some(r=>r.areaErrorMax>.15||r.edgeErrorMax>.1||r.distortionMax>.15)).toBe(true);}
 catch(error){expect((error as Error).message).toMatch(/UNWRAP_|PATCH_|NUMERICAL_FAILURE/);}
 await expect(cutPreview(worker,surface,p,{partitionStrategy:'design',method:'arap',automaticCuts:false},assets)).rejects.toThrow();expect(p).toEqual(before);
},30000);

it('a punctured torus remains invalid despite having a single simple boundary',async()=>{
 const around=8,tube=6,vertices:Surface['vertices']=[],faces:Surface['faces']=[];
 for(let j=0;j<tube;j++)for(let i=0;i<around;i++){const u=2*Math.PI*i/around,v=2*Math.PI*j/tube;vertices.push({id:randomUUID(),xMm:(100+25*Math.cos(v))*Math.cos(u),yMm:(100+25*Math.cos(v))*Math.sin(u),zMm:25*Math.sin(v)});}
 for(let j=0;j<tube;j++)for(let i=0;i<around;i++){if(i===0&&j===0)continue;const a=j*around+i,b=j*around+(i+1)%around,c=((j+1)%tube)*around+(i+1)%around,d=((j+1)%tube)*around+i;for(const tri of [[a,b,c],[a,c,d]])faces.push({id:randomUUID(),region:'punctured-torus',vertices:tri.map(k=>vertices[k].id) as [string,string,string]});}
 const surface:Surface={id:randomUUID(),source:'obj',topologyVersion:1,vertices,faces};validateSurface(surface);await expect(native(surface)).rejects.toThrow('PATCH_NOT_DISK');
},30000);

it('crossing hole charts fail without persisting a candidate or changing the project',async()=>{
 const f=cylinderWindows(2),p=inputProject(f.surface),before=structuredClone(p),bad=structuredClone(f.uv),first=f.windows[0],second=f.windows[1];
 // Slide the complete first opening through the second in UV space. The
 // underlying 3D mesh is unchanged; the supplied chart is physically invalid.
 for(const uv of bad){const original=f.uv.find(v=>v.vertexId===uv.vertexId)!;if(original.xMm>=first[0]*f.chord&&original.xMm<=first[1]*f.chord&&original.yMm>=first[2]*20&&original.yMm<=first[3]*20)uv.xMm+=(second[0]-first[0])*f.chord;}
 await expect(native(f.surface,bad)).rejects.toThrow(/UNWRAP_(FLIPPED|OVERLAP)/);expect(p).toEqual(before);expect(p.surfaceRun).toBeUndefined();
 // Backward compatibility: reports from saved projects need no holes field.
 const report=surfaceReportSchema.parse({faceIds:[f.surface.faces[0].id],uv:f.uv,boundary:f.surface.faces[0].vertices,areaErrorMax:0,edgeErrorMax:0,distortionMean:0,distortionP95:0,distortionMax:0,status:'acceptable'});
 expect(reportHoles(report)).toEqual([]);
},30000);
