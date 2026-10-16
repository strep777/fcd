import type {Marking} from '../schema/index';
export type Placement=NonNullable<Marking['placement']>;
export type Point={xMm:number;yMm:number};
/** Rotation occurs before scale. Old anatomy-1 records continue to use their
 * original independent axis scales; new registrations preserve pigment shape. */
export function placedPoint(p:Point,placement:Placement,offsetXmm=0,offsetYmm=0):Point{
 const x=p.xMm-placement.sourceCenter.xMm,y=p.yMm-placement.sourceCenter.yMm,a=placement.rotationRad??0,c=Math.cos(a),s=Math.sin(a);
 return {xMm:(c*x-s*y)*placement.scaleX+placement.targetCenter.xMm+offsetXmm,yMm:(s*x+c*y)*placement.scaleY+placement.targetCenter.yMm+offsetYmm};
}
/** Area-weighted principal direction is insensitive to uneven contour sampling.
 * Adjacent pigment rings add to the same silhouette; holes subtract their area. */
export function principalDirection(rings:Point[][],outward:Point):number|undefined{
 let area=0,mx=0,my=0,xx=0,yy=0,xy=0;
 for(const ring of rings)for(let i=0;i<ring.length;i++){const a=ring[i],b=ring[(i+1)%ring.length],cross=a.xMm*b.yMm-b.xMm*a.yMm;area+=cross/2;mx+=(a.xMm+b.xMm)*cross/6;my+=(a.yMm+b.yMm)*cross/6;xx+=(a.xMm*a.xMm+a.xMm*b.xMm+b.xMm*b.xMm)*cross/12;yy+=(a.yMm*a.yMm+a.yMm*b.yMm+b.yMm*b.yMm)*cross/12;xy+=(2*a.xMm*a.yMm+a.xMm*b.yMm+b.xMm*a.yMm+2*b.xMm*b.yMm)*cross/24;}
 if(Math.abs(area)<1e-8)return;mx/=area;my/=area;xx=xx/area-mx*mx;yy=yy/area-my*my;xy=xy/area-mx*my;const trace=xx+yy,spread=Math.hypot(xx-yy,2*xy);
 if(trace<=1e-8||spread/trace<.2)return;let angle=.5*Math.atan2(2*xy,xx-yy);if(Math.cos(angle)*outward.xMm+Math.sin(angle)*outward.yMm<0)angle+=Math.PI;return Math.atan2(Math.sin(angle),Math.cos(angle));
}
