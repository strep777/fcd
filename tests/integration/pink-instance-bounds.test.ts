import {expect,it} from 'vitest';
import {splitStrongPinkInstances} from '../../packages/reference/pink-instance-separators';

type Input={width:number;height:number;groups:number[][];ink:Uint8Array;strongBand:Uint8Array;light:Float32Array};
type XY={x:number;y:number};
const rectangle=(x0:number,y0:number,x1:number,y1:number)=>{const points:XY[]=[];for(let y=y0;y<y1;y++)for(let x=x0;x<x1;x++)points.push({x,y});return points;};
const input=(width=60,height=48):Input=>({width,height,groups:[],ink:new Uint8Array(width*height),strongBand:new Uint8Array(width*height),light:new Float32Array(width*height).fill(.9)});
const ordered=(groups:number[][])=>groups.map(g=>[...g].sort((a,b)=>a-b)).sort((a,b)=>a[0]-b[0]);
function run(f:Input){const before=structuredClone(f),result=splitStrongPinkInstances(f.width,f.height,f.groups,f.ink,f.strongBand,f.light);expect(f,'source pixel groups and all evidence arrays remain unchanged').toEqual(before);return result;}

it.each(['ink','strongBand','light'] as const)('rejects a short %s field before changing any input, including an empty inner group',field=>{
 for(const groups of [[[]],[[42,43,44,45]]]){
  const f=input();f.groups=groups;if(field==='light')f.light=f.light.slice(0,-1);else f[field]=f[field].slice(0,-1);const before=structuredClone(f);
  expect(()=>splitStrongPinkInstances(f.width,f.height,f.groups,f.ink,f.strongBand,f.light)).toThrow('IMAGE_LIMIT');expect(f).toEqual(before);
 }
});

it('keeps an empty outer group list empty without requiring unused evidence fields',()=>{
 const f=input();f.ink=new Uint8Array();f.strongBand=new Uint8Array();f.light=new Float32Array();expect(run(f)).toEqual([]);
});

it('retains a single source pixel and ignores valid empty inner groups',()=>{
 const f=input();f.groups=[[],[f.width*4+7],[]];expect(run(f)).toEqual([[f.width*4+7]]);
});

// Independent pixel partitions precede any call. The left source component
// has a real empty hole; the right component is disconnected. Neither output
// labels nor a second implementation supplies expected ownership.
const source=[rectangle(0,0,20,18).filter(p=>!(p.x>=6&&p.x<12&&p.y>=6&&p.y<12)),rectangle(26,4,34,14)];
it.each([
 {x:0,y:0,mirror:false},{x:26,y:0,mirror:true},
 {x:0,y:30,mirror:true},{x:26,y:30,mirror:false}
])('preserves the prescribed hole and disconnected owners at image corner $x,$y, mirror=$mirror',variant=>{
 const f=input(),expected=source.map(g=>g.map(p=>(p.y+variant.y)*f.width+variant.x+(variant.mirror?33-p.x:p.x)));
 const selected=new Set(expected.flat());
 // Off-mask values must not provide new separator evidence or be claimed.
 for(let i=0;i<f.ink.length;i++)if(!selected.has(i)){f.ink[i]=i%2;f.strongBand[i]=+(i%3===0);f.light[i]=(i%7)/6;}
 for(const combined of [false,true]){
  f.groups=combined?[[...expected[1],...expected[0]].reverse()]:expected.map(g=>[...g]);const result=run(f);
  expect(ordered(result),'each known source component owns exactly its prescribed pixels').toEqual(ordered(expected));
  expect(new Set(result.flat()).size,'no duplicated pixel ownership').toBe(result.flat().length);
 }
});

it('keeps two source-supported sides distinct without filling an independently empty hole',()=>{
 const f=input(64,48),points=rectangle(10,8,54,40).filter(p=>!(p.x>=20&&p.x<24&&p.y>=18&&p.y<23));f.groups=[points.map(p=>p.y*f.width+p.x)];
 // A full-height dark source divider has bright material on both sides.
 // Ownership of its two dark columns is deliberately not prescribed.
 for(let y=8;y<40;y++)for(let x=31;x<33;x++){const i=y*f.width+x;f.ink[i]=1;f.strongBand[i]=1;f.light[i]=.2;}
 const result=run(f),owner=(x:number,y:number)=>result.findIndex(g=>g.includes(y*f.width+x)),left=owner(15,12),right=owner(49,12);
 expect(result).toHaveLength(2);expect(left).toBeGreaterThanOrEqual(0);expect(right).toBeGreaterThanOrEqual(0);expect(left).not.toBe(right);
 expect([...result.flat()].sort((a,b)=>a-b),'complete source coverage with no extra hole/background pixels').toEqual([...f.groups[0]].sort((a,b)=>a-b));
 for(const p of points){if(p.x<30)expect(owner(p.x,p.y)).toBe(left);if(p.x>33)expect(owner(p.x,p.y)).toBe(right);}
});
