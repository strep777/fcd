type XY={xMm:number;yMm:number};
/** Find an interior annotation anchor, including concave outlines and cut-out holes. */
export function interiorAnchor(outer:XY[],holes:XY[][]=[]){
 const rings=[outer,...holes],minY=Math.min(...outer.map(p=>p.yMm)),maxY=Math.max(...outer.map(p=>p.yMm));let best={xMm:outer[0]?.xMm??0,yMm:outer[0]?.yMm??0,clearanceMm:0};
 const distance=(p:XY,a:XY,b:XY)=>{const dx=b.xMm-a.xMm,dy=b.yMm-a.yMm,length=dx*dx+dy*dy,t=length?Math.max(0,Math.min(1,((p.xMm-a.xMm)*dx+(p.yMm-a.yMm)*dy)/length)):0;return Math.hypot(p.xMm-a.xMm-t*dx,p.yMm-a.yMm-t*dy);};
 for(let row=0;row<17;row++){const yMm=minY+(maxY-minY)*(row+.5)/17,intersections:number[]=[];for(const ring of rings)for(let i=0;i<ring.length;i++){const a=ring[i],b=ring[(i+1)%ring.length];if((a.yMm>yMm)!==(b.yMm>yMm))intersections.push(a.xMm+(yMm-a.yMm)*(b.xMm-a.xMm)/(b.yMm-a.yMm));}intersections.sort((a,b)=>a-b);
  for(let i=0;i+1<intersections.length;i+=2){const point={xMm:(intersections[i]+intersections[i+1])/2,yMm};let clearanceMm=Infinity;for(const ring of rings)for(let j=0;j<ring.length;j++)clearanceMm=Math.min(clearanceMm,distance(point,ring[j],ring[(j+1)%ring.length]));if(clearanceMm>best.clearanceMm)best={...point,clearanceMm};}
 }
 return best;
}
