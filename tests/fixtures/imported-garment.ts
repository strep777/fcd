import type {Surface} from '../../packages/schema/index';
import {randomUUID} from 'node:crypto';

/** A single imported object: connected front/back cloth with open neck,
 * wrists and ankles. Its original group carries no limb classification. */
export function importedGarment(region='PatternBody',options:{reverseDiagonal?:boolean;subdivisions?:number}={}):Surface{
 const xs=[-700,-600,-250,-120,0,120,250,600,700],ys=[100,500,750,950,1050,1150,1350,1550];
 const vertices:Surface['vertices']=[],faces:Surface['faces']=[],ids=new Map<string,string>(),occupied=new Set<string>();
 const vertex=(x:number,y:number,z:number)=>{const key=[x,y,z].join(',');let id=ids.get(key);if(!id){id=randomUUID();ids.set(key,id);vertices.push({id,xMm:x,yMm:y,zMm:z});}return id;};
 const quad=(points:number[][])=>{const n=options.subdivisions??1,at=(u:number,v:number)=>points[0].map((a,k)=>a+(points[1][k]-a)*u+(points[3][k]-a)*v);
  for(let y=0;y<n;y++)for(let x=0;x<n;x++){const ids=[[x,y],[x+1,y],[x+1,y+1],[x,y+1]].map(([u,v])=>{const p=at(u/n,v/n);return vertex(p[0],p[1],p[2]);});
   for(const triangle of options.reverseDiagonal?[[0,1,3],[1,2,3]]:[[0,1,2],[0,2,3]])faces.push({id:randomUUID(),region,vertices:triangle.map(i=>ids[i]) as [string,string,string]});
  }
 };
 for(let j=0;j<ys.length-1;j++)for(let i=0;i<xs.length-1;i++){
  const x=(xs[i]+xs[i+1])/2,y=(ys[j]+ys[j+1])/2;
  if(y>=750&&Math.abs(x)<250||y>=950&&y<1150||y<750&&Math.abs(x)>120&&Math.abs(x)<250)occupied.add(i+','+j);
 }
 for(const key of occupied){const [i,j]=key.split(',').map(Number),a=xs[i],b=xs[i+1],c=ys[j],d=ys[j+1];
  quad([[a,c,100],[b,c,100],[b,d,100],[a,d,100]]);quad([[a,d,-100],[b,d,-100],[b,c,-100],[a,c,-100]]);
  if(!occupied.has((i-1)+','+j)&&a!==-700)quad([[a,c,-100],[a,c,100],[a,d,100],[a,d,-100]]);
  if(!occupied.has((i+1)+','+j)&&b!==700)quad([[b,c,100],[b,c,-100],[b,d,-100],[b,d,100]]);
  if(!occupied.has(i+','+(j-1))&&c!==100)quad([[a,c,-100],[b,c,-100],[b,c,100],[a,c,100]]);
  if(!occupied.has(i+','+(j+1))&&d!==1550)quad([[a,d,100],[b,d,100],[b,d,-100],[a,d,-100]]);
 }
 return {id:randomUUID(),topologyVersion:1,source:'glb',vertices,faces};
}
