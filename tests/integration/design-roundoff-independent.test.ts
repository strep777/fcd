import {expect,it} from 'vitest';
import {composeMaterialStation,type MaterialFace} from '../../packages/surface/design-cuts';
import {trimMeshSchema} from '../../packages/schema/index';

const identity:MaterialFace['barycentric']=[[1,0,0],[0,1,0],[0,0,1]];
const area=(ring:number[][])=>Math.abs(ring.reduce((n,a,i)=>{const b=ring[(i+1)%ring.length];return n+a[1]*b[2]-a[2]*b[1];},0))/2;

it('canonicalizes only the stated ulp corridor and retains physically small positive stations',()=>{
 const eps=Number.EPSILON;
 for(const point of [[-63*eps*1000,250],[250,-63*eps*1000]] as [number,number][]){const actual=composeMaterialStation(point,identity);expect(actual.every(n=>n>=0&&n<=1)).toBe(true);expect(Math.abs(actual.reduce((a,b)=>a+b,0)-1)).toBeLessThanOrEqual(eps);}
 for(const point of [[-65*eps*1000,250],[250,-65*eps*1000],[500,500+128*eps*1000]] as [number,number][])expect(()=>composeMaterialStation(point,identity)).toThrow('INVALID_CUT');
 expect(composeMaterialStation([1e-7,200],identity)[1]).toBe(1e-7/1000);
});

it('preserves an independently measured material partition through successive affine refinements',()=>{
 const parent:MaterialFace['barycentric']=[[.2,.3,.5],[.1,.8,.1],[.7,.15,.15]];
 const triangles=[[[0,0],[500,0],[0,500]],[[500,0],[1000,0],[500,500]],[[0,500],[500,500],[0,1000]],[[500,0],[500,500],[0,500]]] as [number,number][][];
 let total=0;
 for(const triangle of triangles){const mapped=triangle.map(p=>composeMaterialStation(p,parent)) as MaterialFace['barycentric'];total+=area(mapped);
  for(const point of [[175,225],[0,700],[700,0]] as [number,number][]){const actual=composeMaterialStation(point,mapped),w=[1-(point[0]+point[1])/1000,point[0]/1000,point[1]/1000],expected=[0,1,2].map(k=>w.reduce((sum,n,i)=>sum+n*mapped[i][k],0));expect(Math.max(...actual.map((n,i)=>Math.abs(n-expected[i])*1000))).toBeLessThan(1e-10);}
 }
 expect(Math.abs(total-area(parent))).toBeLessThan(1e-14);
});

it('produces strict persisted trim weights while rejecting real outside parent material coordinates',()=>{
 const vertexIds=['10000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000003'] as [string,string,string];
 const barycentric=[[0,0],[413.15546218487395,586.8445378151262],[0,1000]].map(p=>composeMaterialStation(p as [number,number],identity));
 const trim={vertices:vertexIds.map((id,i)=>({id,xMm:i*20,yMm:i===1?20:0})),triangles:[{faceId:vertexIds[0],vertices:vertexIds,barycentric}],boundary:vertexIds,holes:[]};
 expect(trimMeshSchema.safeParse(trim).success).toBe(true);
 for(const parent of [[[-1e-10,.5,.5000000001],identity[1],identity[2]],[[.2,.3,.6],identity[1],identity[2]]] as MaterialFace['barycentric'][])expect(()=>composeMaterialStation([0,0],parent)).toThrow('INVALID_CUT');
});
