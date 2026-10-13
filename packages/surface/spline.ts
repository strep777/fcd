export type Knot={xMm:number;yMm:number};
const mid=(a:Knot,b:Knot):Knot=>({xMm:(a.xMm+b.xMm)/2,yMm:(a.yMm+b.yMm)/2});
function distance(p:Knot,a:Knot,b:Knot){const dx=b.xMm-a.xMm,dy=b.yMm-a.yMm,len=dx*dx+dy*dy,t=len?Math.max(0,Math.min(1,((p.xMm-a.xMm)*dx+(p.yMm-a.yMm)*dy)/len)):0;return Math.hypot(p.xMm-a.xMm-t*dx,p.yMm-a.yMm-t*dy);}
/** Closed interpolating cubic. Convex-hull distance bounds each flattened segment in millimetres. */
export function surfaceSpline(knots:Knot[],tension=.5,toleranceMm=.05):Knot[]{
 if(knots.length<3||knots.length>400||!Number.isFinite(tension)||tension<0||tension>1||!Number.isFinite(toleranceMm)||toleranceMm<.01||toleranceMm>.5||knots.some(p=>!Number.isFinite(p.xMm)||!Number.isFinite(p.yMm)))throw Error('INVALID_SPLINE');
 const out:Knot[]=[knots[0]],gain=(1-tension)/6;
 const flatten=(a:Knot,b:Knot,c:Knot,d:Knot,depth=0)=>{if(out.length>=2000||depth>24)throw Error('SPLINE_LIMIT');if(Math.max(distance(b,a,d),distance(c,a,d))<=toleranceMm){out.push(d);return;}const ab=mid(a,b),bc=mid(b,c),cd=mid(c,d),abc=mid(ab,bc),bcd=mid(bc,cd),center=mid(abc,bcd);flatten(a,ab,abc,center,depth+1);flatten(center,bcd,cd,d,depth+1);};
 for(let i=0;i<knots.length;i++){const a=knots[i],d=knots[(i+1)%knots.length],prev=knots[(i-1+knots.length)%knots.length],next=knots[(i+2)%knots.length];if(Math.hypot(d.xMm-a.xMm,d.yMm-a.yMm)<1e-8)throw Error('INVALID_SPLINE');flatten(a,{xMm:a.xMm+(d.xMm-prev.xMm)*gain,yMm:a.yMm+(d.yMm-prev.yMm)*gain},{xMm:d.xMm-(next.xMm-a.xMm)*gain,yMm:d.yMm-(next.yMm-a.yMm)*gain},d);}
 out.pop();return out;
}
