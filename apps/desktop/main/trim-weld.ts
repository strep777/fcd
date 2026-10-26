import type {Binding,Surface} from '../../../packages/schema/index';

/** A trial dart whose two sides flatten to the same stations has no opening.
 * Weld its duplicate UV vertices only when they refer to the same original
 * surface station. This removes a redundant trial seam, not a material slit.
 * Nonzero darts and unrelated touching sheets retain separate identities. */
export function weldClosedTrimDarts(trim:NonNullable<Binding['trim']>,source:Surface){
 const faces=new Map(source.faces.map(f=>[f.id,f])),uv=new Map(trim.vertices.map(v=>[v.id,v]));
 const canonical=new Map<string,string>(),replace=new Map<string,string>();
 const canonicalId=(id:string)=>{while(replace.has(id))id=replace.get(id)!;return id;};
 const edgeKey=(a:string,b:string)=>[a,b].sort().join(':'),locked=new Set((source.cutConstraints??[]).filter(e=>e.locked).map(e=>edgeKey(e.a,e.b)));
 const edges=new Map<string,{a:string;b:string;count:number;locked:boolean}>();
 if(locked.size)for(const t of trim.triangles){const face=faces.get(t.faceId);if(!face)continue;
  for(let i=0;i<3;i++){const j=(i+1)%3,a=t.vertices[i],b=t.vertices[j],key=edgeKey(a,b),row=edges.get(key)??{a,b,count:0,locked:false};row.count++;
   // An exact source-edge station has zero weight at its opposite corner.
   // Tolerate floating-point composition only, not nearby material slivers.
   for(let k=0;k<3;k++)if(Math.abs(t.barycentric[i][k])<=64*Number.EPSILON&&Math.abs(t.barycentric[j][k])<=64*Number.EPSILON&&locked.has(edgeKey(face.vertices[(k+1)%3],face.vertices[(k+2)%3])))row.locked=true;
   edges.set(key,row);
  }
 }
 const protectedSides=[...edges.values()].filter(e=>e.count===1&&e.locked);
 // A locked slit includes its two independent vertex fans, even when both
 // paper sides currently have the same coordinates. Welding only one end
 // can keep the edge keys different while turning a simple boundary into a
 // degree-four junction. Every station on either protected side stays put;
 // a trial seam incident to that station is not an unrelated trial seam.
 const protectedStations=new Set(protectedSides.flatMap(e=>[e.a,e.b]));
 const keepsLockedSides=(from:string,to:string)=>{
  if(!protectedSides.length)return true;
  if(protectedStations.has(from)||protectedStations.has(to))return false;
  const proposed=(id:string)=>{const current=canonicalId(id);return current===from?to:current;},counts=new Set<string>();
  for(const e of protectedSides){const a=proposed(e.a),b=proposed(e.b),key=edgeKey(a,b);if(a===b||counts.has(key))return false;counts.add(key);}
  return true;
 };
 const station=(face:Surface['faces'][number],w:number[])=>{
  const active=w.map((weight,i)=>({weight,id:face.vertices[i]})).filter(p=>p.weight>1e-10).sort((a,b)=>a.id.localeCompare(b.id));
  return active.map(p=>p.id+':'+Math.round(p.weight*1e10)).join('|');
 };
 for(const t of trim.triangles){const face=faces.get(t.faceId);if(!face)continue;
  t.vertices.forEach((id,i)=>{if(replace.has(id))return;const v=uv.get(id)!;
   const key=station(face,t.barycentric[i])+':'+Math.round(v.xMm*1e7)+':'+Math.round(v.yMm*1e7),stored=canonical.get(key),existing=stored===undefined?undefined:canonicalId(stored);
   if(existing){const p=uv.get(existing)!;if(existing!==id&&Math.hypot(p.xMm-v.xMm,p.yMm-v.yMm)<=1e-7&&keepsLockedSides(id,existing))replace.set(id,existing);}else canonical.set(key,id);
  });
 }
 if(!replace.size)return;
 for(const t of trim.triangles)t.vertices=t.vertices.map(canonicalId) as [string,string,string];
 trim.boundary=trim.boundary.map(canonicalId);trim.holes=trim.holes?.map(r=>r.map(canonicalId));
 trim.vertices=trim.vertices.filter(v=>!replace.has(v.id));
}
