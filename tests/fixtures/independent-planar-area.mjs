// Test-only polygon area. Work in a local coordinate frame so translating a
// micrometre trim across a metre-sized page cannot erase its determinant.
export function planarArea(points) {
  if(points.length<3)return 0;
  const origin=points[0];
  let sum=0,compensation=0;
  for(let i=0;i<points.length;i++){
    const a=points[i],b=points[(i+1)%points.length];
    const term=(a[0]-origin[0])*(b[1]-origin[1])-(b[0]-origin[0])*(a[1]-origin[1]);
    const next=sum+term;
    compensation+=Math.abs(sum)>=Math.abs(term)?sum-next+term:term-next+sum;
    sum=next;
  }
  return Math.abs(sum+compensation)/2;
}
