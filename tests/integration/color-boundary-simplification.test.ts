import {expect,it} from 'vitest';
import {simplifyColorBoundary,colorBoundary} from '../../apps/desktop/main/color-cuts';
import {safeColorOutline} from '../../apps/desktop/main/color-outline';
type XY=[number,number];
const area=(ring:XY[])=>ring.reduce((s,p,i)=>{const q=ring[(i+1)%ring.length];return s+p[0]*q[1]-q[0]*p[1];},0)/2;
const rectangle=(width:number,height:number):XY[]=>[[0,0],[width/2,0],[width,0],[width,height/2],[width,height],[width/2,height],[0,height],[0,height/2]];
const distance=(p:XY,a:XY,b:XY)=>{const dx=b[0]-a[0],dy=b[1]-a[1],length=dx*dx+dy*dy,t=length?Math.max(0,Math.min(1,((p[0]-a[0])*dx+(p[1]-a[1])*dy)/length)):0;return Math.hypot(p[0]-a[0]-t*dx,p[1]-a[1]-t*dy);};
it('removes a long retraced spur within the actual nine-digit clipping grid budget',()=>{
 const ring:XY[]=[[206.1552812810664,48.507125007],[126.26119276806641,68.480647136],[167.3495812750664,58.208550008],[160.07351252406642,29.104275003999998],[82.4621125130664,48.507125007],[43.65641250706642,58.208550008],[50.93248125806642,87.31282501300001],[12.126781252066394,97.014250015],[6.642153493885417e-11,48.507125007],[194.0285000290664,0]],result=colorBoundary(ring);
 expect(result).not.toContainEqual(ring[1]);expect(Math.abs(area(result)-area(ring))).toBeLessThan(1e-6);
});
it('retains real fine islands, holes and short corners regardless of edge length',()=>{
 for(const ring of [rectangle(30,.00005),rectangle(30,.00015).reverse(),[[0,0],[.0002,0],[.0002,.00005],[0,.00005]] as XY[]]){const result=colorBoundary(ring);expect(area(result)).toBeCloseTo(area(ring),12);expect(result.length).toBeGreaterThanOrEqual(4);}
});
it('retains positive-area thin islands smaller than the manufacturing contour tolerance',()=>{
 const ring=rectangle(30,.00005),result=simplifyColorBoundary(ring);
 expect(result.length).toBeGreaterThanOrEqual(3);expect(area(result)).toBeCloseTo(area(ring),12);expect(Math.max(...result.map(p=>p[1]))-Math.min(...result.map(p=>p[1]))).toBeCloseTo(.00005,12);
});
it('retains narrow hole orientation and area while removing redundant edge samples',()=>{
 const ring=rectangle(40,.00015).reverse(),result=simplifyColorBoundary(ring);
 expect(result.length).toBeGreaterThanOrEqual(3);expect(area(result)).toBeLessThan(0);expect(area(result)).toBeCloseTo(area(ring),12);
});
it('bounds every source sample globally and retains a real notch above the tolerance',()=>{
 const ring:XY[]=[...Array.from({length:1500},(_,i)=>[i/150,Math.sin(i/10)*.00002] as XY),[10,0],[10,1],[5.0002,1],[5,1-.0004],[4.9998,1],[0,1]],result=simplifyColorBoundary(ring,.0001);
 expect(result.length).toBeLessThan(30);expect(result).toContainEqual([5,1-.0004]);for(const point of ring)expect(Math.min(...result.map((a,i)=>distance(point,a,result[(i+1)%result.length])))).toBeLessThanOrEqual(.0001+1e-10);expect(Math.sign(area(result))).toBe(Math.sign(area(ring)));
});
it('rejects a bounded simplification that crosses a nearby narrow hole',()=>{
 const outer:XY[]=[[0,0],[10,0],[10,10],[5,10.0008],[0,10]],hole:XY[]=[[4.9999,10.0001],[4.9999,10.0004],[5.0001,10.0004],[5.0001,10.0001]],original={outer,holes:[hole]},candidate={outer:simplifyColorBoundary(outer),holes:[hole]};
 expect(candidate.outer).not.toContainEqual([5,10.0008]);expect(safeColorOutline(original,candidate)).toBe(original);
});
it('accepts topology-preserving simplification and retains a separate fine island',()=>{
 const outer=rectangle(10,10),hole=rectangle(2,.00015).reverse().map(([x,y])=>[x+4,y+4] as XY),original={outer,holes:[hole]},candidate={outer:simplifyColorBoundary(outer),holes:[simplifyColorBoundary(hole)]};
 expect(safeColorOutline(original,candidate)).toBe(candidate);const island={outer:rectangle(30,.00005),holes:[]};expect(safeColorOutline(island,{outer:simplifyColorBoundary(island.outer),holes:[]})).not.toBe(island);
});
