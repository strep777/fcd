import type {Surface,SurfaceReport} from '../schema/index';
import {refineSurface,type Child} from './refine';
import {orientedPlaneSegments} from './cut-geometry';
import {designComponents} from './design-partition';

/** Split at the actual manufacturing obstruction in the solved paper chart.
 * A box-centre cut in model space can miss a small collapsed hole repeatedly.
 * All new stations are barycentric refinements of the unchanged 3D surface. */
export function manufacturingSection(mesh:Surface,report:SurfaceReport,hole:number|undefined,newId:()=>string){
 const ids=new Set(report.faceIds),faces=mesh.faces.filter(f=>ids.has(f.id)),uv=new Map(report.uv.map(p=>[p.vertexId,p]));
 if(faces.length<2)return;
 const ring=(hole===undefined?report.boundary:report.holes?.[hole])?.map(id=>uv.get(id)!);if(!ring?.length||ring.some(p=>!p))return;
 const min=[Math.min(...ring.map(p=>p.xMm)),Math.min(...ring.map(p=>p.yMm))],max=[Math.max(...ring.map(p=>p.xMm)),Math.max(...ring.map(p=>p.yMm))];
 let normal:[number,number,number]=max[0]-min[0]>max[1]-min[1]?[1,0,0]:[0,1,0],position=normal[0]?(min[0]+max[0])/2:(min[1]+max[1])/2;
 if(hole===undefined){
  // A closed zero-width dart is a backtrack in the paper boundary. Continue
  // a transverse section through its tip, not through an unrelated box centre.
  const tips=ring.flatMap((p,i)=>{const a=ring[(i+ring.length-1)%ring.length],b=ring[(i+1)%ring.length],u=[a.xMm-p.xMm,a.yMm-p.yMm],v=[b.xMm-p.xMm,b.yMm-p.yMm],l=Math.hypot(...u),m=Math.hypot(...v);return l>1e-6&&m>1e-6&&u[0]*v[0]+u[1]*v[1]>0&&Math.abs(u[0]*v[1]-u[1]*v[0])/Math.max(l,m)<1e-6?[{p,u:u.map(n=>n/l),length:Math.min(l,m)}]:[];}).sort((a,b)=>b.length-a.length);
  if(tips.length){const tip=tips[0];normal=[tip.u[0],tip.u[1],0];position=tip.p.xMm*normal[0]+tip.p.yMm*normal[1];}
 }
 const flat:Surface={...mesh,vertices:report.uv.map(p=>({id:p.vertexId,xMm:p.xMm,yMm:p.yMm,zMm:0})),faces,assembly:undefined};
 let revised:ReturnType<typeof refineSurface>;
 try{revised=refineSurface(mesh,orientedPlaneSegments(flat,normal,position,'manufacturing-section'),newId);}catch(error){if(error instanceof Error&&['INVALID_CUT','SECTION_NO_INTERSECTION','DEGENERATE_MESH'].includes(error.message))return;throw error;}
 const newUv=new Map(uv),childFaces:Surface['faces']=[];
 for(const face of faces){const children=revised.children.get(face.id);if(!children){childFaces.push(face);continue;}const points=face.vertices.map(id=>uv.get(id)!);
  for(const child of children){childFaces.push(child.face);child.face.vertices.forEach((id,i)=>{const [u,v]=child.triangle[i],weights=[1-(u+v)/1000,u/1000,v/1000];newUv.set(id,{vertexId:id,xMm:weights.reduce((s,w,k)=>s+w*points[k].xMm,0),yMm:weights.reduce((s,w,k)=>s+w*points[k].yMm,0)});});}
 }
 const side=(f:Surface['faces'][number])=>f.vertices.reduce((s,id)=>{const p=newUv.get(id)!;return s+(p.xMm*normal[0]+p.yMm*normal[1]-position);},0)/3;
 const parts=[childFaces.filter(f=>side(f)<0),childFaces.filter(f=>side(f)>=0)].flatMap(designComponents);
 if(parts.length<2||parts.some(p=>!p.length))return;
 return {surface:revised.surface,children:revised.children as Map<string,Child[]>,parts};
}
