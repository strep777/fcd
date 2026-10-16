import {expect,it} from 'vitest';
import {sourceTipOracles,sourceWindows} from '../fixtures/source-tip-oracle';
import {loadSourceFixture} from '../fixtures/source-tip-jpeg';

const expectedCounts={'crown':[7,7],'leg-inner':[14,11],'leg-outer':[19,12]} as const;
const cases=sourceWindows.flatMap(cap=>cap.windows.map((window,side)=>({name:cap.name,side,window})));
type Window=typeof cases[number]['window'];
function positions(window:Window):{x:number;y:number;station:number}[]{
 const points=[];
 for(let station=window.stations[0];station<=window.stations[1];station++)for(let coordinate=window.range[0];coordinate<=window.range[1];coordinate++)points.push(window.axis==='x'?{x:coordinate,y:station,station}:{x:station,y:coordinate,station});
 return points;
}
const has=(window:Window,p:{x:number;y:number})=>window.axis==='x'?p.x>=window.range[0]&&p.x<=window.range[1]&&p.y>=window.stations[0]&&p.y<=window.stations[1]:p.y>=window.range[0]&&p.y<=window.range[1]&&p.x>=window.stations[0]&&p.x<=window.stations[1];
function unchangedOtherWindows(rgba:Uint8Array,before:Uint8Array,width:number,target:Window){
 for(const entry of cases)if(entry.window!==target)for(const p of positions(entry.window)){
  const index=4*(p.y*width+p.x);
  expect(Buffer.from(rgba.subarray(index,index+4)).equals(Buffer.from(before.subarray(index,index+4)))).toBe(true);
 }
}

it.each(sourceWindows)('$name has two independently observed source lines and complete reference-to-cap seams',async spec=>{
 const source=await loadSourceFixture(),before=source.rgba.slice(),cap=sourceTipOracles(source.rgba,source.width,source.height).find(c=>c.name===spec.name)!;
 expect(cap).toBeDefined();expect(cap.lines.map(line=>line.points.length)).toStrictEqual([...expectedCounts[spec.name]]);
 expect([cap.tip.x,cap.tip.y,...Object.values(cap.bounds)].every(Number.isFinite)).toBe(true);
 const second=cap.reference.findIndex((p,i)=>i>0&&p.x===cap.tip.x&&p.y===cap.tip.y);expect(second).toBeGreaterThan(1);
 const roundoff=64*Number.EPSILON*Math.max(1,...Object.values(cap.bounds).map(Math.abs));
 expect(cap.ends).toHaveLength(2);
 for(const [side,ray] of [cap.reference.slice(0,second),cap.reference.slice(second)].entries()){
  expect(ray[0]).toStrictEqual(cap.tip);const end=ray.at(-1)!;
  expect(Math.hypot(end.x-cap.ends[side].x,end.y-cap.ends[side].y)).toBeLessThanOrEqual(roundoff);
  expect(Math.min(Math.abs(end.x-cap.bounds.left),Math.abs(end.x-cap.bounds.right),Math.abs(end.y-cap.bounds.top),Math.abs(end.y-cap.bounds.bottom))).toBeLessThanOrEqual(roundoff);
  for(const p of ray)expect(cap.inCap(p)).toBe(true);
  for(let i=1;i<ray.length;i++)expect(Math.hypot(ray[i].x-ray[i-1].x,ray[i].y-ray[i-1].y)).toBeLessThanOrEqual(.25+roundoff);
 }
 // Independently evaluate finite segments using endpoint and perpendicular
 // distances, rather than repeating the oracle's clamped projection formula.
 const finiteDistance=(p:{x:number;y:number})=>Math.min(...cap.ends.map(end=>{
  const dx=end.x-cap.tip.x,dy=end.y-cap.tip.y,px=p.x-cap.tip.x,py=p.y-cap.tip.y,dot=px*dx+py*dy,length2=dx*dx+dy*dy;
  const endpoint=Math.min(Math.hypot(px,py),Math.hypot(p.x-end.x,p.y-end.y));
  return dot>=0&&dot<=length2?Math.min(endpoint,Math.abs(px*dy-py*dx)/Math.hypot(dx,dy)):endpoint;
 }));
 const corners=[{x:cap.bounds.left,y:cap.bounds.top},{x:cap.bounds.left,y:cap.bounds.bottom},{x:cap.bounds.right,y:cap.bounds.top},{x:cap.bounds.right,y:cap.bounds.bottom}];
 for(const p of [cap.tip,...cap.ends,...corners]){
  expect(Math.abs(cap.distance(p)-finiteDistance(p))).toBeLessThanOrEqual(roundoff);
 }
 for(const end of cap.ends){
  const beyond={x:cap.tip.x+2*(end.x-cap.tip.x),y:cap.tip.y+2*(end.y-cap.tip.y)};
  expect(cap.inCap(beyond)).toBe(false);
  expect(cap.distance(beyond)).toBeGreaterThan(0);
  expect(Math.abs(cap.distance(beyond)-finiteDistance(beyond))).toBeLessThanOrEqual(roundoff);
 }
 expect(Buffer.from(source.rgba).equals(Buffer.from(before))).toBe(true);
});

it.each(cases)('$name side$side rejects zero local RGB contrast without corrupting any other source window',async ({window})=>{
 const source=await loadSourceFixture(),rgba=source.rgba.slice(),sourceBefore=source.rgba.slice(),points=positions(window),other=cases.filter(c=>c.window!==window).map(c=>c.window);
 for(let station=window.stations[0];station<=window.stations[1];station++){
  const row=points.filter(p=>p.station===station);
  // The two crown profiles share x823. Keep that original pixel as the row
  // color when making this side uniformly weak, leaving the other side intact.
  const anchor=row.find(p=>other.some(w=>has(w,p)))??row[0],index=4*(anchor.y*source.width+anchor.x),color=source.rgba.slice(index,index+4);
  for(const p of row)rgba.set(color,4*(p.y*source.width+p.x));
 }
 unchangedOtherWindows(rgba,source.rgba,source.width,window);
 const before=rgba.slice();expect(()=>sourceTipOracles(rgba,source.width,source.height)).toThrow('WEAK_SOURCE_SUPPORT');
 expect(Buffer.from(rgba).equals(Buffer.from(before))).toBe(true);
 expect(Buffer.from(source.rgba).equals(Buffer.from(sourceBefore))).toBe(true);
});

it.each(cases)('$name side$side rejects one alpha254 observation with all other source windows unchanged',async ({window})=>{
 const source=await loadSourceFixture(),rgba=source.rgba.slice(),sourceBefore=source.rgba.slice(),other=cases.filter(c=>c.window!==window).map(c=>c.window),point=positions(window).find(p=>!other.some(w=>has(w,p)))!;
 expect(point).toBeDefined();rgba[4*(point.y*source.width+point.x)+3]=254;
 unchangedOtherWindows(rgba,source.rgba,source.width,window);
 const before=rgba.slice();expect(()=>sourceTipOracles(rgba,source.width,source.height)).toThrow('MISSING_SOURCE_SUPPORT');
 expect(Buffer.from(rgba).equals(Buffer.from(before))).toBe(true);
 expect(Buffer.from(source.rgba).equals(Buffer.from(sourceBefore))).toBe(true);
});
