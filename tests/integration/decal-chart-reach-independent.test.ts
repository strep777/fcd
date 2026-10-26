import {expect,it} from 'vitest';
import type {Surface} from '../../packages/schema/index';
import type {Shape} from '../../packages/surface/attached-edit';
import {decalChart} from '../../packages/surface/decal-chart';
import {previewFragments} from '../../packages/surface/marking-preview';

function plane():Surface{
 const vertices:Surface['vertices']=[],faces:Surface['faces']=[];
 for(let y=-10;y<=10;y++)for(let x=-10;x<=110;x++)vertices.push({id:`${x},${y}`,xMm:x,yMm:y,zMm:0});
 for(let y=-10;y<10;y++)for(let x=-10;x<110;x++){
  const a=`${x},${y}`,b=`${x+1},${y}`,c=`${x+1},${y+1}`,d=`${x},${y+1}`;
  faces.push({id:`${x},${y}a`,vertices:[a,b,c],region:'cloth'},{id:`${x},${y}b`,vertices:[a,c,d],region:'cloth'});
 }
 return {id:'reach-plane',source:'obj',topologyVersion:1,vertices,faces};
}
const shape:Shape={wrap:true,anchorFaceId:'0,0a',origin:[0,0,0],axes:[[1,0,0],[0,1,0],[0,0,1]],nodes:[{xMm:-5,yMm:-5},{xMm:5,yMm:-5},{xMm:5,yMm:5},{xMm:-5,yMm:5}],curves:[{startIndex:1,c1:{xMm:120,yMm:-5},c2:{xMm:120,yMm:5}}]};

// The independently evaluated cubic midpoint is (91.25, 0), although every
// endpoint lies inside the 10 x 10 mm square. Interior material near x=90
// must therefore survive chart traversal and the actual preview clipping.
it('includes distant cubic material instead of limiting reach to endpoint radius',()=>{
 const mesh=plane(),before=structuredClone(mesh),chart=decalChart(mesh,shape)!;
 for(const x of[20,50,90,91]){
  const point=chart.get(`${x},0`)!;expect({xMm:point.xMm,yMm:point.yMm}).toEqual({xMm:x,yMm:0});
  expect(Number.isFinite(point.distanceMm)).toBe(true);expect(point.distanceMm).toBeGreaterThanOrEqual(0);
 }
 const fragments=previewFragments(mesh,shape)!;
 expect(fragments.some(f=>f.faceId==='90,0a'||f.faceId==='90,0b')).toBe(true);
 const vertices=new Map(mesh.vertices.map(p=>[p.id,p])),faces=new Map(mesh.faces.map(f=>[f.id,f]));
 const actualArea=fragments.reduce((sum,f)=>sum+f.rings.reduce((total,ring)=>{
  const triangle=faces.get(f.faceId)!.vertices.map(id=>vertices.get(id)!),points=ring.map(w=>({x:triangle.reduce((s,p,i)=>s+p.xMm*w[i],0),y:triangle.reduce((s,p,i)=>s+p.yMm*w[i],0)}));
  return total+points.reduce((s,p,i)=>{const q=points[(i+1)%points.length];return s+p.x*q.y-q.x*p.y;},0)/2;
 },0),0);
 // x(t)=5+345t(1-t), y'(t)=60t(1-t): the extra area
 // is 20700 * integral_0^1(t^2(1-t)^2) = 690 mm².
 expect(Math.abs(actualArea-790)).toBeLessThan(.5);
 expect(mesh).toEqual(before);
});

it('a disconnected oversized triangle cannot change a small local chart or its material coverage',()=>{
 const mesh=plane(),local={...shape,curves:[]},before=structuredClone(mesh),chart=decalChart(mesh,local)!,fragments=previewFragments(mesh,local);
 const unrelated:Surface={...mesh,vertices:[...mesh.vertices,{id:'farA',xMm:10000,yMm:0,zMm:0},{id:'farB',xMm:20000,yMm:0,zMm:0},{id:'farC',xMm:10000,yMm:10000,zMm:0}],faces:[...mesh.faces,{id:'unrelated',vertices:['farA','farB','farC'],region:'cloth'}]};
 expect([...decalChart(unrelated,local)!]).toEqual([...chart]);
 expect(previewFragments(unrelated,local)).toEqual(fragments);expect(mesh).toEqual(before);
});
