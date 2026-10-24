import {expect,it} from 'vitest';
import {fitMeasuredBoundary} from '../packages/reference/image-contour';
it('small smooth source arcs retain common tangents at recursive and cyclic joins',()=>{
 let id=0;const next=()=>String(++id),points=Array.from({length:48},(_,i)=>({id:next(),xMm:8*Math.cos(i*2*Math.PI/48),yMm:6*Math.sin(i*2*Math.PI/48)}));
 const fitted=fitMeasuredBoundary(points,true,next,.1);
 expect(fitted.curves.length).toBeGreaterThan(0);
 for(const node of fitted.nodes){const incoming=fitted.curves.find(c=>c.endNodeId===node.id),outgoing=fitted.curves.find(c=>c.startNodeId===node.id);expect(incoming).toBeDefined();expect(outgoing).toBeDefined();
  const ax=node.xMm-incoming!.c2.xMm,ay=node.yMm-incoming!.c2.yMm,bx=outgoing!.c1.xMm-node.xMm,by=outgoing!.c1.yMm-node.yMm;
  expect((ax*bx+ay*by)/(Math.hypot(ax,ay)*Math.hypot(bx,by))).toBeCloseTo(1,6);
 }
});
