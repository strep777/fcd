import {expect,it} from 'vitest';
import {randomUUID} from 'node:crypto';
import type {Binding} from '../../packages/schema/index';
import {insertTrimBoundary} from '../../apps/desktop/main/trim-boundary';
function mesh():NonNullable<Binding['trim']>{const ids=Array.from({length:3},()=>randomUUID());return {vertices:[[2709.0062,5.1084],[2709.1605,2.8716],[2717.2754,4.2603]].map(([xMm,yMm],i)=>({id:ids[i],xMm,yMm})),triangles:[{faceId:randomUUID(),vertices:ids as [string,string,string],barycentric:[[1,0,0],[0,1,0],[0,0,1]]}],boundary:[],holes:[]};}
it('real canine clipping-grid endpoint maps to its existing trim vertex within the bounded contour tolerance',()=>{const trim=mesh(),before=structuredClone(trim);expect(insertTrimBoundary(trim,[2709.0062,5.1085])).toBe(trim.vertices[0].id);expect(trim).toEqual(before);expect(Math.hypot(trim.vertices[0].xMm-2709.0062,trim.vertices[0].yMm-5.1085)).toBeLessThanOrEqual(.0002);});
it('endpoints beyond the clipping-grid tolerance remain rejected',()=>{const trim=mesh();expect(()=>insertTrimBoundary(trim,[2709.0062,5.1094])).toThrow('COLOR_CUT_BOUNDARY');expect(trim.vertices).toHaveLength(3);});
