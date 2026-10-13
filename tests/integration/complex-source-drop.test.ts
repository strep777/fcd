import {expect,it} from 'vitest';
import {randomUUID} from 'node:crypto';
import {resolve} from 'node:path';
import {readFileSync} from 'node:fs';
import {rectangle,project} from '../fixtures';
import {sourceSurfaceShape} from '../../packages/surface/source-drop';
import {edgeArcPoints} from '../../packages/pattern/edit';
import {contourPiece,sampleShapeContour,splitContourEdge,moveContourNode,deleteContourNode} from '../../packages/surface/shape-contour';
import {transformShape,translateShape} from '../../packages/surface/attached-edit';
import {surfaceMarking,staleMarkingIds} from '../../apps/desktop/main/markings';
import {parseObj} from '../../apps/desktop/main/surface';
import {resizeShape} from '../../apps/desktop/main/resize-project';
import {markingSchema,projectSchema,pieceSchema} from '../../packages/schema/index';
import {analyze} from '../../apps/desktop/main/worker';

export function curvedSource(){
 const source=rectangle();source.allowanceMm=0;
 const count=16,radius=20000,step=2*Math.PI/count,handle=4/3*Math.tan(step/4)*radius;
 source.nodes=Array.from({length:count},(_,i)=>({id:randomUUID(),xMm:radius*Math.cos(i*step),yMm:radius*Math.sin(i*step)}));
 source.curves=source.nodes.map((a,i)=>{const b=source.nodes[(i+1)%count],alpha=i*step,beta=(i+1)*step;return {id:randomUUID(),startNodeId:a.id,endNodeId:b.id,c1:{id:randomUUID(),xMm:a.xMm-handle*Math.sin(alpha),yMm:a.yMm+handle*Math.cos(alpha)},c2:{id:randomUUID(),xMm:b.xMm+handle*Math.sin(beta),yMm:b.yMm-handle*Math.cos(beta)}};});
 return source;
}
const frame={origin:[0,0,0] as [number,number,number],axes:[[1,0,0],[0,1,0],[0,0,1]] as [[number,number,number],[number,number,number],[number,number,number]]};
it('allows dropping a valid source whose derived curve samples exceed the editable-node budget',()=>{
 const source=curvedSource(),before=structuredClone(source);
 expect(source.nodes.flatMap(n=>edgeArcPoints(source,n.id).slice(0,-1)).length).toBeGreaterThan(2000);
 expect(()=>sourceSurfaceShape(source,{xMm:0,yMm:0,zMm:0},frame)).not.toThrow();
 const shape=sourceSurfaceShape(source,{xMm:0,yMm:0,zMm:0},frame);
 expect(shape.nodes).toHaveLength(16);expect(shape.curves).toHaveLength(16);
 expect(sampleShapeContour(shape)).toEqual(source.nodes.flatMap(n=>edgeArcPoints(source,n.id).slice(0,-1)).map(({xMm,yMm})=>({xMm,yMm})));
 expect(source).toEqual(before);
});
it('projects the original cubic source into real model fragments without reducing its accuracy',async()=>{
 const worker=resolve('target/release/fpcad-worker.exe'),p=project();p.pieces=[];
 p.surface=parseObj('v -30000 -30000 0\nv 30000 -30000 0\nv 30000 30000 0\nv -30000 30000 0\nv 0 0 0\nf 1 2 5\nf 2 3 5\nf 3 4 5\nf 4 1 5');
 const source=curvedSource(),shape=sourceSurfaceShape(source,{xMm:0,yMm:0,zMm:0},frame),marking=await surfaceMarking(worker,p,shape,source.color,source.name);
 p.markings=[marking];expect(markingSchema.safeParse(marking).success).toBe(true);expect(projectSchema.safeParse(p).success).toBe(true);expect(staleMarkingIds(p).size).toBe(0);expect(marking.surfaceShape).toEqual(shape);expect(marking.fragments.length).toBe(4);
 const vertices=new Map(p.surface.vertices.map(v=>[v.id,v]));let paintedArea=0;
 for(const fragment of marking.fragments){const face=p.surface.faces.find(f=>f.id===fragment.faceId)!;for(const ring of fragment.rings){const xy=ring.map(w=>({x:w.reduce((n,v,i)=>n+v*vertices.get(face.vertices[i])!.xMm,0),y:w.reduce((n,v,i)=>n+v*vertices.get(face.vertices[i])!.yMm,0)}));paintedArea+=xy.reduce((n,a,i)=>{const b=xy[(i+1)%xy.length];return n+a.x*b.y-b.x*a.y;},0)/2;}}
 const expected=(await analyze(worker,{...p,pieces:[source]}))[0].areaMm2;expect(Math.abs(paintedArea-expected)/expected).toBeLessThan(1e-10);
},30000);
it('moves, resizes and subdivides cubic controls without flattening saved source geometry',()=>{
 const shape=sourceSurfaceShape(curvedSource(),{xMm:0,yMm:0,zMm:0},frame),moved=translateShape(shape,20,-30),scaled=transformShape(shape,.5,.25,0);
 expect(moved.curves![0].c1.xMm).toBe(shape.curves![0].c1.xMm+20);expect(moved.curves![0].c2.yMm).toBe(shape.curves![0].c2.yMm-30);
 expect(scaled.curves![0].c1.xMm).toBeCloseTo(shape.curves![0].c1.xMm*.5,8);expect(scaled.curves![0].c2.yMm).toBeCloseTo(shape.curves![0].c2.yMm*.25,8);
 const split=splitContourEdge(shape,0,.5);expect(split.nodes).toHaveLength(17);expect(split.curves).toHaveLength(17);
 const a=shape.nodes[0],b=shape.nodes[1],c=shape.curves![0];expect(split.nodes[1].xMm).toBeCloseTo((a.xMm+3*c.c1.xMm+3*c.c2.xMm+b.xMm)/8,8);
 const shifted=moveContourNode(split,1,{xMm:split.nodes[1].xMm+7,yMm:split.nodes[1].yMm-4});
 expect(shifted.curves!.find(c=>c.startIndex===1)!.c1.xMm).toBe(split.curves!.find(c=>c.startIndex===1)!.c1.xMm+7);
 const removed=deleteContourNode(shifted,1);expect(removed.nodes).toHaveLength(16);expect(removed.curves).toHaveLength(15);expect(()=>contourPiece(removed)).not.toThrow();
 const mesh=parseObj('v -30000 -30000 0\nv 30000 -30000 0\nv 30000 30000 0\nf 1 2 3'),next={...mesh,vertices:mesh.vertices.map(v=>({...v,xMm:v.xMm*2,yMm:v.yMm*3}))},resized=resizeShape(shape,mesh,next);
 expect(resized.curves![0].c1.xMm).toBeCloseTo(shape.curves![0].c1.xMm*2,8);expect(resized.curves![0].c2.yMm).toBeCloseTo(shape.curves![0].c2.yMm*3,8);
});
it('rejects malformed indexed curves rather than silently attaching a different shape',()=>{
 const shape=sourceSurfaceShape(curvedSource(),{xMm:0,yMm:0,zMm:0},frame),curve=shape.curves![0];
 for(const curves of [[curve,curve],[{...curve,startIndex:16}],[{...curve,c1:{xMm:NaN,yMm:0}}]])expect(()=>contourPiece({...shape,curves})).toThrow('INVALID_GEOMETRY');
 expect(()=>contourPiece({...shape,spline:{algorithm:'closed-catmull-rom-1',tension:.5,toleranceMm:.05}})).toThrow('INVALID_GEOMETRY');
});
it('retains a dense 150 mm contour at its calibrated size rather than rejecting its sampled edge',()=>{
 const source=rectangle(),count=160,step=2*Math.PI/count;
 source.nodes=Array.from({length:count},(_,i)=>({id:randomUUID(),xMm:60*Math.cos(i*step),yMm:60*Math.sin(i*step)}));
 const control=(a:number)=>({id:randomUUID(),xMm:80*Math.cos(a),yMm:80*Math.sin(a)});
 source.curves=source.nodes.map((n,i)=>({id:randomUUID(),startNodeId:n.id,endNodeId:source.nodes[(i+1)%count].id,c1:control((i+1/3)*step),c2:control((i+2/3)*step)}));
 const samples=source.nodes.flatMap(n=>edgeArcPoints(source,n.id).slice(0,-1));expect(samples.length).toBeGreaterThan(2000);
 const shape=sourceSurfaceShape(source,{xMm:0,yMm:0,zMm:0},frame,{xMm:0,yMm:0});expect(shape.nodes.length).toBe(160);expect(shape.curves!.length).toBe(160);
 expect(sampleShapeContour(shape)).toEqual(samples.map(({xMm,yMm})=>({xMm,yMm})));
});
it('attaches the actual previously saved character contour, including its six holes',async()=>{
 const source=pieceSchema.parse(JSON.parse(readFileSync(resolve('tests/fixtures/legacy-curved-character-piece.json'),'utf8'))),before=structuredClone(source);
 expect(source.nodes).toHaveLength(318);expect(source.curves).toHaveLength(318);expect(source.holes).toHaveLength(6);
 const samples=source.nodes.flatMap(n=>edgeArcPoints(source,n.id).slice(0,-1));expect(samples.length).toBeGreaterThan(3000);
 const cx=(Math.min(...samples.map(p=>p.xMm))+Math.max(...samples.map(p=>p.xMm)))/2,cy=(Math.min(...samples.map(p=>p.yMm))+Math.max(...samples.map(p=>p.yMm)))/2;
 const shape=sourceSurfaceShape(source,{xMm:0,yMm:0,zMm:0},frame);
 expect(shape.nodes).toHaveLength(318);expect(shape.curves).toHaveLength(318);expect(shape.holes).toHaveLength(6);
 const actual=sampleShapeContour(shape);expect(actual).toHaveLength(samples.length);actual.forEach((p,i)=>{expect(p.xMm).toBeCloseTo(samples[i].xMm-cx,8);expect(p.yMm).toBeCloseTo(samples[i].yMm-cy,8);});
 const p=project();p.pieces=[];p.surface=parseObj('v -2500 -2500 0\nv 2500 -2500 0\nv 2500 2500 0\nv -2500 2500 0\nf 1 2 3\nf 1 3 4');
 const worker=resolve('target/release/fpcad-worker.exe'),marking=await surfaceMarking(worker,p,shape,source.color,source.name);
 expect(marking.fragments.length).toBeGreaterThan(0);expect(marking.surfaceShape).toEqual(shape);
 const vertices=new Map(p.surface.vertices.map(v=>[v.id,v]));let area=0;
 for(const f of marking.fragments){const face=p.surface.faces.find(v=>v.id===f.faceId)!;for(const ring of f.rings){const xy=ring.map(b=>({x:b.reduce((s,w,i)=>s+w*vertices.get(face.vertices[i])!.xMm,0),y:b.reduce((s,w,i)=>s+w*vertices.get(face.vertices[i])!.yMm,0)}));area+=xy.reduce((s,a,i)=>{const b=xy[(i+1)%xy.length];return s+a.x*b.y-b.x*a.y;},0)/2;}}
 const expected=(await analyze(worker,{...p,pieces:[source]}))[0].areaMm2;expect(Math.abs(area-expected)/expected).toBeLessThan(1e-8);expect(source).toEqual(before);
},30000);
