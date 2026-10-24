import type {Binding,Surface} from '../../../packages/schema/index';

/** A trial dart whose two sides flatten to the same stations has no opening.
 * Weld its duplicate UV vertices only when they refer to the same original
 * surface station. This removes a redundant trial seam, not a material slit.
 * Nonzero darts and unrelated touching sheets retain separate identities. */
export function weldClosedTrimDarts(trim:NonNullable<Binding['trim']>,source:Surface){
 const faces=new Map(source.faces.map(f=>[f.id,f])),uv=new Map(trim.vertices.map(v=>[v.id,v]));
 const canonical=new Map<string,string>(),replace=new Map<string,string>();
 const canonicalId=(id:string)=>{while(replace.has(id))id=replace.get(id)!;return id;};
 const station=(face:Surface['faces'][number],w:number[])=>{
  const active=w.map((weight,i)=>({weight,id:face.vertices[i]})).filter(p=>p.weight>1e-10).sort((a,b)=>a.id.localeCompare(b.id));
  return active.map(p=>p.id+':'+Math.round(p.weight*1e10)).join('|');
 };
 for(const t of trim.triangles){const face=faces.get(t.faceId);if(!face)continue;
  t.vertices.forEach((id,i)=>{if(replace.has(id))return;const v=uv.get(id)!;
   const key=station(face,t.barycentric[i])+':'+Math.round(v.xMm*1e7)+':'+Math.round(v.yMm*1e7),stored=canonical.get(key),existing=stored===undefined?undefined:canonicalId(stored);
   if(existing){const p=uv.get(existing)!;if(existing!==id&&Math.hypot(p.xMm-v.xMm,p.yMm-v.yMm)<=1e-7)replace.set(id,existing);}else canonical.set(key,id);
  });
 }
 if(!replace.size)return;
 for(const t of trim.triangles)t.vertices=t.vertices.map(canonicalId) as [string,string,string];
 trim.boundary=trim.boundary.map(canonicalId);trim.holes=trim.holes?.map(r=>r.map(canonicalId));
 trim.vertices=trim.vertices.filter(v=>!replace.has(v.id));
}
