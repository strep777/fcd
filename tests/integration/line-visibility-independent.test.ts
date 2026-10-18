import {expect,it} from 'vitest';
import type {Surface} from '../../packages/schema/index';
import {surfaceLineVisibility} from '../../packages/surface/line-visibility';

type V=[number,number,number];
type Screen={x:number;y:number;z:number;inverseDepth:number};
const distance=10;
const project=(perspective=false)=>(v:Surface['vertices'][number]):Screen=>{
 const inverseDepth=perspective?1/(distance-v.zMm):1;
 return {x:v.xMm*inverseDepth,y:v.yMm*inverseDepth,z:v.zMm,inverseDepth};
};
// Fixtures specify screen coverage explicitly; depth is genuine camera-space mm.
function mesh(triangles:V[][],perspective=false):Surface{
 const vertices:Surface['vertices']=[],faces:Surface['faces']=[];
 for(const triangle of triangles){const ids=triangle.map(([x,y,z])=>{const id='v'+vertices.length,k=perspective?distance-z:1;vertices.push({id,xMm:x*k,yMm:y*k,zMm:z});return id;});faces.push({id:'f'+faces.length,vertices:ids as [string,string,string],region:'cloth'});}
 return {id:'mesh',topologyVersion:1,source:'obj',vertices,faces};
}
function line(a:V,b:V,perspective=false){const at=([x,y,z]:V):Screen=>({x,y,z,inverseDepth:perspective?1/(distance-z):1});return {key:'saved-cut',a:at(a),b:at(b),color:'#123456',opacity:.5,nodes:false};}
const sub=(a:V,b:V):V=>a.map((v,i)=>v-b[i]) as V;
const cross=(a:V,b:V):V=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
const dot=(a:V,b:V)=>a.reduce((n,v,i)=>n+v*b[i],0);
// Independent Moller-Trumbore world ray/triangle intersections. No production
// screen barycentrics, clipping, camera helper or spatial index acts as oracle.
function rayDepth(surface:Surface,x:number,y:number,perspective:boolean){
 const origin:V=perspective?[0,0,distance]:[x,y,100],direction:V=perspective?[x,y,-1]:[0,0,-1];let nearest=Infinity;
 for(const face of surface.faces){const [a,b,c]=face.vertices.map(id=>{const v=surface.vertices.find(v=>v.id===id)!;return [v.xMm,v.yMm,v.zMm] as V;}),e1=sub(b,a),e2=sub(c,a),h=cross(direction,e2),det=dot(e1,h);if(Math.abs(det)<1e-12)continue;
  const s=sub(origin,a),u=dot(s,h)/det,q=cross(s,e1),v=dot(direction,q)/det,t=dot(e2,q)/det;if(u>=-1e-10&&v>=-1e-10&&u+v<=1+1e-10&&t>=0)nearest=Math.min(nearest,t);
 }
 return nearest===Infinity?-Infinity:origin[2]-nearest;
}
function verify(surface:Surface,input:ReturnType<typeof line>,perspective=false){
 const output=surfaceLineVisibility(surface,project(perspective),perspective)([input]);
 for(let i=0;i<1001;i++){
  const t=(i+.317)/1001,x=input.a.x+(input.b.x-input.a.x)*t,y=input.a.y+(input.b.y-input.a.y)*t,q=input.a.inverseDepth+(input.b.inverseDepth-input.a.inverseDepth)*t;
  const z=perspective?distance-1/q:input.a.z+(input.b.z-input.a.z)*t,nearest=rayDepth(surface,x,y,perspective);
  if(Math.abs(nearest-z)<2e-5)continue;
  const visible=output.some(segment=>{const dx=segment.b.x-segment.a.x,dy=segment.b.y-segment.a.y,k=((x-segment.a.x)*dx+(y-segment.a.y)*dy)/(dx*dx+dy*dy);return k>=0&&k<=1&&Math.abs((x-segment.a.x)*dy-(y-segment.a.y)*dx)<1e-7;});
  expect(visible,`ray sample ${i} at ${x},${y}, depth ${z}, surface ${nearest}`).toBe(nearest<=z);
 }
 for(const segment of output){expect(segment.opacity).toBe(.5);expect(segment.color).toBe(input.color);expect(segment.nodes).toBe(false);}
 return output;
}
const cover:V[]=[[-10,-10,2],[10,-10,2],[0,10,2]];
it('fully hides a saved rear seam but preserves the front seam and its 50% style',()=>{
 const surface=mesh([cover]);expect(verify(surface,line([-2,0,0],[2,0,0]))).toEqual([]);
 const front=line([-2,0,3],[2,0,3]),result=verify(surface,front);expect(result).toHaveLength(1);expect(result[0].a).toEqual(front.a);expect(result[0].b).toEqual(front.b);
});
it('clips both ends at exact triangle coverage, without a sampled staircase',()=>{
 const surface=mesh([[[-1,-1,2],[1,-1,2],[0,1,2]]]),result=verify(surface,line([-2,0,0],[2,0,0]));
 expect(result).toHaveLength(2);expect(result[0].b.x).toBeCloseTo(-.5,8);expect(result[1].a.x).toBeCloseTo(.5,8);
});
it('splits at a depth crossing inside a triangle, retaining the near half',()=>{
 const surface=mesh([[[-10,-10,-10],[10,-10,10],[0,10,0]]]),result=verify(surface,line([-2,0,0],[2,0,0]));
 expect(result).toHaveLength(1);expect(result[0].a.x).toBe(-2);expect(result[0].b.x).toBeCloseTo(1e-6,8);
});
it('uses perspective ray depth where linear screen z would expose a hidden line',()=>{
 const surface=mesh([[[-10,-10,0],[10,-10,9],[0,10,9]]],true);
 // At screen center, linear z=6.75 would put the z=7 seam in front;
 // the real camera ray intersects at z=8.709677..., so the seam must disappear.
 expect(rayDepth(surface,0,0,true)).toBeCloseTo(8.709677419,8);
 expect(verify(surface,line([-1,0,7],[1,0,7],true),true)).toEqual([]);
});
it('finds perspective depth crossings and preserves reciprocal endpoint depth',()=>{
 const surface=mesh([[[-10,-10,0],[10,-10,9],[0,10,0]]],true),input=line([-4,0,5],[4,0,5],true),result=verify(surface,input,true);
 // qSurface=.325+.045*x; qLine=.2, crossing x=-25/9.
 expect(result).toHaveLength(1);expect(result[0].b.x).toBeCloseTo(-25/9,4);expect(result[0].b.inverseDepth).toBe(.2);expect(result[0].b.z).toBeCloseTo(5,10);
});
it('treats reversed triangle winding as the same opaque surface',()=>{
 const a=mesh([cover]),b=mesh([[...cover].reverse()]),input=line([-20,0,0],[20,0,0]);
 expect(verify(b,input)).toEqual(verify(a,input));
});
it('keeps coplanar shared seams despite reversed faces and sub-bias roundoff',()=>{
 const surface=mesh([[[-2,-2,2],[2,-2,2],[2,2,2]],[[-2,-2,2],[-2,2,2],[2,2,2]]]);
 for(const z of [2,2-5e-7]){const input=line([-1,-1,z],[1,1,z]);expect(verify(surface,input)).toHaveLength(1);}
});
it('unions repeated and overlapping occluders without duplicate visible pieces',()=>{
 const first:V[]=[[-2,-1,2],[2,-1,2],[0,1,2]],second:V[]=[[-1,-1,3],[3,-1,3],[1,1,3]],surface=mesh([first,first,second,second]);
 const result=verify(surface,line([-3,0,0],[3,0,0]));expect(result).toHaveLength(2);expect(result[0].b.x).toBeCloseTo(-1,8);expect(result[1].a.x).toBeCloseTo(2,8);
});
it('ignores edge-on triangles and leaves all input geometry and metadata unchanged',()=>{
 const surface=mesh([cover,[[0,-2,4],[0,0,4],[0,2,4]]]),input=line([-20,0,0],[20,0,0]),before=structuredClone({surface,input});
 function freeze(value:object){Object.freeze(value);for(const child of Object.values(value))if(child&&typeof child==='object')freeze(child);}
 freeze(surface);freeze(input);verify(surface,input);expect({surface,input}).toEqual(before);
});
it('clips degenerate orthographic handle points by real ray depth while retaining coplanar and front points',()=>{
 const surface=mesh([cover]),visible=surfaceLineVisibility(surface,project(false));
 for(const [x,y,z]of [[0,0,0],[0,0,2],[0,0,3],[20,20,0]]){
  const input=line([x,y,z],[x,y,z]),expected=rayDepth(surface,x,y,false)<=z+1e-6,result=visible([input]);
  expect(result.length).toBe(expected?1:0);if(expected)expect(result[0].a).toEqual(result[0].b);
 }
});
it('clips degenerate perspective handle points by inverse depth where screen-linear z is wrong',()=>{
 const surface=mesh([[[-10,-10,0],[10,-10,9],[0,10,9]]],true),visible=surfaceLineVisibility(surface,project(true),true),coplanar=rayDepth(surface,0,0,true);
 for(const z of [7,coplanar,9.5]){const input=line([0,0,z],[0,0,z],true),result=visible([input]);expect(result.length).toBe(coplanar<=z+1e-6?1:0);}
});
