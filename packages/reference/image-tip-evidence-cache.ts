/** Cache a pure native-pixel measurement only while every byte it observed is
 * unchanged. Image identity alone is insufficient: callers may edit RGBA in
 * place. Weak keys do not retain closed images. Geometry order is significant;
 * this never changes the sampling phase or reverses a contour. Results must
 * be acyclic plain data, as produced by the corner measurement. The compute
 * callback must only read RGBA and report every pixel it reads. */
export function sourceEvidenceCache<T>(maxEntries=8,maxBytes=2*1024*1024){
 type Entry={key:string;indices:Uint32Array;bytes:Uint32Array;value:T;size:number};
 const images=new WeakMap<Uint8Array,Entry[]>();
 const pixel=(rgba:Uint8Array,i:number)=>(rgba[i*4]|rgba[i*4+1]<<8|rgba[i*4+2]<<16|rgba[i*4+3]<<24)>>>0;
 const footprint=(value:unknown):number=>{
  if(value===null||value===undefined)return 8;
  if(typeof value==='number'||typeof value==='boolean')return 16;
  if(typeof value==='string')return 24+value.length*2;
  if(Array.isArray(value))return 32+value.reduce((sum,v)=>sum+footprint(v),0);
  if(typeof value==='object')return 64+Object.entries(value).reduce((sum,[key,v])=>sum+32+key.length*2+footprint(v),0);
  return maxBytes+1;
 };
 return (rgba:Uint8Array,key:string,compute:(observe:(pixelIndex:number)=>void)=>T):T=>{
  const entries=images.get(rgba)??[],index=entries.findIndex(e=>e.key===key);
  if(index>=0){
   const entry=entries[index];entries.splice(index,1);
   if(entry.indices.every((p,i)=>p*4+3<rgba.length&&pixel(rgba,p)===entry.bytes[i])){
    entries.push(entry);return structuredClone(entry.value);
   }
  }
  const reads=new Set<number>();let oversized=false;
  const value=compute(index=>{
   if(oversized)return;
   if(!Number.isInteger(index)||index<0||index*4+3>=rgba.length){oversized=true;reads.clear();return;}
   reads.add(index);
   // Bound tracking itself even when a measurement scans an entire image.
   if(reads.size*32>maxBytes){oversized=true;reads.clear();}
  });
  if(!oversized){
   const size=footprint(value)+reads.size*8+key.length*2+128;
   if(size<=maxBytes){
    const indices=Uint32Array.from(reads),bytes=Uint32Array.from(indices,i=>pixel(rgba,i));
    while(entries.length&&(entries.length>=maxEntries||entries.reduce((s,e)=>s+e.size,0)+size>maxBytes))entries.shift();
    if(maxEntries>0)entries.push({key,indices,bytes,value:structuredClone(value),size});
   }
  }
  images.set(rgba,entries);return value;
 };
}
