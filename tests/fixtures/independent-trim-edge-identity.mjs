const distance=(a,b)=>Math.hypot(...a.map((v,i)=>v-b[i]));

// Called inside one original face/edge support only. Cancel a shared internal
// UV edge by exact trim identity and opposite orientation before approximate
// supporting-line grouping can mix it with a nearby, distinct boundary.
export function cancelExactTrimInterior(edges,geometryMm) {
  const buckets=new Map(),remaining=[];let internalLengthMm=0;
  for(const edge of edges){
    if(!edge.trimA||!edge.trimB){remaining.push(edge);continue;}
    const key=edge.pieceId+':'+[edge.trimA,edge.trimB].sort().join(':');
    const bucket=buckets.get(key)??[];bucket.push(edge);buckets.set(key,bucket);
  }
  for(const bucket of buckets.values()){
    const [a,b]=bucket;
    if(bucket.length===2&&a.trimA===b.trimB&&a.trimB===b.trimA&&
      distance(a.uvA,b.uvB)===0&&distance(a.uvB,b.uvA)===0&&
      distance(a.a,b.b)<=geometryMm&&distance(a.b,b.a)<=geometryMm){
      internalLengthMm+=distance(a.a,a.b);
    }else remaining.push(...bucket);
  }
  return {remaining,internalLengthMm};
}
