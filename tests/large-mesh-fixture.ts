import {randomUUID} from 'node:crypto';
import type {Surface} from '../packages/schema/index';
export function gridMesh(width=250,height=100):Surface{
 const vertices:Surface['vertices']=[],faces:Surface['faces']=[];
 for(let y=0;y<=height;y++)for(let x=0;x<=width;x++)vertices.push({id:randomUUID(),xMm:x*10,yMm:y*10,zMm:0});
 for(let y=0;y<height;y++)for(let x=0;x<width;x++){const a=y*(width+1)+x,b=a+1,c=a+width+1,d=c+1;for(const triangle of [[a,b,d],[a,d,c]])faces.push({id:randomUUID(),vertices:triangle.map(i=>vertices[i].id) as [string,string,string],region:'tile-'+Math.floor(x/25)+'-'+Math.floor(y/20)});}
 return {id:randomUUID(),topologyVersion:1,source:'obj',vertices,faces};
}

export function cylinderMesh(n=250,levels=100):Surface{const vertices:Surface['vertices']=[],faces:Surface['faces']=[];for(let y=0;y<=levels;y++)for(let i=0;i<n;i++)vertices.push({id:randomUUID(),xMm:200*Math.cos(i*2*Math.PI/n),yMm:y*1000/levels,zMm:200*Math.sin(i*2*Math.PI/n)});for(let y=0;y<levels;y++)for(let i=0;i<n;i++){const a=y*n+i,b=y*n+(i+1)%n,c=(y+1)*n+i,d=(y+1)*n+(i+1)%n;for(const triangle of [[a,c,b],[b,c,d]])faces.push({id:randomUUID(),vertices:triangle.map(i=>vertices[i].id) as [string,string,string],region:'torso-'+Math.floor(i*4/n)});}return {id:randomUUID(),topologyVersion:1,source:'obj',vertices,faces};}
