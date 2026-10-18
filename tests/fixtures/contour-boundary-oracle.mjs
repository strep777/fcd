// Independent geometric measurement: explicit Bernstein evaluation and point /
// segment distances. It does not import the production fitter or sampler.
const distance=(a,b)=>Math.hypot(a.xMm-b.xMm,a.yMm-b.yMm);
function segmentDistance(p,a,b){const dx=b.xMm-a.xMm,dy=b.yMm-a.yMm,t=Math.max(0,Math.min(1,((p.xMm-a.xMm)*dx+(p.yMm-a.yMm)*dy)/(dx*dx+dy*dy)||0));return Math.hypot(p.xMm-a.xMm-t*dx,p.yMm-a.yMm-t*dy);}
function sample(shape,steps){
 if(shape.spline)throw Error('Oracle intentionally measures explicit polygon / cubic contours only');
 const result=[],curves=new Map(shape.curves?.map(c=>[c.startIndex,c]));let approximationBoundMm=0;
 for(let i=0;i<shape.nodes.length;i++){
  const a=shape.nodes[i],b=shape.nodes[(i+1)%shape.nodes.length],c=curves.get(i);
  if(c){
   const d2=p=>Math.hypot(6*(p[2].xMm-2*p[1].xMm+p[0].xMm),6*(p[2].yMm-2*p[1].yMm+p[0].yMm));
   approximationBoundMm=Math.max(approximationBoundMm,Math.max(d2([a,c.c1,c.c2]),d2([c.c1,c.c2,b]))/(8*steps*steps));
  }
  for(let j=0;j<steps;j++){const t=j/steps,u=1-t;result.push(c?{xMm:u**3*a.xMm+3*u*u*t*c.c1.xMm+3*u*t*t*c.c2.xMm+t**3*b.xMm,yMm:u**3*a.yMm+3*u*u*t*c.c1.yMm+3*u*t*t*c.c2.yMm+t**3*b.yMm}:{xMm:a.xMm+(b.xMm-a.xMm)*t,yMm:a.yMm+(b.yMm-a.yMm)*t});}
 }
 return {points:result,approximationBoundMm};
}
function directed(a,b){let maximumMm=0,worstPoint,maximumStepMm=0;
 for(let i=0;i<a.length;i++){const p=a[i];let d=Infinity;maximumStepMm=Math.max(maximumStepMm,distance(p,a[(i+1)%a.length]));for(let j=0;j<b.length;j++)d=Math.min(d,segmentDistance(p,b[j],b[(j+1)%b.length]));if(d>maximumMm){maximumMm=d;worstPoint=p;}}
 return {maximumMm,worstPoint,maximumStepMm};
}
export function contourBoundaryError(original,output,{polygonSteps=64,curveSteps=2048}={}){
 const a=sample(original,original.curves?.length?curveSteps:polygonSteps),b=sample(output,output.curves?.length?curveSteps:polygonSteps),forward=directed(a.points,b.points),reverse=directed(b.points,a.points);
 // Distance to a closed set is 1-Lipschitz. Half the largest station gap plus
 // the cubic chord error bounds every unsampled boundary position as well.
 const bound=(d,source,target)=>d.maximumMm+d.maximumStepMm/2+source.approximationBoundMm+target.approximationBoundMm;
 return {originalToOutput:forward,outputToOriginal:reverse,sampledMaximumMm:Math.max(forward.maximumMm,reverse.maximumMm),certifiedUpperBoundMm:Math.max(bound(forward,a,b),bound(reverse,b,a)),originalStations:a.points.length,outputStations:b.points.length,cubicChordErrorBoundMm:Math.max(a.approximationBoundMm,b.approximationBoundMm)};
}
