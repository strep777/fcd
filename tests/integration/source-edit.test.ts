import {it,expect} from 'vitest';
import {reactive} from 'vue';
import {rectangle} from '../fixtures';
import type {Reference} from '../../packages/schema/index';
import {cloneSource,insertSourceNode,removeSourceNode,sourceImageTransform,sourceDrawingIssue} from '../../packages/reference/source-edit';
import {moveNode,piecePath,edgeArcPoints} from '../../packages/pattern/edit';
it('visual source editing retains identity and absolute coordinates while moving attached curve handles',()=>{
 const p=rectangle(100,80),a=p.nodes[0],b=p.nodes[1];p.curves=[{id:crypto.randomUUID(),startNodeId:a.id,endNodeId:b.id,c1:{id:crypto.randomUUID(),xMm:25,yMm:10},c2:{id:crypto.randomUUID(),xMm:75,yMm:10}}];
 const copy=cloneSource(reactive(p)),moved=moveNode(copy,a.id,7,9);expect(moved.id).toBe(p.id);expect(moved.nodes[0]).toMatchObject({xMm:7,yMm:9});expect(moved.curves?.[0].c1).toMatchObject({xMm:32,yMm:19});expect(moved.curves?.[0].c2).toEqual(p.curves[0].c2);expect(p.nodes[0]).toMatchObject({xMm:0,yMm:0});
});
it('Ctrl insertion splits a Bezier at its nearest exact parameter rather than flattening the source edge',()=>{
 const p=rectangle(100,80),a=p.nodes[0],b=p.nodes[1];p.curves=[{id:crypto.randomUUID(),startNodeId:a.id,endNodeId:b.id,c1:{id:crypto.randomUUID(),xMm:0,yMm:-40},c2:{id:crypto.randomUUID(),xMm:100,yMm:-40}}];
 const result=insertSourceNode(p,{xMm:50,yMm:-30});expect(result.piece.id).toBe(p.id);expect(result.piece.nodes).toHaveLength(5);expect(result.piece.curves).toHaveLength(2);const node=result.piece.nodes.find(n=>n.id===result.nodeId)!;expect(node.xMm).toBeCloseTo(50,4);expect(node.yMm).toBeCloseTo(-30,4);expect(result.piece.curves?.[0].c1.xMm).toBeCloseTo(0,4);expect(sourceDrawingIssue(result.piece)).toBe('');
});
it('hole insertion and removal leave the outer contour and other node IDs untouched',()=>{
 const p=rectangle(100,80);p.holes=[[{id:crypto.randomUUID(),xMm:20,yMm:20},{id:crypto.randomUUID(),xMm:20,yMm:40},{id:crypto.randomUUID(),xMm:40,yMm:40},{id:crypto.randomUUID(),xMm:40,yMm:20}]];
 const result=insertSourceNode(p,{xMm:20,yMm:30});expect(result.piece.holes?.[0]).toHaveLength(5);expect(result.piece.nodes).toEqual(p.nodes);const removed=removeSourceNode(result.piece,result.nodeId);expect(removed.holes).toEqual(p.holes);expect(removed.nodes).toEqual(p.nodes);
});
it('removing an outer node drops its dangling curves and never removes the whole source region',()=>{
 const p=rectangle(),id=p.nodes[0].id;p.curves=[{id:crypto.randomUUID(),startNodeId:id,endNodeId:p.nodes[1].id,c1:{id:crypto.randomUUID(),xMm:25,yMm:0},c2:{id:crypto.randomUUID(),xMm:75,yMm:0}}];
 const triangle=removeSourceNode(p,id);expect(triangle.id).toBe(p.id);expect(triangle.nodes).toHaveLength(3);expect(triangle.curves).toEqual([]);expect(removeSourceNode(triangle,triangle.nodes[0].id)).toBe(triangle);
});
it('the original-image affine transform agrees with calibrated source coordinates even for rotated artwork',()=>{
 const reference={calibration:{a:{x:30,y:90},b:{x:90,y:10},distanceMm:200}} as Reference,transform=sourceImageTransform(reference)!,values=transform.slice(7,-1).split(' ').map(Number),[a,b,c,d,tx,ty]=values;
 const X=17,Y=61,dx=60,dy=-80,px=30+(-dy*X+dx*Y)/200,py=90+(dx*X+dy*Y)/200;expect(a*px+c*py+tx).toBeCloseTo(X,9);expect(b*px+d*py+ty).toBeCloseTo(-Y,9);
});
it('visual contour validation catches crossings and cancellation can restore the complete original curved path',()=>{
 const original=rectangle(),draft=cloneSource(original);[draft.nodes[1],draft.nodes[2]]=[draft.nodes[2],draft.nodes[1]];expect(sourceDrawingIssue(draft)).toBe('DRAWING_CROSSING');expect(piecePath(cloneSource(original))).toBe(piecePath(original));
});
it('large valid curved sources defer excessive preview sampling to native validation without changing their saved geometry',()=>{
 const p=rectangle(40000,40000),k=.55228475,center=20000,r=20000;
 p.nodes=[{id:crypto.randomUUID(),xMm:center+r,yMm:center},{id:crypto.randomUUID(),xMm:center,yMm:center+r},{id:crypto.randomUUID(),xMm:center-r,yMm:center},{id:crypto.randomUUID(),xMm:center,yMm:center-r}];
 const tangents=[[0,1],[-1,0],[0,-1],[1,0]];p.curves=p.nodes.map((a,i)=>{const b=p.nodes[(i+1)%4],ta=tangents[i],tb=tangents[(i+1)%4];return {id:crypto.randomUUID(),startNodeId:a.id,endNodeId:b.id,c1:{id:crypto.randomUUID(),xMm:a.xMm+ta[0]*r*k,yMm:a.yMm+ta[1]*r*k},c2:{id:crypto.randomUUID(),xMm:b.xMm-tb[0]*r*k,yMm:b.yMm-tb[1]*r*k}};});
 expect(p.nodes.reduce((n,node)=>n+edgeArcPoints(p,node.id).length-1,0)).toBeGreaterThan(2000);const before=cloneSource(p);expect(sourceDrawingIssue(p)).toBe('');expect(p).toEqual(before);expect(p.nodes).toHaveLength(4);
});
