import {readFileSync} from 'node:fs';
import {createHash,randomUUID} from 'node:crypto';
import {resolve} from 'node:path';
import {expect,it} from 'vitest';
import type {Piece,Surface} from '../../packages/schema/index';
import {analyze} from '../../apps/desktop/main/worker';
import {unwrapSurface} from '../../apps/desktop/main/surface';
import {project,rectangle} from '../fixtures';

type XY=[number,number];
const analytic=JSON.parse(readFileSync(new URL('../fixtures/allowance-created-hole-analytic.json',import.meta.url),'utf8')) as {outer:XY[];sourceAreaMm2:number;mouthWidthMm:number;allowanceMm:number;bayPoint:XY;mouthPoint:XY;survivingHole:XY[];survivingHoleCenter:XY;collapsedHole:XY[];collapsedHoleCenter:XY};
const realBytes=readFileSync(new URL('../fixtures/allowance-created-hole-pieces.json',import.meta.url));
const real=JSON.parse(realBytes.toString('utf8')) as {cases:{chartIndex:number;piece:Piece;oldIssues:{messageKey:string}[];newCutHoles:number}[]};
const worker=resolve('target/release/fpcad-worker.exe');
const xy=(p:{xMm:number;yMm:number}):XY=>[p.xMm,p.yMm];
const nodes=(points:XY[])=>points.map(([xMm,yMm])=>({id:randomUUID(),xMm,yMm}));
const area=(ring:XY[])=>{const o=ring[0];return Math.abs(ring.reduce((sum,a,i)=>{const b=ring[(i+1)%ring.length];return sum+(a[0]-o[0])*(b[1]-o[1])-(b[0]-o[0])*(a[1]-o[1]);},0)/2);};
const inside=(p:XY,ring:XY[])=>{let result=false;for(let i=0,j=ring.length-1;i<ring.length;j=i++){const a=ring[i],b=ring[j];if((a[1]>p[1])!==(b[1]>p[1])&&p[0]<(b[0]-a[0])*(p[1]-a[1])/(b[1]-a[1])+a[0])result=!result;}return result;};
const edgeSet=(ring:{xMm:number;yMm:number}[])=>ring.map((a,i)=>[JSON.stringify(xy(a)),JSON.stringify(xy(ring[(i+1)%ring.length]))].sort().join(':')).sort();
async function analyzePiece(piece:Piece){
 const p=project();p.pieces=[piece];const before=structuredClone(p),g=await analyze(worker,p);expect(g).toHaveLength(1);expect(p).toEqual(before);
 const geometry=g[0];if(!geometry.seam)throw Error('The actual native result must retain its source seam');
 return {...geometry,seam:geometry.seam};
}

function cShape(join:NonNullable<Piece['join']>,variable:boolean,hole?:XY[]):Piece{
 const piece:Piece={...rectangle(),name:'Analytic C, 10 mm mouth and 10 mm allowance',nodes:nodes(analytic.outer),holes:hole?[nodes(hole)]:[],allowanceMm:analytic.allowanceMm,join};
 if(variable)piece.edgeAllowances=[{nodeId:piece.nodes[0].id,endNodeId:piece.nodes[1].id,samples:[{s:0,widthMm:8},{s:1,widthMm:12}]}];
 return piece;
}
const configurations=(['round','bevel','miter'] as const).flatMap(join=>[false,true].map(variable=>({join,variable})));

for(const config of configurations){
 const label=`${config.join}, ${config.variable?'nonuniform 8–12 mm edge profile':'uniform allowance'}`;
 it(`a 10 mm C mouth closes into one new cut hole while its original seam remains intact (${label})`,async()=>{
  const piece=cShape(config.join,config.variable),before=structuredClone(piece),g=await analyzePiece(piece);
  expect(area(analytic.outer)).toBe(8100);expect(analytic.mouthWidthMm).toBe(10);expect(g.issues.filter(i=>i.severity==='error')).toEqual([]);
  expect(g.cutHoles).toHaveLength(1);expect(g.seamHoles??[]).toHaveLength(0);expect(g.areaMm2).toBe(8100);
  expect(edgeSet(g.seam)).toEqual(edgeSet(piece.nodes));expect(piece).toEqual(before);
  const holes=g.cutHoles!.map(r=>r.map(xy)),outer=g.cut.map(xy);
  expect(inside(analytic.mouthPoint,analytic.outer)).toBe(false);expect(inside(analytic.mouthPoint,outer)).toBe(true);
  expect(holes.some(h=>inside(analytic.mouthPoint,h))).toBe(false);expect(holes.filter(h=>inside(analytic.bayPoint,h))).toHaveLength(1);
  if(!config.variable)expect([Math.min(...outer.map(p=>p[0])),Math.max(...outer.map(p=>p[0])),Math.min(...outer.map(p=>p[1])),Math.max(...outer.map(p=>p[1]))]).toEqual([-10,110,-10,110]);
 });

 it(`keeps one true source-hole inset as well as the new outer-generated hole (${label})`,async()=>{
  const piece=cShape(config.join,config.variable,analytic.survivingHole),g=await analyzePiece(piece);
  expect(g.issues.filter(i=>i.severity==='error')).toEqual([]);expect(g.seamHoles).toHaveLength(1);expect(g.cutHoles).toHaveLength(2);
  expect(edgeSet(g.seam)).toEqual(edgeSet(piece.nodes));expect(edgeSet(g.seamHoles![0])).toEqual(edgeSet(piece.holes![0]));
  expect(g.areaMm2).toBe(8100-625);
  const holes=g.cutHoles!.map(r=>r.map(xy)),source=analytic.survivingHole;
  // A square is convex: containment of every output vertex proves each
  // straight output edge is entirely inside this specific original hole.
  const insets=holes.filter(h=>h.every(p=>p[0]>=2.5&&p[0]<=27.5&&p[1]>=37.5&&p[1]<=62.5));
  expect(insets).toHaveLength(1);expect(inside(analytic.survivingHoleCenter,insets[0])).toBe(true);expect(area(insets[0])).toBeCloseTo(25,6);
  expect(holes.filter(h=>inside(analytic.bayPoint,h))).toHaveLength(1);expect(inside(analytic.bayPoint,source)).toBe(false);
 });

 it(`rejects a collapsed 5 mm source hole even though a new bay hole would keep the old total-hole count equal (${label})`,async()=>{
  const control=cShape(config.join,config.variable),g0=await analyzePiece(control);expect(g0.issues.filter(i=>i.severity==='error')).toEqual([]);expect(g0.cutHoles).toHaveLength(1);
  const piece=cShape(config.join,config.variable,analytic.collapsedHole),sourceOnly={...structuredClone(piece),allowanceMm:0,edgeAllowances:undefined},validSource=await analyzePiece(sourceOnly);
  expect(validSource.issues.filter(i=>i.severity==='error')).toEqual([]);expect(validSource.cutHoles).toHaveLength(1);expect(area(analytic.collapsedHole)).toBe(25);
  // The one surviving bay cut-out is not the source hole it would replace.
  expect(piece.holes).toHaveLength(g0.cutHoles!.length);expect(g0.cutHoles!.some(h=>inside(analytic.collapsedHoleCenter,h.map(xy)))).toBe(false);
  const g=await analyzePiece(piece);expect(g.issues.some(i=>i.severity==='error'&&i.messageKey==='holeCollapsed')).toBe(true);
 });
}

it.each(real.cases)('the captured chart $chartIndex no longer becomes a manufacturing failure solely because allowance creates a new hole',async fixture=>{
 const piece=structuredClone(fixture.piece),before=structuredClone(piece);expect(piece.holes).toEqual([]);expect(piece.allowanceMm).toBe(10);expect(fixture.oldIssues.some(i=>i.messageKey==='holeCollapsed')).toBe(true);
 const nativeSource=await analyzePiece({...structuredClone(piece),allowanceMm:0});expect(nativeSource.issues.filter(i=>i.severity==='error')).toEqual([]);
 const g=await analyzePiece(piece);expect(g.issues.filter(i=>i.severity==='error')).toEqual([]);expect(g.cut.length).toBeGreaterThan(2);expect(g.cutHoles).toHaveLength(fixture.newCutHoles);expect(g.cutHoles!.length).toBeGreaterThan(0);
 // serde_json/V8 decimal conversion differs by a final Float64 bit on these
 // captured coordinates. Compare allowance output to the exact native zero-
 // allowance seam. Native Geometry assigns derived point IDs, so its entire
 // ordered seam (coordinates, IDs, edge count) must equal that baseline;
 // original source IDs and coordinates remain protected by input equality.
 // No positional tolerance is introduced.
 expect(g.seamHoles??[]).toHaveLength(0);expect(g.seam).toEqual(nativeSource.seam);expect(g.seam).toHaveLength(piece.nodes.length);expect(piece).toEqual(before);
 expect(Math.abs(g.areaMm2/area(piece.nodes.map(xy))-1)).toBeLessThanOrEqual(1e-8);
});

it('uses only the four captured paper outlines, not the whole generated working mesh',()=>{
 expect(real.cases).toHaveLength(4);expect(realBytes.length).toBeLessThan(350000);
 expect(createHash('sha256').update(realBytes).digest('hex')).toBe('70634e374a64dc3029ec5003d5089f202a72b287e0a983ff1ff121a09fdfb043');
});

it('complete native unfolding of the actual 815-face bay chart keeps one piece when 10 mm allowance creates a hole',async()=>{
 const bytes=readFileSync(new URL('../fixtures/allowance-bay-real-surface.json',import.meta.url));
 expect(createHash('sha256').update(bytes).digest('hex')).toBe('082b48eebdeef3e6e8f1ec4b269c2a39d0829d98ba6bb9a0ffa2125119843b7c');
 const {mesh}=JSON.parse(bytes.toString('utf8')) as {mesh:Surface},before=structuredClone(mesh),seamLengths:number[][]=[];
 expect(mesh.faces).toHaveLength(815);expect(mesh.vertices).toHaveLength(804);
 for(const allowanceMm of [0,10]){
  const p=project();p.pieces=[];p.defaultAllowanceMm=allowanceMm;p.surface=structuredClone(mesh);
  const run=await unwrapSurface(worker,mesh,p,{method:'arap',partitionStrategy:'design',automaticCuts:true,colorBoundaryCuts:false,iterations:30,optimizeCuts:true,maxPieces:500});
  expect(run.pieces).toHaveLength(1);expect(run.bindings).toHaveLength(1);expect(run.optimization).toBeDefined();expect(run.optimization?.repairPasses??0).toBe(0);
  expect(run.bindings[0].report.faceIds).toHaveLength(before.faces.length);expect(new Set(run.bindings[0].report.faceIds)).toEqual(new Set(before.faces.map(f=>f.id)));
  const report=run.bindings[0].report;expect(report.areaErrorMax).toBeLessThanOrEqual(.15);expect(report.edgeErrorMax).toBeLessThanOrEqual(.1);expect(report.distortionMax).toBeLessThanOrEqual(.15);expect(report.seamErrorMax).toBeLessThanOrEqual(.0005);expect(report.seamLengthErrorMm).toBeLessThanOrEqual(.25);
  // Generated pieces inherit their project's allowance. Retain that exact
  // project context for both the zero and ten millimetre native checks.
  const geometry=await analyze(worker,{...p,pieces:run.pieces});expect(geometry).toHaveLength(1);const g=geometry[0];if(!g.seam)throw Error('Missing source seam');
  expect(g.issues.filter(i=>i.severity==='error')).toEqual([]);expect(g.seamHoles??[]).toHaveLength(0);expect(g.cutHoles??[]).toHaveLength(allowanceMm===0?0:1);
  const seam=g.seam;seamLengths.push(seam.map((a,i)=>{const b=seam[(i+1)%seam.length];return Math.hypot(a.xMm-b.xMm,a.yMm-b.yMm);}).sort((a,b)=>a-b));
  expect(mesh).toEqual(before);
 }
 expect(seamLengths[0]).toHaveLength(seamLengths[1].length);for(let i=0;i<seamLengths[0].length;i++)expect(seamLengths[0][i]).toBeCloseTo(seamLengths[1][i],6);
},120000);
