import assert from 'node:assert/strict';
export async function focusLegacyPaintCamera(page,steps=37){
 const view=page.locator('.surface-view'),handles=view.locator('.curve-handles circle'),box=await view.boundingBox();assert(box);const center={x:box.x+box.width/2,y:box.y+box.height/2};
 const settle=()=>page.evaluate(()=>new Promise(ok=>requestAnimationFrame(()=>requestAnimationFrame(ok))));
 const expectedVisible=[0,1,2,3,4,13,14,15,16,17],expectedHidden=[5,6,7,8,9,10,11,12];
 async function positions(stage){
  const nodes=await handles.evaluateAll(nodes=>nodes.map((n,index)=>{const b=n.getBoundingClientRect();return{index,cx:n.getAttribute('cx'),cy:n.getAttribute('cy'),x:b.x+b.width/2,y:b.y+b.height/2,diameter:Math.max(b.width,b.height)};}));
  assert.equal(nodes.length,18,stage+': all 18 knot indices remain in the DOM');
  for(const n of nodes){assert(n.cx!==null&&n.cy!==null);n.cx=Number(n.cx);n.cy=Number(n.cy);assert(Number.isFinite(n.cx)&&Number.isFinite(n.cy));assert.equal(n.cx===1e6,n.cy===1e6,stage+': hidden sentinel coordinates must be paired');}
  const hidden=nodes.filter(n=>n.cx===1e6&&n.cy===1e6),visible=nodes.filter(n=>!(n.cx===1e6&&n.cy===1e6));
  assert.deepEqual(visible.map(n=>n.index),expectedVisible,stage+': visibility must match the independent world-ray diagnosis');assert.deepEqual(hidden.map(n=>n.index),expectedHidden,stage+': exactly the eight rear knots are hidden');
  return{totalCount:nodes.length,visibleCount:visible.length,hiddenCount:hidden.length,visibleIndices:visible.map(n=>n.index),hiddenIndices:hidden.map(n=>n.index),visible,hidden};
 }
 await settle();const initialMeasurement=await positions('default camera');
 await page.mouse.move(center.x,center.y);for(let i=0;i<steps;i++)await page.mouse.wheel(0,-1);await settle();const original=await positions('zoomed default orientation');
 const dx=center.x-original.visible.reduce((s,p)=>s+p.x,0)/original.visibleCount,dy=center.y-original.visible.reduce((s,p)=>s+p.y,0)/original.visibleCount,count=Math.max(4,Math.ceil(Math.abs(dx)/(box.width*.3)),Math.ceil(Math.abs(dy)/(box.height*.3)));
 await page.keyboard.down('Shift');try{for(let i=0;i<count;i++){await page.mouse.move(center.x,center.y);await page.mouse.down({button:'middle'});await page.mouse.move(center.x+dx/count,center.y+dy/count,{steps:5});await page.mouse.up({button:'middle'});}}finally{await page.keyboard.up('Shift');}await settle();
 const measured=await positions('focused camera'),points=measured.visible;assert(points.every(p=>p.x-p.diameter/2>=box.x&&p.x+p.diameter/2<=box.x+box.width&&p.y-p.diameter/2>=box.y&&p.y+p.diameter/2<=box.y+box.height));
 const distance=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y),adjacent=points.flatMap(p=>{const next=points.find(q=>q.index===(p.index+1)%18);return next?[distance(p,next)]:[];}),pairs=points.flatMap((p,i)=>points.slice(i+1).map(q=>distance(p,q)));assert(adjacent.length>0);
 return{zoom:await page.locator('.zoom-level').innerText(),...measured,points,initialMeasurement,diagnosis:'test-results/current-cutting/final-regression-legacy-handle-occlusion-diagnosis.json',viewBounds:box,allVisibleHandlesInsideView:true,minAdjacentDistancePx:Math.min(...adjacent),minPairDistancePx:Math.min(...pairs),maxHandleDiameterPx:Math.max(...points.map(p=>p.diameter))};
}
