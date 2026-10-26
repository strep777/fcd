import {afterEach,expect,it,vi} from 'vitest';
import {randomUUID} from 'node:crypto';
import {resolve} from 'node:path';
import type {Surface} from '../../packages/schema/index';
import type {Bary,FaceCut} from '../../packages/surface/refine';
import * as continuity from '../../packages/surface/section-continuity';
import {cutPreview} from '../../apps/desktop/main/cut-preview';
import {editSurfaceCuts} from '../../apps/desktop/main/cut-tools';
import {parseObj} from '../../apps/desktop/main/surface';
import {openingWorldTrace,requireAnalyticOpening,type Point3} from '../fixtures/geometric-opening-independent';
import {project} from '../fixtures';

afterEach(()=>vi.restoreAllMocks());
const sub=(a:number[],b:number[])=>a.map((n,i)=>n-b[i]),dot=(a:number[],b:number[])=>a.reduce((s,n,i)=>s+n*b[i],0),cross=(a:number[],b:number[])=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]],unit=(a:number[])=>{const l=Math.hypot(...a);return a.map(n=>n/l);};
const angle=(a:number[],b:number[])=>Math.acos(Math.max(-1,Math.min(1,dot(a,b)/Math.hypot(...a)/Math.hypot(...b))))*180/Math.PI;

function shoulder(scale=1,reverse=false){
 // Exact original source vertices and the two surviving physical cut edges
 // from the saved R4 candidate. No production section or mapping constructs
 // this regression: the 110-degree elbow crosses an 11-degree surface bend.
 const xyz=[[-286.1007080078125,1467.8372802734375,61.863609313964844],[-292.0484619140625,1478.0404052734375,58.26504135131836],[-336.87066650390625,1438.71142578125,60.030487060546875],[-330.9002685546875,1428.370361328125,61.2065544128418]],vertices=xyz.map(([x,y,z],i)=>({id:'shoulder-v'+i,xMm:x*scale,yMm:y*scale,zMm:z*scale}));
 const surface:Surface={id:'actual-shoulder',source:'obj',topologyVersion:1,vertices,faces:[{id:'shoulder-0',vertices:['shoulder-v0','shoulder-v1','shoulder-v2'],region:'arm-left'},{id:'shoulder-1',vertices:['shoulder-v0','shoulder-v2','shoulder-v3'],region:'arm-left'}]};
 const cuts:FaceCut[]=[{faceId:'shoulder-0',a:[.2765173941991394,.05273135526376029,.6707512505371004],b:[.30646487413474377,0,.6935351258652563],owner:'actual-shoulder'},{faceId:'shoulder-1',a:[.30646487413474377,.6935351258652562,0],b:[.3187241595869292,0,.6812758404130709],owner:'actual-shoulder'}];
 if(reverse){surface.vertices.reverse();surface.faces.reverse();cuts.reverse();for(const c of cuts)[c.a,c.b]=[c.b,c.a];}
 return{surface,cuts};
}
function measured(f:ReturnType<typeof shoulder>){const trace=openingWorldTrace(f.surface,f.cuts),point=(f:Surface['faces'][number])=>f.vertices.map(id=>{const v=fSurface.vertices.find(v=>v.id===id)!;return[v.xMm,v.yMm,v.zMm];}),fSurface=f.surface,normals=f.surface.faces.map(face=>{const [a,b,c]=point(face);return unit(cross(sub(b,a),sub(c,a)));}),center=trace.flatMap(t=>[t.a,t.b]).find(p=>trace.every(t=>[t.a,t.b].some(q=>Math.hypot(...sub(p,q))<1e-7)))!,ends=trace.map(t=>[t.a,t.b].find(p=>Math.hypot(...sub(p,center))>1e-7)!);return{angleDeg:angle(sub(ends[0],center),sub(ends[1],center)),normalSpreadDeg:angle(normals[0],normals[1]),center};}

it.each([{scale:1,reverse:false},{scale:.001,reverse:true},{scale:1000,reverse:true}])('rejects the actual 110-degree shoulder elbow across the same mild source bend (%j)',({scale,reverse})=>{
 const f=shoulder(scale,reverse),before=structuredClone(f),metrics=measured(f);
 expect(metrics.angleDeg).toBeCloseTo(110.31065439063634,7);expect(metrics.normalSpreadDeg).toBeCloseTo(11.309841565665215,7);
 expect(continuity.continuousSection(f.surface,f.cuts)).toBe(false);expect(f).toEqual(before);
});

it('a physical hard fold preserves a real corner with the same exact source stations',()=>{
 const f=shoulder(),a=f.surface.vertices[0],b=f.surface.vertices[2],p=f.surface.vertices[3],origin=[a.xMm,a.yMm,a.zMm],axis=unit(sub([b.xMm,b.yMm,b.zMm],origin)),q=sub([p.xMm,p.yMm,p.zMm],origin),turn=Math.PI/2,rotated=q.map((n,i)=>origin[i]+n*Math.cos(turn)+cross(axis,q)[i]*Math.sin(turn)+axis[i]*dot(axis,q)*(1-Math.cos(turn)));
 [p.xMm,p.yMm,p.zMm]=rotated as Point3;const metrics=measured(f);
 expect(metrics.angleDeg).toBeLessThan(135);expect(metrics.normalSpreadDeg).toBeGreaterThan(30);expect(continuity.continuousSection(f.surface,f.cuts)).toBe(true);
});

it('a genuine T branch remains a junction instead of being mistaken for an elbow',()=>{
 const f=shoulder();f.cuts.push({faceId:'shoulder-0',a:[.30646487413474377,0,.6935351258652563],b:[0,1,0],owner:'actual-branch'});
 const trace=openingWorldTrace(f.surface,f.cuts),center=measured(shoulder()).center,degree=trace.filter(e=>[e.a,e.b].some(p=>Math.hypot(...sub(p,center))<1e-7)).length;
 expect(degree).toBe(3);expect(continuity.continuousSection(f.surface,f.cuts)).toBe(true);
});

it('coincident disconnected source banks are separate finite cuts rather than a false sharp joint',()=>{
 const f=shoulder(),right=f.surface.faces.find(face=>face.id==='shoulder-1')!,originals=new Map(f.surface.vertices.map(v=>[v.id,v]));
 right.vertices=right.vertices.map(id=>{const copy={...originals.get(id)!,id:id+'-disconnected'};f.surface.vertices.push(copy);return copy.id;}) as [string,string,string];
 expect(right.vertices.every(id=>!f.surface.faces[0].vertices.includes(id))).toBe(true);
 expect(measured(f).angleDeg).toBeCloseTo(110.31065439063634,7);
 expect(continuity.continuousSection(f.surface,f.cuts)).toBe(true);
});

it.each([{divisions:1,flip:false,scale:1},{divisions:1,flip:true,scale:1},{divisions:3,flip:true,scale:.01},{divisions:2,flip:false,scale:100}])('a straight physical cut stays legal under coplanar diagonal flips, subdivisions and scale (%j)',({divisions,flip,scale})=>{
 const vertices:Surface['vertices']=[],faces:Surface['faces']=[],count=divisions+1;
 for(let y=0;y<=divisions;y++)for(let x=0;x<=divisions;x++)vertices.push({id:`v-${x}-${y}`,xMm:(-100+200*x/divisions)*scale,yMm:(-100+200*y/divisions)*scale,zMm:0});
 for(let y=0;y<divisions;y++)for(let x=0;x<divisions;x++){const a=y*count+x,b=a+1,c=a+count,d=c+1;for(const indices of flip?[[a,b,c],[b,d,c]]:[[a,b,d],[a,d,c]])faces.push({id:'f-'+faces.length,region:'cloth',vertices:indices.map(i=>vertices[i].id) as [string,string,string]});}
 const surface:Surface={id:'straight-independent',source:'obj',topologyVersion:1,vertices:vertices.reverse(),faces:faces.reverse()},start:Point3=[-80*scale,-53*scale,0],end:Point3=[80*scale,47*scale,0],cuts:FaceCut[]=[];
 for(const face of faces){const [a,b,c]=face.vertices.map(id=>vertices.find(v=>v.id===id)!),den=(b.xMm-a.xMm)*(c.yMm-a.yMm)-(b.yMm-a.yMm)*(c.xMm-a.xMm),weights=(p:Point3):Bary=>{const v=((p[0]-a.xMm)*(c.yMm-a.yMm)-(p[1]-a.yMm)*(c.xMm-a.xMm))/den,w=((b.xMm-a.xMm)*(p[1]-a.yMm)-(b.yMm-a.yMm)*(p[0]-a.xMm))/den;return[1-v-w,v,w];},wa=weights(start),wb=weights(end);let lo=0,hi=1;
  for(let i=0;i<3;i++){const d=wb[i]-wa[i];if(Math.abs(d)<1e-14){if(wa[i]<0)hi=-1;}else if(d>0)lo=Math.max(lo,-wa[i]/d);else hi=Math.min(hi,-wa[i]/d);}
  if(hi-lo<=1e-10)continue;const at=(t:number)=>wa.map((n,i)=>n+t*(wb[i]-n)) as Bary;cuts.push({faceId:face.id,a:at(lo),b:at(hi),owner:'analytic-straight'});
 }
 requireAnalyticOpening(openingWorldTrace(surface,cuts),start,end);expect(continuity.continuousSection(surface,cuts)).toBe(true);
});

it('saving and unfolding a locked authored right-angle line bypasses automatic-candidate continuity filtering',async()=>{
 const calls=vi.spyOn(continuity,'continuousSection').mockImplementation(()=>{throw Error('An authored line reached automatic section filtering');});
 const p=project();p.pieces=[];p.defaultAllowanceMm=0;p.surface=parseObj('v -100 0 0\nv 100 0 0\nv 100 200 0\nv -100 200 0\nf 1 2 3\nf 1 3 4');
 const controlPoints=[[-100,50],[0,50],[0,150],[100,150]].map(([xMm,yMm])=>({id:randomUUID(),xMm,yMm,zMm:0})),worker=resolve('target/release/fpcad-worker.exe');
 Object.assign(p,await editSurfaceCuts(worker,p,{type:'surface.curve',name:'Authored right-angle line',kind:'pen',closed:false,controlPoints,surfaceAnchored:true,projection:{origin:[0,0,0],axes:[[1,0,0],[0,1,0],[0,0,1]]},tension:1,symmetric:false}));
 const before=structuredClone(p),candidate=await cutPreview(worker,p.surface!,p,{method:'arap',partitionStrategy:'design',automaticCuts:false},resolve('dist/assets'));
 expect(candidate.run.pieces).toHaveLength(2);expect(candidate.run.designCutReport!.userSeams).toBe(1);expect(p.surface!.cutLines![0].controlPoints).toEqual(controlPoints);expect(p).toEqual(before);expect(calls).not.toHaveBeenCalled();
},30000);
