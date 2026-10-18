import {expect,it} from 'vitest';
import {mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {randomUUID} from 'node:crypto';
import {project,rectangle} from '../fixtures';
import {editLibraryRegion} from '../../apps/desktop/main/library-region-edit';
import {brushSurfaceMarking} from '../../apps/desktop/main/surface-marking-edit';
import {parseObj} from '../../apps/desktop/main/surface';
import {edgeArcPoints} from '../../packages/pattern/edit';
import {sampleShapeContour} from '../../packages/surface/shape-contour';
import {Repository} from '../../apps/desktop/main/repository';
import {pack,unpack} from '../../apps/desktop/main/archive';
import {surfaceMarking} from '../../apps/desktop/main/markings';
import {projectSchema,requestSchema} from '../../packages/schema/index';
import {mirrorPaintShape} from '../../packages/surface/symmetry';

const worker=resolve('target/release/fpcad-worker.exe'),output=resolve('test-results/current-cutting');
const frame={origin:[0,0,0] as [number,number,number],axes:[[1,0,0],[0,1,0],[0,0,1]] as [[number,number,number],[number,number,number],[number,number,number]]};
const evidence=(name:string,value:unknown)=>{mkdirSync(output,{recursive:true});writeFileSync(resolve(output,name+'.json'),JSON.stringify(value,null,2));};
const area=(r:{xMm:number;yMm:number}[])=>Math.abs(r.reduce((s,a,i)=>{const b=r[(i+1)%r.length];return s+a.xMm*b.yMm-b.xMm*a.yMm;},0)/2);
function minChord(nodes:{xMm:number;yMm:number}[]){return Math.min(...nodes.map((a,i)=>{const b=nodes[(i+1)%nodes.length];return Math.hypot(b.xMm-a.xMm,b.yMm-a.yMm);}));}
type XY={xMm:number;yMm:number};
type Capsule={a:XY;b:XY;radius:number};
const xy=(xMm:number,yMm:number):XY=>({xMm,yMm});
function distanceSegment(p:XY,a:XY,b:XY){const dx=b.xMm-a.xMm,dy=b.yMm-a.yMm,den=dx*dx+dy*dy,t=den?Math.max(0,Math.min(1,((p.xMm-a.xMm)*dx+(p.yMm-a.yMm)*dy)/den)):0;return Math.hypot(p.xMm-a.xMm-t*dx,p.yMm-a.yMm-t*dy);}
/** Analytic swept disks, independently sampled at <=0.06 mm intervals.
 * Remove buried capsule arcs rather than comparing against brushFootprint,
 * Boolean output, the curve fitter, or its claimed error report. */
function unionBoundary(capsules:Capsule[]){
 return capsules.flatMap(({a,b,radius},owner)=>{
  const angle=Math.atan2(b.yMm-a.yMm,b.xMm-a.xMm),steps=Math.ceil(Math.PI*radius/.05),out:XY[]=[];
  for(let i=0;i<=steps;i++)for(const[end,base]of[[a,angle+Math.PI/2],[b,angle-Math.PI/2]] as const){const theta=base+i*Math.PI/steps;out.push(xy(end.xMm+radius*Math.cos(theta),end.yMm+radius*Math.sin(theta)));}
  const count=Math.max(1,Math.ceil(Math.hypot(b.xMm-a.xMm,b.yMm-a.yMm)/.05));for(let i=0;i<=count;i++)for(const sign of[-1,1])out.push(xy(a.xMm+(b.xMm-a.xMm)*i/count-sign*radius*Math.sin(angle),a.yMm+(b.yMm-a.yMm)*i/count+sign*radius*Math.cos(angle)));
  return out.filter(p=>capsules.every((other,i)=>i===owner||distanceSegment(p,other.a,other.b)>=other.radius-1e-7));
 });
}
function deviations(sampled:XY[],capsules:Capsule[]){
 return boundaryDeviation(sampled,unionBoundary(capsules));
}
function boundaryDeviation(sampled:XY[],boundary:XY[]){
 expect(boundary.length).toBeGreaterThan(100);
 let originalToFit=0,fitToOriginal=0;
 for(const p of boundary)originalToFit=Math.max(originalToFit,Math.min(...sampled.map((a,i)=>distanceSegment(p,a,sampled[(i+1)%sampled.length]))));
 for(const p of sampled)fitToOriginal=Math.max(fitToOriginal,Math.min(...boundary.map(q=>Math.hypot(p.xMm-q.xMm,p.yMm-q.yMm))));
 return {originalToFit,fitToOriginal};
}
function assertSparse(nodes:XY[],sampled:XY[],capsules:Capsule[],curveCount:number){const error=deviations(sampled,capsules),metrics={nodes:nodes.length,curveCount,minimumEditableChordMm:minChord(nodes),...error};expect(nodes.length,'capsule/filled region must not retain cap tessellation nodes').toBeLessThanOrEqual(24);expect(curveCount).toBeGreaterThan(0);expect(metrics.minimumEditableChordMm,'smooth paint needs meaningful editable spans').toBeGreaterThan(.5);expect(error.originalToFit,'paint must cover the independently measured intended boundary').toBeLessThanOrEqual(.5);expect(error.fitToOriginal,'fit may not create bulges or buried interior arcs').toBeLessThanOrEqual(.5);return metrics;}
function modelProject(){const p=project();p.pieces=[];p.markings=[];p.surface=parseObj('v -200 -200 0\nv 200 -200 0\nv 200 200 0\nv -200 200 0\nf 1 2 3\nf 1 3 4');return p;}

/** Independent segment intersection check on the actual flattened closed path. */
function assertSimpleClosed(points:XY[]){
 expect(points.length).toBeGreaterThanOrEqual(3);
 const cross=(a:XY,b:XY,c:XY)=>(b.xMm-a.xMm)*(c.yMm-a.yMm)-(b.yMm-a.yMm)*(c.xMm-a.xMm);
 const onSegment=(a:XY,b:XY,p:XY)=>Math.abs(cross(a,b,p))<1e-9&&p.xMm>=Math.min(a.xMm,b.xMm)-1e-9&&p.xMm<=Math.max(a.xMm,b.xMm)+1e-9&&p.yMm>=Math.min(a.yMm,b.yMm)-1e-9&&p.yMm<=Math.max(a.yMm,b.yMm)+1e-9;
 for(let i=0;i<points.length;i++){
  const a=points[i],b=points[(i+1)%points.length];expect(Math.hypot(a.xMm-b.xMm,a.yMm-b.yMm),'closed boundary cannot contain zero-length spans').toBeGreaterThan(1e-9);
  for(let j=i+2;j<points.length;j++){
   if(i===0&&j===points.length-1)continue;
   const c=points[j],d=points[(j+1)%points.length],abc=cross(a,b,c),abd=cross(a,b,d),cda=cross(c,d,a),cdb=cross(c,d,b);
   const crossing=abc*abd<0&&cda*cdb<0||onSegment(a,b,c)||onSegment(a,b,d)||onSegment(c,d,a)||onSegment(c,d,b);
   expect(crossing,`nonadjacent contour spans ${i} and ${j} must not intersect`).toBe(false);
  }
 }
 expect(area(points)).toBeGreaterThan(0);
}

it('captured exact symmetric brush input retains bounded sparse controls and one atomic undo step',async()=>{
 // This fixture preserves the exact IPC floats, original project and transformed
 // preexisting marking from the isolated desktop test, rather than reconstructing
 // approximate mouse coordinates or relying on generated test-results files.
 const capture=JSON.parse(readFileSync(resolve('tests/fixtures/symmetric-brush-exact-input.json'),'utf8')),p=projectSchema.parse(capture.before),request=requestSchema.parse(capture.request);
 if(request.method!=='marking.surface.brush')throw Error('Expected recorded brush request');
 const stroke=request.payload.stroke,before=structuredClone(p);expect(stroke.points).toHaveLength(33);expect(stroke.symmetric).toBe(true);expect(stroke.radiusMm).toBe(8);expect(stroke.paint!.frame.origin).toEqual([0,120,0]);
 const original=await brushSurfaceMarking(worker,p,request.payload.markingId,stroke);
 // Follow the production symmetric branch: reflect the fitted result and project
 // it, then save both records with the same markings.batch transaction.
 const mirrored=await surfaceMarking(worker,p,mirrorPaintShape(p.surface!,original.surfaceShape!),original.color,original.name+' · 对称'),markings=[original,mirrored],rows=[];
 for(let side=0;side<markings.length;side++){
  const shape=markings[side].surfaceShape!,sampled=sampleShapeContour(shape),points=stroke.points.map(n=>xy(side?-n.xMm:n.xMm,n.yMm)),capsules=points.slice(1).map((b,i)=>({a:points[i],b,radius:stroke.radiusMm}));
  const metrics={side:side?'mirrored':'original',nodes:shape.nodes.length,curves:shape.curves?.length??0,minimumEditableChordMm:minChord(shape.nodes),...deviations(sampled,capsules)};
  rows.push(metrics);evidence('exact-symmetric-brush-observation',{metrics:rows,stroke,markings});
  expect(shape.nodes.length).toBeLessThan(80);expect(shape.curves?.length).toBeGreaterThan(0);expect(metrics.minimumEditableChordMm).toBeGreaterThan(.5);expect(metrics.originalToFit).toBeLessThanOrEqual(.5);expect(metrics.fitToOriginal).toBeLessThanOrEqual(.5);expect(shape.holes??[]).toHaveLength(0);expect(markings[side].fragments.length).toBeGreaterThan(0);assertSimpleClosed(sampled);
 }
 expect(mirrored.surfaceShape!.nodes).toEqual(original.surfaceShape!.nodes.map(n=>xy(-n.xMm,n.yMm)));
 expect(mirrored.surfaceShape!.curves).toEqual(original.surfaceShape!.curves!.map(c=>({...c,c1:xy(-c.c1.xMm,c.c1.yMm),c2:xy(-c.c2.xMm,c.c2.yMm)})));expect(p).toEqual(before);
 const repo=new Repository(':memory:');
 try{
  repo.open(p,null);const fingerprint=JSON.stringify(request),stripRevision=(value:ReturnType<Repository['snapshot']>)=>{const {revision,updatedAt,...rest}=value!;return rest;};
  repo.assertRevision(request.projectId,request.expectedRevision);repo.commit({type:'markings.batch',markings},request.requestId,fingerprint);const committed=repo.snapshot()!;
  // SQLite JSON omits optional undefined properties; all persisted coordinates,
  // controls, fragments and preexisting records must otherwise match exactly.
  expect(committed.markings).toEqual(JSON.parse(JSON.stringify([...before.markings!,...markings])));expect(committed.revision).toBe(before.revision+1);expect(repo.replay(request.requestId,fingerprint)).toBe(true);expect(repo.snapshot()).toEqual(committed);expect(()=>repo.assertRevision(request.projectId,request.expectedRevision)).toThrow('REVISION_CONFLICT');
  const restored=repo.historyMove(false);expect(stripRevision(restored)).toEqual(stripRevision(before));expect(()=>repo.historyMove(false)).toThrow('NOTHING_TO_UNDO');
  const redone=repo.historyMove(true);expect(stripRevision(redone)).toEqual(stripRevision(committed));expect(unpack(pack(redone).bytes)).toEqual(redone);
  evidence('exact-symmetric-brush-history',{beforeRevision:before.revision,committedRevision:committed.revision,undoRevision:restored.revision,redoRevision:redone.revision,preexistingMarkingsPreserved:true,sidesCommittedTogether:true,undoExactlyRestored:true,redoExactlyRestored:true,archiveExactlyRestored:true});
 }finally{repo.close();}
},30000);

it('33-point front-view and mirrored round strokes retain sparse simple capsule boundaries',async()=>{
 // The recorded desktop gesture used renderer offsets (-95,40)..(-75,-35).
 // Its orthographic scale was 450 CSS px / 240 mm; screen Y runs downward.
 // Test both the literal mm trajectory and the independently reconstructed
 // physical trajectory, including CSS-rounded intermediate pointer positions.
 const input=Array.from({length:33},(_,i)=>xy(-95+20*i/32,40-75*i/32)),scale=240/450;
 const cases=[{name:'literal-millimetres',points:input},{name:'recorded-camera-ideal',points:input.map(p=>xy(p.xMm*scale,-p.yMm*scale))},{name:'recorded-camera-pixel-rounded',points:input.map(p=>xy(Math.round(p.xMm)*scale,-Math.round(p.yMm)*scale))}];
 const rows=[];
 for(const testCase of cases)for(const mirrored of[false,true]){
  const p=project();p.pieces=[];p.markings=[];p.surface=parseObj('v -100 0 0\nv 100 0 0\nv 100 240 0\nv -100 240 0\nf 1 2 3\nf 1 3 4');
  const points=testCase.points.map(point=>xy(mirrored?-point.xMm:point.xMm,point.yMm)),before=structuredClone(p),paintFrame={...frame,origin:[0,120,0] as [number,number,number]};
  const marking=await brushSurfaceMarking(worker,p,undefined,{mode:'add',radiusMm:8,brushShape:'round',points,paint:{frame:paintFrame,color:'#cc9944',name:'Recorded 33-point brush'}}),shape=marking.surfaceShape!,sampled=sampleShapeContour(shape);
  // Rounded pointer positions form a shallow polyline, so its reference is the
  // exact union of analytic swept disks for all 32 segments, not one capsule.
  const capsules=points.slice(1).map((b,i)=>({a:points[i],b,radius:8})),metrics={case:testCase.name,mirrored,inputSamples:points.length,nodes:shape.nodes.length,curves:shape.curves?.length??0,minimumEditableChordMm:minChord(shape.nodes),...deviations(sampled,capsules)};
  rows.push(metrics);evidence('dense-front-brush-observation',rows);evidence(`dense-front-brush-${testCase.name}-${mirrored?'mirrored':'original'}`,{points,shape,metrics});
  expect(p).toEqual(before);expect(shape.origin).toEqual([0,120,0]);expect(shape.holes??[]).toHaveLength(0);
  expect(shape.nodes.length,'one 33-sample stroke must not expose cap tessellation as edit knots').toBeLessThan(80);expect(shape.curves?.length).toBeGreaterThan(0);expect.soft(metrics.minimumEditableChordMm,`${testCase.name}, mirrored=${mirrored}: editable spans must remain meaningful`).toBeGreaterThan(.5);
  expect(metrics.originalToFit,'paint must cover the independently swept stroke boundary').toBeLessThanOrEqual(.5);expect(metrics.fitToOriginal,'sparse fit may not bulge beyond the intended stroke').toBeLessThanOrEqual(.5);assertSimpleClosed(sampled);
 }
},30000);

it('original-image source brush yields sparse round outer controls while preserving an erased hole and absolute geometry',async()=>{
 const p=project(),piece=rectangle(4,4);piece.allowanceMm=0;piece.nodes.forEach(n=>{n.xMm-=2;n.yMm-=2;});p.pieces=[];p.patternLibrary=[{piece,referenceId:randomUUID(),view:'front',category:'test'}];const before=structuredClone(p);
 const result=await editLibraryRegion(worker,p,piece.id,{piece,operations:[{kind:'brush',mode:'add',radiusMm:30,points:[{xMm:0,yMm:0}]},{kind:'brush',mode:'erase',radiusMm:8,points:[{xMm:0,yMm:0}]}]}),painted=result.region.piece,samples=painted.nodes.flatMap(n=>edgeArcPoints(painted,n.id).slice(0,-1));
 evidence('original-source-brush-observation',{outerNodes:painted.nodes.length,curves:painted.curves?.length??0,minimumEditableChordMm:minChord(painted.nodes),holeNodes:painted.holes?.map(h=>h.length),areaMm2:area(samples)-area(painted.holes![0])});
 expect(p).toEqual(before);expect(painted.id).toBe(piece.id);expect(painted.holes).toHaveLength(1);expect(Math.abs(area(painted.holes![0])-Math.PI*64)).toBeLessThan(2*Math.PI*8*.025);
 for(const n of samples)expect(Math.abs(Math.hypot(n.xMm,n.yMm)-30)).toBeLessThan(.3);
 expect(painted.nodes.length,'a circular dab must not expose all tessellation vertices').toBeLessThanOrEqual(24);expect(painted.curves?.length).toBeGreaterThan(0);expect(minChord(painted.nodes),'a smooth circle has no intentional submillimetre edit spans').toBeGreaterThan(.5);
});

it('model paint round dab and eraser retain a bounded sparse exterior with no microscopic control spans',async()=>{
 const p=project();p.pieces=[];p.markings=[];p.surface=parseObj('v -100 -100 0\nv 100 -100 0\nv 100 100 0\nv -100 100 0\nf 1 2 3\nf 1 3 4');
 const fresh=await brushSurfaceMarking(worker,p,undefined,{mode:'add',radiusMm:30,points:[{xMm:0,yMm:0}],paint:{frame,color:'#cc9944',name:'Round material'}});p.markings=[fresh];const before=structuredClone(p),erased=await brushSurfaceMarking(worker,p,fresh.id,{mode:'erase',radiusMm:8,points:[{xMm:0,yMm:0}],shape:fresh.surfaceShape}),shape=erased.surfaceShape!;
 evidence('model-round-brush-observation',{freshNodes:fresh.surfaceShape!.nodes.length,erasedOuterNodes:shape.nodes.length,curves:shape.curves?.length??0,minimumEditableChordMm:minChord(shape.nodes),holes:shape.holes?.map(h=>h.length)});
 expect(p).toEqual(before);expect(shape.holes).toHaveLength(1);for(const n of sampleShapeContour(shape))expect(Math.abs(Math.hypot(n.xMm,n.yMm)-30)).toBeLessThan(.3);
 expect(shape.nodes.length).toBeLessThanOrEqual(24);expect(shape.curves?.length).toBeGreaterThan(0);expect(minChord(shape.nodes)).toBeGreaterThan(.5);
});

it('two-point round brush capsules retain sparse physical boundaries at horizontal and oblique stroke angles',async()=>{
 const rows=[];
 for(const b of[xy(15,7.5),xy(20,-7.5),xy(-7.5,25)]){
  const p=modelProject(),before=structuredClone(p),capsule={a:xy(-15,-7.5),b,radius:30};
  const marking=await brushSurfaceMarking(worker,p,undefined,{mode:'add',radiusMm:capsule.radius,points:[capsule.a,capsule.b],paint:{frame,color:'#cc9944',name:'Capsule'}}),shape=marking.surfaceShape!,sampled=sampleShapeContour(shape);
  const observation={endpoint:b,nodes:shape.nodes.length,curves:shape.curves?.length??0,minimumEditableChordMm:minChord(shape.nodes),...deviations(sampled,[capsule])};rows.push(observation);evidence('model-capsules-observation',rows);expect(p).toEqual(before);assertSparse(shape.nodes,sampled,[capsule],shape.curves?.length??0);
 }
});

it('source-image two-point capsules fit at horizontal and oblique angles without keeping cap tessellation',async()=>{
 const rows=[];for(const b of[xy(15,7.5),xy(20,-7.5),xy(-7.5,25)]){
  const source=project(),piece=rectangle(4,4);piece.allowanceMm=0;piece.nodes.forEach(n=>{n.xMm-=2;n.yMm-=2;});source.pieces=[];source.patternLibrary=[{piece,referenceId:randomUUID(),view:'front',category:'test'}];const before=structuredClone(source),capsule={a:xy(-15,-7.5),b,radius:30};
  const result=await editLibraryRegion(worker,source,piece.id,{piece,operations:[{kind:'brush',mode:'add',radiusMm:30,points:[capsule.a,b]}]}),contour=result.region.piece,sampled=contour.nodes.flatMap(n=>edgeArcPoints(contour,n.id).slice(0,-1));rows.push({endpoint:b,nodes:contour.nodes.length,curves:contour.curves?.length??0,minimumEditableChordMm:minChord(contour.nodes),...deviations(sampled,[capsule])});evidence('source-capsules-observation',rows);expect(source).toEqual(before);assertSparse(contour.nodes,sampled,[capsule],contour.curves?.length??0);
 }
});

it('overlapping round strokes compact the complete material union in both source and model editing',async()=>{
 const capsules:Capsule[]=[{a:xy(-20,-12),b:xy(20,-12),radius:18},{a:xy(-20,12),b:xy(20,12),radius:18},{a:xy(-20,-12),b:xy(20,12),radius:18}],p=modelProject(),rows=[];
 let marking=await brushSurfaceMarking(worker,p,undefined,{mode:'add',radiusMm:18,points:[capsules[0].a,capsules[0].b],paint:{frame,color:'#cc9944',name:'Overlapping fill'}});
 for(let i=1;i<capsules.length;i++){p.markings=[marking];const before=structuredClone(p),c=capsules[i];marking=await brushSurfaceMarking(worker,p,marking.id,{mode:'add',radiusMm:c.radius,points:[c.a,c.b],shape:marking.surfaceShape});expect(p).toEqual(before);}
 const shape=marking.surfaceShape!,modelMetrics={nodes:shape.nodes.length,curveCount:shape.curves?.length??0,minimumEditableChordMm:minChord(shape.nodes),...deviations(sampleShapeContour(shape),capsules)};rows.push({entry:'model',...modelMetrics});evidence('overlapping-brush-observation',rows);expect(shape.holes??[]).toHaveLength(0);
 const source=project(),piece=rectangle(4,4);piece.allowanceMm=0;piece.nodes.forEach(n=>{n.xMm-=2;n.yMm-=2;});source.pieces=[];source.patternLibrary=[{piece,referenceId:randomUUID(),view:'front',category:'test'}];const before=structuredClone(source),result=await editLibraryRegion(worker,source,piece.id,{piece,operations:capsules.map(c=>({kind:'brush',mode:'add',radiusMm:c.radius,points:[c.a,c.b]}))}),contour=result.region.piece,sampled=contour.nodes.flatMap(n=>edgeArcPoints(contour,n.id).slice(0,-1)),sourceMetrics={nodes:contour.nodes.length,curveCount:contour.curves?.length??0,minimumEditableChordMm:minChord(contour.nodes),...deviations(sampled,capsules)};
 rows.push({entry:'source',...sourceMetrics});evidence('overlapping-brush-observation',rows);expect(source).toEqual(before);assertSparse(contour.nodes,sampled,capsules,contour.curves?.length??0);assertSparse(shape.nodes,sampleShapeContour(shape),capsules,shape.curves?.length??0);expect(contour.holes??[]).toHaveLength(0);
},30000);

it('repeated fill strokes entirely inside painted material do not drift its original exterior',async()=>{
 const p=modelProject(),capsule={a:xy(-15,-7.5),b:xy(15,7.5),radius:30};let marking=await brushSurfaceMarking(worker,p,undefined,{mode:'add',radiusMm:30,points:[capsule.a,capsule.b],paint:{frame,color:'#cc9944',name:'Stable filled exterior'}});const rows=[];
 for(let i=0;i<8;i++){p.markings=[marking];const before=structuredClone(p);marking=await brushSurfaceMarking(worker,p,marking.id,{mode:'add',radiusMm:4,points:[xy(-5,0),xy(5,0)],shape:marking.surfaceShape});expect(p).toEqual(before);const shape=marking.surfaceShape!;rows.push({stroke:i+1,nodes:shape.nodes.length,...deviations(sampleShapeContour(shape),[capsule])});}
 evidence('contained-fill-brush-observation',rows);const shape=marking.surfaceShape!;assertSparse(shape.nodes,sampleShapeContour(shape),[capsule],shape.curves?.length??0);
},30000);

it('erasing an exterior notch respects the measured difference boundary and restores exact curves through undo/redo',async()=>{
 const p=modelProject(),fresh=await brushSurfaceMarking(worker,p,undefined,{mode:'add',radiusMm:30,points:[xy(0,0)],paint:{frame,color:'#cc9944',name:'Notched material'}});p.markings=[fresh];const before=structuredClone(p),erased=await brushSurfaceMarking(worker,p,fresh.id,{mode:'erase',radiusMm:12,points:[xy(25,0)],shape:fresh.surfaceShape}),shape=erased.surfaceShape!,sampled=sampleShapeContour(shape);
 const circle=(center:XY,radius:number)=>{const count=Math.ceil(2*Math.PI*radius/.05);return Array.from({length:count},(_,i)=>{const angle=i*2*Math.PI/count;return xy(center.xMm+radius*Math.cos(angle),center.yMm+radius*Math.sin(angle));});};
 const reference=[...circle(xy(0,0),30).filter(n=>Math.hypot(n.xMm-25,n.yMm)>=12),...circle(xy(25,0),12).filter(n=>Math.hypot(n.xMm,n.yMm)<=30)],error=boundaryDeviation(sampled,reference);
 evidence('erase-notch-undo-observation',{nodes:shape.nodes.length,curves:shape.curves?.length??0,minimumEditableChordMm:minChord(shape.nodes),...error});expect(p).toEqual(before);expect(erased.id).toBe(fresh.id);expect(shape.holes??[]).toHaveLength(0);expect(shape.nodes.length).toBeLessThanOrEqual(24);expect(minChord(shape.nodes)).toBeGreaterThan(.5);expect(error.originalToFit).toBeLessThanOrEqual(.5);expect(error.fitToOriginal).toBeLessThanOrEqual(.5);
 const repo=new Repository(':memory:');try{repo.open(p,null);repo.commit({type:'marking.put',marking:erased},randomUUID(),'erase exterior notch');expect(repo.snapshot()!.markings).toEqual([erased]);expect(unpack(pack(repo.snapshot()!).bytes).markings).toEqual([erased]);repo.historyMove(false);expect(repo.snapshot()!.markings).toEqual([fresh]);repo.historyMove(true);expect(repo.snapshot()!.markings).toEqual([erased]);const saved=repo.snapshot()!;await expect(brushSurfaceMarking(worker,saved,erased.id,{mode:'erase',radiusMm:100,points:[xy(0,0)],shape})).rejects.toThrow('EMPTY_MARKING');expect(repo.snapshot()).toEqual(saved);}finally{repo.close();}
},30000);
