import type {Surface} from '../schema/index';
import {shapePoint,type Shape} from './attached-edit';
import {sampleShapeContour} from './shape-contour';

/** A decal belongs to the connected front-facing sheet under its drop point.
 * The footprint bounds stop a second limb being reached via a distant shoulder,
 * even when an imported mesh gives every triangle the same material/region. */
export function projectionFaces(surface:Surface,shape:Shape,restrictFootprint=true):Set<string>|undefined {
 if(!shape.anchorFaceId)return shape.regions?new Set(surface.faces.filter(f=>shape.regions!.includes(f.region)).map(f=>f.id)):undefined;
 const points=sampleShapeContour(shape),xs=points.map(p=>p.xMm),ys=points.map(p=>p.yMm);
 const minX=Math.min(...xs),maxX=Math.max(...xs),minY=Math.min(...ys),maxY=Math.max(...ys),pad=Math.max(1e-5,Math.hypot(maxX-minX,maxY-minY)*.01);
 const vertices=new Map(surface.vertices.map(v=>[v.id,shapePoint(shape,v)]));
 const eligible=new Set<string>();
 const faces=surface.faces.filter(f=>{
  if(shape.regions&&!shape.regions.includes(f.region))return false;
  const [a,b,c]=f.vertices.map(id=>vertices.get(id)!);
  if((b.xMm-a.xMm)*(c.yMm-a.yMm)-(b.yMm-a.yMm)*(c.xMm-a.xMm)<=1e-9)return false;
  if(!restrictFootprint||Math.max(a.xMm,b.xMm,c.xMm)>=minX-pad&&Math.min(a.xMm,b.xMm,c.xMm)<=maxX+pad&&Math.max(a.yMm,b.yMm,c.yMm)>=minY-pad&&Math.min(a.yMm,b.yMm,c.yMm)<=maxY+pad)eligible.add(f.id);
  return true;
 });
 const edges=new Map<string,string[]>(),byId=new Map(faces.map(f=>[f.id,f]));
 const keys=(v:string[])=>v.map((a,i)=>[a,v[(i+1)%3]].sort().join(':'));
 for(const f of faces)for(const k of keys(f.vertices)){const rows=edges.get(k)??[];rows.push(f.id);edges.set(k,rows);}
 if(!byId.has(shape.anchorFaceId))return new Set<string>();
 // Resizing about the source centre can move the footprint away from its
 // original picked face. Find the first eligible face on that same sheet;
 // a disconnected overlapping object can never become the replacement anchor.
 let anchor=shape.anchorFaceId;
 if(!eligible.has(anchor)){const visited=new Set([anchor]),search=[anchor];let found=false;for(let i=0;i<search.length&&!found;i++)for(const k of keys(byId.get(search[i])!.vertices)){for(const id of edges.get(k)??[]){if(visited.has(id))continue;visited.add(id);search.push(id);if(eligible.has(id)){anchor=id;found=true;break;}}if(found)break;}if(!found)return new Set<string>();}
 const scope=new Set([anchor]),queue=[anchor];
 for(let i=0;i<queue.length;i++)for(const k of keys(byId.get(queue[i])!.vertices))for(const id of edges.get(k)??[])if(eligible.has(id)&&!scope.has(id)){scope.add(id);queue.push(id);}
 return scope;
}
