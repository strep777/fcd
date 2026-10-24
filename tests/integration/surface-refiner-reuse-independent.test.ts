import {expect,it} from 'vitest';
import {randomUUID} from 'node:crypto';
import type {Surface} from '../../packages/schema/index';
import {createSurfaceRefiner,refineSurface,type FaceCut} from '../../packages/surface/refine';
import {sectionDesignDomain} from '../../packages/surface/design-section';

// An affine sloping square and a distant island make physical coordinates,
// texture coordinates and untouched topology independently predictable.
function fixture(){
 const vertices=[[0,0,0],[100,0,10],[100,100,30],[0,100,20],[300,0,0],[400,0,0],[300,100,0]].map(([xMm,yMm,zMm])=>({id:randomUUID(),xMm,yMm,zMm}));
 const faces=[[0,1,2],[0,2,3],[4,5,6]].map((ids,i)=>({id:randomUUID(),vertices:ids.map(j=>vertices[j].id) as [string,string,string],region:['left-material','right-material','distant-material'][i]}));
 const mesh:Surface={id:randomUUID(),source:'obj',topologyVersion:7,vertices,faces};
 return mesh;
}
const cuts=(mesh:Surface,t:number):FaceCut[]=>[{faceId:mesh.faces[0].id,a:[1-t,t,0],b:[1-t,0,t],owner:'trial'}];
const coords=(p:Surface['vertices'][number])=>[p.xMm,p.yMm,p.zMm];
const distance=(a:number[],b:number[])=>Math.hypot(...a.map((n,i)=>n-b[i]));
function inspect(source:Surface,result:ReturnType<typeof refineSurface>){
 const points=new Map(result.surface.vertices.map(v=>[v.id,v])),originals=new Map(source.vertices.map(v=>[v.id,v]));
 expect(new Set(result.surface.vertices.map(v=>v.id)).size).toBe(result.surface.vertices.length);
 const edges=new Map<string,{a:string;b:string}[]>();
 for(const face of result.surface.faces){
  expect(face.vertices.every(id=>points.has(id))).toBe(true);
  face.vertices.forEach((a,i)=>{const b=face.vertices[(i+1)%3],key=[a,b].sort().join(':'),rows=edges.get(key)??[];rows.push({a,b});edges.set(key,rows);});
 }
 for(const rows of edges.values()){
  expect(rows.length).toBeLessThanOrEqual(2);
  if(rows.length===2)expect(rows[0].a).toBe(rows[1].b);
  const a=coords(points.get(rows[0].a)!),b=coords(points.get(rows[0].b)!),d=b.map((n,i)=>n-a[i]),length2=d.reduce((s,n)=>s+n*n,0);
  for(const p of points.values()){
   if(p.id===rows[0].a||p.id===rows[0].b)continue;
   const xyz=coords(p),t=d.reduce((s,n,i)=>s+n*(xyz[i]-a[i]),0)/length2;
   if(t>1e-8&&t<1-1e-8)expect(distance(xyz,a.map((n,i)=>n+t*d[i])),'no hanging station inside a mesh edge').toBeGreaterThan(1e-7);
  }
 }
 for(const [parent,children]of result.children){
  const original=source.faces.find(f=>f.id===parent)!;
  expect(result.surface.faces.some(f=>f.id===parent)).toBe(false);
  let coverage=0;
  for(const child of children){
   expect(child.face.region).toBe(original.region);
   const [a,b,c]=child.triangle,ratio=((b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]))/1e6;
   expect(ratio).toBeGreaterThan(0);coverage+=ratio;
   child.triangle.forEach(([u,v],i)=>{
    const weights=[1-(u+v)/1000,u/1000,v/1000];
    expect(weights.every(w=>w>=-1e-10&&w<=1+1e-10)).toBe(true);
    const expected=[0,1,2].map(axis=>weights.reduce((sum,w,k)=>sum+w*coords(originals.get(original.vertices[k])!)[axis],0));
    expect(distance(expected,coords(points.get(child.face.vertices[i])!))).toBeLessThan(1e-9);
   });
  }
  expect(coverage).toBeCloseTo(1,11);
 }
 expect(result.surface.faces.find(f=>f.id===source.faces[2].id)).toEqual(source.faces[2]);
 expect(result.surface.vertices.filter(v=>source.faces[2].vertices.includes(v.id))).toEqual(source.vertices.slice(4));
}

it('nine independent proposals preserve exact parent coverage and adjoining materials without accumulating trial stations',()=>{
 const mesh=fixture(),before=structuredClone(mesh),refine=createSurfaceRefiner(mesh);
 for(let i=1;i<=9;i++){
  const t=i/10,result=refine(cuts(mesh,t),randomUUID);inspect(mesh,result);
  expect(mesh).toEqual(before);expect(result.children.has(mesh.faces[1].id)).toBe(true);
  const created=result.surface.vertices.filter(v=>!mesh.vertices.some(p=>p.id===v.id));
  expect(created).toHaveLength(2);
  for(const p of created)expect(p.xMm).toBeCloseTo(100*t,10);
  const shared=created.find(p=>Math.abs(p.xMm-p.yMm)<1e-8)!;
  expect(new Set(result.surface.faces.filter(f=>f.vertices.includes(shared.id)).map(f=>f.region))).toEqual(new Set(['left-material','right-material']));
 }
});

it('oppositely oriented cuts on both incident faces share one physical station and one continuous owned path',()=>{
 const mesh=fixture(),t=.37,requests=[...cuts(mesh,t),{faceId:mesh.faces[1].id,a:[1-t,0,t],b:[1-t,t,0],owner:'trial'} as FaceCut];
 for(const ordered of [requests,[...requests].reverse()]){
  const result=createSurfaceRefiner(mesh)(ordered,randomUUID);inspect(mesh,result);
  const shared=result.surface.vertices.filter(p=>distance(coords(p),[37,37,11.1])<1e-8);expect(shared).toHaveLength(1);
  const owned=result.owned.get('trial')!,degree=new Map<string,number>();
  for(const e of owned)for(const id of [e.a,e.b])degree.set(id,(degree.get(id)??0)+1);
  expect(degree.get(shared[0].id)).toBe(2);expect([...degree.values()].filter(n=>n===1)).toHaveLength(2);
  const points=new Map(result.surface.vertices.map(p=>[p.id,p]));
  expect(owned.reduce((s,e)=>s+distance(coords(points.get(e.a)!),coords(points.get(e.b)!)),0)).toBeCloseTo(37*(Math.sqrt(1.04)+Math.sqrt(1.01)),9);
 }
});

it('saved seam chains, locked constraints and affine texture stations remain on the same physical parent edge',()=>{
 const mesh=fixture(),[a,,c]=mesh.vertices,textureId=randomUUID();
 mesh.cutConstraints=[{a:a.id,b:c.id,locked:true}];mesh.cutBaseConstraints=structuredClone(mesh.cutConstraints);
 mesh.cutLines=[{id:randomUUID(),name:'saved diagonal',kind:'section',closed:false,enabled:true,symmetric:false,controlPoints:[],tension:0,edges:[{a:a.id,b:c.id}]}];
 const uv=(p:Surface['vertices'][number]):[number,number]=>[.2+p.xMm/500,.1+p.yMm/250];
 mesh.textureFaces=mesh.faces.map(f=>({faceId:f.id,textureId,uv:f.vertices.map(id=>uv(mesh.vertices.find(p=>p.id===id)!)) as [[number,number],[number,number],[number,number]]}));
 const result=createSurfaceRefiner(mesh)(cuts(mesh,.4),randomUUID);inspect(mesh,result);
 const points=new Map(result.surface.vertices.map(p=>[p.id,p]));
 for(const chain of [result.surface.cutConstraints!,result.surface.cutBaseConstraints!,result.surface.cutLines![0].edges]){
  expect(chain).toHaveLength(2);expect(chain.reduce((s,e)=>s+distance(coords(points.get(e.a)!),coords(points.get(e.b)!)),0)).toBeCloseTo(Math.sqrt(20900),9);
  for(const e of chain)for(const id of [e.a,e.b]){const p=points.get(id)!;expect(p.xMm).toBeCloseTo(p.yMm,10);}
 }
 expect(result.surface.cutConstraints!.every(e=>e.locked)).toBe(true);
 expect(result.surface.textureFaces).toHaveLength(result.surface.faces.length);
 for(const row of result.surface.textureFaces!){const face=result.surface.faces.find(f=>f.id===row.faceId)!;expect(row.textureId).toBe(textureId);row.uv.forEach((actual,i)=>{const expected=uv(points.get(face.vertices[i])!);expect(distance(actual,expected)).toBeLessThan(1e-12);});}
});

it('an allocation failure leaves cached input and subsequent successful proposals unchanged',()=>{
 const mesh=fixture(),before=structuredClone(mesh),refine=createSurfaceRefiner(mesh);
 let count=0;expect(()=>refine(cuts(mesh,.2),()=>{if(++count===2)throw Error('allocation failure');return randomUUID();})).toThrow('allocation failure');
 const result=refine(cuts(mesh,.7),randomUUID);inspect(mesh,result);expect(mesh).toEqual(before);
 expect(result.surface.vertices.filter(p=>!mesh.vertices.some(v=>v.id===p.id)).every(p=>Math.abs(p.xMm-70)<1e-8)).toBe(true);
});

it('editing a discarded trial child cannot corrupt the next proposal or its parent stations',()=>{
 const mesh=fixture(),refine=createSurfaceRefiner(mesh),first=refine(cuts(mesh,.2),randomUUID);
 first.surface.vertices.find(p=>!mesh.vertices.some(v=>v.id===p.id))!.xMm=999;
 first.children.get(mesh.faces[0].id)![0].triangle[0][0]=999;
 first.children.get(mesh.faces[0].id)![0].face.region='discarded';
 const next=refine(cuts(mesh,.6),randomUUID);inspect(mesh,next);
 expect(next.surface.vertices.some(p=>p.xMm===999)).toBe(false);
});

it.each([false,true])('rejects a distant unchanged collinear face with local cuts=%s',withCuts=>{
 const mesh=fixture();mesh.vertices[6].xMm=500;mesh.vertices[6].yMm=0;
 const before=structuredClone(mesh),refine=createSurfaceRefiner(mesh);
 expect(()=>refine(withCuts?cuts(mesh,.4):[],randomUUID)).toThrow('DEGENERATE_MESH');expect(mesh).toEqual(before);
});

it('a later empty proposal returns original topology and metadata without any discarded cut',()=>{
 const mesh=fixture(),refine=createSurfaceRefiner(mesh);refine(cuts(mesh,.4),randomUUID);
 const empty=refine([],randomUUID);expect(empty.surface).toEqual({...mesh,cutConstraints:[]});expect(empty.children.size).toBe(0);expect(empty.owned.size).toBe(0);
});

it('section trial selection preserves texture attachment after improving child diagonals',()=>{
 const vertices:Surface['vertices']=[],faces:Surface['faces']=[],xs=[0,10,35,70,100],ys=[0,12,40,68,100];
 for(const yMm of ys)for(const xMm of xs)vertices.push({id:randomUUID(),xMm,yMm,zMm:.1*xMm+.2*yMm});
 for(let y=0;y<4;y++)for(let x=0;x<4;x++){const a=y*5+x,b=a+1,c=a+5,d=c+1;for(const row of [[a,b,d],[a,d,c]])faces.push({id:randomUUID(),vertices:row.map(i=>vertices[i].id) as [string,string,string],region:'textured-cloth'});}
 const textureId=randomUUID(),uv=(p:Surface['vertices'][number]):[number,number]=>[.2+p.xMm/500,.1+p.yMm/250];
 const mesh:Surface={id:randomUUID(),source:'obj',topologyVersion:1,vertices,faces,textureFaces:faces.map(f=>({faceId:f.id,textureId,uv:f.vertices.map(id=>uv(vertices.find(p=>p.id===id)!)) as [[number,number],[number,number],[number,number]]}))},before=structuredClone(mesh);
 const result=sectionDesignDomain(mesh,faces,randomUUID);expect(result).toBeDefined();expect(mesh).toEqual(before);
 const points=new Map(result!.surface.vertices.map(v=>[v.id,v]));
 expect(result!.surface.textureFaces).toHaveLength(result!.surface.faces.length);
 for(const row of result!.surface.textureFaces!){
  const face=result!.surface.faces.find(f=>f.id===row.faceId)!;expect(face).toBeDefined();
  row.uv.forEach((actual,i)=>expect(distance(actual,uv(points.get(face.vertices[i])!)),'texture must remain attached to the physical child vertex').toBeLessThan(1e-12));
 }
});
