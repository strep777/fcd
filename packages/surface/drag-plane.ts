import type {CutProjection} from '../schema/index';
import type {Point,World} from './attached-edit';

const dot=(a:number[],b:number[])=>a.reduce((sum,x,i)=>sum+x*b[i],0);

/**
 * Convert a captured screen displacement to the persistent contour frame.
 * The parallel drag plane passes through the displayed surface handle, not
 * the original decal plane. This preserves the grab offset under perspective.
 * At a silhouette only one direction is observable: retain the minimum-norm
 * displacement in that direction instead of dividing by a near-zero angle.
 * Screen coordinates are camera-plane millimetres, before viewport scale.
 */
export function surfaceDragDelta(frame:CutProjection,view:CutProjection,start:Point,end:Point,anchor:World,perspective=false,distance=1800):Point|undefined{
 const world=[anchor.xMm,anchor.yMm,anchor.zMm],relative=world.map((v,i)=>v-view.origin[i]);
 if(![...world,...relative,start.xMm,start.yMm,end.xMm,end.yMm,distance].every(Number.isFinite)||distance<=0)return;
 const depth=dot(relative,view.axes[2]),remaining=distance-depth;
 if(perspective&&remaining<=distance*1e-8)return;
 const ray=(p:Point)=>{
  const origin=perspective?view.origin.map((v,i)=>v+view.axes[2][i]*distance):view.origin.map((v,i)=>v+view.axes[0][i]*p.xMm+view.axes[1][i]*p.yMm);
  const direction=perspective?view.axes[0].map((v,i)=>v*p.xMm+view.axes[1][i]*p.yMm-view.axes[2][i]*distance):view.axes[2].map(v=>-v);
  const denominator=dot(direction,frame.axes[2]);
  if(Math.abs(denominator)/Math.hypot(...direction)<.08)return;
  const t=dot(world.map((v,i)=>v-origin[i]),frame.axes[2])/denominator;
  if(perspective&&t<=0)return;
  return origin.map((v,i)=>v+t*direction[i]);
 };
 const a=ray(start),b=ray(end);
 if(a&&b){const d=b.map((v,i)=>v-a[i]);return{xMm:dot(d,frame.axes[0]),yMm:dot(d,frame.axes[1])};}
 const x=dot(relative,view.axes[0]),y=dot(relative,view.axes[1]),scale=perspective?distance/remaining:1;
 const columns=frame.axes.slice(0,2).map(axis=>{
  const dz=perspective?dot(axis,view.axes[2])/remaining:0;
  return [scale*(dot(axis,view.axes[0])+x*dz),scale*(dot(axis,view.axes[1])+y*dz)];
 });
 const aa=dot(columns[0],columns[0]),ab=dot(columns[0],columns[1]),bb=dot(columns[1],columns[1]);
 const angle=.5*Math.atan2(2*ab,aa-bb),c=Math.cos(angle),s=Math.sin(angle);
 const eigenvectors=[[c,s],[-s,c]],largest=(aa+bb+Math.hypot(aa-bb,2*ab))/2;
 if(largest<=1e-16)return;
 const screen=[end.xMm-start.xMm,end.yMm-start.yMm],rhs=columns.map(column=>dot(column,screen)),delta=[0,0];
 for(const v of eigenvectors){
  const value=aa*v[0]*v[0]+2*ab*v[0]*v[1]+bb*v[1]*v[1];
  if(value<largest*.08**2)continue;
  const amount=dot(v,rhs)/value;
  delta[0]+=v[0]*amount;delta[1]+=v[1]*amount;
 }
 return delta.every(Number.isFinite)?{xMm:delta[0],yMm:delta[1]}:undefined;
}
