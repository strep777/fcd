import {randomUUID,createHash} from 'node:crypto';
import {readFileSync,mkdirSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {beforeAll,afterAll,expect,it} from 'vitest';
import type {Surface,Project,Marking} from '../../packages/schema/index';
import {generateSpecies,speciesDefaults} from '../../apps/desktop/main/species';
import {assembleSpecies} from '../../apps/desktop/main/species-assembly';
import {surfaceMarking} from '../../apps/desktop/main/markings';
import {sourceSurfaceShape} from '../../packages/surface/source-drop';
import {surfaceDragShape} from '../../packages/surface/attached-edit';
import {previewFragments} from '../../packages/surface/marking-preview';
import {pack,unpack} from '../../apps/desktop/main/archive';
import {Repository} from '../../apps/desktop/main/repository';
import {project,rectangle} from '../fixtures';

type Mode='dtd'|'padded'|'costume';
type Vec=[number,number,number];
type Site={name:string;region:string;yFraction:number;xFraction?:number;view:'front'|'back'|'left'|'right'};
const sites:Site[]=[
 {name:'chest',region:'torso',yFraction:.7,view:'front'},
 {name:'abdomen',region:'torso',yFraction:.35,view:'front'},
 ...['left','right'].flatMap(side=>[
  {name:side+' shoulder',region:'arm-'+side,yFraction:.8,xFraction:.12,view:'front' as const},
  {name:side+' upper arm',region:'arm-'+side,yFraction:.6,xFraction:.4,view:'front' as const},
  {name:side+' thigh',region:'leg-'+side,yFraction:.72,view:'front' as const},
  {name:side+' calf',region:'leg-'+side,yFraction:.3,view:'front' as const},
 ]),
 {name:'back',region:'torso',yFraction:.7,view:'back'},
 {name:'left side',region:'torso',yFraction:.7,view:'left'},
 {name:'right side',region:'torso',yFraction:.7,view:'right'},
];
const cases=(['dtd','padded','costume'] as Mode[]).flatMap(mode=>[...sites,...(mode==='costume'?[{name:'tail',region:'tail',yFraction:.5,view:'right' as const}]:[])].map(site=>({mode,site,name:site.name})));
const worker=resolve('target/release/fpcad-worker.exe'),models=new Map<Mode,Surface>(),records:unknown[]=[];
const xyz=(p:{xMm:number;yMm:number;zMm:number}):Vec=>[p.xMm,p.yMm,p.zMm];
const sub=(a:Vec,b:Vec):Vec=>a.map((v,i)=>v-b[i]) as Vec;
const cross=(a:Vec,b:Vec):Vec=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
function inside(p:number[],ring:number[][]){let yes=false;for(let i=0,j=ring.length-1;i<ring.length;j=i++)if((ring[i][1]>p[1])!==(ring[j][1]>p[1])&&p[0]<(ring[j][0]-ring[i][0])*(p[1]-ring[i][1])/(ring[j][1]-ring[i][1])+ring[i][0])yes=!yes;return yes;}
function geometry(mesh:Surface){const vv=new Map(mesh.vertices.map(v=>[v.id,xyz(v)]));return mesh.faces.map(face=>({face,p:face.vertices.map(id=>vv.get(id)!),center:face.vertices.map(id=>vv.get(id)!).reduce((sum,p)=>sum.map((v,i)=>v+p[i]/3) as Vec,[0,0,0] as Vec)}));}
// Independent axis-aligned orthographic camera oracle. It intersects every
// original triangle in the image plane and selects maximum camera depth; no
// production picker, decal chart, normal interpolation or ownership is used.
function nearest(rows:ReturnType<typeof geometry>,point:Vec,view:Site['view']){
 const axis=view==='left'||view==='right'?0:2,sign=view==='left'||view==='back'?-1:1,axes=axis===2?[0,1]:[2,1];let depth=-Infinity,faceId='';
 for(const row of rows){const [a,b,c]=row.p,x=axes[0],y=axes[1],det=(b[x]-a[x])*(c[y]-a[y])-(b[y]-a[y])*(c[x]-a[x]);if(Math.abs(det)<1e-12)continue;
  const u=((point[x]-a[x])*(c[y]-a[y])-(point[y]-a[y])*(c[x]-a[x]))/det,v=((b[x]-a[x])*(point[y]-a[y])-(b[y]-a[y])*(point[x]-a[x]))/det;if(u< -1e-10||v< -1e-10||u+v>1+1e-10)continue;
  const d=sign*((1-u-v)*a[axis]+u*b[axis]+v*c[axis]);if(d>depth){depth=d;faceId=row.face.id;}
 }return {faceId,depth,axis,sign};
}
function anchor(rows:ReturnType<typeof geometry>,site:Site){
 const candidates=rows.filter(r=>r.face.region===site.region||site.region==='tail'&&r.face.region.startsWith('tail-'));expect(candidates.length,site.name).toBeGreaterThan(0);
 const bounds=[0,1,2].map(axis=>[Math.min(...candidates.flatMap(r=>r.p.map(p=>p[axis]))),Math.max(...candidates.flatMap(r=>r.p.map(p=>p[axis])))]),y=bounds[1][0]+site.yFraction*(bounds[1][1]-bounds[1][0]),side=site.region.endsWith('left')?-1:1;
 const x=site.xFraction===undefined?(bounds[0][0]+bounds[0][1])/2:side*(Math.min(Math.abs(bounds[0][0]),Math.abs(bounds[0][1]))+site.xFraction*(bounds[0][1]-bounds[0][0])),z=(bounds[2][0]+bounds[2][1])/2;
 const sorted=candidates.sort((a,b)=>{const score=(r:typeof a)=>(r.center[1]-y)**2+(site.view==='left'||site.view==='right'?(r.center[2]-z)**2:(r.center[0]-x)**2);return score(a)-score(b);});
 for(const row of sorted){const hit=nearest(rows,row.center,site.view);if(Math.abs(hit.depth-hit.sign*row.center[hit.axis])<1e-6)return row;}
 throw Error('No independently camera-visible anchor at '+site.name);
}
function physicalArea(rows:ReturnType<typeof geometry>,fragments:Marking['fragments']){const faces=new Map(rows.map(r=>[r.face.id,r]));return fragments.reduce((sum,f)=>{const [a,b,c]=faces.get(f.faceId)!.p,area=Math.hypot(...cross(sub(b,a),sub(c,a)))/2;return sum+f.rings.reduce((total,ring)=>total+ring.reduce((n,p,i)=>{const q=ring[(i+1)%ring.length];return n+p[1]*q[2]-q[1]*p[2];},0)*area,0);},0);}
function component(mesh:Surface,start:string){
 const edges=new Map<string,string[]>(),neighbors=new Map(mesh.faces.map(f=>[f.id,new Set<string>()]));for(const f of mesh.faces)for(let i=0;i<3;i++){const key=[f.vertices[i],f.vertices[(i+1)%3]].sort().join(':');edges.set(key,[...edges.get(key)??[],f.id]);}for(const ids of edges.values())if(ids.length===2){neighbors.get(ids[0])!.add(ids[1]);neighbors.get(ids[1])!.add(ids[0]);}
 const seen=new Set<string>(),queue=[start];while(queue.length){const id=queue.pop()!;if(seen.has(id))continue;seen.add(id);queue.push(...neighbors.get(id)!);}return seen;
}
beforeAll(async()=>{for(const mode of ['dtd','padded','costume'] as Mode[])models.set(mode,await assembleSpecies(generateSpecies(speciesDefaults('canine',mode))));},120000);
it.each(cases)('$mode visible $name preserves a full-size fitting source, its hole, anchor and persisted local sheet',async({mode,site})=>{
 const surface=models.get(mode)!,p:Project={...project(),surface,pieces:[],bindings:[],markings:[]},rows=geometry(surface),target=anchor(rows,site),hit=nearest(rows,target.center,site.view),normal=cross(sub(target.p[1],target.p[0]),sub(target.p[2],target.p[0])),length=Math.hypot(...normal),unit=normal.map(v=>v/length) as Vec;
 const source=site.name==='tail'?rectangle(20,40):rectangle(80,80),w=site.name==='tail'?20:80,h=site.name==='tail'?40:80,hole=site.name==='tail'?4:10;
 source.holes=[[[w*.2,h*.2],[w*.2+hole,h*.2],[w*.2+hole,h*.2+hole],[w*.2,h*.2+hole]].map(([xMm,yMm])=>({id:randomUUID(),xMm,yMm}))];
 const before=JSON.stringify(p),sourceBefore=structuredClone(source),position={xMm:target.center[0],yMm:target.center[1],zMm:target.center[2]},frame={origin:[0,0,0] as Vec,axes:[[1,0,0],[0,1,0],[0,0,1]] as [Vec,Vec,Vec]},shape=surfaceDragShape(sourceSurfaceShape(source,position,frame),{xMm:0,yMm:0},position,unit,undefined,target.face.id);
 const record:Record<string,unknown>={mode,site:site.name,targetFace:target.face.id,nearestCameraFace:hit.faceId,anchor:position,sourceWidthMm:w,sourceHeightMm:h,sourceHoleMm:hole};
 try{
  const saved=await surfaceMarking(worker,p,shape,source.color,mode+' '+site.name);expect(saved.fragments.length).toBeGreaterThan(0);expect(saved.surfaceShape!.holes).toHaveLength(1);expect(saved.surfaceShape!.nodes).toEqual(shape.nodes);
  expect(saved.surfaceShape!.holes).toEqual(shape.holes);expect(Math.abs(hit.depth-hit.sign*target.center[hit.axis]),'The drop anchor is on the independently nearest visible sheet').toBeLessThanOrEqual(1e-6);
  const anchorFragments=saved.fragments.filter(f=>f.faceId===target.face.id);expect(anchorFragments.some(f=>f.rings.reduce((yes,r)=>yes!==inside([1/3,1/3],r.map(b=>[b[1],b[2]])),false)),'The actual camera-picked anchor is painted').toBe(true);
  for(const fragment of saved.fragments)for(const ring of fragment.rings)for(const weights of ring){expect(weights.every(v=>Number.isFinite(v)&&v>=-1e-8&&v<=1+1e-8)).toBe(true);expect(weights.reduce((sum,v)=>sum+v,0)).toBeCloseTo(1,8);}
  const actualArea=physicalArea(rows,saved.fragments),expectedArea=w*h-hole*hole;record.physicalAreaMm2=actualArea;record.expectedAreaMm2=expectedArea;record.physicalAreaRelativeDifference=actualArea/expectedArea-1;expect(Number.isFinite(actualArea)&&actualArea>0).toBe(true);
  // Wrapping follows the picked connected sheet. A piece may legitimately
  // continue behind another body part in this one camera; that visibility and
  // the 3D-vs-flat area difference are observations, not new product limits.
  const connected=component(surface,target.face.id),byId=new Map(rows.map(r=>[r.face.id,r]));let cameraOccludedProbes=0,maxCameraOcclusionMm=0;
  for(const f of saved.fragments){expect(connected.has(f.faceId),'Paint cannot jump to an unrelated disconnected sheet').toBe(true);const row=byId.get(f.faceId)!,ring=f.rings[0],center=ring.reduce((sum,b)=>sum.map((v,axis)=>v+row.p.reduce((n,p,i)=>n+p[axis]*b[i],0)/ring.length) as Vec,[0,0,0] as Vec),visible=nearest(rows,center,site.view),depth=Math.abs(visible.depth-visible.sign*center[visible.axis]);if(depth>1e-5)cameraOccludedProbes++;maxCameraOcclusionMm=Math.max(maxCameraOcclusionMm,depth);}
  record.cameraOccludedProbes=cameraOccludedProbes;record.maxCameraOcclusionMm=maxCameraOcclusionMm;
  const draft=previewFragments(surface,shape);expect(new Set(draft!.map(f=>f.faceId))).toEqual(new Set(saved.fragments.map(f=>f.faceId)));
  const repo=new Repository(':memory:');try{repo.open(p,null);repo.commit({type:'marking.put',marking:saved},randomUUID(),'visible matrix');expect(repo.snapshot()!.markings).toEqual([saved]);expect(unpack(pack(repo.snapshot()!).bytes).markings).toEqual([saved]);repo.historyMove(false);expect(repo.snapshot()!.markings??[]).toHaveLength(0);repo.historyMove(true);expect(repo.snapshot()!.markings).toEqual([saved]);}finally{repo.close();}
  expect(JSON.stringify(p)).toBe(before);expect(source).toEqual(sourceBefore);record.passed=true;record.fragments=saved.fragments.length;
 }catch(error){record.passed=false;record.error=String(error);throw error;}finally{records.push(record);}
},30000);
afterAll(()=>{const directory=resolve('test-results/2026-10-25-pattern-quality');mkdirSync(directory,{recursive:true});writeFileSync(resolve(directory,'group2-visible-body-matrix-measurements.json'),JSON.stringify({workerSha256:createHash('sha256').update(readFileSync(worker)).digest('hex'),scope:'Manual domain-level drag attachment with explicitly created fitting 80mm sources (tail 20x40), not UI events, automatic matching, or resized original JPEG assets. Independent nearest orthographic triangle oracle, physical fragment area, anchor, barycentrics, occlusion, preview/persist/archive/undo-redo.',records},null,2));});
