import {expect,it} from 'vitest';
import {randomUUID} from 'node:crypto';
import {resolve} from 'node:path';
import {project} from './fixtures';
import {surfaceMarking} from '../apps/desktop/main/markings';
import {decalChart} from '../packages/surface/decal-chart';
import {previewFragments} from '../packages/surface/marking-preview';
import type {Surface,Marking} from '../packages/schema/index';

function cylinder(){
 const n=64,r=30,vertices:Surface['vertices']=[],faces:Surface['faces']=[];
 for(let y=0;y<3;y++)for(let i=0;i<n;i++){const t=i*2*Math.PI/n;vertices.push({id:`${y}-${i}`,xMm:r*Math.sin(t),yMm:(y-1)*50,zMm:r*Math.cos(t)});}
 for(let y=0;y<2;y++)for(let i=0;i<n;i++){const j=(i+1)%n,a=`${y}-${i}`,b=`${y}-${j}`,c=`${y+1}-${i}`,d=`${y+1}-${j}`;faces.push({id:`${y}-${i}-a`,vertices:[a,b,c],region:'limb'},{id:`${y}-${i}-b`,vertices:[b,d,c],region:'limb'});}
 const mesh={id:'cylinder',topologyVersion:1,source:'obj',vertices,faces} as Surface;
 const shape:NonNullable<Marking['surfaceShape']>={wrap:true,anchorFaceId:'1-0-a',origin:[0,0,r],axes:[[1,0,0],[0,1,0],[0,0,1]],nodes:[{xMm:-60,yMm:-20},{xMm:60,yMm:-20},{xMm:60,yMm:20},{xMm:-60,yMm:20}]};
 return {mesh,shape};
}
it('a physical decal continues around a cylindrical limb past the tangent-plane silhouette',()=>{
 const {mesh,shape}=cylinder(),faces=mesh.faces;
 const chart=decalChart(mesh,shape)!;
 expect(chart.get('1-20')!.xMm).toBeGreaterThan(55);
 const fragments=previewFragments(mesh,shape)!;
 expect(fragments.some(f=>f.faceId.split('-')[1]==='19')).toBe(true);
 let area=0;for(const f of fragments){const triangle=faces.find(t=>t.id===f.faceId)!.vertices.map(id=>chart.get(id)!);for(const ring of f.rings){const points=ring.map(w=>({x:w.reduce((s,n,i)=>s+n*triangle[i].xMm,0),y:w.reduce((s,n,i)=>s+n*triangle[i].yMm,0)}));area+=Math.abs(points.reduce((s,p,i)=>{const q=points[(i+1)%points.length];return s+p.x*q.y-q.x*p.y;},0)/2);}}
 expect(area).toBeCloseTo(120*40,1);
});

it('native saved wrapping agrees with full preview coverage and refuses partial edge clips',async()=>{
 const {mesh,shape}=cylinder(),ids=new Map([...mesh.vertices.map(v=>v.id),...mesh.faces.map(f=>f.id)].map(id=>[id,randomUUID()]));
 mesh.id=randomUUID();mesh.vertices=mesh.vertices.map(v=>({...v,id:ids.get(v.id)!}));mesh.faces=mesh.faces.map(f=>({...f,id:ids.get(f.id)!,vertices:f.vertices.map(id=>ids.get(id)!) as [string,string,string]}));shape.anchorFaceId=ids.get(shape.anchorFaceId!);
 const p=project();p.surface=mesh;p.pieces=[];p.bindings=[];const before=JSON.stringify(p);
 const saved=await surfaceMarking(resolve('target/release/fpcad-worker.exe'),p,shape,'#ff0000','Wrap');
 expect(saved.surfaceShape!.wrap).toBe(true);expect(saved.fragments.length).toBeGreaterThan(50);
 const tooTall={...shape,nodes:shape.nodes.map(q=>({...q,yMm:q.yMm*5}))};
 await expect(surfaceMarking(resolve('target/release/fpcad-worker.exe'),p,tooTall,'#ff0000','Oversize')).rejects.toThrow('INCOMPLETE_SURFACE_WRAP');
 expect(JSON.stringify(p)).toBe(before);
},30000);
