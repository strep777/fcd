import {expect,it} from 'vitest';
import {randomUUID} from 'node:crypto';
import {rectangle} from '../fixtures';
import {recoverSharedContours} from '../../packages/reference/shared-contour';
import {safeContour} from '../../packages/reference/contour-topology';
import type {BoundaryFit} from '../../packages/reference/image-contour';
import type {Piece,Point} from '../../packages/schema/index';

const square=():Piece=>({...rectangle(),nodes:[[0,0],[10,0],[10,10],[0,10]].map(([xMm,yMm])=>({id:randomUUID(),xMm,yMm})),curves:[],holes:[],allowanceMm:0});
const coordinates=(points:Point[])=>points.map(p=>[p.xMm,p.yMm]).sort((a,b)=>a[0]-b[0]||a[1]-b[1]);
function retainsOriginal(prepare:NonNullable<BoundaryFit['prepare']>){
 const original=square(),before=structuredClone(original),fit:BoundaryFit=()=>undefined;fit.prepare=prepare;
 const answer=recoverSharedContours([original],.8,randomUUID,fit);expect(original).toEqual(before);expect(answer.pieces).toHaveLength(1);expect(safeContour(answer.pieces[0],original,.8)).toBe(true);expect(coordinates(answer.pieces[0].nodes)).toEqual(coordinates(original.nodes));
}

it('falls back to the unchanged graph if prepare omits required chain outputs',()=>{
 // A truncated callback result is invalid evidence, not a replacement graph.
 retainsOriginal(()=>[]);
});

it('rejects a self-crossing prepared cycle without changing source ownership',()=>{
 retainsOriginal(branches=>branches.map(b=>[b.raw[0],b.raw[2],b.raw[1],b.raw[3]]));
});

it('keeps an explicit prepare refusal on the ordinary raw fallback route',()=>{
 let calls=0;retainsOriginal(()=>{calls++;return undefined;});expect(calls).toBe(1);
});

it('keeps the original fit as prepare receiver through the native-coordinate wrapper',()=>{
 const original=square(),before=structuredClone(original),fit:BoundaryFit=()=>undefined;let receiver:unknown;
 fit.prepare=function(this:BoundaryFit){receiver=this;return undefined;};
 recoverSharedContours([original],.8,randomUUID,fit);expect(receiver).toBe(fit);expect(original).toEqual(before);
});

it('declines nonfinite and oversized prepared point arrays before replacing source ownership',()=>{
 retainsOriginal(branches=>branches.map(b=>b.raw.map((p,i)=>i?{...p}:{...p,xMm:NaN})));
 retainsOriginal(branches=>branches.map((b,i)=>i?b.raw:Array.from({length:65537},()=>({...b.raw[0]}))));
});

it.each([.05,1,10])('passes prepare contour nodes and cubic controls in the same world units at scale %s',scale=>{
 const original=square(),world=(p:Point)=>({...p,xMm:100+p.xMm*scale,yMm:-200+p.yMm*scale});
 original.curves=[{id:'straight-cubic',startNodeId:original.nodes[0].id,endNodeId:original.nodes[1].id,c1:world({id:'c1',xMm:3,yMm:0}),c2:world({id:'c2',xMm:7,yMm:0})}];original.nodes=original.nodes.map(world);
 const before=structuredClone(original);let observed:Piece[]|undefined;
 const fit:BoundaryFit=()=>undefined;fit.prepare=(_branches,contours)=>{observed=structuredClone(contours);return undefined;};
 recoverSharedContours([original],.8*scale,randomUUID,fit);expect(original).toEqual(before);expect(observed).toHaveLength(1);
 const received=observed![0],expected=original.curves[0],actual=received.curves![0];
 for(let i=0;i<received.nodes.length;i++)expect(Math.hypot(received.nodes[i].xMm-original.nodes[i].xMm,received.nodes[i].yMm-original.nodes[i].yMm)).toBeLessThanOrEqual(scale*1e-8);
 for(const key of ['c1','c2'] as const)expect(Math.hypot(actual[key].xMm-expected[key].xMm,actual[key].yMm-expected[key].yMm)).toBeLessThanOrEqual(scale*1e-8);
});
