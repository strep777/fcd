import {expect,it} from 'vitest';
import {sourceSpliceBase} from '../../packages/reference/image-tip-source-tube';
import {sourceJunctions} from '../../packages/reference/image-tip-junctions';
import type {Point,Piece} from '../../packages/schema/index';

type Geometry={nodes:Point[];curves:NonNullable<Piece['curves']>};
const p=(xMm:number,yMm:number,id=''):Point=>({id,xMm,yMm});
const line=(y=0):Geometry=>({nodes:[p(0,y,'a'),p(10,y,'b')],curves:[]});
function checked(measured:Geometry,raw:Point[],closed=false){const before=structuredClone({measured,raw});let serial=0;const result=sourceSpliceBase(measured,raw,closed,()=>`sample-${++serial}`);expect({measured,raw}).toEqual(before);return result;}

it('retains a measured cubic with independently known .9px peak and rejects its 6px counterpart',()=>{
 for(const height of [1.2,8]){
  const measured=line();measured.curves=[{id:'c',startNodeId:'a',endNodeId:'b',c1:p(10/3,height),c2:p(20/3,height)}];
  // With equal control heights, y(t)=3*h*t*(1-t), maximum=.75*h.
  expect(checked(measured,line().nodes)).toBe(height===1.2);
 }
});

it('checks both source and raster paths, preserving a raw notch and rejecting an extra tail',()=>{
 expect(checked(line(),[p(0,0),p(5,-2),p(10,0)])).toBe(false);
 expect(checked({nodes:[p(2,0,'a'),p(8,0,'b')],curves:[]},line().nodes)).toBe(false);
 const measured:Geometry={nodes:[p(0,0,'a'),p(4.999,0,'b'),p(5,1.06,'c'),p(5.001,0,'d'),p(10,0,'e')],curves:[]};
 expect(checked(measured,line().nodes)).toBe(false);
});

it.each([NaN,Infinity,-Infinity])('declines nonfinite source coordinates %s without sampling them',coordinate=>{
 const measured:Geometry={nodes:[p(coordinate,0,'a'),p(coordinate,10,'b')],curves:[]};expect(checked(measured,structuredClone(measured.nodes))).toBe(false);
});

it('declines resource-heavy but identical input paths without changing them',()=>{
 const long:Geometry={nodes:[p(0,0,'a'),p(1e9,0,'b')],curves:[]};expect(checked(long,structuredClone(long.nodes))).toBe(false);
 const dense:Geometry={nodes:Array.from({length:1002},(_,i)=>p(i*.001,0,`d${i}`)),curves:[]};expect(checked(dense,structuredClone(dense.nodes))).toBe(false);
});

type Branch=Parameters<typeof sourceJunctions>[0][number];
const branch=(raw:Point[]):Branch=>({raw,closed:false,colors:['#ffffff','#111111']});
it('rejects empty, nonfinite and enormous junction arms before allocating resampled points',()=>{
 const rgba=new Uint8Array(32*32*4).fill(255);
 for(const raw of [[],[p(NaN,2),p(4,4)],[p(2,2),p(Infinity,4)],[p(2,2),p(1e9,4)]]){
  const branches=[branch(raw)],before=structuredClone(branches);expect(sourceJunctions(branches,32,32,rgba)).toBeUndefined();expect(branches).toEqual(before);
 }
});

it('validates image dimensions and RGBA length before junction preparation',()=>{
 const branches=[branch([p(2,2),p(4,4)])],before=structuredClone(branches);
 expect(()=>sourceJunctions(branches,0,32,new Uint8Array())).toThrow('IMAGE_LIMIT');
 expect(()=>sourceJunctions(branches,32,32,new Uint8Array(32*32*4-1))).toThrow('IMAGE_LIMIT');expect(branches).toEqual(before);
});

it('moves all three source-supported arms to one analytic material junction',()=>{
 const width=64,height=64,rgba=new Uint8Array(width*height*4),colors=[[230,50,70],[40,90,230],[40,210,90]];
 for(let y=0;y<height;y++)for(let x=0;x<width;x++)rgba.set([...colors[y>=32?2:x<32?0:1],255],(y*width+x)*4);
 const branches=[{...branch([p(31,31,'j'),p(5,31,'l')]),colors:['#e63246','#28d25a']},{...branch([p(31,31,'j'),p(59,31,'r')]),colors:['#285ae6','#28d25a']},{...branch([p(31,31,'j'),p(31,5,'t')]),colors:['#e63246','#285ae6']}],before=structuredClone(branches),bytes=rgba.slice();
 const result=sourceJunctions(branches,width,height,rgba);expect(result).toBeDefined();expect(branches).toEqual(before);expect(rgba).toEqual(bytes);
 for(const arm of result!.output)expect(Math.hypot(arm[0].xMm-32,arm[0].yMm-32)).toBeLessThan(1e-8);
});
