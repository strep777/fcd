import{expect,it}from'vitest';
import{clipSegments,intersects,nearestSegment,partitionSegments,ringSegments,sameDomainMetrics,samples,type Segment}from'../fixtures/source-tip-domain';
const bounds={left:-2,right:2,top:-.2,bottom:.2},cap={name:'fixed-source',bounds,tip:{x:0,y:-.2},ends:[{x:-2,y:-.2},{x:2,y:-.2}]};
const crossing:Segment={a:{x:-3,y:0},b:{x:3,y:0}};
it('a finite raw segment crossing a cap qualifies even with both nodes outside',()=>{
 expect(intersects([crossing],bounds)).toBe(true);
 expect(partitionSegments([crossing],[cap]).outside).toEqual([{a:{x:-3,y:0},b:{x:-2,y:0}},{a:{x:2,y:0},b:{x:3,y:0}}]);
});
it('retained raw intervals are separate segments and cannot bridge the deleted cap',()=>{
 const outside=partitionSegments([crossing],[cap]).outside;
 expect(nearestSegment({x:0,y:0},outside)).toBe(2);
 expect(outside).toHaveLength(2);
 expect(samples(outside).every(p=>p.x<=-2||p.x>=2)).toBe(true);
});
it('an exterior query cannot use its nearest point on deleted raw geometry',()=>{
 const p={x:0,y:.3},outside=partitionSegments([crossing],[cap]).outside;
 expect(nearestSegment(p,[crossing])).toBe(.3);
 expect(nearestSegment(p,outside)).toBeGreaterThan(1.05);
});
it('all finite cap-edge endpoints are represented exactly in both partitions',()=>{
 const parts=partitionSegments([crossing],[cap]),inside=parts.inside[cap.name];
 expect(inside).toEqual([{a:{x:-2,y:0},b:{x:2,y:0}}]);
 expect(samples(inside)[0]).toEqual(parts.outside[0].b);expect(samples(inside).at(-1)).toEqual(parts.outside[1].a);
});
it('boundary contact qualifies and finite clipping never extends a source ray',()=>{
 const touch={a:{x:2,y:1},b:{x:2,y:.2}},clipped=clipSegments([touch],bounds);
 expect(intersects([touch],bounds)).toBe(true);expect(clipped).toEqual([{a:{x:2,y:.2},b:{x:2,y:.2}}]);
 expect(nearestSegment({x:4,y:-.2},cap.ends.map(b=>({a:cap.tip,b})))).toBe(2);
});
it('overlapping fixed caps split the original segment without filling either hole',()=>{
 const second={name:'second',bounds:{left:1,right:2.5,top:-1,bottom:1}},parts=partitionSegments([crossing],[cap,second]);
 expect(parts.outside).toEqual([{a:{x:-3,y:0},b:{x:-2,y:0}},{a:{x:2.5,y:0},b:{x:3,y:0}}]);
 expect(samples(parts.outside).some(p=>p.x>-2&&p.x<2.5)).toBe(false);
});
it('reverse cap references cannot be served by output geometry in another domain',()=>{
 const raw=[crossing],output=[{a:{x:-2,y:-.3},b:{x:2,y:-.3}}],m=sameDomainMetrics(raw,output,[cap],{left:-4,right:4,top:-1,bottom:1});
 expect(m.capMetrics[0].sourceSamples).toBeGreaterThan(0);expect(m.capMetrics[0].outputSegments).toBe(0);expect(m.capMetrics[0].reverse).toBe(Infinity);
});
it('a neighbour qualifies through a hole boundary without joining separate rings',()=>{
 const outer=[{x:-5,y:-5},{x:5,y:-5},{x:5,y:5},{x:-5,y:5}],hole=[{x:-3,y:0},{x:3,y:0},{x:3,y:1},{x:-3,y:1}];
 expect(intersects(ringSegments([outer]),bounds)).toBe(false);
 const all=ringSegments([outer,hole]);expect(all).toHaveLength(8);expect(intersects(all,bounds)).toBe(true);
 expect(all[3].b).toEqual(outer[0]);expect(all[7].b).toEqual(hole[0]);
});
it('an ROI edge query can use a complete target in its same cap partition',()=>{
 const raw=[{a:{x:0,y:.5},b:{x:.1,y:.5}}],output=[{a:{x:-.1,y:.4},b:{x:-.1,y:.6}}],roi={left:0,right:1,top:0,bottom:1};
 // Clipping target segments to this reporting window would make the reverse
 // distance Infinity, although the nearest physical segment is only .2 away.
 expect(clipSegments(output,roi)).toHaveLength(0);
 const metric=sameDomainMetrics(raw,output,[],roi);expect(metric.outsideReverse).toBeCloseTo(.2,12);
 expect(metric.retainedOutputTargetSegments).toBe(1);expect(metric.retainedOutputSegments).toBe(0);
});
