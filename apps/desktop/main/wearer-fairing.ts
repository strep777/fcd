/** Fair only Boolean join neighbourhoods. Part interiors (and the height
 * extrema) remain fixed, so a shoulder union cannot shrink the entire body.
 * Alternating diffusion removes join ridges without repeated Laplacian shrink. */
export function fairWearerJoins(mesh:{numVert:number;numTri:number;numProp:number;vertProperties:Float32Array;triVerts:Uint32Array;runIndex:Uint32Array;runOriginalID:Uint32Array}){
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
  if(d<85&&d<distance[b]){distance[b]=d;queue.push(b);}
 }}
 const maxY=Math.max(...Array.from({length:n},(_,i)=>original[i*3+1])),minY=Math.min(...Array.from({length:n},(_,i)=>original[i*3+1]));
 const weights=Array.from(distance,(d,i)=>original[i*3+1]<minY+2||original[i*3+1]>maxY-2?0:Math.max(0,1-d/85)**2);
 let current=original.slice();
 for(let pass=0;pass<24;pass++){
  const next=current.slice(),lambda=pass%2===0?.48:-.50;
  for(let i=0;i<n;i++)if(weights[i])for(let a=0;a<3;a++){
   let average=0;for(const j of neighbours[i])average+=current[j*3+a]/neighbours[i].size;
   next[i*3+a]+=lambda*weights[i]*(average-current[i*3+a]);
  }
  current=next;
 }
 for(let i=0;i<n;i++)for(let a=0;a<3;a++)mesh.vertProperties[i*stride+a]=current[i*3+a];
}
