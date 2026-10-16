import {safeColorOutline} from './color-outline';
type XY=[number,number];
const area=(r:XY[])=>r.reduce((sum,p,i)=>{const q=r[(i+1)%r.length],o=r[0];return sum+(p[0]-o[0])*(q[1]-o[1])-(q[0]-o[0])*(p[1]-o[1]);},0)/2;
/** Manufacturing-only numerical normalization. Exact mapped triangles remain
 * unchanged. Snapped samples move <=1e-6 mm; a zero-area retrace may disappear
 * over a longer distance. Hole count, orientation and simple topology remain. */
export function designManufacturingOutline(original:{outer:XY[];holes:XY[][]}){
 const epsilon=1e-6,perimeter=(r:XY[])=>r.reduce((sum,p,i)=>sum+Math.hypot(p[0]-r[(i+1)%r.length][0],p[1]-r[(i+1)%r.length][1]),0);
 const snap=(ring:XY[])=>{const groups=ring.map((_,i)=>[i]);for(let i=0;i<groups.length;i++){if(!groups[i].length)continue;for(let j=i+1;j<groups.length;j++){if(!groups[j].length)continue;const a=ring[groups[i][0]],b=ring[groups[j][0]];if(Math.hypot(a[0]-b[0],a[1]-b[1])>epsilon*2)continue;const ids=[...groups[i],...groups[j]],p=ids.reduce((sum,k)=>[sum[0]+ring[k][0]/ids.length,sum[1]+ring[k][1]/ids.length] as XY,[0,0] as XY);if(ids.some(k=>Math.hypot(p[0]-ring[k][0],p[1]-ring[k][1])>epsilon))continue;groups[i]=ids;groups[j]=[];}}
 const result=ring.map(p=>[...p] as XY);for(const ids of groups.filter(g=>g.length>1)){const p=ids.reduce((sum,k)=>[sum[0]+ring[k][0]/ids.length,sum[1]+ring[k][1]/ids.length] as XY,[0,0] as XY);ids.forEach(k=>result[k]=p);}let changed=true;while(changed&&result.length>3){changed=false;for(let i=0;i<result.length;i++){const a=result[(i+result.length-1)%result.length],b=result[i],c=result[(i+1)%result.length];if(Math.abs((b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]))<=2e-9*Math.max(Math.hypot(b[0]-a[0],b[1]-a[1]),Math.hypot(c[0]-a[0],c[1]-a[1]),Math.hypot(c[0]-b[0],c[1]-b[1]))){result.splice(i,1);changed=true;break;}}}return result.length>=3&&Math.sign(area(result))===Math.sign(area(ring))&&Math.abs(area(result)-area(ring))<=perimeter(ring)*epsilon?result:ring;};
 return safeColorOutline(original,{outer:snap(original.outer),holes:original.holes.map(snap)});
}
