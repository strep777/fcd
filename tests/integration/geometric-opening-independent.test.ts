import {expect,it} from 'vitest';
import {randomUUID} from 'node:crypto';
import {geometricOpeningCuts} from '../../packages/surface/geometric-opening';
import {coincidentCrackOpeningFixture,coneOpeningFixture,coplanarFoldedOpeningFixture,guideWorldTrace,openingWorldTrace,planarOpeningFixture,requireAnalyticOpening,traceLength,type Point3} from '../fixtures/geometric-opening-independent';

// No native worker or production distance/sectioning helper is used here.
// These tests describe the FaceCut contract, not how a section plane is chosen.

it.each([
 {subdivisions:1,flipDiagonals:false,permuted:false,tilted:false},
 {subdivisions:1,flipDiagonals:true,permuted:true,tilted:false},
 {subdivisions:2,flipDiagonals:false,permuted:true,tilted:false},
 {subdivisions:4,flipDiagonals:true,permuted:true,tilted:false},
 {subdivisions:2,flipDiagonals:true,permuted:true,tilted:true},
])('cuts the same analytic oblique line through triangulated interiors (%j)',options=>{
 const fixture=planarOpeningFixture(options),before=structuredClone(fixture.surface),guideBefore=structuredClone(fixture.guideEdges);
 // First prove this input cannot pass by returning the mesh guide unchanged.
 expect(()=>requireAnalyticOpening(guideWorldTrace(fixture.surface,fixture.guideEdges),fixture.start,fixture.end)).toThrow();
 const cuts=geometricOpeningCuts(fixture.surface,fixture.guideEdges);
 const measured=requireAnalyticOpening(openingWorldTrace(fixture.surface,cuts),fixture.start,fixture.end);
 expect(measured.lengthMm).toBeCloseTo(Math.hypot(120,80),4);
 // A proper cut reaches source-face interiors, rather than merely selecting
 // another collection of existing mesh edges with the correct endpoints.
 expect(cuts.some(cut=>cut.a.filter(weight=>Math.abs(weight)<1e-8).length<2||cut.b.filter(weight=>Math.abs(weight)<1e-8).length<2)).toBe(true);
 expect(fixture.surface).toEqual(before);expect(fixture.guideEdges).toEqual(guideBefore);
});

it('preserves the physical result when guide edges are reversed and stored out of traversal order',()=>{
 const fixture=planarOpeningFixture({subdivisions:2,flipDiagonals:true}),before=structuredClone(fixture.surface);
 const reversed=fixture.guideEdges.map(edge=>({a:edge.b,b:edge.a})).reverse();
 const shuffled=[...fixture.guideEdges.filter((_,i)=>i%2===1),...fixture.guideEdges.filter((_,i)=>i%2===0)];
 for(const guide of [fixture.guideEdges,reversed,shuffled])requireAnalyticOpening(openingWorldTrace(fixture.surface,geometricOpeningCuts(fixture.surface,guide)),fixture.start,fixture.end);
 expect(fixture.surface).toEqual(before);
});

it.each([[12,4,0],[16,6,3],[24,5,17]])('opens only the requested cone side with a radial geometric slit (sectors=%i, levels=%i, sector=%i)',(sectors,levels,sector)=>{
 const fixture=coneOpeningFixture(sectors,levels,sector),before=structuredClone(fixture.surface),guideBefore=structuredClone(fixture.guideEdges);
 expect(()=>requireAnalyticOpening(guideWorldTrace(fixture.surface,fixture.guideEdges),fixture.start,fixture.end)).toThrow();
 const cuts=geometricOpeningCuts(fixture.surface,fixture.guideEdges);
 const measured=requireAnalyticOpening(openingWorldTrace(fixture.surface,cuts),fixture.start,fixture.end);
 expect(measured.lengthMm).toBeCloseTo(fixture.motherLineMm,4);
 expect(fixture.surface).toEqual(before);expect(fixture.guideEdges).toEqual(guideBefore);
});

it('refuses a straight section interrupted by a real hole instead of retaining a jagged detour or a partial slit',()=>{
 const fixture=planarOpeningFixture({hole:true}),before=structuredClone(fixture.surface),guideBefore=structuredClone(fixture.guideEdges);
 // Every guide edge still belongs to real material on the hole boundary.
 for(const edge of fixture.guideEdges)expect(fixture.surface.faces.some(face=>face.vertices.includes(edge.a)&&face.vertices.includes(edge.b))).toBe(true);
 expect(geometricOpeningCuts(fixture.surface,fixture.guideEdges)).toEqual([]);
 expect(fixture.surface).toEqual(before);expect(fixture.guideEdges).toEqual(guideBefore);
});

it('does not bridge coincident crack banks with disconnected source vertex identities',()=>{
 const fixture=coincidentCrackOpeningFixture(),before=structuredClone(fixture.surface),guideBefore=structuredClone(fixture.guideEdges),vertices=new Map(fixture.surface.vertices.map(vertex=>[vertex.id,vertex]));
 for(const [original,copy]of fixture.copies){
  expect(original).not.toBe(copy);
  const a=vertices.get(original)!,b=vertices.get(copy)!;
  expect([a.xMm,a.yMm,a.zMm]).toEqual([b.xMm,b.yMm,b.zMm]);
  expect(fixture.surface.faces.some(face=>face.vertices.includes(original)&&face.vertices.includes(copy))).toBe(false);
 }
 // This is a legal connected guide around the crack tip, not a malformed
 // missing-edge input. Its intended direct line crosses x=40 at y=80/3,
 // inside the crack's 0..60 mm span.
 for(const edge of fixture.guideEdges)expect(fixture.surface.faces.some(face=>face.vertices.includes(edge.a)&&face.vertices.includes(edge.b))).toBe(true);
 expect(40*80/120).toBeGreaterThan(0);expect(40*80/120).toBeLessThan(60);
 expect(geometricOpeningCuts(fixture.surface,fixture.guideEdges)).toEqual([]);
 expect(fixture.surface).toEqual(before);expect(fixture.guideEdges).toEqual(guideBefore);
});

it.each([false,true])('refuses a fully coplanar folded facet instead of tracing its internal triangulation (alternateFan=%s)',alternateFan=>{
 const fixture=coplanarFoldedOpeningFixture(alternateFan),before=structuredClone(fixture.surface),guideBefore=structuredClone(fixture.guideEdges),vertices=new Map(fixture.surface.vertices.map(vertex=>[vertex.id,vertex])),edges=new Map<string,number>();
 let normalSum=[0,0,0];const guideIds=new Set(fixture.guideEdges.flatMap(edge=>[edge.a,edge.b]));
 for(const face of fixture.surface.faces){
  const [a,b,c]=face.vertices.map(id=>vertices.get(id)!),u=[b.xMm-a.xMm,b.yMm-a.yMm,b.zMm-a.zMm],v=[c.xMm-a.xMm,c.yMm-a.yMm,c.zMm-a.zMm],normal=[u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0]];
  expect(Math.hypot(...normal)).toBeGreaterThan(0);
  if(face.vertices.some(id=>guideIds.has(id)))normalSum=normalSum.map((n,i)=>n+normal[i]);
  for(let i=0;i<3;i++){const key=[face.vertices[i],face.vertices[(i+1)%3]].sort().join(':');edges.set(key,(edges.get(key)??0)+1);}
 }
 expect([...edges.values()].every(owners=>owners===2)).toBe(true);
 expect(Math.hypot(...normalSum)).toBeLessThan(1e-9);
 // The outline guide has an area vector perpendicular to the whole facet;
 // interpreting that plane as triangle edges would recreate a mesh walk.
 expect(fixture.surface.vertices.every(vertex=>vertex.zMm===0)).toBe(true);
 expect(()=>requireAnalyticOpening(guideWorldTrace(fixture.surface,fixture.guideEdges),fixture.start,fixture.end)).toThrow();
 expect(geometricOpeningCuts(fixture.surface,fixture.guideEdges)).toEqual([]);
 expect(fixture.surface).toEqual(before);expect(fixture.guideEdges).toEqual(guideBefore);
});

function twoOpeningDomains(holeSecond=false){
 const first=planarOpeningFixture(),second=planarOpeningFixture({flipDiagonals:true,permuted:true,hole:holeSecond});
 for(const vertex of second.surface.vertices)vertex.xMm+=200;
 second.start[0]+=200;second.end[0]+=200;
 const surface={...first.surface,id:randomUUID(),vertices:[...first.surface.vertices,...second.surface.vertices],faces:[...first.surface.faces,...second.surface.faces]};
 return {first,second,surface};
}

it('keeps every legal independent opening complete across disconnected material domains',()=>{
 const {first,second,surface}=twoOpeningDomains(),before=structuredClone(surface),guide=[...first.guideEdges,...second.guideEdges],guideBefore=structuredClone(guide);
 const cuts=geometricOpeningCuts(surface,guide),assigned=new Set<string>();
 for(const fixture of [first,second]){
  const faces=new Set(fixture.surface.faces.map(face=>face.id)),local=cuts.filter(cut=>faces.has(cut.faceId));
  requireAnalyticOpening(openingWorldTrace(surface,local),fixture.start,fixture.end);
  for(const cut of local)assigned.add(cut.faceId);
 }
 expect(cuts.every(cut=>assigned.has(cut.faceId))).toBe(true);
 expect(surface).toEqual(before);expect(guide).toEqual(guideBefore);
});

it.each([false,true])('rejects all openings when one independent domain has an unsafe interrupted section (badFirst=%s)',badFirst=>{
 const {first,second,surface}=twoOpeningDomains(true),before=structuredClone(surface);
 const guide=badFirst?[...second.guideEdges,...first.guideEdges]:[...first.guideEdges,...second.guideEdges],guideBefore=structuredClone(guide);
 expect(geometricOpeningCuts(surface,guide)).toEqual([]);
 expect(surface).toEqual(before);expect(guide).toEqual(guideBefore);
});

it.each(['empty','missing vertex','not a mesh edge','branched','closed'] as const)('refuses an unsafe %s guide without changing the source',kind=>{
 const fixture=planarOpeningFixture(),before=structuredClone(fixture.surface),guide=structuredClone(fixture.guideEdges),id=(x:number,y:number)=>fixture.ids[y][x];
 if(kind==='empty')guide.splice(0);
 if(kind==='missing vertex')guide[0].a=randomUUID();
 if(kind==='not a mesh edge')guide.splice(0,guide.length,{a:id(0,0),b:id(6,4)});
 if(kind==='branched')guide.push({a:id(1,1),b:id(0,1)});
 if(kind==='closed')guide.splice(0,guide.length,{a:id(0,0),b:id(1,0)},{a:id(1,0),b:id(1,1)},{a:id(1,1),b:id(0,1)},{a:id(0,1),b:id(0,0)});
 const guideBefore=structuredClone(guide);
 expect(geometricOpeningCuts(fixture.surface,guide)).toEqual([]);
 expect(fixture.surface).toEqual(before);expect(guide).toEqual(guideBefore);
});

it('the independent oracle rejects an equal-area, isometric, exactly sewable sawtooth partition',()=>{
 // Both panels use the same physical zigzag and identity UVs. Their union is
 // the complete square, every triangle may remain isometric, and both seam
 // lengths are equal. Those properties cannot certify a straight cut.
 const path:Point3[]=[[50,0,0],...Array.from({length:50},(_,i)=>[50+(i%2===0?.5:-.5),(i+1)*100/51,0] as Point3),[50,100,0]];
 const zigzag=path.slice(1).map((point,i)=>({a:path[i],b:point})),straight={a:[50,0,0] as Point3,b:[50,100,0] as Point3};
 const polygonArea=(ring:Point3[])=>Math.abs(ring.reduce((sum,a,i)=>{const b=ring[(i+1)%ring.length];return sum+a[0]*b[1]-a[1]*b[0];},0)/2);
 const left:Point3[]=[[0,0,0],...path,[0,100,0]],right:Point3[]=[...path,[100,100,0],[100,0,0]];
 expect(polygonArea(left)).toBeCloseTo(5000,8);expect(polygonArea(right)).toBeCloseTo(5000,8);
 expect(traceLength(zigzag)).toBe(traceLength(zigzag.map(segment=>({a:segment.b,b:segment.a}))));
 expect(traceLength(zigzag)).toBeGreaterThan(100);
 expect(()=>requireAnalyticOpening(zigzag,straight.a,straight.b)).toThrow('Opening leaves the analytic finite line');
 // Positive control: unequal subdivisions and repeated physical face records
 // remain acceptable, so the oracle does not demand a particular node count.
 const mid:Point3=[50,37,0],split=[{a:straight.a,b:mid},{a:mid,b:straight.b}];
 expect(()=>requireAnalyticOpening([...split,...split],straight.a,straight.b)).not.toThrow();
 const gap=[{a:straight.a,b:[50,12.345,0] as Point3},{a:[50,12.346,0] as Point3,b:straight.b}];
 expect(()=>requireAnalyticOpening(gap,straight.a,straight.b)).toThrow('Opening contains a gap');
});
