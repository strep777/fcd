import {randomUUID} from 'node:crypto';
import {resolve} from 'node:path';
import type {Project,Piece,Binding,Marking,Surface} from '../../packages/schema/index';
import {project,rectangle} from '../fixtures';
import {parseObj,unwrapSurface} from '../../apps/desktop/main/surface';
import {projectMarking} from '../../apps/desktop/main/markings';
export const detailWorker=resolve('target/release/fpcad-worker.exe');
export const ring=(points:number[][])=>points.map(([xMm,yMm])=>({id:randomUUID(),xMm,yMm}));
export function box(x:number,y:number,width:number,height:number,name:string,color:string):Piece{const piece=rectangle(width,height);piece.name=name;piece.color=color;piece.allowanceMm=0;piece.nodes.forEach(n=>{n.xMm+=x;n.yMm+=y;});return piece;}
export function physicalHolePlane():Surface{
 const values=[0,40,60,100],vertices:Surface['vertices']=[],grid:string[][]=[],faces:Surface['faces']=[];for(let j=0;j<4;j++){grid[j]=[];for(let i=0;i<4;i++){const id=randomUUID();grid[j][i]=id;vertices.push({id,xMm:values[i],yMm:values[j],zMm:0});}}
 for(let j=0;j<3;j++)for(let i=0;i<3;i++){if(i===1&&j===1)continue;const a=grid[j][i],b=grid[j][i+1],c=grid[j+1][i+1],d=grid[j+1][i];for(const ids of [[a,b,c],[a,c,d]])faces.push({id:randomUUID(),region:'panel',vertices:ids as [string,string,string]});}return{id:randomUUID(),source:'obj',topologyVersion:1,vertices,faces};
}
export async function detailPlane(options:{sourceHole?:boolean;physicalHole?:boolean;detailRole?:'sewn'|'detail';detailWidth?:number}={}){
 const p=project();p.pieces=[];p.defaultAllowanceMm=0;p.surface=options.physicalHole?physicalHolePlane():parseObj('v 0 0 0\nv 100 0 0\nv 100 100 0\nv 0 100 0\ng torso\nf 1 2 3\nf 1 3 4');const base=await unwrapSurface(detailWorker,p.surface,p,{partitionStrategy:'design',automaticCuts:false,colorBoundaryCuts:false,method:'arap'});p.pieces=base.pieces;p.bindings=base.bindings;
 const body=box(0,0,100,100,'Body cloth','#2786b6'),detail=box(options.physicalHole?30:40,options.physicalHole?30:40,options.physicalHole?40:options.detailWidth??20,options.physicalHole?40:20,'Eye ink','#080608'),referenceId=randomUUID();if(options.sourceHole)body.holes=[options.physicalHole?ring([[30,30],[30,70],[70,70],[70,30]]):ring([[40,40],[40,60],[60,60],[60,40]])];p.patternLibrary=[{piece:body,referenceId,view:'front',category:'body'},{piece:detail,referenceId,view:'front',category:'eye',...(options.detailRole?{fabrication:options.detailRole}:{})}];p.markings=[];for(const region of p.patternLibrary)p.markings.push(await projectMarking(detailWorker,p,region.piece.id,'front',0,0));return{p,body,detail,referenceId};
}
export function sourceFragmentArea(p:Project,m:Marking){const points=new Map(p.surface!.vertices.map(v=>[v.id,v])),faces=new Map(p.surface!.faces.map(f=>[f.id,f]));return m.fragments.reduce((sum,f)=>{const source=faces.get(f.faceId)!.vertices.map(id=>points.get(id)!),ringArea=(r:typeof f.rings[number])=>{const pp=r.map(w=>({x:w.reduce((s,n,i)=>s+n*source[i].xMm,0),y:w.reduce((s,n,i)=>s+n*source[i].yMm,0)}));return pp.reduce((s,a,i)=>{const b=pp[(i+1)%pp.length],o=pp[0];return s+(a.x-o.x)*(b.y-o.y)-(b.x-o.x)*(a.y-o.y);},0)/2;};return sum+Math.abs(f.rings.reduce((s,r)=>s+ringArea(r),0));},0);}
export function trimPhysicalArea(source:Surface,binding:Binding){const vertices=new Map(source.vertices.map(v=>[v.id,v])),faces=new Map(source.faces.map(f=>[f.id,f]));return binding.trim!.triangles.reduce((sum,t)=>{const corners=faces.get(t.faceId)!.vertices.map(id=>vertices.get(id)!),p=t.barycentric.map(w=>[0,1,2].map(axis=>w.reduce((s,n,i)=>s+n*[corners[i].xMm,corners[i].yMm,corners[i].zMm][axis],0))),u=p[1].map((v,i)=>v-p[0][i]),v=p[2].map((v,i)=>v-p[0][i]);return sum+Math.hypot(u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0])/2;},0);}
