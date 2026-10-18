import {describe,it,expect} from 'vitest';
import {speciesParamsSchema,type Surface} from '../../packages/schema/index';
import {speciesDefaults} from '../../packages/body/defaults';
import {validSpeciesParameters} from '../../packages/body/parameter-validation';
import {drawingIssue} from '../../packages/surface/drawing';
import type {Shape,Point,World} from '../../packages/surface/attached-edit';
import {shapeWorld} from '../../packages/surface/attached-edit';
import {compactPaintContour} from '../../packages/surface/paint-contour';
import {sampleShapeContour} from '../../packages/surface/shape-contour';
import {simplifySurfaceStroke} from '../../packages/surface/stroke-path';
import {dragShapeTransform,setShapeTransform,transformFrame} from '../../packages/surface/free-transform';
import {surfaceCurveSegments} from '../../packages/surface/surface-curve';
import {mirrorPaintShape,mirrorSurfacePoint,surfaceSymmetryGuide} from '../../packages/surface/symmetry';
import {splitDesignDomain} from '../../packages/surface/design-partition';

const frame={origin:[0,0,0] as [number,number,number],axes:[[1,0,0],[0,1,0],[0,0,1]] as [[number,number,number],[number,number,number],[number,number,number]]};
const xy=(xMm:number,yMm:number):Point=>({xMm,yMm});
const xyz=(xMm:number,yMm:number,zMm:number):World=>({xMm,yMm,zMm});
const distance=(a:World,b:World)=>Math.hypot(a.xMm-b.xMm,a.yMm-b.yMm,a.zMm-b.zMm);
function segmentDistance(p:World,a:World,b:World){const dx=b.xMm-a.xMm,dy=b.yMm-a.yMm,dz=b.zMm-a.zMm,d=dx*dx+dy*dy+dz*dz,t=d?Math.max(0,Math.min(1,((p.xMm-a.xMm)*dx+(p.yMm-a.yMm)*dy+(p.zMm-a.zMm)*dz)/d)):0;return distance(p,xyz(a.xMm+t*dx,a.yMm+t*dy,a.zMm+t*dz));}
const boundaryDistance=(p:Point,ring:Point[])=>Math.min(...ring.map((a,i)=>segmentDistance({...p,zMm:0},{...a,zMm:0},{...ring[(i+1)%ring.length],zMm:0})));
const area=(ring:Point[])=>Math.abs(ring.reduce((s,a,i)=>{const b=ring[(i+1)%ring.length];return s+a.xMm*b.yMm-b.xMm*a.yMm;},0)/2);
const rectangle=():Shape=>({...frame,nodes:[xy(0,0),xy(100,0),xy(100,60),xy(0,60)],holes:[[xy(10,10),xy(10,20),xy(20,20),xy(20,10)]]});
function mesh(vertices:World[],indices:number[][]):Surface{return {id:'workflow-model',source:'obj',topologyVersion:1,vertices:vertices.map((p,i)=>({...p,id:'v'+i})),faces:indices.map((v,i)=>({id:'f'+i,vertices:v.map(j=>'v'+j) as [string,string,string],region:'shell'}))};}
function cube(){return mesh([xyz(-50,-50,-50),xyz(50,-50,-50),xyz(50,50,-50),xyz(-50,50,-50),xyz(-50,-50,50),xyz(50,-50,50),xyz(50,50,50),xyz(-50,50,50)],[[4,5,6],[4,6,7],[0,3,2],[0,2,1],[1,2,6],[1,6,5],[3,7,6],[3,6,2],[0,4,7],[0,7,3],[0,1,5],[0,5,4]]);}
function cylinder(){const vertices:World[]=[],faces:number[][]=[];for(let i=0;i<32;i++){const a=i*Math.PI/16;vertices.push(xyz(50*Math.cos(a),-50,50*Math.sin(a)),xyz(50*Math.cos(a),50,50*Math.sin(a)));}for(let i=0;i<32;i++){const a=i*2,b=(i+1)%32*2;faces.push([a,a+1,b+1],[a,b+1,b]);}return mesh(vertices,faces);}

it('repair splits a tube along its length and retains every physical face',()=>{
 const points:World[]=[],triangles:number[][]=[];
 for(let j=0;j<=10;j++)for(let i=0;i<32;i++)points.push(xyz(50*Math.cos(i*Math.PI/16),j*60-300,50*Math.sin(i*Math.PI/16)));
 for(let j=0;j<10;j++)for(let i=0;i<32;i++){const a=j*32+i,b=j*32+(i+1)%32;triangles.push([a,a+32,b+32],[a,b+32,b]);}
 const surface=mesh(points,triangles),before=structuredClone(surface),parts=splitDesignDomain(surface,surface.faces),vertices=new Map(surface.vertices.map(v=>[v.id,v]));
 expect(parts).toHaveLength(2);expect(parts.flat().map(f=>f.id).sort()).toEqual(surface.faces.map(f=>f.id).sort());
 for(const faces of parts){const heights=faces.flatMap(f=>f.vertices.map(id=>vertices.get(id)!.yMm));expect(Math.min(...heights)).toBe(-300);expect(Math.max(...heights)).toBe(300);}
 expect(surface).toEqual(before);
});
function cutWorld(surface:Surface,points:World[]){const cuts=surfaceCurveSegments(surface,points,false,'independent-cut'),vertices=new Map(surface.vertices.map(v=>[v.id,v])),faces=new Map(surface.faces.map(f=>[f.id,f]));return cuts.map(c=>{const f=faces.get(c.faceId)!;const at=(w:number[])=>f.vertices.reduce((p,id,i)=>{const v=vertices.get(id)!;return xyz(p.xMm+v.xMm*w[i],p.yMm+v.yMm*w[i],p.zMm+v.zMm*w[i]);},xyz(0,0,0));for(const w of[c.a,c.b]){expect(w.reduce((a,b)=>a+b,0)).toBeCloseTo(1,9);expect(w.every(n=>Number.isFinite(n)&&n>=-1e-7&&n<=1+1e-7)).toBe(true);}return {a:at(c.a),b:at(c.b),faceId:c.faceId};});}
function checkConnected(surface:Surface,points:World[]){const before=structuredClone(surface),segments=cutWorld(surface,points);expect(segments.length).toBeGreaterThan(1);expect(distance(segments[0].a,points[0])).toBeLessThan(1e-6);expect(distance(segments.at(-1)!.b,points.at(-1)!)).toBeLessThan(1e-6);for(let i=1;i<segments.length;i++)expect(distance(segments[i-1].b,segments[i].a)).toBeLessThan(1e-6);expect(surface).toEqual(before);return segments;}

describe('completed brush contours and captured world strokes',()=>{
 it('a dense curved paint loop becomes sparse within an independently measured boundary and area budget',()=>{
  const nodes=Array.from({length:360},(_,i)=>{const a=i*Math.PI/180;return xy(70*Math.cos(a),40*Math.sin(a));}),shape:Shape={...frame,nodes,holes:[[xy(-6,-6),xy(-6,6),xy(6,6),xy(6,-6)]]},before=structuredClone(shape),result=compactPaintContour(shape,.25),sampled=sampleShapeContour(result);
  expect(result.nodes.length).toBeLessThan(30);expect(result.curves?.length).toBeGreaterThan(0);expect(result.holes).toEqual(shape.holes);expect(shape).toEqual(before);
  for(const p of nodes)expect(boundaryDistance(p,sampled)).toBeLessThanOrEqual(.3);
  for(const p of sampled)expect(boundaryDistance(p,nodes)).toBeLessThanOrEqual(.3);
  expect(Math.abs(area(sampled)-Math.PI*70*40)/(Math.PI*70*40)).toBeLessThan(.01);
 });
 it('dense three dimensional strokes retain physical corners, endpoints and the millimetre error bound',()=>{
  const points=Array.from({length:201},(_,i)=>i<=100?xyz(i*.5,Math.sin(i)*.025,0):xyz(50,(i-100)*.5,(i-100)*.3)),before=structuredClone(points),result=simplifySurfaceStroke(points,.1);
  expect(result).toHaveLength(3);expect(result[0]).toEqual(points[0]);expect(result[1]).toEqual(points[100]);expect(result.at(-1)).toEqual(points.at(-1));expect(points).toEqual(before);
  for(const p of points)expect(Math.min(...result.slice(1).map((q,i)=>segmentDistance(p,result[i],q)))).toBeLessThanOrEqual(.1);
  expect(()=>simplifySurfaceStroke([xyz(0,0,0),xyz(NaN,1,0)],.1)).toThrow();
 });
 it('almost duplicate adjacent brush vertices do not prevent sparse, valid ellipse fitting',()=>{
  const base=Array.from({length:202},(_,i)=>{const a=i*2*Math.PI/202;return xy(40*Math.cos(a),18*Math.sin(a));}),nodes=[base[0],xy(base[0].xMm-1e-6,base[0].yMm+1e-6),...base.slice(1)],shape:Shape={...frame,nodes},before=structuredClone(shape),fitted=compactPaintContour(shape,.25),sampled=sampleShapeContour(fitted);expect(fitted.nodes.length).toBeLessThan(30);expect(fitted.curves?.length).toBeGreaterThan(0);expect(drawingIssue(sampled)).toBeFalsy();for(const p of nodes)expect(boundaryDistance(p,sampled)).toBeLessThanOrEqual(.3);for(const p of sampled)expect(boundaryDistance(p,nodes)).toBeLessThanOrEqual(.3);expect(shape).toEqual(before);
 });
});

it('all six default species have valid body space while an impossible shorter rabbit is rejected by form and schema',()=>{
 for(const name of['canine','feline','rabbit','bear','deer','dragon'] as const){const p=speciesDefaults(name);expect(validSpeciesParameters(p),name).toBe(true);expect(speciesParamsSchema.safeParse(p).success,name).toBe(true);}
 const rabbit={...speciesDefaults('rabbit'),heightMm:1500};expect(validSpeciesParameters(rabbit)).toBe(false);expect(speciesParamsSchema.safeParse(rabbit).success).toBe(false);expect(validSpeciesParameters({...rabbit,legLengthMm:690})).toBe(true);expect(speciesParamsSchema.safeParse({...rabbit,legLengthMm:690}).success).toBe(true);
});

describe('free transforms preserve the editable geometry and opposite anchor',()=>{
 it('corner and side drags keep the opposite handle fixed, including rotated frames and holes',()=>{
  for(const angle of[0,Math.PI/5])for(const [handle,opposite]of[['ne','sw'],['e','w'],['s','n']] as const){const initial=setShapeTransform(rectangle(),100,60,angle),snapshot=structuredClone(initial),f=transformFrame(initial,angle),start=f.handles.find(h=>h.id===handle)!.point,anchor=f.handles.find(h=>h.id===opposite)!.point,result=dragShapeTransform(initial,handle,start,xy(start.xMm+18,start.yMm+12),{angleRad:angle}),end=transformFrame(result.shape,result.angleRad).handles.find(h=>h.id===opposite)!.point;expect(Math.hypot(end.xMm-anchor.xMm,end.yMm-anchor.yMm)).toBeLessThan(1e-7);expect(result.shape.holes?.[0]).toHaveLength(4);expect(initial).toEqual(snapshot);}
 });
 it('absolute width, height and angle can be applied repeatedly without incremental rotation or drift',()=>{
  const source=rectangle(),first=setShapeTransform(source,125,75,Math.PI/3),again=setShapeTransform(first,125,75,Math.PI/3,Math.PI/3),f=transformFrame(again,Math.PI/3);expect(f.width).toBeCloseTo(125,7);expect(f.height).toBeCloseTo(75,7);expect(f.center.xMm).toBeCloseTo(50,7);expect(f.center.yMm).toBeCloseTo(30,7);for(const [a,b]of [...first.nodes.map((p,i)=>[p,again.nodes[i]]),...first.holes![0].map((p,i)=>[p,again.holes![0][i]])])expect(Math.hypot(a.xMm-b.xMm,a.yMm-b.yMm)).toBeLessThan(1e-7);
 });
});

describe('surface cut paths follow a connected visible sheet after view changes',()=>{
 it('a front/right/top cube stroke crosses adjacent faces continuously without using the back sheet',()=>{
  const segments=checkConnected(cube(),[xyz(0,0,50),xyz(50,0,0),xyz(0,50,0)]),length=segments.reduce((s,e)=>s+distance(e.a,e.b),0);expect(length).toBeCloseTo(200,7);for(const e of segments)for(const p of[e.a,e.b]){expect(Math.max(Math.abs(p.xMm),Math.abs(p.yMm),Math.abs(p.zMm))).toBeCloseTo(50,7);expect(p.xMm).toBeGreaterThanOrEqual(-1e-7);expect(p.yMm).toBeGreaterThanOrEqual(-1e-7);expect(p.zMm).toBeGreaterThanOrEqual(-1e-7);}
 });
 it('cylinder quarter-turn cuts stay on their own hemisphere and contain no interior chord shortcuts',()=>{
  const surface=cylinder();for(const [start,end,left]of[[xyz(50,-20,0),xyz(0,10,50),false],[xyz(0,10,50),xyz(-50,20,0),true]] as const){const segments=checkConnected(surface,[start,end]),length=segments.reduce((s,e)=>s+distance(e.a,e.b),0);expect(length).toBeGreaterThan(78);expect(length).toBeLessThan(92);for(const e of segments)for(const p of[e.a,e.b]){expect(p.zMm).toBeGreaterThanOrEqual(-1e-7);expect(left?p.xMm<=1e-7:p.xMm>=-1e-7).toBe(true);expect(Math.hypot(p.xMm,p.zMm)).toBeGreaterThanOrEqual(49.7);}}
 });
 it('overlapping disconnected sheets fail atomically instead of inventing a projected bridge',()=>{
  const surface=mesh([xyz(0,0,10),xyz(100,0,10),xyz(0,100,10),xyz(0,0,-10),xyz(100,0,-10),xyz(0,100,-10)],[[0,1,2],[3,4,5]]),before=structuredClone(surface);expect(()=>surfaceCurveSegments(surface,[xyz(20,20,10),xyz(20,20,-10)],false,'seam')).toThrow();expect(surface).toEqual(before);
 });
});

it('half-side reflection preserves world geometry and holes and yields a right-handed paint frame',()=>{
 const surface=cube();surface.cutScope={axis:'x',positionMm:12,side:'right',closeMidline:true};const p={...xyz(30,8,50),pressure:.7},reflected=mirrorSurfacePoint(surface,p);expect(reflected).toEqual({...p,xMm:-6});expect(mirrorSurfacePoint(surface,reflected)).toEqual(p);
 const shape={...rectangle(),origin:[30,0,50] as [number,number,number]},mirrored=mirrorPaintShape(surface,shape);for(let i=0;i<shape.nodes.length;i++)expect(shapeWorld(mirrored,mirrored.nodes[i])).toEqual(mirrorSurfacePoint(surface,shapeWorld(shape,shape.nodes[i])));for(let i=0;i<shape.holes![0].length;i++)expect(shapeWorld(mirrored,mirrored.holes![0][i])).toEqual(mirrorSurfacePoint(surface,shapeWorld(shape,shape.holes![0][i])));
 const [x,y,z]=mirrored.axes,cross=[x[1]*y[2]-x[2]*y[1],x[2]*y[0]-x[0]*y[2],x[0]*y[1]-x[1]*y[0]];expect(cross.reduce((sum,v,i)=>sum+v*z[i],0)).toBeCloseTo(1,9);for(const line of surfaceSymmetryGuide(surface))for(const p of[line.a,line.b])expect(p.xMm).toBe(12);
});
