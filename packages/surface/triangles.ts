import type {Binding,Surface} from '../schema/index';
export type XY=[number,number];
export type Bary=[number,number,number];
export function triangleWeights(point:XY,triangle:XY[]):Bary{const [a,b,c]=triangle,d=(b[1]-c[1])*(a[0]-c[0])+(c[0]-b[0])*(a[1]-c[1]);const u=((b[1]-c[1])*(point[0]-c[0])+(c[0]-b[0])*(point[1]-c[1]))/d,v=((c[1]-a[1])*(point[0]-c[0])+(a[0]-c[0])*(point[1]-c[1]))/d;return [u,v,1-u-v];}
export function bindingTriangles(binding:Binding,surface:Surface){
 if(binding.trim){const points=new Map(binding.trim.vertices.map(v=>[v.id,[v.xMm,v.yMm] as XY]));return binding.trim.triangles.map(t=>({faceId:t.faceId,uv:t.vertices.map(id=>points.get(id)!),barycentric:t.barycentric}));}
 const bound=new Set(binding.report.faceIds),points=new Map(binding.report.uv.map(v=>[v.vertexId,[v.xMm,v.yMm] as XY]));return surface.faces.filter(f=>bound.has(f.id)).map(f=>({faceId:f.id,uv:f.vertices.map(id=>points.get(id)!),barycentric:[[1,0,0],[0,1,0],[0,0,1]] as [Bary,Bary,Bary]}));
}
export const composeWeights=(w:Bary,triangle:Bary[])=>[0,1,2].map(i=>w.reduce((sum,n,j)=>sum+n*triangle[j][i],0)) as Bary;
