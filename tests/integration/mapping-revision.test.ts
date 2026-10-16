import {expect,it} from 'vitest';
import {randomUUID} from 'node:crypto';
import {resolve} from 'node:path';
import {project,rectangle} from '../fixtures';
import type {CutProjection,Project} from '../../packages/schema/index';
import {anatomicalPlacement} from '../../apps/desktop/main/anatomical-placement';
import {projectMarking,surfaceMarking,staleMarkingIds} from '../../apps/desktop/main/markings';
import {editSurfaceMarking} from '../../apps/desktop/main/surface-marking-edit';
import {parseObj} from '../../apps/desktop/main/surface';
import {surfaceDragShape,shapeWorld,shapePoint,editableShape} from '../../packages/surface/attached-edit';
import {sourceSurfaceShape} from '../../packages/surface/source-drop';
import {previewFragments} from '../../packages/surface/marking-preview';
import {placedPoint,principalDirection} from '../../packages/reference/placement-transform';
import {registrationFingerprint} from '../../packages/reference/placement-registration';
const worker=resolve('target/release/fpcad-worker.exe'),frame:CutProjection={origin:[0,0,0],axes:[[1,0,0],[0,1,0],[0,0,1]]};
const region=(piece=rectangle(100,100),part:'head'|'arm'='head',side:'center'|'left'='center',referenceId=randomUUID()):NonNullable<Project['patternLibrary']>[number]=>({piece,referenceId,view:'front',category:part,anatomy:{part,side,confidence:1,method:'manual'}});
it('source grab anchors preserve the point actually picked from the thumbnail',()=>{
 const piece=rectangle(100,80),anchor={xMm:20,yMm:30},hit={xMm:120,yMm:80,zMm:25},shape=sourceSurfaceShape(piece,hit,frame,anchor);
 expect(shape.nodes[0]).toEqual({xMm:-20,yMm:-30});expect(shapeWorld(shape,{xMm:0,yMm:0})).toEqual(hit);expect(piece.nodes[0].xMm).toBe(0);
 expect(()=>sourceSurfaceShape(piece,hit,frame,{xMm:Infinity,yMm:30})).toThrow('INVALID_GEOMETRY');
});
it('transport preserves grabbed position, metric dimensions and holes through arbitrary and antipodal normals',()=>{
 const shape={...frame,nodes:[{xMm:10,yMm:10},{xMm:40,yMm:10},{xMm:40,yMm:50},{xMm:10,yMm:50}],holes:[[{xMm:20,yMm:20},{xMm:25,yMm:20},{xMm:20,yMm:25}]]},grab={xMm:28,yMm:32},hit={xMm:45,yMm:60,zMm:70};
 for(const normal of [[1,1,1],[1,0,0],[0,0,-1],[.00001,0,-1]] as [number,number,number][]){const moved=surfaceDragShape(shape,grab,hit,normal);expect(shapeWorld(moved,grab).xMm).toBeCloseTo(hit.xMm,9);expect(shapeWorld(moved,grab).yMm).toBeCloseTo(hit.yMm,9);expect(shapeWorld(moved,grab).zMm).toBeCloseTo(hit.zMm,9);expect(moved.nodes).toEqual(shape.nodes);expect(moved.holes).toEqual(shape.holes);for(const axis of moved.axes)expect(Math.hypot(...axis)).toBeCloseTo(1,10);for(let i=0;i<3;i++)for(let j=i+1;j<3;j++)expect(moved.axes[i].reduce((n,v,k)=>n+v*moved.axes[j][k],0)).toBeCloseTo(0,10);}
});
it('repeated surface-relative drags from front to side reproject rather than keeping an edge-on old frame',async()=>{
 const p=project();p.pieces=[];p.surface=parseObj('v 0 0 0\nv 100 0 0\nv 100 100 0\nv 0 100 0\nv 100 0 -100\nv 100 100 -100\ng front\nf 1 2 3\nf 1 3 4\ng side\nf 2 5 6\nf 2 6 3');
 const shape=sourceSurfaceShape(rectangle(20,20),{xMm:90,yMm:50,zMm:0},frame),initial=await surfaceMarking(worker,p,shape,'#ff0000','Move around corner');p.markings=[initial];
 for(let i=0;i<8;i++){const old=p.markings[0],grab=shapePoint(old.surfaceShape!,{xMm:i===0?90:100,yMm:50,zMm:i===0?0:-10-(i-1)*7}),hit={xMm:100,yMm:50,zMm:-10-i*7},moved=surfaceDragShape(old.surfaceShape!,grab,hit,[1,0,0]),preview=previewFragments(p.surface,moved)!;expect(preview.length).toBeGreaterThan(0);const next=await editSurfaceMarking(worker,p,old.id,moved);expect(next.id).toBe(initial.id);expect(next.fragments.every(f=>p.surface!.faces.find(face=>face.id===f.faceId)?.region==='side')).toBe(true);p.markings=[next];expect(staleMarkingIds(p).size).toBe(0);}
 expect(p.markings).toHaveLength(1);
});
it('automatic arm registration rotates the shared pigment group to the model pose without stretching',async()=>{
 const p=project();p.pieces=[];p.surface=parseObj('v -200 90 10\nv -100 90 10\nv -100 110 10\nv -200 110 10\ng arm-left\nf 1 2 3\nf 1 3 4\nv -50 30 10\nv 50 30 10\nv 50 170 10\nv -50 170 10\ng body\nf 5 6 7\nf 5 7 8');
 const first=rectangle(20,50),second=rectangle(20,50),body=rectangle(100,140);first.allowanceMm=second.allowanceMm=body.allowanceMm=0;for(const n of first.nodes){n.xMm-=100;n.yMm+=20;}for(const n of second.nodes){n.xMm-=100;n.yMm+=70;}for(const n of body.nodes){n.xMm-=50;n.yMm+=120;}const id=randomUUID();p.patternLibrary=[region(first,'arm','left',id),region(second,'arm','left',id),{...region(body,'head','center',id),category:'body',anatomy:{part:'body',side:'center',confidence:1,method:'manual'}}];
 const a=anatomicalPlacement(p,p.patternLibrary[0]),b=anatomicalPlacement(p,p.patternLibrary[1]);expect(Math.abs(a.rotationRad!)).toBeCloseTo(Math.PI/2,8);expect(a.scaleX).toBe(a.scaleY);expect(a.sourceCenter).toEqual(b.sourceCenter);const one=await projectMarking(worker,p,first.id,'front',0,0,false,true),two=await projectMarking(worker,p,second.id,'front',0,0,false,true);expect(one.fragments.length).toBeGreaterThan(0);expect(two.fragments.length).toBeGreaterThan(0);const point=placedPoint(first.nodes[0],a),other=placedPoint(first.nodes[1],a);expect(Math.hypot(point.xMm-other.xMm,point.yMm-other.yMm)).toBeCloseTo(20*a.scaleX,9);expect(one.placement?.algorithm).toBe('anatomy-2');
});
it('calibrated whole-part registration keeps a single cheek accent small and invalidates changed source registration',()=>{
 const p=project();p.surface=parseObj('v 0 0 10\nv 100 0 10\nv 100 100 10\nv 0 100 10\ng head\nf 1 2 3\nf 1 3 4');const source=region(rectangle(10,10)),reference={id:source.referenceId,name:'Head',view:'front' as const,width:100,height:100,png:'data:image/png;base64,AA==',calibration:{a:{x:0,y:100},b:{x:0,y:0},distanceMm:100},illustration:{algorithm:'illustration-2' as const,subject:'head' as const,bounds:{minX:0,minY:0,maxX:100,maxY:100},partBounds:[{part:'head' as const,bounds:{minX:0,minY:0,maxX:100,maxY:100}}],foregroundPixels:10000,discardedPixels:0,palette:['#ffffff'],smoothingPx:0}};p.references=[reference];p.patternLibrary=[source];const placement=anatomicalPlacement(p,source);expect(placement.scaleX).toBe(1);expect(placedPoint({xMm:10,yMm:10},placement)).toEqual({xMm:10,yMm:10});const fingerprint=registrationFingerprint(p,source);reference.calibration.distanceMm=200;expect(registrationFingerprint(p,source)).not.toBe(fingerprint);
});
it('principal orientation depends on area rather than the number of contour points',()=>{
 const basic=[{xMm:0,yMm:0},{xMm:10,yMm:0},{xMm:10,yMm:100},{xMm:0,yMm:100}],dense=[...basic.slice(0,2),...Array.from({length:40},(_,i)=>({xMm:10,yMm:(i+1)*2})),...basic.slice(2)];expect(principalDirection([dense],{xMm:0,yMm:1})).toBeCloseTo(principalDirection([basic],{xMm:0,yMm:1})!,10);
});

it('automatic paint keeps its source contour editable after orbiting to an edge-on view',async()=>{
 const p=project();p.pieces=[];p.surface=parseObj('v 0 0 0\nv 100 0 0\nv 100 100 0\nv 0 100 0\ng head\nf 1 2 3\nf 1 3 4');
 const piece=rectangle(30,30);piece.allowanceMm=0;p.patternLibrary=[region(piece)];const m=await projectMarking(worker,p,piece.id,'front',0,0,false,true);p.markings=[m];
 const sideFrame:CutProjection={origin:[0,0,0],axes:[[0,0,1],[0,1,0],[-1,0,0]]};
 const shape=editableShape(p.surface,m,sideFrame,p);
 expect(shape.axes).toEqual(frame.axes);expect(shape.nodes).toHaveLength(4);expect(shape.nodes[0].xMm).toBeCloseTo(0,8);expect(shape.nodes[2].xMm).toBeCloseTo(100,8);
 const next=await editSurfaceMarking(worker,p,m.id,shape);expect(next.id).toBe(m.id);expect(next.fragments).toHaveLength(2);expect(staleMarkingIds({...p,markings:[next]}).size).toBe(0);
});

it('a connected body pigment crossing the limbs uses the calibrated torso bounds for placement',async()=>{
 const p=project();p.pieces=[];p.surface=parseObj('v -50 0 0\nv 50 0 0\nv 50 200 0\nv -50 200 0\ng body\nf 1 2 3\nf 1 3 4');
 const piece=rectangle(300,200);piece.allowanceMm=0;piece.nodes.forEach(n=>n.xMm-=150);const source={...region(piece),category:'body',anatomy:{part:'body' as const,side:'center' as const,confidence:.8,method:'silhouette-1' as const}};
 p.patternLibrary=[source];p.references=[{id:source.referenceId,name:'Body context',view:'front',width:300,height:200,png:'data:image/png;base64,AA==',calibration:{a:{x:150,y:200},b:{x:150,y:0},distanceMm:200},illustration:{algorithm:'illustration-2',subject:'character',bounds:{minX:0,minY:0,maxX:300,maxY:200},partBounds:[{part:'body',bounds:{minX:100,minY:0,maxX:200,maxY:200}}],foregroundPixels:60000,discardedPixels:0,palette:['#ffffff'],smoothingPx:0}}];
 const placement=anatomicalPlacement(p,source);expect(placement.scaleX).toBe(1);expect(placement.sourceCenter).toEqual({xMm:0,yMm:100});const marking=await projectMarking(worker,p,piece.id,'front',0,0,false,true);
 const vertices=new Map(p.surface.vertices.map(v=>[v.id,v])),faces=new Map(p.surface.faces.map(f=>[f.id,f])),ys=marking.fragments.flatMap(f=>f.rings.flatMap(r=>r.map(w=>w.reduce((s,t,i)=>s+t*vertices.get(faces.get(f.faceId)!.vertices[i])!.yMm,0))));expect(Math.min(...ys)).toBeCloseTo(0,5);expect(Math.max(...ys)).toBeCloseTo(200,5);
});

it('sparse square arm pigment follows the full side silhouette direction and proportions',()=>{
 const p=project();p.pieces=[];p.surface=parseObj('v -200 90 0\nv -100 90 0\nv -100 110 0\nv -200 110 0\ng arm-left\nf 1 2 3\nf 1 3 4\nv -50 30 0\nv 50 30 0\nv 50 170 0\nv -50 170 0\ng body\nf 5 6 7\nf 5 7 8');
 const accent=rectangle(10,10);accent.nodes.forEach(n=>{n.xMm-=145;n.yMm+=20;});const source=region(accent,'arm','left'),body=rectangle(100,140);body.nodes.forEach(n=>{n.xMm-=50;n.yMm+=30;});p.patternLibrary=[source,{...region(body),referenceId:source.referenceId,category:'body',anatomy:{part:'body',side:'center',confidence:1,method:'manual'}}];
 p.references=[{id:source.referenceId,name:'Full arm context',view:'front',width:300,height:200,png:'data:image/png;base64,AA==',calibration:{a:{x:150,y:200},b:{x:150,y:0},distanceMm:200},illustration:{algorithm:'illustration-2',subject:'character',bounds:{minX:0,minY:0,maxX:300,maxY:200},partBounds:[{part:'arm',side:'left',orientationRad:Math.PI/2,bounds:{minX:0,minY:100,maxX:20,maxY:200}}],foregroundPixels:3000,discardedPixels:0,palette:['#ffffff'],smoothingPx:0}}];
 const placement=anatomicalPlacement(p,source);expect(Math.abs(placement.rotationRad!)).toBeCloseTo(Math.PI/2,8);expect(placement.scaleX).toBeCloseTo(1,8);const a=placedPoint(accent.nodes[0],placement),b=placedPoint(accent.nodes[1],placement);expect(Math.hypot(a.xMm-b.xMm,a.yMm-b.yMm)).toBeCloseTo(10,8);
});

it('an edge-on model tail is left for manual placement instead of inventing a tiny accent',()=>{
 const p=project();p.pieces=[];p.surface=parseObj('v 0 0 0\nv 2 0 0\nv 2 100 0\nv 0 100 0\ng tail\nf 1 2 3\nf 1 3 4');
 const piece=rectangle(100,100),source={...region(piece),category:'tail',anatomy:{part:'tail' as const,side:'center' as const,confidence:.9,method:'silhouette-1' as const}};p.patternLibrary=[source];
 expect(()=>anatomicalPlacement(p,source)).toThrow('NO_VISIBLE_PROJECTION');expect(p.patternLibrary[0].piece).toBe(piece);expect(p.markings).toBeUndefined();
});

it('a diagonal full limb uses its oriented silhouette frame rather than an inflated rotated image box',()=>{
 const p=project();p.surface=parseObj('v -200 90 0\nv -100 90 0\nv -100 110 0\nv -200 110 0\ng arm-left\nf 1 2 3\nf 1 3 4\nv -50 30 0\nv 50 30 0\nv 50 170 0\nv -50 170 0\ng body\nf 5 6 7\nf 5 7 8');
 const accent=rectangle(10,10);accent.nodes.forEach(n=>{n.xMm-=105;n.yMm+=65;});const source=region(accent,'arm','left');p.patternLibrary=[source];const q=Math.SQRT1_2,corners=[[-50,-10],[50,-10],[50,10],[-50,10]].map(([along,across])=>({x:150-100+q*along-q*across,y:200-70-q*along-q*across})),xs=corners.map(n=>n.x),ys=corners.map(n=>n.y);
 p.references=[{id:source.referenceId,name:'Raised diagonal arm',view:'front',width:300,height:200,png:'data:image/png;base64,AA==',calibration:{a:{x:150,y:200},b:{x:150,y:0},distanceMm:200},illustration:{algorithm:'illustration-2',subject:'character',bounds:{minX:0,minY:0,maxX:300,maxY:200},partBounds:[{part:'body',bounds:{minX:100,minY:30,maxX:200,maxY:170}},{part:'arm',side:'left',orientationRad:-Math.PI/4,frameCorners:corners,bounds:{minX:Math.min(...xs),minY:Math.min(...ys),maxX:Math.max(...xs),maxY:Math.max(...ys)}}],foregroundPixels:2000,discardedPixels:0,palette:['#ffffff'],smoothingPx:0}}];
 const placement=anatomicalPlacement(p,source);expect(placement.scaleX).toBeCloseTo(1,8);expect(placement.scaleY).toBeCloseTo(1,8);const a=placedPoint(accent.nodes[0],placement),b=placedPoint(accent.nodes[1],placement);expect(Math.hypot(a.xMm-b.xMm,a.yMm-b.yMm)).toBeCloseTo(10,8);
});
