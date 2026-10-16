/** Native-resolution four-connected regions. Typed queues bound memory, without a proxy resize. */
export function rasterComponents(width:number,height:number,data:Uint8Array):number[][]{
 if(!Number.isInteger(width)||!Number.isInteger(height)||width<1||height<1||width*height>4096*4096||data.length!==width*height)throw Error('IMAGE_LIMIT');
 const seen=new Uint8Array(data.length),queue=new Uint32Array(data.length),groups:number[][]=[];
 for(let start=0;start<data.length;start++){
  if(!data[start]||seen[start])continue;let head=0,tail=1;queue[0]=start;seen[start]=1;
  while(head<tail){const i=queue[head++],x=i%width;for(const n of [x?i-1:-1,x+1<width?i+1:-1,i>=width?i-width:-1,i+width<data.length?i+width:-1])if(n>=0&&data[n]&&!seen[n]){seen[n]=1;queue[tail++]=n;}}
  groups.push(Array.from(queue.subarray(0,tail)));
 }
 return groups;
}
