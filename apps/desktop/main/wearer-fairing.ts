/** Fair only Boolean join neighbourhoods. Part interiors (and the height
 * extrema) remain fixed, so a shoulder union cannot shrink the entire body.
 * Alternating diffusion removes join ridges without repeated Laplacian shrink. */
export function fairWearerJoins(mesh:{numVert:number;numTri:number;numProp:number;vertProperties:Float32Array;triVerts:Uint32Array;runIndex:Uint32Array;runOriginalID:Uint32Array},radius=85){
 const {numVert:n,numProp:stride,triVerts:tri}=mesh,original=new Float64Array(n*3),neighbours=Array.from({length:n},()=>new Set<number>()),owners=Array.from({length:n},()=>new Set<number>());
 let run=0;
 for(let i=0;i<n;i++)for(let a=0;a<3;a++)original[i*3+a]=mesh.vertProperties[i*stride+a];
 for(let f=0;f<mesh.numTri;f++){
  while(run+1<mesh.runOriginalID.length&&f*3>=mesh.runIndex[run+1])run++;
  for(let j=0;j<3;j++){const a=tri[f*3+j],b=tri[f*3+(j+1)%3];neighbours[a].add(b);neighbours[b].add(a);owners[a].add(mesh.runOriginalID[run]);}
 }
 const distance=new Float64Array(n).fill(Infinity),queue:number[]=[];
 for(let i=0;i<n;i++)if(owners[i].size>1){distance[i]=0;queue.push(i);}
 // Bounded relaxation is sufficient here; each improved distance is revisited.
 for(let head=0;head<queue.length;head++){const a=queue[head];for(const b of neighbours[a]){
  const d=distance[a]+Math.hypot(original[a*3]-original[b*3],original[a*3+1]-original[b*3+1],original[a*3+2]-original[b*3+2]);
  if(d<radius&&d<distance[b]){distance[b]=d;queue.push(b);}
 }}
 const maxY=Math.max(...Array.from({length:n},(_,i)=>original[i*3+1])),minY=Math.min(...Array.from({length:n},(_,i)=>original[i*3+1]));
 const weights=Array.from(distance,(d,i)=>original[i*3+1]<minY+2||original[i*3+1]>maxY-2?0:Math.max(0,1-d/radius)**2);
 let current=original.slice();
 const incident=Array.from({length:n},()=>[] as number[]);
 for(let f=0;f<mesh.numTri;f++)for(let j=0;j<3;j++)incident[tri[f*3+j]].push(f);
 const normal=(f:number,points:Float64Array)=>{
  const [a,b,c]=[0,1,2].map(j=>tri[f*3+j]*3),u=[0,1,2].map(j=>points[b+j]-points[a+j]),v=[0,1,2].map(j=>points[c+j]-points[a+j]);
  return [u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0]];
 };
 const rest=Array.from({length:mesh.numTri},(_,f)=>normal(f,original)),restLength=rest.map(v=>Math.hypot(...v));
 const faceNeighbours=Array.from({length:mesh.numTri},()=>new Set<number>()),edgeFaces=new Map<string,number>();
 for(let f=0;f<mesh.numTri;f++)for(let j=0;j<3;j++){const a=tri[f*3+j],b=tri[f*3+(j+1)%3],key=Math.min(a,b)+':'+Math.max(a,b),other=edgeFaces.get(key);if(other!==undefined){faceNeighbours[f].add(other);faceNeighbours[other].add(f);}else edgeFaces.set(key,f);}
 const cosine=(a:number[],b:number[])=>a.reduce((s,v,j)=>s+v*b[j],0)/(Math.hypot(...a)*Math.hypot(...b));
 const normals=rest.map(v=>[...v]);
 for(let pass=0;pass<24;pass++){
  const lambda=pass%2===0?.48:-.50;
  for(let i=0;i<n;i++)if(weights[i]){
   const before=[0,1,2].map(a=>current[i*3+a]),delta=before.map((value,a)=>{
    let average=0;for(const j of neighbours[i])average+=current[j*3+a]/neighbours[i].size;
    return lambda*weights[i]*(average-value);
   });
   // Boolean joins contain very unequal triangles. Unrestricted diffusion
   // can fold a small face almost back onto its neighbour while the solid
   // remains topologically manifold. Backtrack each local displacement and
   // certify its complete incident fan before accepting a shape change.
   let accepted=false;
   for(let step=1;step>=1/256;step/=2){
    for(let a=0;a<3;a++)current[i*3+a]=before[a]+step*delta[a];
    const changed=new Map(incident[i].map(f=>[f,normal(f,current)]));
    const safe=[...changed].every(([f,v])=>Math.hypot(...v)>=restLength[f]*.02&&cosine(v,rest[f])>.05&&[...faceNeighbours[f]].every(g=>cosine(v,changed.get(g)??normals[g])>=Math.min(0,cosine(rest[f],rest[g]))-1e-8));
    if(safe){for(const [f,v]of changed)normals[f]=v;accepted=true;break;}
   }
   if(!accepted)for(let a=0;a<3;a++)current[i*3+a]=before[a];
  }
 }
 for(let i=0;i<n;i++)for(let a=0;a<3;a++)mesh.vertProperties[i*stride+a]=current[i*3+a];
}
