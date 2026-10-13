import {it,expect} from 'vitest';
import {reactive} from 'vue';
import type {Surface,Marking,CutProjection} from '../../packages/schema/index';
import {editableShape,planePointer,shapePoint,shapeWorld,translateShape,markingContains} from '../../packages/surface/attached-edit';
const frame:CutProjection={origin:[0,0,0],axes:[[1,0,0],[0,1,0],[0,0,1]]};
const mesh:Surface={id:'surface',source:'obj',topologyVersion:1,vertices:[{id:'a',xMm:0,yMm:0,zMm:0},{id:'b',xMm:100,yMm:0,zMm:0},{id:'c',xMm:100,yMm:100,zMm:0},{id:'d',xMm:0,yMm:100,zMm:0}],faces:[{id:'one',vertices:['a','b','c'],region:'body'},{id:'two',vertices:['a','c','d'],region:'body'}]};
const base:Marking={id:'marking',name:'Old projected marking',color:'#aabbcc',source:'reference',sourceHash:'',surfaceId:'surface',topologyVersion:1,surfaceHash:'',view:'front',offsetXmm:0,offsetYmm:0,paths:[],fragments:[{faceId:'one',rings:[[[1,0,0],[0,1,0],[0,0,1]]]},{faceId:'two',rings:[[[1,0,0],[0,1,0],[0,0,1]]]}]};
const area=(nodes:{xMm:number;yMm:number}[])=>Math.abs(nodes.reduce((s,p,i)=>s+p.xMm*nodes[(i+1)%nodes.length].yMm-nodes[(i+1)%nodes.length].xMm*p.yMm,0))/2;
it('persistent plane pointers follow camera orbit and perspective without changing the shape frame',()=>{
 const tilted:CutProjection={origin:[0,0,0],axes:[[Math.SQRT1_2,0,Math.SQRT1_2],[0,1,0],[-Math.SQRT1_2,0,Math.SQRT1_2]]},p={xMm:25,yMm:40},world=shapeWorld(frame,p),camera=shapePoint(tilted,world);
 expect(planePointer(frame,tilted,camera)).toEqual(p);
 const depth=-Math.SQRT1_2*25,distance=1800,perspective={xMm:camera.xMm*distance/(distance-depth),yMm:camera.yMm*distance/(distance-depth)},hit=planePointer(frame,tilted,perspective,true,distance)!;
 expect(hit.xMm).toBeCloseTo(25,8);expect(hit.yMm).toBeCloseTo(40,8);
 expect(planePointer(frame,{origin:[0,0,0],axes:[[0,0,1],[0,1,0],[-1,0,0]]},p)).toBeUndefined();
});
it('legacy projected triangles recover their exact outer boundary and shared edges disappear',()=>{
 const shape=editableShape(mesh,base,frame);expect(shape.nodes).toHaveLength(4);expect(area(shape.nodes)).toBe(10000);expect(shape.holes).toBeUndefined();
 const moved=translateShape(shape,30,-20);expect(moved.nodes[0].xMm-shape.nodes[0].xMm).toBe(30);expect(moved.origin).toEqual(shape.origin);expect(shape.nodes).not.toEqual(moved.nodes);
});
it('cloning an existing reactive shape retains spline and holes without touching the source',()=>{
 const shape={...frame,nodes:[{xMm:0,yMm:0},{xMm:100,yMm:0},{xMm:100,yMm:100},{xMm:0,yMm:100}],holes:[[{xMm:20,yMm:20},{xMm:20,yMm:30},{xMm:30,yMm:30}]],spline:{algorithm:'closed-catmull-rom-1' as const,tension:.5,toleranceMm:.05}},marking=reactive({...base,surfaceShape:shape}),copy=editableShape(mesh,marking,reactive(frame));
 copy.nodes[0].xMm=10;expect(marking.surfaceShape.nodes[0].xMm).toBe(0);expect(copy.holes).toEqual(shape.holes);expect(copy.spline).toEqual(shape.spline);
});
it('multiple outer rings on one original face are rejected rather than converted into holes',()=>{
 const marking={...base,fragments:[{faceId:'one',rings:[[[.8,.1,.1],[.7,.2,.1],[.7,.1,.2]],[[.2,.7,.1],[.1,.8,.1],[.1,.7,.2]]] as [number,number,number][][]}]};
 expect(()=>editableShape(mesh,marking,frame)).toThrow('MARKING_DISCONNECTED');
});
it('fragment picking respects holes and works without any piece bindings',()=>{
 const marking={...base,fragments:[{faceId:'one',rings:[[[1,0,0],[0,1,0],[0,0,1]],[[.4,.3,.3],[.3,.4,.3],[.3,.3,.4]]] as [number,number,number][][]}]};
 expect(markingContains(marking,'one',[.7,.2,.1])).toBe(true);expect(markingContains(marking,'one',[1/3,1/3,1/3])).toBe(false);expect(markingContains(marking,'absent',[.7,.2,.1])).toBe(false);
});
